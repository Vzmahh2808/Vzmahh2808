import { SLOT_MS, dayId, parseChallenges, resolveChallenge, type Challenge, type ResolvedChallenge } from "./chain/challenge";
import { MAINNET_RPC, SolanaRpc } from "./chain/rpc";
import { Game, itemDescription, itemName, scoreOf, xpToNext } from "./game/game";
import { itemDef, monsterDef } from "./game/data";
import { replayOf } from "./game/replay";
import { randomSeed } from "./game/rng";
import {
  clearSave,
  loadChallenge,
  loadGame,
  loadScores,
  recordScore,
  saveChallenge,
  saveGame,
  type ScoreEntry,
} from "./game/save";
import { INVENTORY_LIMIT, PLAYER_ID, type Point } from "./game/types";
import { Renderer } from "./ui/renderer";
import { Sound } from "./ui/sound";

type Mode = "title" | "play" | "inventory" | "help" | "scores" | "over" | "daily";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
};

const canvas = $<HTMLCanvasElement>("#view");
const overlay = $<HTMLDivElement>("#overlay");
const card = $<HTMLDivElement>("#overlay-card");
const logEl = $<HTMLDivElement>("#log");
const lookEl = $<HTMLSpanElement>("#look");

const renderer = new Renderer(canvas);
const sound = new Sound();
let game: Game | null = null;
let mode: Mode = "title";
let travel: Point[] = [];
let travelTimer = 0;
let exploring = false;
let scoreRecorded = false;
let inventorySel = 0;
/** Daily challenge of the current run; null for a free run. */
let challenge: ResolvedChallenge | null = null;
/** Challenge resolved and shown on the intro screen, waiting for "Начать". */
let pendingChallenge: ResolvedChallenge | null = null;
/** Bumped on every daily-challenge request so a slow answer cannot overwrite a newer screen. */
let dailyRequest = 0;

// ---------------------------------------------------------------- rendering loop

let needsDraw = true;
function requestDraw(): void {
  needsDraw = true;
}
function frame(now: number): void {
  if (game && (needsDraw || renderer.hasAnimations)) {
    renderer.draw(game, now);
    needsDraw = false;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

new ResizeObserver(() => {
  renderer.resize();
  requestDraw();
}).observe(canvas);

// ---------------------------------------------------------------- HUD

function updateHud(): void {
  if (!game) return;
  const p = game.player;
  const hpPct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
  const hpBar = $<HTMLDivElement>("#hp-bar");
  hpBar.style.width = `${hpPct}%`;
  hpBar.classList.toggle("low", hpPct < 30);
  $("#hp-text").textContent = `${p.hp} / ${p.maxHp}`;
  const need = xpToNext(p.level);
  const prev = p.level > 1 ? xpToNext(p.level - 1) : 0;
  const xpPct = Math.max(0, Math.min(100, ((p.xp - prev) / (need - prev)) * 100));
  $<HTMLDivElement>("#xp-bar").style.width = `${xpPct}%`;
  $("#xp-text").textContent = `${p.xp} / ${need}`;
  $("#st-depth").textContent = `${game.state.depth}`;
  $("#st-level").textContent = `${p.level}`;
  const [lo, hi] = game.attackRange();
  $("#st-atk").textContent = `${lo}–${hi}`;
  $("#st-def").textContent = `${game.defense()}`;
  $("#st-gold").textContent = `${p.gold}`;
  $("#st-turn").textContent = `${game.state.turn}`;
  const status = $("#st-status");
  status.textContent = p.poison > 0 ? `Отравлен (${p.poison})` : "";
  $("#eq-weapon").textContent = p.weapon ? itemName(p.weapon) : "кулаки (1–3)";
  $("#eq-armor").textContent = p.armor ? itemName(p.armor) : "нет";
  $("#inv-count").textContent = `${p.inventory.length}/${INVENTORY_LIMIT}`;

  const list = $<HTMLOListElement>("#inv-list");
  list.innerHTML = "";
  if (p.inventory.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "пусто";
    list.appendChild(li);
  }
  p.inventory.forEach((item, i) => {
    const def = itemDef(item.defId);
    const li = document.createElement("li");
    li.innerHTML = `<span class="key">${keyFor(i)}</span><span class="glyph" style="color:${def.color}">${def.glyph}</span><span>${def.name}</span>`;
    li.title = def.description;
    li.addEventListener("click", () => {
      if (mode !== "play") return;
      act(() => game!.useItem(i));
    });
    list.appendChild(li);
  });

  renderLog();
}

function keyFor(i: number): string {
  return "abcdefghijkl".charAt(i);
}

function renderLog(): void {
  if (!game) return;
  const entries = game.state.log.slice(-40);
  const turn = game.state.turn;
  logEl.innerHTML = entries
    .map((e) => `<div class="entry ${e.kind}${turn - e.turn > 3 ? " old" : ""}">${escapeHtml(e.text)}</div>`)
    .join("");
  logEl.scrollTop = logEl.scrollHeight;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
}

function flushEvents(): void {
  if (!game) return;
  for (const e of game.events) {
    renderer.handle(e);
    sound.handle(e, PLAYER_ID);
  }
  game.events = [];
}

// ---------------------------------------------------------------- game flow

/** Run a player action; if it consumed a turn, persist and refresh. */
function act(action: () => boolean): void {
  if (!game || mode !== "play") return;
  const took = action();
  flushEvents();
  if (took) {
    saveGame(game.snapshot());
    if (game.state.status !== "playing") {
      finishGame();
    }
  }
  updateHud();
  requestDraw();
}

function finishGame(): void {
  if (!game || scoreRecorded) return;
  scoreRecorded = true;
  stopTravel();
  clearSave();
  const s = game.state;
  const entry: ScoreEntry = {
    score: scoreOf(s),
    depth: s.depth,
    level: s.player.level,
    turns: s.turn,
    outcome: s.status === "won" ? "won" : "dead",
    cause: s.deathCause,
    date: new Date().toISOString().slice(0, 10),
  };
  const { rank } = recordScore(entry);
  setTimeout(() => showGameOver(entry, rank), 1300);
}

function startNewGame(daily: ResolvedChallenge | null = null): void {
  game = Game.newGame(daily ? daily.seed : randomSeed());
  challenge = daily;
  saveChallenge(daily);
  if (daily) game.log(`Испытание ${daily.id}: подземелье построено из блока Solana №${daily.blockSlot}.`, "system");
  scoreRecorded = false;
  renderer.reset();
  renderer.clearFade();
  saveGame(game.snapshot());
  enterPlay();
}

function continueGame(): boolean {
  const state = loadGame();
  if (!state) return false;
  try {
    game = Game.fromState(state);
  } catch {
    clearSave();
    return false;
  }
  const saved = loadChallenge();
  challenge = saved && saved.seed === state.seed ? saved : null;
  scoreRecorded = false;
  renderer.reset();
  renderer.clearFade();
  game.log("Игра продолжена.", "system");
  enterPlay();
  return true;
}

function enterPlay(): void {
  mode = "play";
  hideOverlay();
  renderer.resize();
  updateHud();
  requestDraw();
}

// ---------------------------------------------------------------- travel / auto-explore

function stopTravel(): void {
  travel = [];
  exploring = false;
  renderer.path = [];
  if (travelTimer) {
    clearInterval(travelTimer);
    travelTimer = 0;
  }
  requestDraw();
}

function startTravel(path: Point[], explore: boolean): void {
  if (!game || path.length === 0) return;
  if (game.visibleMonsters().length > 0) {
    game.log("Рядом враги — сначала разберитесь с ними.", "warn");
    updateHud();
    return;
  }
  stopTravel();
  travel = path;
  exploring = explore;
  renderer.path = path;
  travelTimer = window.setInterval(travelTick, 70);
}

function travelTick(): void {
  if (!game || mode !== "play") return stopTravel();
  if (travel.length === 0) {
    if (exploring) {
      const next = game.exploreTarget();
      const path = next ? game.pathTo(next.x, next.y) : [];
      if (path.length === 0) {
        game.log("Этаж исследован. Ищите лестницу вниз (>).", "system");
        updateHud();
        return stopTravel();
      }
      travel = path;
      renderer.path = path;
    } else {
      return stopTravel();
    }
  }
  const step = travel.shift()!;
  const dx = step.x - game.player.x;
  const dy = step.y - game.player.y;
  const moved = game.movePlayer(dx, dy);
  flushEvents();
  saveGame(game.snapshot());
  updateHud();
  requestDraw();
  renderer.path = travel;
  if (!moved || game.state.status !== "playing" || game.visibleMonsters().length > 0) {
    if (game.visibleMonsters().length > 0) game.log("Вы замечаете врага и останавливаетесь.", "warn");
    updateHud();
    if (game.state.status !== "playing") finishGame();
    return stopTravel();
  }
}

// ---------------------------------------------------------------- overlays

function showOverlay(html: string): void {
  card.innerHTML = html;
  overlay.classList.remove("hidden");
}
function hideOverlay(): void {
  overlay.classList.add("hidden");
}

function showTitle(): void {
  mode = "title";
  stopTravel();
  const hasSave = loadGame() !== null;
  showOverlay(`
    <h1>Сердце подземелья</h1>
    <p class="sub">Пошаговый рогалик. Спуститесь на 10-й этаж, одолейте Владыку и заберите артефакт. Смерть окончательна.</p>
    <div class="menu">
      <button data-go="continue" ${hasSave ? "" : "disabled"}>Продолжить <span class="hint">C</span></button>
      <button data-go="new">Новая игра <span class="hint">N</span></button>
      <button data-go="daily">Испытание дня <span class="hint">D</span></button>
      <button data-go="scores">Рекорды <span class="hint">R</span></button>
      <button data-go="help">Как играть <span class="hint">?</span></button>
    </div>
  `);
}

function showHelp(): void {
  mode = "help";
  showOverlay(`
    <h2>Как играть</h2>
    <div class="keys">
      <kbd>← ↑ → ↓</kbd><span>Движение (также WASD, цифры 1–9, клавиши HJKLYUBN)</span>
      <kbd>. или 5</kbd><span>Пропустить ход</span>
      <kbd>G</kbd><span>Подобрать предмет</span>
      <kbd>I</kbd><span>Открыть рюкзак</span>
      <kbd>a–l</kbd><span>В рюкзаке: использовать или надеть предмет</span>
      <kbd>&gt;</kbd><span>Спуститься по лестнице</span>
      <kbd>O</kbd><span>Автоисследование этажа</span>
      <kbd>Клик</kbd><span>Идти к клетке на карте</span>
      <kbd>M</kbd><span>Включить или выключить звук</span>
      <kbd>Esc</kbd><span>Меню</span>
    </div>
    <h2 style="margin-top:16px">Обозначения</h2>
    <div class="glyphs">
      <div><b style="color:#fff3b0">@</b> вы</div>
      <div><b style="color:#ffd32a">&gt;</b> лестница вниз</div>
      <div><b style="color:#c08a4b">+</b> дверь</div>
      <div><b style="color:#ff6b6b">!</b> зелье</div>
      <div><b style="color:#f6e58d">?</b> свиток</div>
      <div><b style="color:#dfe6e9">)</b> оружие</div>
      <div><b style="color:#a4b0be">[</b> броня</div>
      <div><b style="color:#ffd32a">$</b> золото</div>
      <div><b style="color:#b08968">r</b> крыса, <b style="color:#8fbf5f">k</b> кобольд</div>
      <div><b style="color:#7fb069">g</b> гоблин, <b style="color:#e0e0d0">s</b> скелет</div>
      <div><b style="color:#6a994e">o</b> орк, <b style="color:#4f8a5b">T</b> тролль</div>
      <div><b style="color:#ff4d6d">L</b> Владыка подземелья</div>
    </div>
    <p class="sub" style="margin-top:14px">Здоровье медленно восстанавливается само. Уровень растёт с опытом. Время от времени появляются новые монстры, так что не задерживайтесь.</p>
    <div class="menu"><button data-go="back">Назад <span class="hint">Esc</span></button></div>
  `);
}

function showScores(): void {
  mode = "scores";
  const scores = loadScores();
  const rows = scores.length
    ? scores
        .map(
          (s, i) =>
            `<tr><td>${i + 1}</td><td>${s.score}</td><td>${s.depth}</td><td>${s.level}</td><td>${s.turns}</td><td>${
              s.outcome === "won" ? "победа" : escapeHtml(s.cause)
            }</td><td>${s.date}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="7" class="muted">Пока пусто. Станьте первым.</td></tr>`;
  showOverlay(`
    <h2>Рекорды</h2>
    <table><thead><tr><th>#</th><th>Очки</th><th>Этаж</th><th>Ур.</th><th>Ходов</th><th>Итог</th><th>Дата</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="menu"><button data-go="back">Назад <span class="hint">Esc</span></button></div>
  `);
}

function showGameOver(entry: ScoreEntry, rank: number): void {
  if (!game) return;
  mode = "over";
  const won = entry.outcome === "won";
  showOverlay(`
    <h1>${won ? "Победа!" : "Вы погибли"}</h1>
    <p class="sub">${
      won
        ? `Сердце подземелья ваше. Пройдено ${entry.turns} ходов.`
        : `Этаж ${entry.depth}, уровень ${entry.level}, ${entry.turns} ходов. Причина: ${escapeHtml(entry.cause)}.`
    }</p>
    <div class="big">${entry.score} очков</div>
    <p>${rank >= 0 ? `Место в таблице рекордов: <b>${rank + 1}</b>.` : "В десятку лучших не попало."}</p>
    ${replayBlock()}
    <div class="menu">
      ${challenge ? `<button data-go="copy-replay">Скопировать запись партии</button>` : ""}
      <button data-go="new">Новая игра <span class="hint">N</span></button>
      <button data-go="scores">Рекорды <span class="hint">R</span></button>
    </div>
  `);
}

/** For a challenge run: the replay anyone can re-play to check the score. */
function replayBlock(): string {
  const replay = game ? replayOf(game) : null;
  if (!challenge || !replay) return "";
  return `
    <h2 style="margin-top:16px">Запись партии</h2>
    <p class="sub">По записи любой может заново сыграть партию и проверить счёт: <code>npm run challenge -- check запись.json</code>.</p>
    <textarea id="replay-out" readonly rows="4" aria-label="Запись партии">${escapeHtml(JSON.stringify({ ...replay, challenge }))}</textarea>`;
}

function copyReplay(): void {
  const area = card.querySelector<HTMLTextAreaElement>("#replay-out");
  const btn = card.querySelector<HTMLButtonElement>('[data-go="copy-replay"]');
  if (!area || !btn) return;
  const selectInstead = () => {
    area.focus();
    area.select();
    btn.textContent = "Запись выделена, скопируйте её вручную";
  };
  if (!navigator.clipboard) return selectInstead();
  navigator.clipboard.writeText(area.value).then(() => {
    btn.textContent = "Запись скопирована";
  }, selectInstead);
}

// ---------------------------------------------------------------- daily challenge

const dailyBack = `<div class="menu"><button data-go="back">Назад <span class="hint">Esc</span></button></div>`;

function formatWait(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return "минуту";
  if (minutes < 60) return `${minutes} мин`;
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

function explorerLink(slot: number, rpcUrl: string): string {
  const cluster = rpcUrl.includes("devnet") ? "?cluster=devnet" : rpcUrl.includes("testnet") ? "?cluster=testnet" : "";
  return `<a href="https://explorer.solana.com/block/${slot}${cluster}" target="_blank" rel="noopener">№${slot}</a>`;
}

/**
 * Finds today's announced challenge (or the one given as ?challenge=id@slot), resolves its
 * Solana block and shows the intro. ?rpc=URL switches the RPC endpoint.
 */
async function showDaily(): Promise<void> {
  mode = "daily";
  stopTravel();
  pendingChallenge = null;
  const request = ++dailyRequest;
  const stale = () => request !== dailyRequest || mode !== "daily";
  showOverlay(`<h2>Испытание дня</h2><p class="sub">Загружаем объявление и блок Solana…</p>${dailyBack}`);

  const params = new URLSearchParams(location.search);
  const rpcUrl = params.get("rpc") || MAINNET_RPC;
  try {
    let target: Challenge | undefined;
    const override = params.get("challenge");
    if (override) {
      const [id, slot] = override.split("@");
      target = parseChallenges([{ id, slot: Number(slot) }])[0];
    } else {
      const res = await fetch("./challenges.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`список испытаний недоступен (HTTP ${res.status})`);
      const today = dayId(new Date());
      target = parseChallenges(await res.json()).find((c) => c.id === today);
    }
    if (stale()) return;
    if (!target) {
      showOverlay(`<h2>Испытание дня</h2><p>На сегодня испытание не объявлено.</p>${dailyBack}`);
      return;
    }

    const r = await resolveChallenge(new SolanaRpc(rpcUrl), target);
    if (stale()) return;
    if (r.state === "pending") {
      showOverlay(`
        <h2>Испытание ${escapeHtml(target.id)}</h2>
        <p>Подземелье появится после блока Solana №${target.slot}, примерно через ${formatWait(r.slotsLeft * SLOT_MS)}.</p>
        <div class="menu"><button data-go="daily">Проверить снова</button><button data-go="back">Назад <span class="hint">Esc</span></button></div>`);
      return;
    }

    const c = r.challenge;
    pendingChallenge = c;
    showOverlay(`
      <h2>Испытание ${escapeHtml(c.id)}</h2>
      <p class="sub">Подземелье построено из хеша блока Solana, которого ещё не существовало, когда испытание объявили. Заранее его не знал никто, даже мы. Все игроки сегодня получают одно и то же подземелье.</p>
      <dl class="facts">
        <dt>Блок</dt><dd>${explorerLink(c.blockSlot, rpcUrl)}</dd>
        <dt>Хеш</dt><dd>${escapeHtml(c.blockhash)}</dd>
        <dt>Seed</dt><dd>${c.seed}</dd>
      </dl>
      <div class="menu">
        <button data-go="daily-start">Начать <span class="hint">Enter</span></button>
        <button data-go="back">Назад <span class="hint">Esc</span></button>
      </div>`);
  } catch (e) {
    if (stale()) return;
    const message = e instanceof Error ? e.message : String(e);
    showOverlay(`
      <h2>Испытание дня</h2>
      <p>Не удалось получить испытание: ${escapeHtml(message)}</p>
      <p class="sub">Другой RPC можно указать в адресе страницы: <code>?rpc=https://…</code></p>
      <div class="menu"><button data-go="daily">Попробовать снова</button><button data-go="back">Назад <span class="hint">Esc</span></button></div>`);
  }
}

function showInventory(): void {
  if (!game) return;
  mode = "inventory";
  const inv = game.player.inventory;
  inventorySel = Math.min(inventorySel, Math.max(0, inv.length - 1));
  const items = inv.length
    ? inv
        .map((item, i) => {
          const def = itemDef(item.defId);
          const verb = def.kind === "weapon" || def.kind === "armor" ? "Надеть" : "Использовать";
          return `<li data-i="${i}" class="${i === inventorySel ? "sel" : ""}">
            <span class="key muted">${keyFor(i)}</span>
            <span style="color:${def.color};font-family:var(--font-mono)">${def.glyph}</span>
            <span>${def.name}<div class="desc">${itemDescription(item)}</div></span>
            <span class="act"><button data-use="${i}">${verb}</button><button data-drop="${i}">Бросить</button></span>
          </li>`;
        })
        .join("")
    : `<li class="muted">Рюкзак пуст.</li>`;
  showOverlay(`
    <div class="inv-modal">
      <h2>Рюкзак <span class="muted">${inv.length}/${INVENTORY_LIMIT}</span></h2>
      <ol>${items}</ol>
      <p class="sub" style="margin-top:12px">Буква или Enter — использовать, D — бросить, Esc — закрыть.</p>
    </div>
  `);
}

overlay.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement;
  const go = target.closest<HTMLElement>("[data-go]")?.dataset.go;
  if (go) return handleMenu(go);
  const use = target.closest<HTMLElement>("[data-use]")?.dataset.use;
  if (use !== undefined) return inventoryAction(Number(use), false);
  const drop = target.closest<HTMLElement>("[data-drop]")?.dataset.drop;
  if (drop !== undefined) return inventoryAction(Number(drop), true);
  const row = target.closest<HTMLElement>("li[data-i]");
  if (row) {
    inventorySel = Number(row.dataset.i);
    showInventory();
  }
});

function handleMenu(go: string): void {
  switch (go) {
    case "new":
      startNewGame();
      break;
    case "daily":
      void showDaily();
      break;
    case "daily-start":
      if (pendingChallenge) startNewGame(pendingChallenge);
      break;
    case "copy-replay":
      copyReplay();
      break;
    case "continue":
      if (!continueGame()) showTitle();
      break;
    case "scores":
      showScores();
      break;
    case "help":
      showHelp();
      break;
    case "back":
      if (game && game.state.status === "playing") enterPlay();
      else showTitle();
      break;
  }
}

function inventoryAction(index: number, drop: boolean): void {
  if (!game) return;
  mode = "play";
  hideOverlay();
  act(() => (drop ? game!.dropItem(index) : game!.useItem(index)));
}

// ---------------------------------------------------------------- input

const DIR_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], q: [-1, -1], e: [1, -1], z: [-1, 1], c: [1, 1],
  ц: [0, -1], ы: [0, 1], ф: [-1, 0], в: [1, 0], й: [-1, -1], у: [1, -1], я: [-1, 1], с: [1, 1],
  k: [0, -1], j: [0, 1], h: [-1, 0], l: [1, 0], y: [-1, -1], u: [1, -1], b: [-1, 1], n: [1, 1],
  "8": [0, -1], "2": [0, 1], "4": [-1, 0], "6": [1, 0], "7": [-1, -1], "9": [1, -1], "1": [-1, 1], "3": [1, 1],
  Home: [-1, -1], PageUp: [1, -1], End: [-1, 1], PageDown: [1, 1],
};

window.addEventListener("pointerdown", () => sound.unlock(), { passive: true });
window.addEventListener("keydown", () => sound.unlock());

function updateMuteButton(): void {
  const btn = $("#btn-sound");
  btn.textContent = sound.muted ? "🔇" : "🔊";
  btn.title = sound.muted ? "Включить звук (M)" : "Выключить звук (M)";
}
$("#btn-sound").addEventListener("click", () => {
  sound.toggleMute();
  updateMuteButton();
});
updateMuteButton();

window.addEventListener("keydown", (ev) => {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const key = ev.key;
  if ((key === "m" || key === "M" || key === "ь") && mode !== "inventory") {
    sound.toggleMute();
    updateMuteButton();
    return;
  }

  if (mode === "title") {
    if (key === "n" || key === "N" || key === "т") startNewGame();
    else if (key === "c" || key === "C" || key === "с") handleMenu("continue");
    else if (key === "r" || key === "R" || key === "к") showScores();
    else if (key === "d" || key === "D" || key === "в") void showDaily();
    else if (key === "?" || key === "F1") showHelp();
    return;
  }
  if (mode === "daily") {
    if (key === "Escape") handleMenu("back");
    else if (key === "Enter" && pendingChallenge) handleMenu("daily-start");
    return;
  }
  if (mode === "help" || mode === "scores") {
    if (key === "Escape" || key === "Enter" || key === "?" || key === "r" || key === "R") handleMenu("back");
    return;
  }
  if (mode === "over") {
    if (key === "n" || key === "N" || key === "Enter") startNewGame();
    else if (key === "r" || key === "R") showScores();
    return;
  }
  if (mode === "inventory") {
    const inv = game?.player.inventory ?? [];
    if (key === "Escape" || key === "i" || key === "I") return enterPlay();
    if (key === "ArrowDown" || key === "j") {
      inventorySel = Math.min(inv.length - 1, inventorySel + 1);
      return showInventory();
    }
    if (key === "ArrowUp" || key === "k") {
      inventorySel = Math.max(0, inventorySel - 1);
      return showInventory();
    }
    if (key === "Enter") return inventoryAction(inventorySel, false);
    if (key === "d" || key === "D") return inventoryAction(inventorySel, true);
    const li = "abcdefghijkl".indexOf(key.toLowerCase());
    if (li >= 0 && li < inv.length) return inventoryAction(li, false);
    return;
  }

  // mode === "play"
  if (!game) return;
  if (travel.length > 0 || exploring) {
    stopTravel();
    if (key === "Escape") return;
  }
  if (key === "Escape") return showTitle();
  if (key === "?" || key === "F1") return showHelp();
  if (key === "i" || key === "I" || key === "ш") return showInventory();
  if (key === "g" || key === "G" || key === "п" || key === ",") return act(() => game!.pickUp());
  if (key === ">" || key === "Enter") return act(() => game!.descend());
  if (key === "." || key === "5" || key === " ") {
    ev.preventDefault();
    return act(() => game!.wait());
  }
  if (key === "o" || key === "O" || key === "щ") return autoExplore();
  const dir = DIR_KEYS[key];
  if (dir) {
    ev.preventDefault();
    return act(() => game!.movePlayer(dir[0], dir[1]));
  }
});

function autoExplore(): void {
  if (!game) return;
  const target = game.exploreTarget();
  const path = target ? game.pathTo(target.x, target.y) : [];
  if (path.length === 0) {
    game.log("Этаж исследован. Ищите лестницу вниз (>).", "system");
    updateHud();
    return;
  }
  startTravel(path, true);
}

canvas.addEventListener("mousemove", (ev) => {
  if (!game || mode !== "play") return;
  const rect = canvas.getBoundingClientRect();
  const tile = renderer.tileAtPixel(game, ev.clientX - rect.left, ev.clientY - rect.top);
  renderer.hover = tile;
  const m = game.monsterAt(tile.x, tile.y);
  if (m && game.isVisible(m.x, m.y)) {
    const def = monsterDef(m.defId);
    lookEl.textContent = `${def.name}: ${m.hp}/${m.maxHp} HP, урон ${def.atk[0]}–${def.atk[1]}, защита ${def.def}`;
  } else {
    const items = game.itemsAt(tile.x, tile.y);
    lookEl.textContent = items.length && game.state.map.explored[tile.y * game.state.map.width + tile.x] ? items.map((g) => itemName(g.item)).join(", ") : "";
  }
  requestDraw();
});
canvas.addEventListener("mouseleave", () => {
  renderer.hover = null;
  lookEl.textContent = "";
  requestDraw();
});
canvas.addEventListener("click", (ev) => {
  if (!game || mode !== "play") return;
  const rect = canvas.getBoundingClientRect();
  const tile = renderer.tileAtPixel(game, ev.clientX - rect.left, ev.clientY - rect.top);
  const dx = tile.x - game.player.x;
  const dy = tile.y - game.player.y;
  if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
    if (dx === 0 && dy === 0) return act(() => game!.wait());
    stopTravel();
    return act(() => game!.movePlayer(dx, dy));
  }
  const path = game.pathTo(tile.x, tile.y);
  if (path.length === 0) {
    game.log("Туда не пройти.");
    updateHud();
    return;
  }
  startTravel(path, false);
});

// On-screen controls.
document.querySelectorAll<HTMLButtonElement>("#dpad button").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!game || mode !== "play") return;
    stopTravel();
    const [dx, dy] = btn.dataset.dir!.split(",").map(Number);
    act(() => (dx === 0 && dy === 0 ? game!.wait() : game!.movePlayer(dx, dy)));
  });
});
document.querySelectorAll<HTMLButtonElement>("#actions button").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!game || mode !== "play") return;
    stopTravel();
    if (btn.dataset.act === "pickup") act(() => game!.pickUp());
    if (btn.dataset.act === "descend") act(() => game!.descend());
  });
});
$("#btn-explore").addEventListener("click", () => mode === "play" && autoExplore());
$("#btn-inventory").addEventListener("click", () => mode === "play" && showInventory());
$("#btn-help").addEventListener("click", () => mode === "play" && showHelp());
$("#btn-menu").addEventListener("click", () => (mode === "play" ? showTitle() : mode === "title" ? undefined : handleMenu("back")));

// ---------------------------------------------------------------- boot

// Debug hook for automated play-testing: open the page with ?debug.
if (location.search.includes("debug")) {
  (window as unknown as { __dd: unknown }).__dd = { game: () => game, mode: () => mode };
}

showTitle();

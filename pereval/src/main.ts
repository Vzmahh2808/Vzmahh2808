import { CATEGORIES, ROLES, TERRAIN, WEATHER } from "./game/data";
import { Game, fmtHours, QUALITY_OK, QUALITY_SLIP } from "./game/game";
import { randomSeed } from "./game/rng";
import { clearSave, loadGame, loadScores, recordScore, saveGame, type ScoreEntry } from "./game/save";
import { rankFor, scoreBreakdown } from "./game/score";
import type { Category, Point, RiverMethod } from "./game/types";
import { Renderer, pointEq } from "./ui/renderer";
import { Sound } from "./ui/sound";

type Mode = "title" | "play" | "stage" | "menu" | "help" | "scores" | "over";

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
let scoreRecorded = false;
/** Cleanup for whatever mini-game is on screen. */
let stageCleanup: (() => void) | null = null;

// ---------------------------------------------------------------- rendering loop

let needsDraw = true;
function requestDraw(): void {
  needsDraw = true;
}
function frame(now: number): void {
  if (game && (needsDraw || renderer.hasAnimations || game.state.weather !== "clear")) {
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
  const s = game.state;
  const w = WEATHER[s.weather];
  const f = WEATHER[s.forecast];
  $("#daybox").innerHTML = `День <b>${s.day}</b>/${s.deadline} · <b>${fmtHours(s.hours)}</b> · ${w.glyph}<span class="wname"> ${w.name}</span> <span class="muted fcast">→ ${f.name.toLowerCase()}</span>`;

  const team = $("#team");
  team.innerHTML = "";
  for (const m of s.members) {
    const div = document.createElement("div");
    div.className = "member";
    const hpLow = m.health < 35 ? " low" : "";
    const stLow = m.stamina < 30 ? " low" : "";
    const kitBtn = s.supplies.kit > 0 && (m.health < 100 || m.injury > 0) ? `<button class="kit" data-kit="${m.id}" title="Использовать аптечку">+ аптечка</button>` : "";
    div.innerHTML = `
      <div class="head"><span class="name">${m.name}</span><span class="role">${ROLES[m.role].name}</span>${kitBtn}</div>
      <div class="skills">техника ${"●".repeat(m.technique)}${"○".repeat(5 - m.technique)} · сила ${"●".repeat(m.strength)}${"○".repeat(5 - m.strength)}</div>
      <div class="bar-row"><span class="bar-label">Здор.</span><div class="bar"><div class="bar-fill hp${hpLow}" style="width:${m.health}%"></div><span class="bar-text">${m.health}</span></div></div>
      <div class="bar-row"><span class="bar-label">Силы</span><div class="bar"><div class="bar-fill st${stLow}" style="width:${m.stamina}%"></div><span class="bar-text">${m.stamina}</span></div></div>
      ${m.injury > 0 ? `<div class="injury">Травма, ещё ${m.injury} дн.</div>` : ""}`;
    team.appendChild(div);
  }
  team.querySelectorAll<HTMLButtonElement>("button[data-kit]").forEach((b) => {
    b.addEventListener("click", () => act(() => game!.useKit(Number(b.dataset.kit))));
  });

  const sup = s.supplies;
  const food = $("#st-food");
  food.textContent = `${sup.food} чел.-дн. (${Math.floor(sup.food / s.members.length)} дн.)`;
  food.className = sup.food === 0 ? "none" : sup.food < s.members.length * 2 ? "low" : "";
  const gas = $("#st-gas");
  gas.textContent = `${sup.gas} дн.`;
  gas.className = sup.gas === 0 ? "none" : sup.gas <= 2 ? "low" : "";
  $("#st-rope").textContent = sup.rope ? "есть" : "нет";
  const kit = $("#st-kit");
  kit.textContent = `${sup.kit} шт.`;
  kit.className = sup.kit === 0 ? "none" : "";
  $("#st-load").textContent = `${game.loadKg()} кг`;

  $<HTMLDivElement>("#morale-bar").style.width = `${s.morale}%`;
  $("#morale-text").textContent = `${s.morale}`;
  const cps = $("#cps");
  cps.innerHTML = s.checkpoints
    .map((c) => `<div class="${c.taken ? "done" : ""}"><span class="flag"></span>КП ${c.id} «${c.name}»${c.taken ? " ✓" : ""}</div>`)
    .join("");
  const fin = document.createElement("div");
  fin.innerHTML = `<span style="width:14px;text-align:center">🏁</span>Финиш${game.allCheckpointsTaken() ? " — все КП есть, можно закрывать маршрут" : ""}`;
  cps.appendChild(fin);

  $<HTMLButtonElement>("#btn-rest").disabled = s.hours < 10 - 1e-6;
  renderLog();
}

function renderLog(): void {
  if (!game) return;
  const entries = game.state.log.slice(-40);
  const day = game.state.day;
  logEl.innerHTML = entries.map((e) => `<div class="entry ${e.kind}${day - e.day > 1 ? " old" : ""}">${escapeHtml(e.text)}</div>`).join("");
  logEl.scrollTop = logEl.scrollHeight;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
}

function flushEvents(): void {
  if (!game) return;
  const now = performance.now();
  for (const e of game.events) {
    renderer.handle(e, now, game);
    sound.handle(e);
  }
  game.events = [];
}

// ---------------------------------------------------------------- game flow

/** Run a player action; persist and refresh when it changed the state. */
function act(action: () => boolean): void {
  if (!game || (mode !== "play" && mode !== "stage")) return;
  const changed = action();
  flushEvents();
  if (changed) {
    saveGame(game.snapshot());
    if (game.state.status !== "playing") {
      finishGame();
    } else if (game.state.pending && mode === "play") {
      stopTravel();
      openStage();
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
  const b = scoreBreakdown(s);
  const entry: ScoreEntry = {
    score: b.total,
    rank: rankFor(b.total),
    category: s.category,
    days: s.day,
    checkpoints: s.checkpoints.filter((c) => c.taken).length,
    outcome: s.status === "won" ? "won" : "lost",
    reason: s.endReason,
    date: new Date().toISOString().slice(0, 10),
  };
  const { place } = recordScore(entry);
  setTimeout(() => showGameOver(entry, place), 900);
}

function startNewGame(category: Category): void {
  game = Game.newGame(randomSeed(), category);
  scoreRecorded = false;
  renderer.reset();
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
  scoreRecorded = false;
  renderer.reset();
  game.log("Поход продолжен.", "system");
  enterPlay();
  return true;
}

function enterPlay(): void {
  mode = "play";
  hideOverlay();
  renderer.resize();
  updateHud();
  requestDraw();
  if (game?.state.pending) openStage();
}

// ---------------------------------------------------------------- travel by click

function stopTravel(): void {
  travel = [];
  if (travelTimer) {
    clearTimeout(travelTimer);
    travelTimer = 0;
  }
}

function startTravel(path: Point[]): void {
  stopTravel();
  travel = path;
  stepTravel();
}

function stepTravel(): void {
  if (!game || mode !== "play" || travel.length === 0) return stopTravel();
  const next = travel.shift()!;
  const s = game.state;
  const dx = next.x - s.pos.x;
  const dy = next.y - s.pos.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return stopTravel();
  let moved = false;
  act(() => {
    moved = game!.move(dx, dy);
    return moved;
  });
  if (!moved || game.state.pending || game.state.status !== "playing") return stopTravel();
  if (travel.length) travelTimer = window.setTimeout(stepTravel, 150);
}

// ---------------------------------------------------------------- overlays

function showOverlay(html: string, className = ""): void {
  card.innerHTML = html;
  card.className = `card ${className}`;
  overlay.classList.remove("hidden");
}
function hideOverlay(): void {
  overlay.classList.add("hidden");
  if (stageCleanup) {
    stageCleanup();
    stageCleanup = null;
  }
}

function showTitle(): void {
  mode = "title";
  const hasSave = loadGame() !== null;
  const cats = ([1, 2, 3] as Category[])
    .map((c) => `<button data-cat="${c}">${CATEGORIES[c].name} <span class="hint">${CATEGORIES[c].days} дн. · ${CATEGORIES[c].checkpoints} КП</span><small>${CATEGORIES[c].hint}</small></button>`)
    .join("");
  showOverlay(`
    <h1>Перевал</h1>
    <p class="sub">Спортивный туризм: проведите группу из четырёх человек по категорийному маршруту. Отметьтесь на всех КП, переправьтесь через реки, возьмите перевалы и вернитесь в посёлок до контрольного срока.</p>
    <div class="menu">
      ${hasSave ? `<button data-act="continue">Продолжить поход</button>` : ""}
      ${cats}
      <button data-act="scores">Рекорды</button>
      <button data-act="help">Как играть</button>
    </div>`);
  card.querySelectorAll<HTMLButtonElement>("button[data-cat]").forEach((b) =>
    b.addEventListener("click", () => {
      sound.unlock();
      startNewGame(Number(b.dataset.cat) as Category);
    }),
  );
  bindAct("continue", () => {
    sound.unlock();
    if (!continueGame()) showTitle();
  });
  bindAct("scores", () => showScores(null, 0, showTitle));
  bindAct("help", () => showHelp(showTitle));
}

function bindAct(name: string, fn: () => void): void {
  card.querySelector<HTMLButtonElement>(`button[data-act="${name}"]`)?.addEventListener("click", fn);
}

function showMenu(): void {
  if (!game) return;
  mode = "menu";
  stopTravel();
  showOverlay(`
    <h2>Меню</h2>
    <div class="menu">
      <button data-act="resume">Вернуться на маршрут <span class="hint">Esc</span></button>
      <button data-act="help">Как играть <span class="hint">?</span></button>
      <button data-act="scores">Рекорды</button>
      <button data-act="sound">Звук: ${sound.muted ? "выкл" : "вкл"} <span class="hint">M</span></button>
      <button data-act="abandon">Сойти с маршрута</button>
      <button data-act="title">В главное меню</button>
    </div>`);
  bindAct("resume", enterPlay);
  bindAct("help", () => showHelp(showMenu));
  bindAct("scores", () => showScores(null, 0, showMenu));
  bindAct("sound", () => {
    setMuted(sound.toggleMute());
    showMenu();
  });
  bindAct("abandon", () => {
    if (!confirm("Сойти с маршрута? Поход закончится, но очки за КП сохранятся.")) return;
    mode = "play";
    act(() => game!.abandon());
  });
  bindAct("title", () => {
    if (game && game.state.status === "playing") saveGame(game.snapshot());
    showTitle();
  });
}

function showHelp(back: () => void): void {
  mode = "help";
  const legend = (Object.keys(TERRAIN) as (keyof typeof TERRAIN)[])
    .map((k) => {
      const d = TERRAIN[k];
      return `<div><span style="background:${d.color}"></span>${d.name}${d.passable ? ` — ${d.hours} ч` : " — не пройти"}</div>`;
    })
    .join("");
  showOverlay(`
    <h2>Как играть</h2>
    <p>У группы 10 ходовых часов в день. Каждая клетка стоит часов по типу местности; дождь, тяжёлые рюкзаки, усталость и травмы замедляют. Когда часы кончились — ставьте лагерь: группа ест, спит и восстанавливает силы. Днёвка (целый день отдыха) лечит лучше, но стоит дня.</p>
    <p>Реки переходят вброд или по навесной переправе (нужна верёвка, дольше, но безопаснее). Мостик — бесплатно. Перевалы берут по перилам. На каждом препятствии — короткая мини-игра; промах стоит сил, падение — здоровья.</p>
    <p>Отметьтесь на всех КП и дойдите до финишного посёлка до контрольного срока. Вершины необязательны, но дают очки и мораль. Если у кого-то здоровье упадёт до нуля, группу эвакуируют.</p>
    <h3>Управление</h3>
    <div class="keys">
      <kbd>← ↑ → ↓</kbd><span>Шаг на соседнюю клетку (также WASD)</span>
      <kbd>Клик по карте</kbd><span>Идти к клетке по кратчайшему пути</span>
      <kbd>C</kbd><span>Ночёвка</span>
      <kbd>R</kbd><span>Днёвка (только с утра)</span>
      <kbd>Пробел</kbd><span>Остановить бегунок на переправе</span>
      <kbd>M</kbd><span>Звук вкл/выкл</span>
      <kbd>Esc</kbd><span>Меню</span>
    </div>
    <h3>Местность (часы на клетку)</h3>
    <div class="legend">${legend}</div>
    <div class="menu"><button data-act="back">Назад</button></div>`);
  bindAct("back", back);
}

function showScores(me: ScoreEntry | null, place: number, back: () => void): void {
  mode = "scores";
  const scores = loadScores();
  const rows = scores.length
    ? scores
        .map(
          (e, i) =>
            `<tr class="${me === e || (place === i + 1 && me && e.score === me.score && e.date === me.date) ? "me" : ""}"><td>${i + 1}</td><td>${e.score}</td><td>${e.rank}</td><td>${CATEGORIES[e.category].short}</td><td>${e.checkpoints} КП</td><td>${e.outcome === "won" ? `${e.days} дн.` : "сход"}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="6" class="muted">Пока пусто</td></tr>`;
  showOverlay(`
    <h2>Рекорды</h2>
    <table><thead><tr><th>#</th><th>Очки</th><th>Разряд</th><th>Кат.</th><th>КП</th><th>Итог</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="menu"><button data-act="back">Назад</button></div>`);
  bindAct("back", back);
}

function showGameOver(entry: ScoreEntry, place: number): void {
  if (!game) return;
  mode = "over";
  const s = game.state;
  const b = scoreBreakdown(s);
  const won = s.status === "won";
  const line = (label: string, v: number) => (v === 0 ? "" : `<div>${label}</div><div class="${v < 0 ? "neg" : ""}">${v > 0 ? "+" : ""}${v}</div>`);
  showOverlay(`
    <h1>${won ? "Маршрут закрыт!" : "Маршрут не пройден"}</h1>
    <p class="sub">${won ? `${CATEGORIES[s.category].name}, ${s.day} дн. из ${s.deadline}.` : s.endReason + "."}</p>
    <div class="big">${b.total} очков</div>
    <div class="rank">${entry.rank}${place ? ` · ${place}-е место в таблице` : ""}</div>
    <div class="breakdown">
      ${line("КП", b.checkpoints)}${line("Финиш", b.finish)}${line("Вершины", b.peaks)}${line("Запас по сроку", b.daysLeft)}
      ${line("Здоровье группы", b.health)}${line("Мораль", b.morale)}${line("Падения", b.falls)}${line("Днёвки", b.restDays)}
      <div>Коэффициент категории</div><div>×${b.factor}</div>
    </div>
    <div class="menu">
      <button data-act="again">Новый маршрут</button>
      <button data-act="scores">Рекорды</button>
    </div>`);
  bindAct("again", showTitle);
  bindAct("scores", () => showScores(entry, place, () => showGameOver(entry, place)));
}

// ---------------------------------------------------------------- technical stages

function openStage(): void {
  if (!game || !game.state.pending) return;
  mode = "stage";
  stopTravel();
  if (game.state.pending.kind === "river") showRiverStage();
  else showPassStage();
}

function resultClass(q: number): "ok" | "slip" | "fall" {
  return q >= QUALITY_OK ? "ok" : q >= QUALITY_SLIP ? "slip" : "fall";
}
const RESULT_TEXT = { ok: "чисто", slip: "оступился", fall: "упал" };

function showRiverStage(): void {
  const g = game!;
  const p = g.state.pending!;
  const wet = g.state.weather === "rain" || g.state.weather === "storm";
  const render = () => {
    const methodBtn = (m: RiverMethod, label: string, hint: string) =>
      p.methods.includes(m) ? `<button data-method="${m}" class="${p.method === m ? "sel" : ""}">${label}<small>${hint}</small></button>` : "";
    const hoursFor = (m: RiverMethod) => {
      const base = m === "rope" ? 2 : 0.75;
      return fmtHours(Math.round(base * g.speedFactor() * 4) / 4);
    };
    showOverlay(
      `
      <h2>Переправа через реку</h2>
      <p class="hint">${wet ? "После дождя вода поднялась — брод опасен." : "Вода спокойная."} Каждый участник переходит по очереди: остановите бегунок в зелёной зоне. Зона зависит от техники и усталости.</p>
      <div class="methods">
        ${methodBtn("ford", "Вброд", `${hoursFor("ford")}, быстро, но можно упасть`)}
        ${methodBtn("rope", "Навесная переправа", `${hoursFor("rope")}, по верёвке — падений не бывает`)}
      </div>
      <div id="stage-body"></div>
      <button class="go" data-act="go">Начать переправу (${fmtHours(p.hours)})</button>
      <button class="cancel" data-act="cancel">Отойти от берега</button>`,
      "stage-card",
    );
    card.querySelectorAll<HTMLButtonElement>("button[data-method]").forEach((b) =>
      b.addEventListener("click", () => {
        g.chooseMethod(b.dataset.method as RiverMethod);
        render();
      }),
    );
    bindAct("cancel", () => {
      act(() => g.cancelStage());
      enterPlay();
    });
    bindAct("go", () => {
      sound.unlock();
      card.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.disabled = true));
      card.querySelectorAll<HTMLButtonElement>(".go, .cancel").forEach((b) => (b.style.display = "none"));
      runTimingRounds($("#stage-body"), p.zones, (qualities) => {
        act(() => g.resolveStage(qualities));
        if (mode === "stage" && game?.state.status === "playing") setTimeout(enterPlay, 700);
      });
    });
  };
  render();
}

/** One timing round per member: a marker sweeps the track, the player stops it in the zone. */
function runTimingRounds(host: HTMLElement, zones: number[], done: (qualities: number[]) => void): void {
  const g = game!;
  const members = g.state.members;
  const qualities: number[] = [];
  const speed = 0.7 + g.state.category * 0.12; // sweeps per second
  let i = 0;
  let raf = 0;
  let start = 0;
  let stopped = false;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;

  const cleanup = () => {
    if (raf) cancelAnimationFrame(raf);
    if (keyHandler) window.removeEventListener("keydown", keyHandler);
    keyHandler = null;
  };
  stageCleanup = cleanup;

  const round = () => {
    const m = members[i];
    const half = zones[i];
    const center = 0.2 + Math.random() * 0.6;
    host.innerHTML = `
      <div class="who">Идёт <b>${m.name}</b> (${i + 1} из ${members.length}) — техника ${"●".repeat(m.technique)}</div>
      <div class="track" id="track">
        <div class="zone near" style="left:${(center - half * 2.5) * 100}%;width:${half * 5 * 100}%"></div>
        <div class="zone" style="left:${(center - half) * 100}%;width:${half * 2 * 100}%"></div>
        <div class="marker" id="marker"></div>
      </div>
      <div class="results">${qualities.map((q, k) => `<span class="${resultClass(q)}">${members[k].name}: ${RESULT_TEXT[resultClass(q)]}</span>`).join("")}</div>
      <p class="hint">Пробел, Enter или тап по дорожке — остановить.</p>`;
    const marker = $<HTMLDivElement>("#marker");
    const track = $<HTMLDivElement>("#track");
    stopped = false;
    start = performance.now();
    let pos = 0;
    const tick = (now: number) => {
      if (stopped) return;
      const t = ((now - start) / 1000) * speed;
      const ph = t % 2;
      pos = ph < 1 ? ph : 2 - ph;
      marker.style.left = `${pos * 100}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      marker.classList.add("stopped");
      const dist = Math.abs(pos - center);
      const q = Math.max(0, Math.min(1, 1 - dist / (half * 2.5)));
      qualities.push(q);
      const cls = resultClass(q);
      if (cls === "ok") sound.hit();
      else if (cls === "slip") sound.slip();
      else sound.fall();
      i++;
      setTimeout(() => {
        if (i < members.length) round();
        else {
          cleanup();
          host.innerHTML = `<div class="results">${qualities.map((q, k) => `<span class="${resultClass(q)}">${members[k].name}: ${RESULT_TEXT[resultClass(q)]}</span>`).join("")}</div>`;
          done(qualities);
        }
      }, 450);
    };
    track.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      stop();
    });
    if (keyHandler) window.removeEventListener("keydown", keyHandler);
    keyHandler = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", keyHandler);
  };
  round();
}

const ARROWS: { key: string; glyph: string }[] = [
  { key: "ArrowUp", glyph: "↑" },
  { key: "ArrowDown", glyph: "↓" },
  { key: "ArrowLeft", glyph: "←" },
  { key: "ArrowRight", glyph: "→" },
];
const KEY_ALIASES: Record<string, string> = { KeyW: "ArrowUp", KeyS: "ArrowDown", KeyA: "ArrowLeft", KeyD: "ArrowRight" };

function showPassStage(): void {
  const g = game!;
  const p = g.state.pending!;
  const n = p.sequence;
  showOverlay(
    `
    <h2>Перевальный взлёт</h2>
    <p class="hint">Руководитель провешивает перила. Повторите последовательность из ${n} движений стрелками, пока не истекло время. Ошибки и медлительность — срывы для всей группы; каждому помогает его техника.</p>
    <div id="stage-body"></div>
    <button class="go" data-act="go">Начать подъём (${fmtHours(p.hours)})</button>
    <button class="cancel" data-act="cancel">Спуститься обратно</button>`,
    "stage-card",
  );
  bindAct("cancel", () => {
    act(() => g.cancelStage());
    enterPlay();
  });
  bindAct("go", () => {
    sound.unlock();
    card.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.disabled = true));
    card.querySelectorAll<HTMLButtonElement>(".go, .cancel").forEach((b) => (b.style.display = "none"));
    runSequence($("#stage-body"), n, (q) => {
      act(() => g.resolveStage([q]));
      if (mode === "stage" && game?.state.status === "playing") setTimeout(enterPlay, 700);
    });
  });
}

function runSequence(host: HTMLElement, n: number, done: (quality: number) => void): void {
  const g = game!;
  const seq = Array.from({ length: n }, () => ARROWS[Math.floor(Math.random() * ARROWS.length)]);
  const limit = n * (1.5 - g.state.category * 0.15) * 1000;
  let idx = 0;
  let strikes = 0;
  let finished = false;
  const start = performance.now();
  host.innerHTML = `
    <div class="seq" id="seq">${seq.map((a, i) => `<span class="${i === 0 ? "cur" : ""}">${a.glyph}</span>`).join("")}</div>
    <div class="timer"><div id="timer-bar"></div></div>
    <div class="arrows">
      <button class="blank"></button><button data-key="ArrowUp">↑</button><button class="blank"></button>
      <button data-key="ArrowLeft">←</button><button data-key="ArrowDown">↓</button><button data-key="ArrowRight">→</button>
    </div>`;
  const cells = Array.from($<HTMLDivElement>("#seq").children) as HTMLSpanElement[];
  const bar = $<HTMLDivElement>("#timer-bar");
  let raf = 0;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;
  const cleanup = () => {
    if (raf) cancelAnimationFrame(raf);
    if (keyHandler) window.removeEventListener("keydown", keyHandler);
  };
  stageCleanup = cleanup;
  const finish = (timedOut: boolean) => {
    if (finished) return;
    finished = true;
    cleanup();
    const elapsed = performance.now() - start;
    const timeLeft = Math.max(0, 1 - elapsed / limit);
    let q = (idx / n) * (timedOut ? 0.5 : 0.5 + timeLeft * 0.5 + 0.25) - strikes * 0.1;
    q = Math.max(0, Math.min(1, q));
    const cls = resultClass(q);
    if (cls === "ok") sound.hit();
    else if (cls === "slip") sound.slip();
    else sound.fall();
    host.insertAdjacentHTML("beforeend", `<div class="results"><span class="${cls}">${timedOut ? "Время вышло. " : ""}Качество ${Math.round(q * 100)} %</span></div>`);
    setTimeout(() => done(q), 400);
  };
  const press = (key: string) => {
    if (finished) return;
    sound.tick();
    if (key === seq[idx].key) {
      cells[idx].className = "done";
      idx++;
      if (idx < n) cells[idx].className = "cur";
      else finish(false);
    } else {
      strikes++;
      cells[idx].classList.add("err");
      setTimeout(() => cells[idx]?.classList.remove("err"), 250);
    }
  };
  host.querySelectorAll<HTMLButtonElement>("button[data-key]").forEach((b) => b.addEventListener("click", () => press(b.dataset.key!)));
  keyHandler = (e: KeyboardEvent) => {
    const key = KEY_ALIASES[e.code] ?? e.code;
    if (ARROWS.some((a) => a.key === key)) {
      e.preventDefault();
      press(key);
    }
  };
  window.addEventListener("keydown", keyHandler);
  const tick = (now: number) => {
    if (finished) return;
    const left = Math.max(0, 1 - (now - start) / limit);
    bar.style.width = `${left * 100}%`;
    if (left <= 0) finish(true);
    else raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- input

function tryMove(dx: number, dy: number): void {
  if (mode !== "play") return;
  stopTravel();
  act(() => game!.move(dx, dy));
}

const KEY_DIRS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
};

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === "KeyM") {
    setMuted(sound.toggleMute());
    return;
  }
  if (mode === "play") {
    const dir = KEY_DIRS[e.code];
    if (dir) {
      e.preventDefault();
      sound.unlock();
      tryMove(dir[0], dir[1]);
      return;
    }
    if (e.code === "KeyC") act(() => game!.camp());
    else if (e.code === "KeyR") act(() => game!.camp(true));
    else if (e.code === "Escape") showMenu();
    else if (e.key === "?" || e.code === "Slash") showHelp(enterPlay);
  } else if (mode === "menu" && e.code === "Escape") {
    enterPlay();
  } else if ((mode === "help" || mode === "scores") && e.code === "Escape") {
    card.querySelector<HTMLButtonElement>('button[data-act="back"]')?.click();
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (!game || mode !== "play") return;
  const rect = canvas.getBoundingClientRect();
  const p = renderer.tileAtPixel(game, e.clientX - rect.left, e.clientY - rect.top);
  if (pointEq(p, renderer.hover)) return;
  renderer.hover = p;
  if (p) {
    const t = game.tile(p)!;
    const cost = game.moveCost(p);
    const cp = game.checkpointAt(p);
    const reason = game.blockReason(p);
    lookEl.textContent = `${TERRAIN[t.t].name}${cp ? ` · КП ${cp.id} «${cp.name}»` : ""}${reason ? ` · ${reason}` : cost !== null ? ` · ${fmtHours(cost)} за клетку` : ""}`;
    const path = pointEq(p, game.state.pos) ? null : game.pathTo(p);
    renderer.preview = path;
    renderer.previewHours = path ? game.pathHours(path) : 0;
  } else {
    lookEl.textContent = "";
    renderer.preview = null;
  }
  requestDraw();
});
canvas.addEventListener("mouseleave", () => {
  renderer.hover = null;
  renderer.preview = null;
  lookEl.textContent = "";
  requestDraw();
});
canvas.addEventListener("click", (e) => {
  if (!game || mode !== "play") return;
  sound.unlock();
  const rect = canvas.getBoundingClientRect();
  const p = renderer.tileAtPixel(game, e.clientX - rect.left, e.clientY - rect.top);
  if (!p) return;
  if (travel.length) {
    stopTravel();
    return;
  }
  const path = game.pathTo(p);
  if (!path || path.length === 0) {
    const reason = game.blockReason(p);
    if (reason) game.log(reason, "warn");
    updateHud();
    return;
  }
  startTravel(path);
});

document.querySelectorAll<HTMLButtonElement>("#dpad button[data-dir]").forEach((b) => {
  b.addEventListener("click", () => {
    const [dx, dy] = b.dataset.dir!.split(",").map(Number);
    sound.unlock();
    tryMove(dx, dy);
  });
});

$("#btn-camp").addEventListener("click", () => {
  sound.unlock();
  stopTravel();
  act(() => game!.camp());
});
$("#btn-rest").addEventListener("click", () => {
  sound.unlock();
  stopTravel();
  act(() => game!.camp(true));
});
$("#btn-help").addEventListener("click", () => {
  if (mode === "play") showHelp(enterPlay);
});
$("#btn-menu").addEventListener("click", () => {
  if (mode === "play") showMenu();
  else if (mode === "menu") enterPlay();
});
$("#btn-sound").addEventListener("click", () => setMuted(sound.toggleMute()));

function setMuted(muted: boolean): void {
  $("#btn-sound").textContent = muted ? "🔇" : "🔊";
}
setMuted(sound.muted);

// ---------------------------------------------------------------- boot

if (new URLSearchParams(location.search).has("debug")) {
  (window as unknown as { __pv: unknown }).__pv = {
    get game() {
      return game;
    },
    act,
    start: startNewGame,
  };
}

showTitle();

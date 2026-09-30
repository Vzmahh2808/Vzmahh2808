import { randomSeed } from "./core/rng";
import { Sound } from "./audio/sound";
import { AdPolicy, boosted } from "./game/ads";
import { platform } from "./platform";
import {
  advanceDay,
  createSeason,
  currentSeries,
  loadSeason,
  resultForUser,
  saveSeason,
  seriesHome,
  simulateDays,
  simulateToNextPhase,
  userFixture,
  type Season,
} from "./game/league";
import { LENGTH_SECONDS, DIFFICULTY_VALUES, loadSettings, saveSettings, type Settings } from "./game/settings";
import { TEAMS, kitsFor, teamById, type Team } from "./game/teams";
import { Keyboard } from "./input/keyboard";
import { TouchControls, isTouchDevice } from "./input/touch";
import { View } from "./render/view";
import { Match } from "./sim/match";
import { Hud } from "./ui/hud";
import { Screens, type MatchConfig } from "./ui/screens";

const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
const params = new URLSearchParams(location.search);

let settings: Settings = loadSettings();
const sound = new Sound();
sound.muted = settings.muted;
const keyboard = new Keyboard();
const touch = new TouchControls(params.has("touch"));
const hud = new Hud();

const lowEnd = (): boolean => settings.quality === "low" || (settings.quality === "auto" && isTouchDevice());
const view = new View(canvas, { kits: [{ body: "#c8323c", trim: "#fff" }, { body: "#2d5fa8", trim: "#fff" }], quality: lowEnd() ? "low" : "high", palette: [] });
view.resize();
new ResizeObserver(() => view.resize()).observe(canvas);
window.addEventListener("resize", () => view.resize());

let season: Season | null = loadSeason();
const ads = new AdPolicy();
const sessionStart = performance.now();
const sessionTime = (): number => (performance.now() - sessionStart) / 1000;
/** A rewarded boost waiting for the next championship match. */
let boostNext = false;
let match: Match | null = null;
let cfg: MatchConfig | null = null;
let teams: [Team, Team] | null = null;
let paused = true;
let resultTimer = 0;
let resultShown = false;
let hintShown = false;

function applySettings(s: Settings): void {
  settings = s;
  saveSettings(s);
  sound.setMuted(s.muted);
  document.querySelector("#mutebtn")?.classList.toggle("off", s.muted);
  view.setOptions({ quality: lowEnd() ? "low" : "high" });
  view.resize();
}

const screens = new Screens(
  {
    start: (c) => startMatch(c),
    resume: () => setPaused(false),
    restart: () => {
      if (cfg) startMatch(cfg);
    },
    toMenu: () => {
      match = null;
      paused = true;
      hud.hide();
      document.body.classList.remove("in-match");
      sound.update(0, null);
    },
    settings: (s) => applySettings(s),
    leagueOpen: () => showHub(),
    leagueNew: (user, games) => {
      season = createSeason(user, games, randomSeed());
      saveSeason(season);
      screens.hasSeason = true;
      showHub();
    },
    leaguePlay: () => leaguePlay(),
    leagueSim: (kind) => leagueSim(kind),
    leagueContinue: () => void leagueContinue(),
    leagueBoost: () => void leagueBoost(),
    leagueDiscard: () => {
      season = null;
      saveSeason(null);
      screens.hasSeason = false;
    },
  },
  () => settings,
);
screens.hasSeason = season !== null;

function refreshBoost(): void {
  screens.boost = boostNext ? "active" : platform().rewarded && ads.rewardAllowed(sessionTime()) ? "available" : "none";
}

function showHub(): void {
  refreshBoost();
  if (season) screens.hub(season);
}

/** Show an ad with the sound off; resolves true when a rewarded ad was watched to the end. */
async function playAd(kind: "rewarded" | "interstitial"): Promise<boolean> {
  const p = platform();
  const show = kind === "rewarded" ? p.rewarded : p.interstitial;
  if (!show) return false;
  sound.setSuspended(true);
  p.gameplay(false);
  let got = false;
  try {
    if (kind === "rewarded") got = await p.rewarded!();
    else await p.interstitial!();
  } catch {
    got = false;
  }
  sound.setSuspended(false);
  ads.noteAd(sessionTime(), kind === "rewarded");
  return got;
}

async function leagueBoost(): Promise<void> {
  if (!season || boostNext) return;
  if (await playAd("rewarded")) boostNext = true;
  showHub();
}

function leaguePlay(): void {
  if (!season) return;
  if (season.phase === "regular") {
    const f = userFixture(season);
    if (!f) return;
    const home = f.home === season.user;
    startMatch({ home: season.user, away: home ? f.away : f.home, twoPlayers: false, shootoutOnly: false, league: { mode: "regular", userIsHome: home } });
  } else if (season.phase === "playoff") {
    const s = currentSeries(season, season.user);
    if (!s) return;
    startMatch({ home: season.user, away: s.hi === season.user ? s.lo : s.hi, twoPlayers: false, shootoutOnly: false, league: { mode: "playoff", userIsHome: seriesHome(s) === season.user } });
  }
}

function leagueSim(kind: "match" | "days" | "phase" | "season"): void {
  if (!season) return;
  if (kind === "match") advanceDay(season, null);
  else if (kind === "days") simulateDays(season, 5);
  else simulateToNextPhase(season);
  saveSeason(season);
  showHub();
}

/** Record the finished match in the season and go back to the hub. */
async function leagueContinue(): Promise<void> {
  if (!season || !match || !cfg?.league || match.decidedBy === null) return;
  const so = match.decidedBy === "so";
  const userGoals = match.score[0] + (so && match.winner === 0 ? 1 : 0);
  const oppGoals = match.score[1] + (so && match.winner === 1 ? 1 : 0);
  const homeId = cfg.league.userIsHome ? season.user : cfg.away;
  advanceDay(season, resultForUser(season, homeId, userGoals, oppGoals, match.decidedBy));
  saveSeason(season);
  match = null;
  paused = true;
  hud.hide();
  document.body.classList.remove("in-match");
  sound.update(0, null);
  // A natural break: the match is over and the player is between screens.
  if (platform().interstitial && ads.interstitialAllowed(sessionTime())) await playAd("interstitial");
  showHub();
}

function startMatch(c: MatchConfig): void {
  cfg = c;
  sound.init();
  const home = teamById(c.home);
  const away = teamById(c.away);
  teams = [home, away];
  const kits = kitsFor(home, away);
  const palette = [home.main, home.alt, away.main, away.alt, "#f2f4f8", "#c8323c", "#3a4256"];
  view.setOptions({ kits, palette, quality: lowEnd() ? "low" : "high" });
  match = new Match({
    seed: randomSeed(),
    periodSeconds: LENGTH_SECONDS[settings.length],
    mode: c.league?.mode ?? "regular",
    humanHome: true,
    humanAway: c.twoPlayers,
    home: c.league && boostNext ? boosted(home.ratings) : home.ratings,
    away: away.ratings,
    difficulty: DIFFICULTY_VALUES[settings.difficulty],
    penalties: settings.penalties,
  });
  if (c.shootoutOnly) match.beginShootoutOnly();
  keyboard.twoPlayers = c.twoPlayers;
  keyboard.clearPending();
  view.snapCamera(match);
  hud.show(teams, kits);
  screens.hide();
  document.body.classList.add("in-match");
  if (c.league) boostNext = false;
  paused = false;
  resultShown = false;
  resultTimer = 0;
  hintShown = false;
  hud.say(`${home.short} — ${away.short}`, c.shootoutOnly ? "Серия буллитов" : `${home.city} · ${away.city}`, 2.2);
  if (!hintShown) {
    hintShown = true;
    hud.hint(touch.enabled ? "Джойстик — движение · Бросок — удерживайте для щелчка" : c.twoPlayers ? "Игрок 1: WASD, F бросок, Пробел пас · Игрок 2: стрелки, . бросок, Enter пас" : "WASD — ход · F — бросок (держите) · Пробел — пас · G — отбор · Shift — рывок", 7);
  }
}

function setPaused(p: boolean): void {
  if (!match || match.phase === "final") return;
  paused = p;
  sound.setSuspended(p);
  if (p) screens.pause();
  else screens.hide();
}

keyboard.onPause = () => {
  if (!match || match.phase === "final") return;
  setPaused(!paused);
};
keyboard.onMute = () => applySettings({ ...settings, muted: !settings.muted });
document.querySelector("#pausebtn")?.addEventListener("click", () => setPaused(true));
document.querySelector("#mutebtn")?.addEventListener("click", () => {
  sound.init();
  applySettings({ ...settings, muted: !settings.muted });
});
document.querySelector("#mutebtn")?.classList.toggle("off", settings.muted);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (match && !paused && match.phase !== "final") setPaused(true);
    sound.setSuspended(true);
  } else if (paused === false) sound.setSuspended(false);
});
window.addEventListener("pointerdown", () => sound.init(), { once: true });

function onEvents(m: Match): void {
  const ev = m.drainEvents();
  if (ev.length === 0) return;
  view.handle(ev, m);
  sound.handle(ev);
  for (const e of ev) {
    if (e.type === "goal") {
      const t = teams![e.team];
      const name = hud.playerName(m, e.scorer);
      const assists = e.assist.map((a) => hud.playerName(m, a).replace(/^№\d+ /, ""));
      const so = m.phase === "shootout";
      hud.say(so ? "ГОЛ!" : `ГОЛ! ${t.short}`, `${name || t.name}${assists.length ? ` (${assists.join(", ")})` : ""}`, 3);
    } else if (e.type === "penalty") {
      const t = teams![e.team];
      const why = e.kind === "behind" ? "Силовой приём сзади" : e.kind === "hooking" ? "Задержка клюшкой" : "Помеха";
      hud.say("Удаление 2 мин", `${t.short} ${hud.playerName(m, e.skater)} · ${why}`, 3);
    } else if (e.type === "whistle") {
      if (m.phase === "final") hud.say("Конец матча", "", 2.5);
      else if (m.phase === "break") hud.say(m.period === 4 ? "Конец основного времени" : `Конец ${m.period - 1}-го периода`, m.period === 4 ? "Овертайм 3 на 3" : "", 2.2);
    } else if (e.type === "faceoff") {
      hud.clearBanner();
    }
  }
}

// ---------------------------------------------------------------- loop

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (match) {
    if (!paused) {
      const live = match.phase === "play" || match.phase === "shootout";
      if (live) keyboard.apply(match, touch.enabled ? touch.take() : null);
      else keyboard.clearPending();
      // Sub-step long frames so the physics stays stable.
      const n = Math.max(1, Math.ceil(dt * 120));
      const h = dt / n;
      for (let i = 0; i < n; i++) match.tick(h);
      onEvents(match);
      sound.update(dt, match);
      if (match.phase === "final" && !resultShown) {
        resultTimer += dt;
        if (resultTimer > 2.4) {
          resultShown = true;
          screens.result(match, teams!, (id) => hud.playerName(match!, id), cfg?.league !== undefined);
        }
      }
    }
    view.draw(match, paused ? 0 : dt);
    hud.update(match, paused ? 0 : dt);
  } else {
    // Menu backdrop: a slow pan over an empty rink.
    view.drawIdle(dt);
  }
  platform().gameplay(match !== null && !paused && match.phase !== "final");
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Keyboard shortcuts for switching players are handled by the pass button; keep a hook for tests.
if (params.has("debug")) (window as unknown as { __khl: unknown }).__khl = { get match() { return match; }, startMatch, view, teams: TEAMS };

screens.title();
const auto = params.get("auto");
if (auto !== null) {
  const [h, a] = auto.split(",").map(Number);
  startMatch({ home: Number.isFinite(h) ? h : 0, away: Number.isFinite(a) ? a : 1, twoPlayers: params.has("two"), shootoutOnly: params.has("so") });
}

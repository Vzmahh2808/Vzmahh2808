/**
 * The championship: a round-robin regular season, standings with the 2-1-0
 * points system, then a sixteen-team playoff of best-of-seven series with a
 * reseed after every round. Pure data and functions, so it saves as JSON and
 * tests in Node. Games the player does not play are simulated from the clubs'
 * ratings, calibrated against the real match engine.
 */
import { Rng } from "../core/rng";
import { SEASON_KEY, touchSaved } from "./persist";
import { TEAMS, strength, teamById, type Conference } from "./teams";

export type Decided = "reg" | "ot" | "so";

export interface GameResult {
  /** Final goals, with the shootout winner credited one more goal. */
  hg: number;
  ag: number;
  by: Decided;
}

export interface Fixture {
  day: number;
  home: number;
  away: number;
  result: GameResult | null;
}

export interface SeriesGame extends GameResult {
  home: number;
}

export interface Series {
  round: 1 | 2 | 3 | 4;
  /** Better seed first: gets home games 1, 2, 5 and 7. */
  hi: number;
  lo: number;
  hiWins: number;
  loWins: number;
  games: SeriesGame[];
  winner: number | null;
}

export interface Playoffs {
  round: 1 | 2 | 3 | 4;
  series: Series[];
  /** Every finished series, oldest first. */
  history: Series[];
  champion: number | null;
}

export type Phase = "regular" | "playoff" | "done";

export interface Season {
  version: 1;
  user: number;
  /** Games per club: one, two or three full round robins. */
  games: 21 | 42 | 63;
  day: number;
  fixtures: Fixture[];
  phase: Phase;
  playoffs: Playoffs | null;
  /** Regular season winner, set when the regular season ends. */
  leader: number | null;
  rng: number;
}

export const SEASON_LENGTHS: { games: 21 | 42 | 63; name: string }[] = [
  { games: 21, name: "Короткий, 21 матч" },
  { games: 42, name: "Средний, 42 матча" },
  { games: 63, name: "Полный, 63 матча" },
];

export const ROUND_NAMES: Record<1 | 2 | 3 | 4, string> = { 1: "1/8 финала", 2: "1/4 финала", 3: "Полуфинал", 4: "Финал" };
export const WIN_TARGET = 4;
/** Home team by game number (0-based) in a series: 2-2-1-1-1. */
const HI_HOME = [true, true, false, false, true, false, true];

// ------------------------------------------------------------ simulation

/** Poisson draw by inversion. */
export function poisson(rng: Rng, lambda: number): number {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > l && k < 30);
  return k - 1;
}

const BASE_GOALS = 2.7;
const RATING_SLOPE = 0.02;

/** Expected goals for `a` against `b` (both teams' ratings in one number). */
export function expectedGoals(a: number, b: number): number {
  return BASE_GOALS * Math.exp(RATING_SLOPE * (a - b));
}

/** Simulate one game between two clubs. `playoff` forbids the shootout. */
export function simulateGame(rng: Rng, home: number, away: number, playoff: boolean): GameResult {
  const sh = strength(teamById(home));
  const sa = strength(teamById(away));
  let hg = poisson(rng, expectedGoals(sh, sa) * 1.02);
  let ag = poisson(rng, expectedGoals(sa, sh) / 1.02);
  if (hg !== ag) return { hg, ag, by: "reg" };
  // Tied after sixty minutes: a coin weighted by strength, decided in overtime or (regular season) by shootout.
  const pHome = 1 / (1 + Math.exp(-RATING_SLOPE * 1.6 * (sh - sa)));
  const homeWins = rng.next() < pHome;
  if (playoff || rng.next() < 0.45) {
    if (homeWins) hg++;
    else ag++;
    return { hg, ag, by: "ot" };
  }
  if (homeWins) hg++;
  else ag++;
  return { hg, ag, by: "so" };
}

// ------------------------------------------------------------ schedule

/** Circle-method round robin: 21 rounds of 11 games for 22 clubs. */
export function roundRobin(ids: number[]): [number, number][][] {
  const n = ids.length;
  const list = [...ids];
  const rounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      round.push((r + i) % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    // Rotate all but the first.
    list.splice(1, 0, list.pop()!);
  }
  return rounds;
}

export function createSeason(user: number, games: 21 | 42 | 63, seed: number): Season {
  const rng = new Rng(seed);
  const ids = rng.shuffle(TEAMS.map((t) => t.id));
  const base = roundRobin(ids);
  const fixtures: Fixture[] = [];
  const cycles = games / 21;
  let day = 0;
  for (let c = 0; c < cycles; c++) {
    const order = c % 2 === 0 ? base : base.map((round) => round.map(([h, a]) => [a, h] as [number, number]));
    // Shuffle the order of rounds a little between cycles so the calendar is not identical.
    const rounds = c === 0 ? order : rng.shuffle([...order]);
    for (const round of rounds) {
      for (const [h, a] of round) fixtures.push({ day, home: h, away: a, result: null });
      day++;
    }
  }
  return { version: 1, user, games, day: 0, fixtures, phase: "regular", playoffs: null, leader: null, rng: rng.getState() };
}

export const totalDays = (s: Season): number => s.games;

// ------------------------------------------------------------ standings

export interface Row {
  id: number;
  gp: number;
  w: number;
  /** Wins in overtime or shootout. */
  otw: number;
  otl: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
}

const blank = (id: number): Row => ({ id, gp: 0, w: 0, otw: 0, otl: 0, l: 0, gf: 0, ga: 0, pts: 0 });

function apply(row: Row, gf: number, ga: number, by: Decided): void {
  row.gp++;
  row.gf += gf;
  row.ga += ga;
  if (gf > ga) {
    row.w++;
    row.pts += 2;
    if (by !== "reg") row.otw++;
  } else if (by === "reg") row.l++;
  else {
    row.otl++;
    row.pts += 1;
  }
}

export function compareRows(a: Row, b: Row): number {
  return b.pts - a.pts || b.w - a.w || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf || a.id - b.id;
}

export function standings(season: Season): Row[] {
  const rows = new Map<number, Row>(TEAMS.map((t) => [t.id, blank(t.id)]));
  for (const f of season.fixtures) {
    if (!f.result) continue;
    apply(rows.get(f.home)!, f.result.hg, f.result.ag, f.result.by);
    apply(rows.get(f.away)!, f.result.ag, f.result.hg, f.result.by);
  }
  return [...rows.values()].sort(compareRows);
}

export function conferenceTable(rows: Row[], conf: Conference): Row[] {
  return rows.filter((r) => teamById(r.id).conference === conf);
}

// ------------------------------------------------------------ playoffs

function mkSeries(round: 1 | 2 | 3 | 4, hi: number, lo: number): Series {
  return { round, hi, lo, hiWins: 0, loWins: 0, games: [], winner: null };
}

export function startPlayoffs(season: Season): void {
  const rows = standings(season);
  season.leader = rows[0].id;
  const west = conferenceTable(rows, "west").slice(0, 8).map((r) => r.id);
  const east = conferenceTable(rows, "east").slice(0, 8).map((r) => r.id);
  const series: Series[] = [];
  for (const conf of [west, east]) for (let i = 0; i < 4; i++) series.push(mkSeries(1, conf[i], conf[7 - i]));
  season.playoffs = { round: 1, series, history: [], champion: null };
  season.phase = "playoff";
}

/** Overall regular-season rank of each club (0 is best). Stable for the whole playoff. */
export function overallRank(season: Season): Map<number, number> {
  return new Map(standings(season).map((r, i) => [r.id, i]));
}

export function seriesHome(s: Series): number {
  const n = s.games.length;
  return HI_HOME[Math.min(n, 6)] ? s.hi : s.lo;
}

export function seriesGameNumber(s: Series): number {
  return s.games.length + 1;
}

/** Record one game of a series; returns true if the series is now decided. */
export function recordSeriesGame(s: Series, r: GameResult): boolean {
  const home = seriesHome(s);
  s.games.push({ ...r, home });
  const homeWon = r.hg > r.ag;
  const winner = homeWon ? home : home === s.hi ? s.lo : s.hi;
  if (winner === s.hi) s.hiWins++;
  else s.loWins++;
  if (s.hiWins === WIN_TARGET || s.loWins === WIN_TARGET) {
    s.winner = s.hiWins === WIN_TARGET ? s.hi : s.lo;
    return true;
  }
  return false;
}

/** The series the given club plays now, if it is still alive. */
export function currentSeries(season: Season, team: number): Series | null {
  const po = season.playoffs;
  if (!po) return null;
  return po.series.find((s) => s.winner === null && (s.hi === team || s.lo === team)) ?? null;
}

function nextRound(season: Season): void {
  const po = season.playoffs!;
  const winners = po.series.map((s) => s.winner!);
  po.history.push(...po.series);
  if (po.round === 4) {
    po.champion = winners[0];
    po.series = [];
    season.phase = "done";
    return;
  }
  const rank = overallRank(season);
  const sorted = [...winners].sort((a, b) => rank.get(a)! - rank.get(b)!);
  const round = (po.round + 1) as 2 | 3 | 4;
  const series: Series[] = [];
  for (let i = 0; i < sorted.length / 2; i++) series.push(mkSeries(round, sorted[i], sorted[sorted.length - 1 - i]));
  po.round = round;
  po.series = series;
}

// ------------------------------------------------------------ advancing

/** The user's next unplayed regular-season game today, if any. */
export function userFixture(season: Season): Fixture | null {
  if (season.phase !== "regular") return null;
  return season.fixtures.find((f) => f.day === season.day && f.result === null && (f.home === season.user || f.away === season.user)) ?? null;
}

/**
 * Finish today's games. The user's own game uses `userResult` (from the
 * played match, in home/away terms) or is simulated when omitted.
 */
export function advanceDay(season: Season, userResult: GameResult | null = null): void {
  const rng = new Rng(season.rng);
  if (season.phase === "regular") {
    for (const f of season.fixtures) {
      if (f.day !== season.day || f.result) continue;
      const mine = f.home === season.user || f.away === season.user;
      f.result = mine && userResult ? userResult : simulateGame(rng, f.home, f.away, false);
    }
    season.day++;
    if (season.day >= season.games) startPlayoffs(season);
  } else if (season.phase === "playoff") {
    const po = season.playoffs!;
    for (const s of po.series) {
      if (s.winner !== null) continue;
      const mine = s.hi === season.user || s.lo === season.user;
      let r: GameResult;
      if (mine && userResult) r = userResult;
      else r = simulateGame(rng, seriesHome(s), seriesHome(s) === s.hi ? s.lo : s.hi, true);
      recordSeriesGame(s, r);
    }
    if (po.series.every((s) => s.winner !== null)) nextRound(season);
  }
  season.rng = rng.getState();
}

/** Simulate `days` days including the user's games. Stops at the end of the season. */
export function simulateDays(season: Season, days: number): void {
  for (let i = 0; i < days && season.phase !== "done"; i++) advanceDay(season, null);
}

/** Simulate until the phase changes (regular to playoff, playoff to done). */
export function simulateToNextPhase(season: Season): void {
  const phase = season.phase;
  while (season.phase === phase) advanceDay(season, null);
}

export function userAlive(season: Season): boolean {
  if (season.phase === "regular") return true;
  const po = season.playoffs;
  if (!po) return false;
  if (season.phase === "done") return po.champion === season.user;
  return po.series.some((s) => s.hi === season.user || s.lo === season.user) && currentSeries(season, season.user) !== null;
}

/** Where the user's playoff run ended: the round they lost in, or "champion". */
export function userOutcome(season: Season): { kind: "regular" | "missed" | "eliminated" | "playing" | "champion"; round?: 1 | 2 | 3 | 4 } {
  if (season.phase === "regular") return { kind: "regular" };
  const po = season.playoffs!;
  if (po.champion === season.user) return { kind: "champion" };
  const mine = [...po.history, ...po.series].filter((s) => s.hi === season.user || s.lo === season.user);
  if (mine.length === 0) return { kind: "missed" };
  const last = mine[mine.length - 1];
  if (last.winner === null) return { kind: "playing", round: last.round };
  if (last.winner !== season.user) return { kind: "eliminated", round: last.round };
  return { kind: "playing", round: last.round };
}

// ------------------------------------------------------------ recording a played game

/** Convert a played match (user side always simulated as team 0) to home/away terms. */
export function resultForUser(season: Season, home: number, userGoals: number, oppGoals: number, by: Decided): GameResult {
  return season.user === home ? { hg: userGoals, ag: oppGoals, by } : { hg: oppGoals, ag: userGoals, by };
}

// ------------------------------------------------------------ persistence

export const LEAGUE_KEY = SEASON_KEY;

export function serializeSeason(s: Season): string {
  return JSON.stringify(s);
}

export function parseSeason(raw: string | null): Season | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Season;
    if (s.version !== 1 || !Array.isArray(s.fixtures) || typeof s.user !== "number" || s.user < 0 || s.user >= TEAMS.length) return null;
    if (![21, 42, 63].includes(s.games) || s.fixtures.length !== (s.games / 21) * 11 * 21) return null;
    if (s.phase !== "regular" && s.phase !== "playoff" && s.phase !== "done") return null;
    if (s.phase !== "regular" && !s.playoffs) return null;
    return s;
  } catch {
    return null;
  }
}

export function loadSeason(): Season | null {
  try {
    return parseSeason(localStorage.getItem(LEAGUE_KEY));
  } catch {
    return null;
  }
}

export function saveSeason(s: Season | null): void {
  try {
    if (s) localStorage.setItem(LEAGUE_KEY, serializeSeason(s));
    else localStorage.removeItem(LEAGUE_KEY);
    touchSaved();
  } catch {
    /* progress will not persist without storage */
  }
}

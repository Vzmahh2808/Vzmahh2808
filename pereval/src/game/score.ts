import { CATEGORIES } from "./data";
import type { GameState } from "./types";

export interface Rank {
  name: string;
  min: number;
}

/** Sporting ranks, top first. */
export const RANKS: Rank[] = [
  { name: "Мастер спорта", min: 2000 },
  { name: "Кандидат в мастера", min: 1500 },
  { name: "1-й разряд", min: 1100 },
  { name: "2-й разряд", min: 750 },
  { name: "3-й разряд", min: 400 },
  { name: "Значок «Турист России»", min: 150 },
  { name: "Без разряда", min: 0 },
];

export function rankFor(score: number): string {
  for (const r of RANKS) if (score >= r.min) return r.name;
  return RANKS[RANKS.length - 1].name;
}

export interface ScoreBreakdown {
  checkpoints: number;
  finish: number;
  peaks: number;
  daysLeft: number;
  health: number;
  morale: number;
  falls: number;
  restDays: number;
  factor: number;
  total: number;
}

export function scoreBreakdown(s: GameState): ScoreBreakdown {
  const won = s.status === "won";
  const taken = s.checkpoints.filter((c) => c.taken).length;
  const avgHealth = s.members.reduce((a, m) => a + m.health, 0) / Math.max(1, s.members.length);
  const daysLeft = won ? Math.max(0, s.deadline - s.day) : 0;
  const b: ScoreBreakdown = {
    checkpoints: taken * 150,
    finish: won ? 300 : 0,
    peaks: s.stats.peaks * 100,
    daysLeft: daysLeft * 40,
    health: Math.round(avgHealth),
    morale: Math.round(s.morale / 2),
    falls: -s.stats.falls * 30,
    restDays: -s.stats.restDays * 10,
    factor: CATEGORIES[s.category].factor,
    total: 0,
  };
  const raw = b.checkpoints + b.finish + b.peaks + b.daysLeft + b.health + b.morale + b.falls + b.restDays;
  b.total = Math.max(0, Math.round(raw * b.factor));
  return b;
}

export function scoreOf(s: GameState): number {
  return scoreBreakdown(s).total;
}

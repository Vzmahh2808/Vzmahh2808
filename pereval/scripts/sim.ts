/**
 * Headless balance check: a greedy bot walks N routes per category and we report
 * how often it finishes in time. Run with: npm run sim -- [games] [seed]
 */
import { Game } from "../src/game/game";
import { scoreOf } from "../src/game/score";
import type { Category, Point } from "../src/game/types";

const games = Number(process.argv[2] ?? 50);
const baseSeed = Number(process.argv[3] ?? 1000);

interface Result {
  status: string;
  reason: string;
  day: number;
  cps: number;
  score: number;
  falls: number;
  foodLeft: number;
  minHealth: number;
}

/** Greedy nearest-checkpoint bot; the same brain is reused by the UI's "autoplay" test helper. */
export function botStep(g: Game): boolean {
  const s = g.state;
  // The bot is cautious: it takes the last option, which is usually "keep walking".
  if (s.pendingChoice) return g.choose(s.pendingChoice.options.length - 1);
  if (s.pending) {
    if (s.pending.kind === "river" && s.pending.methods.includes("rope") && s.weather !== "clear") g.chooseMethod("rope");
    return g.resolveStage(s.members.map((m) => g.autoQuality(m)));
  }
  for (const m of s.members) {
    if ((m.health < 40 || m.injury >= 2) && s.supplies.kit > 0) {
      g.useKit(m.id);
      return true;
    }
  }
  if (s.hours === 10 && g.averageStamina() < 25 && s.supplies.food >= s.members.length * 2 && s.day < s.deadline - 1) {
    return g.camp(true);
  }
  const targets: Point[] = s.checkpoints.filter((c) => !c.taken).map((c) => c.pos);
  const goals = targets.length ? targets : [s.finish];
  let best: Point[] | null = null;
  for (const t of goals) {
    const p = g.pathTo(t);
    if (p && (!best || g.pathHours(p) < g.pathHours(best))) best = p;
  }
  if (!best || best.length === 0) return g.camp();
  const next = best[0];
  const moved = g.move(next.x - s.pos.x, next.y - s.pos.y);
  if (moved) return true;
  return g.camp();
}

function playOne(seed: number, category: Category): Result {
  // Pick the four strongest candidates, like a careful leader would.
  const roster = Game.roster(seed, category).sort((a, b) => b.technique + b.strength - (a.technique + a.strength));
  const g = Game.newGame(seed, category, { ...Game.defaultSetup(category, roster), memberIds: roster.slice(0, 4).map((m) => m.id) });
  let guard = 0;
  while (g.state.status === "playing" && guard++ < 2000) {
    botStep(g);
  }
  const s = g.state;
  return {
    status: s.status,
    reason: s.endReason,
    day: s.day,
    cps: s.checkpoints.filter((c) => c.taken).length,
    score: scoreOf(s),
    falls: s.stats.falls,
    foodLeft: s.supplies.food,
    minHealth: Math.min(...s.members.map((m) => m.health)),
  };
}

for (const category of [1, 2, 3] as Category[]) {
  const results: Result[] = [];
  for (let i = 0; i < games; i++) results.push(playOne(baseSeed + i, category));
  const won = results.filter((r) => r.status === "won");
  const avg = (f: (r: Result) => number, list = results) => (list.reduce((a, r) => a + f(r), 0) / Math.max(1, list.length)).toFixed(1);
  const reasons = new Map<string, number>();
  for (const r of results) if (r.status !== "won") reasons.set(r.reason.replace(/^\S+ нуждается/, "* нуждается"), (reasons.get(r.reason.replace(/^\S+ нуждается/, "* нуждается")) ?? 0) + 1);
  console.log(`Категория ${category}: побед ${won.length}/${results.length}, средний день финиша ${avg((r) => r.day, won)}, КП ${avg((r) => r.cps)}, очки ${avg((r) => r.score)}, падений ${avg((r) => r.falls)}, еды в конце ${avg((r) => r.foodLeft)}, мин. здоровье ${avg((r) => r.minHealth)}`);
  for (const [reason, n] of reasons) console.log(`   ${n}× ${reason}`);
}

/**
 * Headless balance check: a simple bot plays N games and we report how deep it gets.
 * Run with: npm run sim -- [games] [seed]
 */
import { playBot } from "./bot";

const games = Number(process.argv[2] ?? 100);
const baseSeed = Number(process.argv[3] ?? 1000);

interface Result {
  depth: number;
  level: number;
  turns: number;
  status: string;
  cause: string;
  kills: number;
}

function playOne(seed: number): Result {
  const g = playBot(seed);
  return {
    depth: g.state.depth,
    level: g.player.level,
    turns: g.state.turn,
    status: g.state.status,
    cause: g.state.deathCause,
    kills: g.player.kills,
  };
}

const results: Result[] = [];
for (let i = 0; i < games; i++) results.push(playOne(baseSeed + i));

const byDepth = new Map<number, number>();
const causes = new Map<string, number>();
let wins = 0;
let timeouts = 0;
for (const r of results) {
  byDepth.set(r.depth, (byDepth.get(r.depth) ?? 0) + 1);
  if (r.status === "won") wins++;
  else if (r.status === "playing") timeouts++;
  else causes.set(r.cause, (causes.get(r.cause) ?? 0) + 1);
}
const avg = (f: (r: Result) => number) => (results.reduce((s, r) => s + f(r), 0) / results.length).toFixed(1);

console.log(`games: ${games}  wins: ${wins}  timeouts: ${timeouts}`);
console.log(`avg depth ${avg((r) => r.depth)}  avg level ${avg((r) => r.level)}  avg turns ${avg((r) => r.turns)}  avg kills ${avg((r) => r.kills)}`);
console.log("depth reached:");
for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
  console.log(`  ${String(d).padStart(2)}: ${"#".repeat(byDepth.get(d)!)} ${byDepth.get(d)}`);
}
console.log("death causes:");
for (const [c, n] of [...causes.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${c}: ${n}`);

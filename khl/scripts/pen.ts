import { Match, defaultSettings } from "../src/sim/match";
const N = Number(process.env.N ?? 30);
let pim = [0, 0], g = [0, 0], ppGoals = 0, kinds: Record<string, number> = {};
for (let seed = 1; seed <= N; seed++) {
  const m = new Match({ ...defaultSettings(), seed: Math.imul(seed + 5, 2654435761) >>> 0, humanHome: false });
  let k = 0;
  while (m.phase !== "final" && k < 120 * 60 * 25) {
    const before = m.score.slice();
    const pens = m.penalties.length;
    m.tick(1 / 120);
    for (const e of m.drainEvents()) if (e.type === "penalty") kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    if (pens > 0 && m.phase === "goal" && (m.score[0] !== before[0] || m.score[1] !== before[1])) ppGoals++;
    k++;
  }
  pim[0] += m.stats.pim[0]; pim[1] += m.stats.pim[1]; g[0] += m.score[0]; g[1] += m.score[1];
}
console.log(`penalty minutes/team/game ${(pim[0] / N).toFixed(1)} / ${(pim[1] / N).toFixed(1)} (=${(pim[0] / N / 2).toFixed(1)} minors) goals ${(g[0] / N).toFixed(2)} / ${(g[1] / N).toFixed(2)} ppGoals/game ${(ppGoals / N).toFixed(2)} kinds ${JSON.stringify(kinds)}`);

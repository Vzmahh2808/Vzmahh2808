/**
 * Balance harness: plays AI-vs-AI matches and prints league-style statistics.
 *   N=40 DT=120 SIMMODE=even npx vite-node scripts/balance.ts
 */
import { Match, defaultSettings } from "../src/sim/match";
import type { Ratings } from "../src/sim/state";

{
  const N = Number(process.env.N ?? 16);
  const DTS = Number(process.env.DT ?? 120);
  const agg = { g0: 0, g1: 0, s0: 0, s1: 0, og0: 0, og1: 0, ot: 0, so: 0, hits: 0, zero: 0, max: 0, passes: 0, blocks: 0, saves: 0, held: 0, posts: 0, loose: 0, steps: 0, offZone: 0, home: 0, checks: 0, pokes: 0, pokeOk: 0 };
  const t0 = Date.now();
  let wins0 = 0;
  const strong: Ratings = { off: 90, def: 85, gk: 90, spd: 85 };
  const weak: Ratings = { off: 60, def: 60, gk: 60, spd: 62 };
  const mode = process.env.SIMMODE ?? "even";
  for (let seed = 1; seed <= N; seed++) {
    const s = { ...defaultSettings(), seed: seed * 7919, humanHome: false };
    if (mode === "mismatch") {
      s.home = strong;
      s.away = weak;
    }
    if (process.env.SIMH && process.env.SIMA) {
      const h = Number(process.env.SIMH);
      const a = Number(process.env.SIMA);
      s.home = { off: h, def: h, gk: h, spd: h };
      s.away = { off: a, def: a, gk: a, spd: a };
    }
    const m = new Match(s);
    let steps = 0;
    while (m.phase !== "final" && steps < DTS * 60 * 25) {
      m.tick(1 / DTS);
      for (const e of m.drainEvents()) {
        if (e.type === "pass") agg.passes++;
        if (e.type === "block") agg.blocks++;
        if (e.type === "save") {
          agg.saves++;
          if (e.held) agg.held++;
        }
        if (e.type === "post") agg.posts++;
        if (e.type === "poke") {
          agg.pokes++;
          if (e.ok) agg.pokeOk++;
        }
      }
      const p = m.w.puck;
      if (m.phase === "play") {
        agg.steps++;
        if (p.carrier === -1 && Math.hypot(p.vel.x, p.vel.y) < 1) agg.loose++;
        if (Math.abs(p.pos.x) > 7.14) agg.offZone++;
      }
      steps++;
    }
    if (m.winner === 0) wins0++;
    agg.g0 += m.score[0];
    agg.g1 += m.score[1];
    agg.s0 += m.stats.shots[0];
    agg.s1 += m.stats.shots[1];
    agg.og0 += m.stats.onGoal[0];
    agg.og1 += m.stats.onGoal[1];
    agg.hits += m.stats.hits[0] + m.stats.hits[1];
    if (m.decidedBy === "ot") agg.ot++;
    if (m.decidedBy === "so") agg.so++;
    if (m.score[0] + m.score[1] === 0) agg.zero++;
    agg.max = Math.max(agg.max, m.score[0], m.score[1]);
  }
  const n = N * 2;
  const g = (agg.g0 + agg.g1) / n;
  const og = (agg.og0 + agg.og1) / n;
  console.log(
    `home win ${(wins0 / N).toFixed(2)} [${mode} dt=1/${DTS}] N=${N} goals/team ${g.toFixed(2)} (home ${(agg.g0 / N).toFixed(2)} away ${(agg.g1 / N).toFixed(2)}) shots/team ${((agg.s0 + agg.s1) / n).toFixed(1)} onGoal/team ${og.toFixed(1)} sv% ${(1 - g / og).toFixed(3)} passes/team ${(agg.passes / n).toFixed(0)} blocks/game ${(agg.blocks / N).toFixed(1)} held ${(agg.held / Math.max(1, agg.saves)).toFixed(2)} posts/game ${(agg.posts / N).toFixed(1)} hits/game ${(agg.hits / N).toFixed(1)} pokes/game ${(agg.pokes / N).toFixed(0)} (ok ${(agg.pokeOk / Math.max(1, agg.pokes)).toFixed(2)}) loose-still ${(agg.loose / agg.steps).toFixed(3)} outsideNeutral ${(agg.offZone / agg.steps).toFixed(2)} OT ${agg.ot} SO ${agg.so} 0:0 ${agg.zero} max ${agg.max} time ${Date.now() - t0}ms`,
  );
}

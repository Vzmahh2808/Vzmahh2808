import { Match, defaultSettings } from "../src/sim/match";

const DTS = Number(process.env.DT ?? 60);
const N = Number(process.env.N ?? 20);
const t = { g: [0, 0], shots: [0, 0], og: [0, 0], passes: [0, 0], poke: [0, 0], pokeOk: [0, 0], hits: [0, 0], carry: [0, 0], loose: 0, steps: 0 };
for (let seed = 1; seed <= N; seed++) {
  const m = new Match({ ...defaultSettings(), seed: Math.imul(seed + Number(process.env.OFF ?? 17), 2654435761) >>> 0, humanHome: false });
  let steps = 0;
  while (m.phase !== "final" && steps < DTS * 60 * 25) {
    m.tick(1 / DTS);
    for (const e of m.drainEvents()) {
      if (e.type === "pass") t.passes[e.team]++;
      if (e.type === "poke") {
        t.poke[e.team]++;
        if (e.ok) t.pokeOk[e.team]++;
      }
    }
    if (m.phase === "play") {
      t.steps++;
      const c = m.w.puck.carrier;
      if (c >= 0) t.carry[m.w.skaters[c].team]++;
      else t.loose++;
    }
    steps++;
  }
  t.g[0] += m.score[0];
  t.g[1] += m.score[1];
  t.shots[0] += m.stats.shots[0];
  t.shots[1] += m.stats.shots[1];
  t.og[0] += m.stats.onGoal[0];
  t.og[1] += m.stats.onGoal[1];
  t.hits[0] += m.stats.hits[0];
  t.hits[1] += m.stats.hits[1];
}
const f = (a: number[]) => a.map((x) => (x / N).toFixed(1)).join(" / ");
console.log(`dt=1/${DTS} N=${N} goals ${f(t.g)} shots ${f(t.shots)} onGoal ${f(t.og)} passes ${f(t.passes)} pokes ${f(t.poke)} ok ${f(t.pokeOk)} hits ${f(t.hits)} carry% ${(t.carry[0] / t.steps).toFixed(2)}/${(t.carry[1] / t.steps).toFixed(2)} loose% ${(t.loose / t.steps).toFixed(2)}`);

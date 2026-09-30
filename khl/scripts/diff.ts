import { Match, defaultSettings } from "../src/sim/match";
const N = Number(process.env.N ?? 24);
const hi = Number(process.env.HI ?? 0.85);
const lo = Number(process.env.LO ?? 0.35);
let wins = 0, gh = 0, ga = 0;
for (let seed = 1; seed <= N; seed++) {
  // Alternate sides so home advantage cannot matter.
  const flip = seed % 2 === 0;
  const m = new Match({ ...defaultSettings(), seed: Math.imul(seed + 3, 2654435761) >>> 0, humanHome: false, difficultyHome: flip ? lo : hi, difficultyAway: flip ? hi : lo });
  let k = 0;
  while (m.phase !== "final" && k < 120 * 60 * 25) { m.tick(1 / 120); m.drainEvents(); k++; }
  const strongWon = m.winner === (flip ? 1 : 0);
  if (strongWon) wins++;
  gh += flip ? m.score[1] : m.score[0];
  ga += flip ? m.score[0] : m.score[1];
}
console.log(`diff ${hi} vs ${lo}: strong won ${wins}/${N}, goals strong ${(gh / N).toFixed(2)} weak ${(ga / N).toFixed(2)}`);

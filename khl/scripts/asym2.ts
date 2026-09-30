import { Match, defaultSettings } from "../src/sim/match";

const N = 20;
let sumX = 0, steps = 0, left = 0, right = 0;
const shotX: number[] = [0, 0];
const shotCount = [0, 0];
const speedSum = [0, 0];
const speedN = [0, 0];
const cornerY = { neg: [0, 0], pos: [0, 0] };
for (let seed = 1; seed <= N; seed++) {
  const m = new Match({ ...defaultSettings(), seed: seed * 4441, humanHome: false });
  let k = 0;
  while (m.phase !== "final" && k < 120 * 60 * 25) {
    m.tick(1 / 120);
    for (const e of m.drainEvents()) {
      if (e.type === "shot") {
        shotCount[e.team]++;
        shotX[e.team] += m.w.puck.pos.x * (e.team === 0 ? 1 : -1);
      }
    }
    if (m.phase === "play") {
      sumX += m.w.puck.pos.x; steps++;
      if (m.w.puck.pos.x < -7.14) left++; else if (m.w.puck.pos.x > 7.14) right++;
      for (const s of m.w.skaters) {
        if (s.role === "G") continue;
        speedSum[s.team] += Math.hypot(s.vel.x, s.vel.y); speedN[s.team]++;
      }
    }
    k++;
  }
}
console.log(`mean puck x ${(sumX / steps).toFixed(2)}  time in x<-7: ${(left / steps).toFixed(3)}  x>7: ${(right / steps).toFixed(3)}`);
console.log(`shots ${shotCount.map((c) => (c / N).toFixed(1))} avg shot origin (attack-relative x) ${shotX.map((x, i) => (x / shotCount[i]).toFixed(1))}`);
console.log(`avg skater speed ${speedSum.map((s, i) => (s / speedN[i]).toFixed(2))}`);
void cornerY;

import { Match, defaultSettings } from "../src/sim/match";
import { thinkAI } from "../src/sim/ai";
import { stepWorld } from "../src/sim/physics";

const m = new Match({ ...defaultSettings(), seed: 3, humanHome: false });
const w = m.w;
// Skip the faceoff countdown and drop the puck dead centre with no speed.
for (let i = 0; i < 200; i++) m.tick(1 / 120);
w.puck.pos.x = 0; w.puck.pos.y = 0; w.puck.vel.x = 0; w.puck.vel.y = 0; w.puck.carrier = -1;
for (const s of w.skaters) { s.vel.x = 0; s.vel.y = 0; s.stun = 0; }
m.setupFaceoff();
m.phase = "play";
for (let step = 0; step < 240; step++) {
  thinkAI(w, 1 / 120);
  stepWorld(w, 1 / 120);
  if (step % 40 === 0) {
    const rows = w.skaters.filter((s) => s.team === 0).map((a) => {
      const b = w.skaters[a.id + 6];
      return `${a.role}: dx=${(a.pos.x + b.pos.x).toFixed(3)} dy=${(a.pos.y - b.pos.y).toFixed(3)}`;
    });
    console.log(`step ${step} carrier=${w.puck.carrier} puck=(${w.puck.pos.x.toFixed(2)},${w.puck.pos.y.toFixed(2)})  ${rows.join(" | ")}`);
  }
}

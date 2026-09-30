import { makeWorld, skaterId, goalieId } from "../src/sim/state";
import { stepWorld } from "../src/sim/physics";
import { shoot, takePuck } from "../src/sim/actions";

for (const team of [0, 1] as const) {
  let goals = 0, saves = 0, held = 0, misses = 0;
  const N = 3000;
  const byY: number[] = [0, 0, 0, 0];
  for (let seed = 1; seed <= N; seed++) {
    const w = makeWorld(seed * 7 + 1);
    const s = w.skaters[skaterId(team, "C")];
    const dir = team === 0 ? 1 : -1;
    for (const o of w.skaters) if (o.id !== s.id && o.id !== goalieId((1 - team) as 0 | 1)) o.active = false;
    const y0 = ((seed % 5) - 2) * 1.6;
    s.pos.x = 14 * dir; s.pos.y = y0; s.heading = team === 0 ? 0 : Math.PI;
    takePuck(w, s);
    w.puck.pos.x = s.pos.x + dir * 0.7; w.puck.pos.y = y0;
    shoot(w, s, 0.6);
    let result = "miss";
    for (let i = 0; i < 240; i++) {
      stepWorld(w, 1 / 120);
      const g = w.events.find((e) => e.type === "goal");
      const sv = w.events.find((e) => e.type === "save");
      if (g) { result = "goal"; break; }
      if (sv) { result = sv.type === "save" && sv.held ? "held" : "save"; break; }
      w.events.length = 0;
    }
    if (result === "goal") { goals++; byY[Math.min(3, Math.floor(Math.abs(y0) / 1.7))]++; }
    else if (result === "save") saves++;
    else if (result === "held") held++;
    else misses++;
  }
  console.log(`team ${team} shooting: goals ${goals} saves ${saves} held ${held} nothing ${misses} of ${N}`);
}

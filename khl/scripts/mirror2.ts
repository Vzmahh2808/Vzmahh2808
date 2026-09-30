import { makeWorld, skaterId, goalieId } from "../src/sim/state";
import { stepWorld } from "../src/sim/physics";
import { thinkAI } from "../src/sim/ai";
import { shoot, takePuck } from "../src/sim/actions";

function park(w: ReturnType<typeof makeWorld>, keep: number[]) {
  for (const s of w.skaters) if (!keep.includes(s.id)) s.active = false;
}

// 1. Straight skating, mirrored.
for (const team of [0, 1] as const) {
  const w = makeWorld(1);
  const s = w.skaters[skaterId(team, "C")];
  park(w, [s.id]);
  const dir = team === 0 ? 1 : -1;
  s.pos.x = 0; s.pos.y = 0; s.heading = team === 0 ? 0 : Math.PI;
  s.input.mx = dir; s.input.my = 0.5; s.input.sprint = true;
  for (let i = 0; i < 240; i++) stepWorld(w, 1 / 120);
  console.log(`skate team ${team}: x*dir=${(s.pos.x * dir).toFixed(3)} y=${s.pos.y.toFixed(3)} speed=${Math.hypot(s.vel.x, s.vel.y).toFixed(3)}`);
}

// 2. Same slap shot on an empty net from the same relative spot.
for (const team of [0, 1] as const) {
  let goals = 0, total = 0, sumSpeed = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const w = makeWorld(seed);
    const s = w.skaters[skaterId(team, "C")];
    const dir = team === 0 ? 1 : -1;
    park(w, [s.id, goalieId((1 - team) as 0 | 1)]);
    s.pos.x = 14 * dir; s.pos.y = 3; s.heading = team === 0 ? 0 : Math.PI;
    takePuck(w, s);
    w.puck.pos.x = s.pos.x + dir * 0.7; w.puck.pos.y = 3;
    shoot(w, s, 0.6);
    sumSpeed += Math.hypot(w.puck.vel.x, w.puck.vel.y);
    for (let i = 0; i < 240; i++) {
      stepWorld(w, 1 / 120);
      if (w.events.some((e) => e.type === "goal")) { goals++; break; }
      w.events.length = 0;
    }
    total++;
  }
  console.log(`shot team ${team}: goals ${goals}/${total} avg speed ${(sumSpeed / total).toFixed(2)}`);
}

// 3. AI chasing a loose puck from mirrored positions.
for (const team of [0, 1] as const) {
  const w = makeWorld(2);
  const s = w.skaters[skaterId(team, "C")];
  park(w, [s.id]);
  const dir = team === 0 ? 1 : -1;
  s.pos.x = -5 * dir; s.pos.y = 4; s.heading = team === 0 ? 0 : Math.PI;
  w.puck.pos.x = 8 * dir; w.puck.pos.y = -2; w.puck.vel.x = 0; w.puck.vel.y = 0;
  w.human = [false, false];
  let t = 0;
  while (w.puck.carrier !== s.id && t < 600) { thinkAI(w, 1 / 120); stepWorld(w, 1 / 120); t++; }
  console.log(`chase team ${team}: took ${t} steps, at x*dir=${(s.pos.x * dir).toFixed(2)} y=${s.pos.y.toFixed(2)}`);
}

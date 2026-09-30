/** One step of the world: skating, puck, collisions, goals. Inputs are set beforehand. */
import { angleDiff, approach, clamp, lerp } from "../core/vec";
import { check, pass, shoot, stickPoint, takePuck, REACH } from "./actions";
import { stepGoalie, tryGoalieSave } from "./goalie";
import { NETS, PUCK_R, collidePoint, collideRink, collideSeg, GOAL_HALF, type TeamId } from "./rink";
import type { Skater, World } from "./state";

export const DT = 1 / 120;

export const P = {
  maxSpeed: 8.4,
  carryMul: 0.94,
  sprintMul: 1.2,
  accel: 7.2,
  grip: 6.5,
  glide: 3.2,
  brake: 9,
  bodyR: 0.45,
  puckFriction: 0.85,
};

const sp = { x: 0, y: 0 };

function stepSkater(w: World, s: Skater, dt: number): void {
  const inp = s.input;
  const stunned = s.stun > 0;
  let mx = stunned ? 0 : inp.mx;
  let my = stunned ? 0 : inp.my;
  const mag = Math.min(1, Math.hypot(mx, my));
  if (mag > 0) {
    mx /= Math.max(mag, 1e-6);
    my /= Math.max(mag, 1e-6);
  }
  const carrying = w.puck.carrier === s.id;
  const sprint = !stunned && inp.sprint && s.stamina > 0.03 && mag > 0.5;
  const speed = Math.hypot(s.vel.x, s.vel.y);
  const tired = 0.88 + 0.12 * clamp(s.stamina / 0.4, 0, 1);
  const vmax = P.maxSpeed * s.speed * tired * (carrying ? P.carryMul : 1) * (sprint ? P.sprintMul : 1);

  if (mag > 0.12) {
    const target = Math.atan2(my, mx);
    const rate = lerp(9.5, 3.4, clamp(speed / vmax, 0, 1));
    const d = angleDiff(s.heading, target);
    const step = rate * dt;
    s.heading += Math.abs(d) <= step ? d : Math.sign(d) * step;
  }
  const fx = Math.cos(s.heading);
  const fy = Math.sin(s.heading);
  let vf = s.vel.x * fx + s.vel.y * fy;
  let sx = s.vel.x - fx * vf;
  let sy = s.vel.y - fy * vf;
  const targetV = vmax * mag;
  if (mag > 0.12) {
    if (vf < targetV) vf = Math.min(targetV, vf + P.accel * dt * (sprint ? 1.15 : 1));
    else vf = Math.max(targetV, vf - P.glide * dt);
    // Steering against the current motion brakes hard.
    if (speed > 1 && (s.vel.x * mx + s.vel.y * my) / speed < -0.3) {
      const k = Math.max(0, 1 - (P.brake * dt) / speed);
      vf *= k;
      sx *= k;
      sy *= k;
    }
  } else {
    vf = approach(vf, 0, (stunned ? P.glide : P.glide * 1.1) * dt);
  }
  const keep = Math.exp(-P.grip * dt);
  s.vel.x = fx * vf + sx * keep;
  s.vel.y = fy * vf + sy * keep;
  s.pos.x += s.vel.x * dt;
  s.pos.y += s.vel.y * dt;

  if (sprint) s.stamina = Math.max(0, s.stamina - 0.2 * dt);
  else s.stamina = Math.min(1, s.stamina + (mag < 0.2 ? 0.16 : 0.09) * dt);
}

function processActions(w: World, s: Skater, dt: number): void {
  const inp = s.input;
  if (s.stun > 0) {
    s.charge = 0;
    return;
  }
  const carrying = w.puck.carrier === s.id;
  if (inp.shootHeld) s.charge = Math.min(1.2, s.charge + dt);
  if (inp.shootReleased) {
    if (carrying) shoot(w, s, s.charge);
    else if (incomingTo(w, s)) {
      s.shotBuffer = 0.4;
      s.bufferedCharge = s.charge;
    }
    s.charge = 0;
  } else if (!inp.shootHeld) {
    s.charge = 0;
  }
  if (inp.pass && carrying) pass(w, s);
  if (inp.check) check(w, s);
}

/** True while a teammate's pass or a loose puck is about to arrive at this skater. */
function incomingTo(w: World, s: Skater): boolean {
  const p = w.puck;
  if (p.carrier !== -1) return false;
  if (p.passTo === s.id) return true;
  if (p.lastTeam !== s.team) return false;
  const dx = s.pos.x - p.pos.x;
  const dy = s.pos.y - p.pos.y;
  const d = Math.hypot(dx, dy);
  return d < 3.2 && d > 0.2 && (p.vel.x * dx + p.vel.y * dy) / d > 3;
}

function carryPuck(w: World, s: Skater, dt: number): void {
  const p = w.puck;
  if (s.stun > 0 || !s.active) {
    p.carrier = -1;
    p.flight = 99;
    return;
  }
  if (s.role === "G") return;
  const sway = Math.sin(w.t * 6 + s.id) * 0.16;
  const fx = Math.cos(s.heading);
  const fy = Math.sin(s.heading);
  const tx = s.pos.x + fx * 0.72 - fy * sway;
  const ty = s.pos.y + fy * 0.72 + fx * sway;
  const k = 1 - Math.exp(-28 * dt);
  const px = p.pos.x;
  const py = p.pos.y;
  p.pos.x += (tx - p.pos.x) * k;
  p.pos.y += (ty - p.pos.y) * k;
  p.vel.x = s.vel.x;
  p.vel.y = s.vel.y;
  const goal = goalCrossing(px, py, p.pos.x, p.pos.y);
  if (goal !== null) scoreGoal(w, goal);
}

/** Team that just scored if the segment from (ax, ay) to (bx, by) crosses a goal mouth, else null. */
function goalCrossing(ax: number, ay: number, bx: number, by: number): TeamId | null {
  for (const net of NETS) {
    const da = (ax - net.lineX) * net.out;
    const db = (bx - net.lineX) * net.out;
    if (da < 0 && db >= 0) {
      const t = da / (da - db);
      const y = ay + (by - ay) * t;
      if (Math.abs(y) < GOAL_HALF - PUCK_R * 0.5) return (1 - net.team) as TeamId;
    }
  }
  return null;
}

function scoreGoal(w: World, team: TeamId): void {
  // Scorer and up to two assists come from the recent touches by the scoring side.
  const mine = w.touches.filter((id) => w.skaters[id].team === team && w.skaters[id].role !== "G");
  const uniq: number[] = [];
  for (const id of mine) if (!uniq.includes(id)) uniq.push(id);
  const scorer = uniq[0] ?? -1;
  w.events.push({ type: "goal", team, scorer, assist: uniq.slice(1, 3) });
  w.puck.rebound = 0;
}

function separate(w: World, dt: number): void {
  const list = w.skaters;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.active) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!b.active) continue;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const d2 = dx * dx + dy * dy;
      const rr = P.bodyR * 2;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-6;
      const nx = dx / d;
      const ny = dy / d;
      const pen = rr - d;
      const ma = a.role === "G" ? 3 : 1;
      const mb = b.role === "G" ? 3 : 1;
      const tot = ma + mb;
      a.pos.x -= nx * pen * (mb / tot);
      a.pos.y -= ny * pen * (mb / tot);
      b.pos.x += nx * pen * (ma / tot);
      b.pos.y += ny * pen * (ma / tot);
      const rv = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny;
      if (rv < 0) {
        const j2 = (-(1 + 0.15) * rv) / (1 / ma + 1 / mb);
        a.vel.x -= (j2 / ma) * nx;
        a.vel.y -= (j2 / ma) * ny;
        b.vel.x += (j2 / mb) * nx;
        b.vel.y += (j2 / mb) * ny;
      }
    }
  }
  void dt;
}

function skaterWalls(w: World): void {
  for (const s of w.skaters) {
    if (!s.active) continue;
    const hit = collideRink(s.pos, s.vel, P.bodyR, 0.15, 0.06);
    if (hit > 8 && s.role !== "G") s.stun = Math.max(s.stun, 0.12);
    if (s.role === "G") continue;
    for (const net of NETS) {
      for (const wall of net.walls) collideSeg(wall, s.pos, s.vel, P.bodyR, 0.1);
      collideSeg(net.front, s.pos, s.vel, P.bodyR, 0.1);
      for (const post of net.posts) collidePoint(post, 0.03, s.pos, s.vel, P.bodyR, 0.1);
    }
  }
}

function stepPuck(w: World, dt: number): void {
  const p = w.puck;
  if (p.carrier !== -1) return;
  const speed0 = Math.hypot(p.vel.x, p.vel.y);
  const n = clamp(Math.ceil((speed0 * dt) / 0.03), 1, 20);
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const px = p.pos.x;
    const py = p.pos.y;
    p.pos.x += p.vel.x * h;
    p.pos.y += p.vel.y * h;
    const board = collideRink(p.pos, p.vel, PUCK_R, 0.62, 0.04);
    if (board > 4) w.events.push({ type: "board", speed: board });
    for (const net of NETS) {
      for (const wall of net.walls) {
        const hit = collideSeg(wall, p.pos, p.vel, PUCK_R, 0.25);
        if (hit > 6) w.events.push({ type: "board", speed: hit * 0.5 });
      }
      for (const post of net.posts) {
        const hit = collidePoint(post, 0.03, p.pos, p.vel, PUCK_R, 0.75);
        if (hit > 3) {
          w.events.push({ type: "post", speed: hit });
          p.beaten = -1;
        }
      }
    }
    const goal = goalCrossing(px, py, p.pos.x, p.pos.y);
    if (goal !== null) {
      scoreGoal(w, goal);
      return;
    }
    for (const s of w.skaters) {
      if (!s.active) continue;
      if (s.role === "G") {
        if (tryGoalieSave(w, s)) break;
        continue;
      }
      // Shot blocking by the defending side.
      if (p.lastTeam !== -1 && s.team !== p.lastTeam && s.blockCd <= 0 && p.flight < 3) {
        const sp2 = Math.hypot(p.vel.x, p.vel.y);
        if (sp2 > 24) {
          const dx = p.pos.x - s.pos.x;
          const dy = p.pos.y - s.pos.y;
          if (dx * dx + dy * dy < (0.42 + PUCK_R) * (0.42 + PUCK_R)) {
            s.blockCd = 0.35;
            if (w.rng.next() < 0.38 * s.def) {
              const a = Math.atan2(p.vel.y, p.vel.x) + (w.rng.next() - 0.5) * 1.8;
              const out = sp2 * 0.28;
              p.vel.x = Math.cos(a) * out;
              p.vel.y = Math.sin(a) * out;
              p.lastTouch = s.id;
              p.lastTeam = s.team;
              p.shotTeam = -1;
              w.events.push({ type: "block", team: s.team });
            }
          }
        }
      }
    }
    if (p.carrier !== -1) return;
  }
  // Friction on the ice.
  const sp1 = Math.hypot(p.vel.x, p.vel.y);
  if (sp1 > 0) {
    const ns = Math.max(0, sp1 - P.puckFriction * dt);
    p.vel.x *= ns / sp1;
    p.vel.y *= ns / sp1;
  }
}

function pickups(w: World): void {
  const p = w.puck;
  if (p.carrier !== -1) return;
  const speed = Math.hypot(p.vel.x, p.vel.y);
  let best: Skater | null = null;
  let bestD = Infinity;
  for (const s of w.skaters) {
    if (!s.active || s.pickupCd > 0 || s.stun > 0) continue;
    if (s.role === "G") continue;
    if (p.shooterCd > 0 && p.shooter === s.id) continue;
    stickPoint(s, sp);
    const d = Math.hypot(sp.x - p.pos.x, sp.y - p.pos.y);
    const relSpeed = Math.hypot(p.vel.x - s.vel.x, p.vel.y - s.vel.y);
    const reach = REACH + (p.passTo === s.id ? 0.15 : 0);
    if (d < reach && relSpeed < 24 && speed < 26 && d < bestD) {
      best = s;
      bestD = d;
    }
  }
  if (best) {
    const buffered = best.shotBuffer > 0;
    const charge = best.bufferedCharge;
    takePuck(w, best);
    if (buffered) {
      best.shotBuffer = 0;
      shoot(w, best, Math.max(0.15, charge), true);
    }
  }
}

function tickTimers(w: World, dt: number): void {
  for (const s of w.skaters) {
    if (s.stun > 0) s.stun = Math.max(0, s.stun - dt);
    if (s.pickupCd > 0) s.pickupCd -= dt;
    if (s.pokeCd > 0) s.pokeCd -= dt;
    if (s.blockCd > 0) s.blockCd -= dt;
    if (s.shotBuffer > 0) s.shotBuffer -= dt;
  }
  const p = w.puck;
  if (p.shooterCd > 0) p.shooterCd -= dt;
  p.flight += dt;
  if (p.rebound > 0) p.rebound -= dt;
  if (p.flight > 2.5 && p.passTo !== -1) p.passTo = -1;
}

/** Advance the world by one fixed step. Events are appended to `w.events`. */
export function stepWorld(w: World, dt: number = DT): void {
  w.t += dt;
  tickTimers(w, dt);
  for (const s of w.skaters) {
    if (!s.active) continue;
    if (s.role === "G") stepGoalie(w, s, dt);
    else {
      stepSkater(w, s, dt);
      processActions(w, s, dt);
    }
  }
  separate(w, dt);
  skaterWalls(w);
  const c = w.puck.carrier;
  if (c !== -1) {
    if (w.skaters[c].role !== "G") carryPuck(w, w.skaters[c], dt);
  } else {
    stepPuck(w, dt);
  }
  pickups(w);
  // A carrier too far from the puck (checked away, boxed out) loses it.
  const cc = w.puck.carrier;
  if (cc !== -1 && w.skaters[cc].role !== "G") {
    const s = w.skaters[cc];
    if (Math.hypot(w.puck.pos.x - s.pos.x, w.puck.pos.y - s.pos.y) > 1.6) {
      w.puck.carrier = -1;
      w.puck.flight = 99;
    }
  }
}

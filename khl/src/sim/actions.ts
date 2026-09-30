/** What a skater does with the puck: pass, shoot, poke and body check. */
import { angleDiff, angleOf, clamp, lerp } from "../core/vec";
import { attackDir, goalX, GOAL_HALF, PUCK_R, type TeamId } from "./rink";
import { goalieOf, type Skater, type World } from "./state";

export const CHARGE_MAX = 0.85;
export const PASS_SPEED_MIN = 12;
export const PASS_SPEED_MAX = 22;
export const REACH = 0.85;

/** Standard normal from the world RNG (Box-Muller). */
export function gauss(w: World): number {
  const u = Math.max(1e-9, w.rng.next());
  const v = w.rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function stickPoint(s: Skater, out: { x: number; y: number }): { x: number; y: number } {
  out.x = s.pos.x + Math.cos(s.heading) * 0.55;
  out.y = s.pos.y + Math.sin(s.heading) * 0.55;
  return out;
}

const sp = { x: 0, y: 0 };

/** Give the puck to a skater. */
export function takePuck(w: World, s: Skater): void {
  const p = w.puck;
  p.carrier = s.id;
  p.passTo = -1;
  p.beaten = -1;
  if (p.lastTouch !== s.id) {
    p.lastTouch = s.id;
    w.touches.unshift(s.id);
    if (w.touches.length > 6) w.touches.pop();
  }
  p.lastTeam = s.team;
  p.vel.x = s.vel.x;
  p.vel.y = s.vel.y;
}

/** Direction the shooter aims: stick if it points roughly ahead, else the blade. */
function aimAngle(s: Skater): number {
  const m = Math.hypot(s.input.mx, s.input.my);
  if (m > 0.3) {
    const a = Math.atan2(s.input.my, s.input.mx);
    if (Math.abs(angleDiff(s.heading, a)) < 1.6) return a;
  }
  return s.heading;
}

/**
 * Release the puck toward `aim` (or the aimed direction). `charge` in seconds
 * from 0 to CHARGE_MAX: a tap is a wrist shot, a full hold a slap shot.
 */
export function shoot(w: World, s: Skater, charge: number, oneTimer = false, aim?: number): void {
  const p = w.puck;
  if (p.carrier !== s.id && !oneTimer) return;
  const c = clamp(charge / CHARGE_MAX, 0, 1);
  const team = s.team;
  const net = goalX((1 - team) as TeamId);
  let a = aim ?? aimAngle(s);
  // Aim assist: near the direction of the net, steer to the far corner from the goalie.
  const g = goalieOf(w, (1 - team) as TeamId);
  const dx = net - p.pos.x;
  const dyMid = -p.pos.y;
  const toNet = Math.atan2(dyMid, dx);
  if (Math.abs(angleDiff(a, toNet)) < 0.5 && (dx * attackDir(team)) > 0) {
    const cornerY = g.pos.y > 0.15 ? -0.62 : g.pos.y < -0.15 ? 0.62 : w.rng.next() < 0.5 ? -0.62 : 0.62;
    const toCorner = Math.atan2(cornerY - p.pos.y, dx);
    a = a + angleDiff(a, toCorner) * (aim === undefined ? 0.55 : 0.7);
  }
  const speed = (lerp(19, 38, c * c * 0.5 + c * 0.5) + (oneTimer ? 3 : 0)) * (0.92 + 0.08 * s.shot);
  const sigma = (0.035 + 0.075 * (1 - c * 0.5) + (oneTimer ? 0.03 : 0)) / s.shot + Math.hypot(s.vel.x, s.vel.y) * 0.004;
  a += gauss(w) * sigma;
  p.vel.x = Math.cos(a) * speed + s.vel.x * 0.25;
  p.vel.y = Math.sin(a) * speed + s.vel.y * 0.25;
  p.carrier = -1;
  p.passTo = -1;
  p.shooter = s.id;
  p.shooterCd = 0.3;
  p.flight = 0;
  p.beaten = -1;
  p.lastTouch = s.id;
  p.lastTeam = team;
  p.shotTeam = team;
  p.shotSpeed = speed;
  p.shotDist = Math.hypot(net - p.pos.x, p.pos.y);
  if (w.touches[0] !== s.id) {
    w.touches.unshift(s.id);
    if (w.touches.length > 6) w.touches.pop();
  }
  // Put the puck on the blade so it does not start inside the shooter.
  stickPoint(s, sp);
  p.pos.x = sp.x;
  p.pos.y = sp.y;
  s.pickupCd = 0.4;
  s.charge = 0;
  w.events.push({ type: "shot", team, power: c, oneTimer });
}

function laneClear(w: World, s: Skater, tx: number, ty: number): number {
  // 1 when no opponent stands near the pass line, less otherwise.
  const ax = s.pos.x;
  const ay = s.pos.y;
  const dx = tx - ax;
  const dy = ty - ay;
  const l2 = dx * dx + dy * dy || 1;
  let worst = 1;
  for (const o of w.skaters) {
    if (!o.active || o.team === s.team || o.role === "G") continue;
    const t = clamp(((o.pos.x - ax) * dx + (o.pos.y - ay) * dy) / l2, 0, 1);
    const d = Math.hypot(o.pos.x - (ax + dx * t), o.pos.y - (ay + dy * t));
    worst = Math.min(worst, clamp((d - 0.5) / 1.4, 0, 1));
  }
  return worst;
}

/** Choose the pass receiver for a human or AI carrier; null if nobody is worth it. */
export function pickReceiver(w: World, s: Skater, aim: number, wide: number): Skater | null {
  let best: Skater | null = null;
  let bestScore = 0;
  for (const t of w.skaters) {
    if (!t.active || t.team !== s.team || t.id === s.id || t.role === "G") continue;
    const dx = t.pos.x - s.pos.x;
    const dy = t.pos.y - s.pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 1.5) continue;
    const ad = Math.abs(angleDiff(aim, Math.atan2(dy, dx)));
    if (ad > wide) continue;
    const align = Math.cos(ad * (Math.PI / 2 / wide));
    const lane = laneClear(w, s, t.pos.x, t.pos.y);
    const score = align * (0.35 + 0.65 * lane) * (d < 4 ? 0.7 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return bestScore > 0.25 ? best : null;
}

/** Pass to a chosen teammate, or the best one along the aim; returns who was targeted. */
export function pass(w: World, s: Skater, forced?: Skater | null): Skater | null {
  const p = w.puck;
  if (p.carrier !== s.id) return null;
  const m = Math.hypot(s.input.mx, s.input.my);
  const aim = m > 0.3 ? Math.atan2(s.input.my, s.input.mx) : s.heading;
  const tgt = forced === undefined ? pickReceiver(w, s, aim, m > 0.3 ? 0.9 : 1.3) : forced;
  let dirx: number;
  let diry: number;
  let speed: number;
  if (tgt) {
    const dist = Math.hypot(tgt.pos.x - p.pos.x, tgt.pos.y - p.pos.y);
    speed = clamp(9 + dist * 0.95, PASS_SPEED_MIN, PASS_SPEED_MAX) * (0.95 + 0.05 * s.pass);
    // Lead the receiver.
    const tof = dist / speed;
    const lx = tgt.pos.x + tgt.vel.x * tof * 0.85;
    const ly = tgt.pos.y + tgt.vel.y * tof * 0.85;
    const a = Math.atan2(ly - p.pos.y, lx - p.pos.x) + gauss(w) * (0.02 / s.pass);
    dirx = Math.cos(a);
    diry = Math.sin(a);
    p.passTo = tgt.id;
  } else {
    speed = 14;
    dirx = Math.cos(aim);
    diry = Math.sin(aim);
    p.passTo = -1;
  }
  p.vel.x = dirx * speed + s.vel.x * 0.2;
  p.vel.y = diry * speed + s.vel.y * 0.2;
  p.carrier = -1;
  p.flight = 0;
  p.beaten = -1;
  p.shotTeam = -1;
  p.lastTouch = s.id;
  p.lastTeam = s.team;
  stickPoint(s, sp);
  p.pos.x = sp.x;
  p.pos.y = sp.y;
  s.pickupCd = 0.3;
  w.events.push({ type: "pass", team: s.team });
  return tgt;
}

/** Poke check or body check depending on speed. */
export function check(w: World, s: Skater): void {
  if (s.pokeCd > 0 || s.stun > 0 || s.role === "G") return;
  s.pokeCd = 0.55;
  const p = w.puck;
  let target: Skater | null = null;
  let bestD = 1.7;
  for (const o of w.skaters) {
    if (!o.active || o.team === s.team || o.role === "G") continue;
    const dx = o.pos.x - s.pos.x;
    const dy = o.pos.y - s.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > bestD) continue;
    if (Math.abs(angleDiff(s.heading, angleOf({ x: dx, y: dy }))) > 1.3) continue;
    // Prefer the puck carrier.
    const dd = p.carrier === o.id ? d - 0.5 : d;
    if (dd < bestD) {
      bestD = dd;
      target = o;
    }
  }
  if (!target) return;
  const dx = target.pos.x - s.pos.x;
  const dy = target.pos.y - s.pos.y;
  const d = Math.hypot(dx, dy) || 1;
  const nx = dx / d;
  const ny = dy / d;
  const speed = Math.hypot(s.vel.x, s.vel.y);
  const closing = s.vel.x * nx + s.vel.y * ny - (target.vel.x * nx + target.vel.y * ny);
  const carrier = p.carrier === target.id;
  if (speed > 5.2 && d < 1.3 && closing > 3) {
    const power = clamp(closing / 10, 0.3, 1);
    target.stun = 0.5 + 0.35 * power;
    target.vel.x += nx * (3 + 4 * power);
    target.vel.y += ny * (3 + 4 * power);
    s.stun = 0.18;
    s.vel.x *= 0.6;
    s.vel.y *= 0.6;
    if (carrier) {
      p.carrier = -1;
      p.passTo = -1;
      p.flight = 99;
      p.vel.x = target.vel.x + nx * 3 + (w.rng.next() - 0.5) * 3;
      p.vel.y = target.vel.y + ny * 3 + (w.rng.next() - 0.5) * 3;
      target.pickupCd = 0.6;
    }
    w.events.push({ type: "hit", team: s.team, power });
    if (w.foulsOn) {
      // Facing away from the checker: a hit from behind.
      const away = Math.abs(angleDiff(target.heading, Math.atan2(-ny, -nx)));
      if (away < 0.7 && closing > 6 && w.rng.next() < 0.45) w.events.push({ type: "foul", team: s.team, skater: s.id, kind: "behind" });
      else if (!carrier && w.rng.next() < 0.5) w.events.push({ type: "foul", team: s.team, skater: s.id, kind: "interference" });
    }
    return;
  }
  if (carrier && d < 1.35) {
    const chance = clamp(0.5 * (s.def / Math.max(0.8, target.shot)), 0.2, 0.85);
    const ok = w.rng.next() < chance;
    if (ok) {
      p.carrier = -1;
      p.flight = 99;
      const a = Math.atan2(ny, nx) + (w.rng.next() - 0.5) * 1.6;
      p.vel.x = target.vel.x + Math.cos(a) * 5;
      p.vel.y = target.vel.y + Math.sin(a) * 5;
      target.pickupCd = 0.45;
      s.pickupCd = 0;
    }
    w.events.push({ type: "poke", team: s.team, ok });
    if (!ok && w.foulsOn && w.rng.next() < 0.035) w.events.push({ type: "foul", team: s.team, skater: s.id, kind: "hooking" });
  }
}

/** Half width of the mouth used by shot decisions. */
export const MOUTH = GOAL_HALF;
export { PUCK_R };

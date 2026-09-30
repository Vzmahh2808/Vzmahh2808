/**
 * Team AI. Every skater not driven by a person picks a job each step:
 * carry and decide (shoot or pass), receive a pass, pressure the carrier,
 * chase a loose puck, or hold a role slot that shifts with the puck.
 */
import { angleDiff, clamp } from "../core/vec";
import { check, pass, shoot } from "./actions";
import { P } from "./physics";
import { attackDir, goalX, BLUE_X, GOAL_HALF, type TeamId } from "./rink";
import type { Skater, World } from "./state";

interface Ctx {
  carrier: Skater | null;
  /** Skaters of each team in the order they would reach the puck. */
  order: [Skater[], Skater[]];
}

function timeToPuck(s: Skater, w: World): number {
  const p = w.puck;
  const tx = p.pos.x + p.vel.x * 0.25;
  const ty = p.pos.y + p.vel.y * 0.25;
  const d = Math.hypot(tx - s.pos.x, ty - s.pos.y);
  const ahead = Math.abs(angleDiff(s.heading, Math.atan2(ty - s.pos.y, tx - s.pos.x)));
  return d / (P.maxSpeed * s.speed) + ahead * 0.12;
}

function steer(s: Skater, w: World, tx: number, ty: number, arrive: number, sprintFrom: number): void {
  const dx = tx - s.pos.x;
  const dy = ty - s.pos.y;
  const d = Math.hypot(dx, dy);
  const diff = w.difficulty[s.team];
  const cap = 0.9 + 0.1 * diff;
  let mag = clamp(d / arrive, 0, 1) * cap;
  if (d < 0.15) mag = 0;
  let ux = d > 1e-6 ? dx / d : 0;
  let uy = d > 1e-6 ? dy / d : 0;
  // Keep clear of teammates and of the goalies' nets.
  for (const o of w.skaters) {
    if (!o.active || o.id === s.id) continue;
    const ox = s.pos.x - o.pos.x;
    const oy = s.pos.y - o.pos.y;
    const od = Math.hypot(ox, oy);
    const range = o.team === s.team ? 1.7 : 1.1;
    if (od > 0.01 && od < range) {
      const k = ((range - od) / range) * (o.team === s.team ? 0.9 : 0.5);
      ux += (ox / od) * k;
      uy += (oy / od) * k;
    }
  }
  const l = Math.hypot(ux, uy);
  if (l > 1e-6 && mag > 0) {
    s.input.mx = (ux / l) * mag;
    s.input.my = (uy / l) * mag;
  }
  s.input.sprint = d > sprintFrom && s.stamina > 0.25;
}

/** Where a role stands when its team has the puck near `refX` (team-relative). */
function offenseSlot(team: TeamId, role: Skater["role"], refX: number, refY: number, out: { x: number; y: number }): void {
  const dir = attackDir(team);
  const inZone = refX > 10;
  let rx: number;
  let ry: number;
  switch (role) {
    case "C":
      rx = inZone ? 20 : clamp(refX + 5, -12, 20);
      ry = inZone ? 0 : refY > 0 ? -3 : 3;
      break;
    case "LW":
    case "RW": {
      const lane = role === "LW" ? -1 : 1;
      rx = inZone ? 17 : clamp(refX + 3, -18, 17);
      ry = lane * (inZone ? 8 : 8.5);
      if (Math.abs(refY - ry) < 3.5) {
        // Carrier is in my lane: cut to the back door.
        rx = Math.min(22, rx + 4);
        ry = lane * 3.5;
      }
      break;
    }
    case "LD":
    case "RD": {
      const lane = role === "LD" ? -1 : 1;
      rx = inZone ? BLUE_X - 0.5 : clamp(refX - 8, -20, BLUE_X - 1);
      ry = lane * (inZone ? 9 : 4.5);
      break;
    }
    default:
      rx = 0;
      ry = 0;
  }
  out.x = rx * dir;
  out.y = ry;
}

function defenseSlot(team: TeamId, role: Skater["role"], px: number, py: number, out: { x: number; y: number }): void {
  const gx = goalX(team);
  const dx = px - gx;
  const d = Math.hypot(dx, py) || 1;
  const ux = dx / d;
  const uy = py / d;
  const perpX = -uy;
  const perpY = ux;
  let along: number;
  let lat: number;
  switch (role) {
    case "LD":
    case "RD":
      along = clamp(d * 0.3, 3.5, 9);
      lat = role === "LD" ? -2.6 : 2.6;
      break;
    case "C":
      along = clamp(d * 0.5, 6, 15);
      lat = 0;
      break;
    default:
      along = clamp(d * 0.62, 8, 20);
      lat = role === "LW" ? -6 : 6;
  }
  out.x = gx + ux * along + perpX * lat;
  out.y = uy * along + perpY * lat;
}

const slot = { x: 0, y: 0 };

function laneOpen(w: World, s: Skater, tx: number, ty: number, radius: number): boolean {
  const dx = tx - s.pos.x;
  const dy = ty - s.pos.y;
  const l2 = dx * dx + dy * dy || 1;
  for (const o of w.skaters) {
    if (!o.active || o.team === s.team || o.role === "G") continue;
    const t = clamp(((o.pos.x - s.pos.x) * dx + (o.pos.y - s.pos.y) * dy) / l2, 0, 1);
    if (t < 0.05) continue;
    if (Math.hypot(o.pos.x - (s.pos.x + dx * t), o.pos.y - (s.pos.y + dy * t)) < radius) return false;
  }
  return true;
}

function nearestOpp(w: World, s: Skater): { o: Skater | null; d: number } {
  let best: Skater | null = null;
  let bd = Infinity;
  for (const o of w.skaters) {
    if (!o.active || o.team === s.team || o.role === "G") continue;
    const d = Math.hypot(o.pos.x - s.pos.x, o.pos.y - s.pos.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return { o: best, d: bd };
}

function carrierThink(w: World, s: Skater, dt: number): void {
  const team = s.team;
  const dir = attackDir(team);
  const diff = w.difficulty[team];
  const gx = goalX((1 - team) as TeamId);
  const toGoalX = gx - s.pos.x;
  const dg = Math.hypot(toGoalX, s.pos.y);
  const angleToGoal = Math.atan2(-s.pos.y, toGoalX);
  const inFront = toGoalX * dir > 0;
  const { d: oppD } = nearestOpp(w, s);
  const pressured = oppD < 2.4;

  // Shoot?
  s.aiShootIn -= dt;
  s.aiPassIn -= dt;
  let shootRate = 0;
  if (inFront) {
    if (dg < 6) shootRate = 6;
    else if (dg < 11) shootRate = 2.6;
    else if (dg < 17) shootRate = 1.0;
    if (Math.abs(angleDiff(dir > 0 ? 0 : Math.PI, angleToGoal)) > 1.1) shootRate *= 0.2;
    if (pressured) shootRate *= 1.4;
    if (!laneOpen(w, s, gx, 0, 0.7) && dg > 5) shootRate *= 0.25;
    shootRate *= (0.6 + 0.6 * diff) * 1.35;
  }
  if (shootRate > 0 && w.rng.next() < shootRate * dt && s.stun <= 0) {
    // Turn to the net first; the shot itself snaps to a corner.
    const face = Math.abs(angleDiff(s.heading, angleToGoal)) < 0.5;
    if (face) {
      const charge = dg < 8 ? 0.15 + w.rng.next() * 0.25 : 0.45 + w.rng.next() * 0.4;
      shoot(w, s, charge, false, angleToGoal);
      return;
    }
  }

  // Pass?
  let passRate = 0.35;
  if (pressured) passRate = 3.5;
  if (dg > 20) passRate = Math.max(passRate, 0.9);
  if (w.rng.next() < passRate * dt && s.aiPassIn <= 0) {
    let best: Skater | null = null;
    let bestScore = 0.55;
    for (const t of w.skaters) {
      if (!t.active || t.team !== team || t.id === s.id || t.role === "G") continue;
      const d = Math.hypot(t.pos.x - s.pos.x, t.pos.y - s.pos.y);
      if (d < 3 || d > 24) continue;
      const ahead = ((t.pos.x - s.pos.x) * dir) / 20;
      const lane = laneOpen(w, s, t.pos.x, t.pos.y, 1.1) ? 1 : 0;
      const tg = Math.hypot(gx - t.pos.x, t.pos.y);
      const nearGoal = clamp((18 - tg) / 18, 0, 1);
      const free = nearestOpp(w, t).d > 2.2 ? 0.3 : 0;
      const score = lane * (0.55 + ahead * 0.7 + nearGoal * 0.5 + free);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best) {
      pass(w, s, best);
      s.aiPassIn = 0.5;
      return;
    }
  }

  // Skate toward the slot in front of the net, swinging wide of defenders.
  let tx = gx - dir * 9;
  let ty = clamp(s.pos.y * 0.6, -6, 6);
  if (dg < 12) {
    tx = gx - dir * 5;
    ty = s.pos.y > 0 ? 2.5 : -2.5;
  }
  const { o } = nearestOpp(w, s);
  if (o && Math.hypot(o.pos.x - s.pos.x, o.pos.y - s.pos.y) < 3.5 && (o.pos.x - s.pos.x) * dir > 0) {
    ty += s.pos.y >= o.pos.y ? 3 : -3;
  }
  steer(s, w, tx, ty, 2, 5);
}

/** Set inputs for every AI-controlled skater. */
export function thinkAI(w: World, dt: number): void {
  const p = w.puck;
  const carrier = p.carrier >= 0 ? w.skaters[p.carrier] : null;
  const ctx: Ctx = { carrier: carrier && carrier.role !== "G" ? carrier : null, order: [[], []] };
  for (const s of w.skaters) {
    if (!s.active || s.role === "G") continue;
    ctx.order[s.team].push(s);
  }
  const t2p = new Map<number, number>();
  for (const s of w.skaters) if (s.active && s.role !== "G") t2p.set(s.id, timeToPuck(s, w));
  for (const list of ctx.order) list.sort((a, b) => (t2p.get(a.id)! - t2p.get(b.id)!) || a.id - b.id);

  for (const s of w.skaters) {
    if (!s.active || s.role === "G") continue;
    if (w.human[s.team] && w.controlled[s.team] === s.id) continue;
    const i = s.input;
    i.mx = 0;
    i.my = 0;
    i.sprint = false;
    i.pass = false;
    i.shootHeld = false;
    i.shootReleased = false;
    i.check = false;
    if (s.stun > 0) continue;
    const team = s.team;
    const rank = ctx.order[team].indexOf(s);
    const dir = attackDir(team);

    // Carrying the puck.
    if (p.carrier === s.id) {
      carrierThink(w, s, dt);
      continue;
    }
    // Receiving a pass.
    if (p.passTo === s.id && p.carrier === -1) {
      const sp = Math.hypot(p.vel.x, p.vel.y) || 1;
      const t = clamp(((s.pos.x - p.pos.x) * p.vel.x + (s.pos.y - p.pos.y) * p.vel.y) / (sp * sp), 0, 1.2);
      steer(s, w, p.pos.x + p.vel.x * t, p.pos.y + p.vel.y * t, 1.2, 6);
      continue;
    }
    const oppHas = ctx.carrier !== null && ctx.carrier.team !== team;
    const mineHas = ctx.carrier !== null && ctx.carrier.team === team;
    const loose = ctx.carrier === null && p.carrier === -1;

    if (oppHas) {
      const c = ctx.carrier!;
      const inOwnThird = c.pos.x * dir < -12;
      const pressure = rank === 0 || (rank === 1 && (inOwnThird || w.difficulty[team] > 0.75));
      if (pressure) {
        steer(s, w, c.pos.x + c.vel.x * 0.3, c.pos.y + c.vel.y * 0.3, 0.8, 4);
        const d = Math.hypot(c.pos.x - s.pos.x, c.pos.y - s.pos.y);
        if (d < 1.5 && s.pokeCd <= 0) {
          const speed = Math.hypot(s.vel.x, s.vel.y);
          if (w.rng.next() < (speed > 5.3 ? 0.08 : 0.05) * (0.6 + w.difficulty[team])) check(w, s);
        }
        continue;
      }
      defenseSlot(team, s.role, p.pos.x, p.pos.y, slot);
      steer(s, w, slot.x, slot.y, 2.5, 7);
      continue;
    }
    if (mineHas) {
      const c = ctx.carrier!;
      offenseSlot(team, s.role, c.pos.x * dir, c.pos.y, slot);
      steer(s, w, slot.x, slot.y, 2.5, 7);
      continue;
    }
    if (loose) {
      if (rank === 0 || (rank === 1 && Math.hypot(p.pos.x - s.pos.x, p.pos.y - s.pos.y) < 6)) {
        const sp = Math.hypot(p.vel.x, p.vel.y);
        const lead = sp > 2 ? clamp(timeToPuck(s, w), 0, 0.7) : 0;
        steer(s, w, p.pos.x + p.vel.x * lead, p.pos.y + p.vel.y * lead, 0.6, 3);
        continue;
      }
      // Shape follows whose puck it was last.
      if (p.lastTeam === team) offenseSlot(team, s.role, p.pos.x * dir, p.pos.y, slot);
      else defenseSlot(team, s.role, p.pos.x, p.pos.y, slot);
      steer(s, w, slot.x, slot.y, 2.5, 7);
    }
  }
}

export { GOAL_HALF };

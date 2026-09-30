/** Goalie movement, shot reading and saves. */
import { angleOf, clamp } from "../core/vec";
import { pass, pickReceiver } from "./actions";
import { attackDir, goalX, CREASE_R, GOAL_HALF, type TeamId } from "./rink";
import { goalieHome, type Skater, type World } from "./state";

const gkq = (w: World, g: Skater): number => (w.ratings[g.team].gk - 75) / 20;

/** Where a shot in flight will cross the goal line, or null if it is no threat. */
function threat(w: World, g: Skater): number | null {
  const p = w.puck;
  if (p.carrier !== -1 || p.lastTeam === g.team) return null;
  const dir = attackDir(g.team);
  const lineX = goalX(g.team);
  if ((p.pos.x - lineX) * dir <= 0) return null;
  if (p.vel.x * dir >= -6) return null;
  const speed = Math.hypot(p.vel.x, p.vel.y);
  if (speed < 12) return null;
  const t = (lineX - p.pos.x) / p.vel.x;
  if (t < 0 || t > 1.6) return null;
  const y = p.pos.y + p.vel.y * t;
  return Math.abs(y) < 2.4 ? y : null;
}

export function stepGoalie(w: World, g: Skater, dt: number): void {
  const p = w.puck;
  const dir = attackDir(g.team);
  const lineX = goalX(g.team);
  const q = gkq(w, g);
  const maxLat = 5 + 1.5 * q;
  if (g.gDive > 0) g.gDive -= dt;
  const home = goalieHome(g.team);

  // Hold the puck, then play it out.
  if (p.carrier === g.id) {
    g.gHold -= dt;
    p.pos.x = g.pos.x + dir * 0.6;
    p.pos.y = g.pos.y;
    p.vel.x = 0;
    p.vel.y = 0;
    if (g.gHold <= 0) {
      const rec = pickReceiver(w, g, dir > 0 ? 0 : Math.PI, 1.5);
      const side = w.rng.next() < 0.5 ? -1 : 1;
      g.input.mx = dir;
      g.input.my = rec ? 0 : 0.7 * side;
      pass(w, g, rec ?? null);
    }
  }

  const th = threat(w, g);
  if (th !== null) {
    if (g.aiMode === 0) {
      g.aiMode = 1;
      g.gReact = 0.2 - 0.07 * q;
    } else if (g.aiMode === 1) {
      g.gReact -= dt;
      if (g.gReact <= 0) g.aiMode = 2;
    }
    if (g.aiMode === 2) {
      g.gTarget = clamp(th, -1.6, 1.6);
      if (Math.abs(g.gTarget - g.pos.y) > 0.9 && g.gDive <= 0 && Math.abs(g.gTarget) > 0.4) {
        g.gDive = 0.5;
        g.gDiveDir = Math.sign(g.gTarget - g.pos.y);
      }
    }
  } else {
    g.aiMode = 0;
  }

  let tx: number;
  let ty: number;
  if (g.aiMode === 2) {
    tx = lineX + dir * 0.55;
    ty = g.gTarget;
  } else {
    const px = p.pos.x - lineX;
    const py = p.pos.y;
    if (px * dir <= 0.3) {
      // Puck behind the goal line: hug the near post.
      tx = lineX + dir * 0.5;
      ty = clamp(py * 0.4, -GOAL_HALF, GOAL_HALF);
    } else {
      const d = Math.hypot(px, py);
      const depth = 0.55 + clamp((16 - d) / 16, 0, 1) * 0.55;
      const ux = px / d;
      const uy = py / d;
      tx = lineX + ux * depth;
      ty = clamp(uy * depth * 1.5, -1.15, 1.15);
      if (tx * dir < lineX * dir + 0.45 * 1) tx = lineX + dir * 0.45;
    }
  }
  const speedCap = g.aiMode === 2 ? maxLat * 1.35 : maxLat;
  const dx = tx - g.pos.x;
  const dy = ty - g.pos.y;
  const dl = Math.hypot(dx, dy);
  const step = Math.min(dl, speedCap * dt);
  if (dl > 1e-6) {
    g.vel.x = (dx / dl) * (step / dt);
    g.vel.y = (dy / dl) * (step / dt);
    g.pos.x += (dx / dl) * step;
    g.pos.y += (dy / dl) * step;
  } else {
    g.vel.x = 0;
    g.vel.y = 0;
  }
  // Stay in the crease.
  const cx = g.pos.x - lineX;
  const cy = g.pos.y;
  const cd = Math.hypot(cx, cy);
  if (cd > CREASE_R) {
    g.pos.x = lineX + (cx / cd) * CREASE_R;
    g.pos.y = (cy / cd) * CREASE_R;
  }
  if ((g.pos.x - lineX) * dir < 0.4) g.pos.x = lineX + dir * 0.4;
  g.heading = angleOf({ x: p.pos.x - g.pos.x, y: p.pos.y - g.pos.y });
  void home;
}

/** Called for the puck on every sub-step: decides whether the goalie stops it. */
export function tryGoalieSave(w: World, g: Skater): boolean {
  const p = w.puck;
  if (p.carrier !== -1 || p.beaten === g.id || p.lastTeam === g.team) return false;
  const reach = g.gDive > 0 ? 1.45 : 0.85;
  const dx = p.pos.x - g.pos.x;
  const dy = p.pos.y - g.pos.y;
  if (dx * dx + dy * dy > reach * reach) return false;
  const speed = Math.hypot(p.vel.x, p.vel.y);
  const dir = attackDir(g.team);
  const q = gkq(w, g);
  let held = false;
  let saved: boolean;
  if (speed < 8) {
    saved = true;
    held = w.rng.next() < 0.8;
  } else {
    const shooter = p.shooter >= 0 ? w.skaters[p.shooter] : null;
    let ps = 0.93 + 0.05 * q;
    ps -= 0.3 * clamp((speed - 26) / 14, 0, 1);
    ps -= 0.22 * clamp((9 - p.shotDist) / 9, 0, 1);
    if (p.rebound > 0) ps -= 0.22;
    if (g.gDive > 0) ps -= 0.06;
    if (shooter) ps -= (shooter.shot - 1) * 0.5;
    ps = clamp(ps, 0.3, 0.97);
    saved = w.rng.next() < ps;
    held = saved && w.rng.next() < (speed < 20 ? 0.55 : 0.38);
  }
  if (!saved) {
    p.beaten = g.id;
    return false;
  }
  if (held) {
    p.carrier = g.id;
    p.lastTeam = g.team;
    p.lastTouch = g.id;
    p.passTo = -1;
    p.shotTeam = -1;
    g.gHold = 0.8 + w.rng.next() * 0.7;
    p.vel.x = 0;
    p.vel.y = 0;
    w.events.push({ type: "save", team: g.team, held: true });
    return true;
  }
  const a = Math.atan2(0, dir) + (w.rng.next() - 0.5) * 2.2;
  const out = 3 + speed * 0.16;
  p.vel.x = Math.cos(a) * out;
  p.vel.y = Math.sin(a) * out;
  // Nudge the puck out of the pads so it does not save itself twice.
  p.pos.x = g.pos.x + Math.cos(a) * (reach + 0.05);
  p.pos.y = g.pos.y + Math.sin(a) * (reach + 0.05);
  p.rebound = 1.4;
  p.lastTeam = g.team as TeamId;
  p.lastTouch = g.id;
  p.shotTeam = -1;
  w.events.push({ type: "save", team: g.team, held: false });
  return true;
}

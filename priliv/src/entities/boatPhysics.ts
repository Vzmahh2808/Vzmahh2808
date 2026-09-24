/**
 * Arcade boat handling, independent of Three.js. Boats slide more than cars,
 * steer only while moving, and bounce off anything that is not open water.
 */

export interface BoatSpec {
  name: string;
  length: number;
  width: number;
  /** Top speed in m/s. */
  maxSpeed: number;
  /** Forward acceleration at full throttle from rest, m/s². */
  thrust: number;
  /** Yaw rate at full rudder and speed, rad/s. */
  turn: number;
  /** How quickly sideways drift dies out, 1/s. */
  grip: number;
}

export const BOAT_SPECS: Record<string, BoatSpec> = {
  motorboat: { name: "Катер", length: 6, width: 2.4, maxSpeed: 21, thrust: 7, turn: 1.15, grip: 2.2 },
  speedboat: { name: "Скоростной катер", length: 7, width: 2.2, maxSpeed: 31, thrust: 10, turn: 1.3, grip: 1.8 },
  police: { name: "Полицейский катер", length: 6.6, width: 2.5, maxSpeed: 27, thrust: 9, turn: 1.25, grip: 2.4 },
};

export interface BoatInput {
  throttle: number;
  steer: number;
}

export interface BoatState {
  x: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
  yawRate: number;
  health: number;
  /** Sunk boats stay under the surface until reset. */
  sunk: boolean;
}

export function makeBoat(x: number, z: number, heading: number): BoatState {
  return { x, z, heading, vx: 0, vz: 0, yawRate: 0, health: 100, sunk: false };
}

export function boatSpeed(s: BoatState): number {
  return Math.hypot(s.vx, s.vz);
}

export function boatForward(s: BoatState): number {
  return s.vx * Math.cos(s.heading) + s.vz * Math.sin(s.heading);
}

/** Water drag when coasting, 1/s. */
const DRAG = 0.35;

export function stepBoat(s: BoatState, spec: BoatSpec, input: BoatInput, dt: number): void {
  if (s.sunk) {
    s.vx = s.vz = s.yawRate = 0;
    return;
  }
  const fx = Math.cos(s.heading);
  const fz = Math.sin(s.heading);
  let fwd = s.vx * fx + s.vz * fz;
  let lat = s.vx * -fz + s.vz * fx;
  const t = Math.max(-1, Math.min(1, input.throttle));
  if (t > 0) fwd += spec.thrust * t * dt * Math.max(0, 1 - fwd / spec.maxSpeed);
  else if (t < 0) fwd = Math.max(-spec.maxSpeed * 0.3, fwd + spec.thrust * 0.6 * t * dt);
  // Drag mostly matters when coasting; under power the thrust curve sets top speed.
  fwd *= Math.exp(-DRAG * (1 - Math.abs(t) * 0.9) * dt);
  lat *= Math.exp(-spec.grip * dt);
  // The rudder needs water flowing past it; in reverse the steering flips.
  const flow = Math.min(1, Math.abs(fwd) / 6) * Math.sign(fwd);
  const want = Math.max(-1, Math.min(1, input.steer)) * spec.turn * flow;
  s.yawRate += (want - s.yawRate) * Math.min(1, dt * 4);
  s.heading += s.yawRate * dt;
  // A turning hull throws some speed sideways, which gives boats their drift.
  lat -= s.yawRate * fwd * 0.12 * dt;
  const nx = Math.cos(s.heading);
  const nz = Math.sin(s.heading);
  s.vx = nx * fwd - nz * lat;
  s.vz = nz * fwd + nx * lat;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
}

/** Points around the hull checked against the shore. */
export function hullPoints(s: BoatState, spec: BoatSpec): Array<{ x: number; z: number }> {
  const fx = Math.cos(s.heading);
  const fz = Math.sin(s.heading);
  const hl = spec.length / 2;
  const hw = spec.width / 2;
  return [
    { x: s.x + fx * hl, z: s.z + fz * hl },
    { x: s.x - fx * hl, z: s.z - fz * hl },
    { x: s.x - fz * hw, z: s.z + fx * hw },
    { x: s.x + fz * hw, z: s.z - fx * hw },
    { x: s.x + fx * hl * 0.5 - fz * hw, z: s.z + fz * hl * 0.5 + fx * hw },
    { x: s.x + fx * hl * 0.5 + fz * hw, z: s.z + fz * hl * 0.5 - fx * hw },
  ];
}

/**
 * Keep the hull on open water. If any hull point is on land after a step, the
 * boat goes back to where it was and bounces. Returns the impact speed, or 0.
 */
export function keepOnWater(s: BoatState, spec: BoatSpec, prevX: number, prevZ: number, prevHeading: number, isWater: (x: number, z: number) => boolean): number {
  if (hullPoints(s, spec).every((p) => isWater(p.x, p.z))) return 0;
  const impact = boatSpeed(s);
  s.x = prevX;
  s.z = prevZ;
  s.heading = prevHeading;
  s.vx *= -0.3;
  s.vz *= -0.3;
  s.yawRate = 0;
  // If even the old pose touches land (spawned badly, or pushed by another boat), drift outwards.
  if (!hullPoints(s, spec).every((p) => isWater(p.x, p.z))) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const x = s.x + Math.cos(a) * 1.5;
      const z = s.z + Math.sin(a) * 1.5;
      if (isWater(x, z)) {
        s.x = x;
        s.z = z;
        break;
      }
    }
  }
  return impact;
}

/** Damage from hitting the shore or another boat at a given speed. */
export function boatImpactDamage(speed: number): number {
  return speed < 4 ? 0 : (speed - 4) * 2.2;
}

/** Push two boats apart; returns their closing speed if they touched. */
export function separateBoats(a: BoatState, b: BoatState, ra: number, rb: number): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  const min = ra + rb;
  if (d >= min || d === 0) return 0;
  const nx = dx / d;
  const nz = dz / d;
  const overlap = min - d;
  a.x -= nx * overlap * 0.5;
  a.z -= nz * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.z += nz * overlap * 0.5;
  const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  if (vn <= 0) return 0;
  const j = vn * 0.8;
  a.vx -= j * nx;
  a.vz -= j * nz;
  b.vx += j * nx;
  b.vz += j * nz;
  return vn;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Police boat: aim a little ahead of the target and ram it, steering away from
 * land seen by three probes in front.
 */
export function chaseBoat(s: BoatState, target: { x: number; z: number; vx: number; vz: number }, isWater: (x: number, z: number) => boolean): BoatInput {
  const d = Math.hypot(target.x - s.x, target.z - s.z);
  const lead = Math.min(1.2, d / 25);
  const aim = Math.atan2(target.z + target.vz * lead - s.z, target.x + target.vx * lead - s.x);
  let diff = wrapAngle(aim - s.heading);
  const probe = (off: number, dist: number) => isWater(s.x + Math.cos(s.heading + off) * dist, s.z + Math.sin(s.heading + off) * dist);
  const ahead = Math.max(8, boatSpeed(s) * 1.2);
  if (!probe(0, ahead) || !probe(0, ahead * 0.5)) {
    const left = probe(-0.7, ahead);
    const right = probe(0.7, ahead);
    diff = left && !right ? -1.5 : right && !left ? 1.5 : diff >= 0 ? 1.5 : -1.5;
  }
  const steer = Math.max(-1, Math.min(1, diff * 2));
  // Ease off in tight turns, back up if stuck against the shore.
  const stuck = boatSpeed(s) < 1 && !probe(0, 4);
  const throttle = stuck ? -1 : Math.abs(diff) > 1.4 ? 0.4 : 1;
  return { throttle, steer: stuck ? -steer : steer };
}

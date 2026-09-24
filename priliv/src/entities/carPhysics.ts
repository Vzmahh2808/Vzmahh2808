/** Arcade car model in the XZ plane. Pure functions so it can be unit-tested. */

export interface CarSpec {
  maxSpeed: number; // m/s forward
  maxReverse: number;
  accel: number; // m/s^2
  brake: number;
  drag: number; // per second, fraction of velocity lost
  steerMax: number; // radians at zero speed
  wheelBase: number;
  grip: number; // 0..1 how quickly velocity aligns with heading per second
  handbrakeGrip: number;
  mass: number;
  length: number;
  width: number;
}

export interface CarState {
  x: number;
  z: number;
  heading: number; // radians, 0 = +x
  vx: number;
  vz: number;
  steer: number; // current steering angle
  wheelSpin: number; // accumulated wheel rotation for visuals
  health: number;
  /** True once health hit zero: the car is on fire and counting down to an explosion. */
  burning: boolean;
  /** Seconds left before a burning car explodes. */
  fire: number;
  /** Burnt-out shell after an explosion; cannot be driven. */
  wrecked: boolean;
}

export interface CarInput {
  throttle: number; // -1..1
  steer: number; // -1..1 (positive = right)
  brake: boolean;
  handbrake: boolean;
}

export const CAR_SPECS: Record<string, CarSpec> = {
  sedan: { maxSpeed: 42, maxReverse: 10, accel: 9, brake: 22, drag: 0.6, steerMax: 0.55, wheelBase: 2.7, grip: 6, handbrakeGrip: 1.2, mass: 1300, length: 4.4, width: 1.9 },
  sport: { maxSpeed: 58, maxReverse: 12, accel: 14, brake: 26, drag: 0.5, steerMax: 0.5, wheelBase: 2.5, grip: 7, handbrakeGrip: 1.0, mass: 1200, length: 4.2, width: 1.9 },
  van: { maxSpeed: 32, maxReverse: 8, accel: 6, brake: 18, drag: 0.8, steerMax: 0.6, wheelBase: 3.2, grip: 5, handbrakeGrip: 1.5, mass: 2000, length: 5.2, width: 2.1 },
  pickup: { maxSpeed: 38, maxReverse: 9, accel: 8, brake: 20, drag: 0.7, steerMax: 0.58, wheelBase: 3.0, grip: 5.5, handbrakeGrip: 1.3, mass: 1700, length: 5.0, width: 2.0 },
};

export function makeCar(x: number, z: number, heading: number): CarState {
  return { x, z, heading, vx: 0, vz: 0, steer: 0, wheelSpin: 0, health: 100, burning: false, fire: 0, wrecked: false };
}

export function forwardSpeed(c: CarState): number {
  return c.vx * Math.cos(c.heading) + c.vz * Math.sin(c.heading);
}

/** Sideways speed relative to the car's heading; large values mean the car is sliding. */
export function lateralSpeed(c: CarState): number {
  return -c.vx * Math.sin(c.heading) + c.vz * Math.cos(c.heading);
}

export function speedOf(c: CarState): number {
  return Math.hypot(c.vx, c.vz);
}

export function stepCar(c: CarState, spec: CarSpec, input: CarInput, dt: number): void {
  const fx = Math.cos(c.heading);
  const fz = Math.sin(c.heading);
  let fwd = forwardSpeed(c);
  const speed = speedOf(c);

  // Steering: full lock at low speed, tighter at high speed.
  const speedFactor = 1 / (1 + speed / 18);
  const targetSteer = input.steer * spec.steerMax * speedFactor;
  c.steer += (targetSteer - c.steer) * Math.min(1, dt * 10);

  // Longitudinal forces.
  let accel = 0;
  if (input.brake) {
    if (Math.abs(fwd) > 0.5) accel = -Math.sign(fwd) * spec.brake;
    else fwd = 0;
  } else if (input.throttle > 0) {
    accel = input.throttle * spec.accel * (1 - Math.max(0, fwd) / spec.maxSpeed);
  } else if (input.throttle < 0) {
    if (fwd > 0.5) accel = -spec.brake * 0.8;
    else accel = input.throttle * spec.accel * 0.6 * (1 - Math.max(0, -fwd) / spec.maxReverse);
  }
  if (input.handbrake) accel -= Math.sign(fwd) * Math.min(Math.abs(fwd) / dt, spec.brake * 0.5);

  fwd += accel * dt;
  fwd *= Math.max(0, 1 - spec.drag * 0.05 * dt);
  fwd = Math.max(-spec.maxReverse, Math.min(spec.maxSpeed, fwd));

  // Yaw from the bicycle model. Sliding cars still rotate when sliding sideways.
  if (Math.abs(fwd) > 0.1) {
    const yawRate = (fwd / spec.wheelBase) * Math.tan(c.steer);
    c.heading += yawRate * dt;
  }
  const nfx = Math.cos(c.heading);
  const nfz = Math.sin(c.heading);

  // Blend velocity toward the new heading (grip), keeping some lateral slide.
  const lateralX = c.vx - fx * forwardSpeed(c);
  const lateralZ = c.vz - fz * forwardSpeed(c);
  const grip = input.handbrake ? spec.handbrakeGrip : spec.grip;
  const keep = Math.max(0, 1 - grip * dt);
  c.vx = nfx * fwd + lateralX * keep;
  c.vz = nfz * fwd + lateralZ * keep;

  c.x += c.vx * dt;
  c.z += c.vz * dt;
  c.wheelSpin += (fwd / 0.35) * dt;
}

/** Bounce a car off a wall given the push-out vector; scales damage with impact speed. */
export function collideCar(c: CarState, pushX: number, pushZ: number): number {
  const len = Math.hypot(pushX, pushZ);
  if (len === 0) return 0;
  const nx = pushX / len;
  const nz = pushZ / len;
  c.x += pushX;
  c.z += pushZ;
  const vn = c.vx * nx + c.vz * nz;
  let damage = 0;
  if (vn < 0) {
    damage = Math.max(0, -vn - 4) * 1.5;
    c.vx -= 1.6 * vn * nx;
    c.vz -= 1.6 * vn * nz;
    c.vx *= 0.55;
    c.vz *= 0.55;
    c.health = Math.max(0, c.health - damage);
  }
  return damage;
}

/** Elastic-ish push between two cars modelled as circles. */
export function separateCars(a: CarState, b: CarState, ra: number, rb: number): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  const min = ra + rb;
  if (dist >= min || dist === 0) return false;
  const nx = dx / dist;
  const nz = dz / dist;
  const overlap = min - dist;
  a.x -= nx * overlap * 0.5;
  a.z -= nz * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.z += nz * overlap * 0.5;
  const rvx = a.vx - b.vx;
  const rvz = a.vz - b.vz;
  const vn = rvx * nx + rvz * nz;
  if (vn > 0) {
    const j = vn * 0.8;
    a.vx -= j * nx;
    a.vz -= j * nz;
    b.vx += j * nx;
    b.vz += j * nz;
    const dmg = Math.max(0, vn - 5) * 1.2;
    a.health = Math.max(0, a.health - dmg);
    b.health = Math.max(0, b.health - dmg);
  }
  return true;
}

import type { CarInput, CarState } from "../entities/carPhysics";
import { roadCoord, type CityLayout } from "../world/city";
import { lineOfSight, nearestIntersection, policeDrive, type PoliceUnit, type Target } from "./policeAI";

/** Close enough, in sight: stop following streets and go straight for the ram. */
export const RAM_RANGE = 18;

/**
 * Gang hunter: finds the player through the street grid like a police car,
 * but instead of boxing a stopped target in it keeps the throttle open and
 * rams, then backs off and comes again.
 */
export function gangDrive(car: CarState, unit: PoliceUnit, layout: CityLayout, target: Target, dt: number): CarInput {
  const dist = Math.hypot(target.x - car.x, target.z - car.z);
  if (unit.reverse <= 0 && dist < RAM_RANGE && lineOfSight(layout, car.x, car.z, target.x, target.z)) {
    const aim = Math.atan2(target.z + target.vz * 0.3 - car.z, target.x + target.vx * 0.3 - car.x);
    let diff = aim - car.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const fwd = car.vx * Math.cos(car.heading) + car.vz * Math.sin(car.heading);
    // Pinned against the target: reverse a little to line up the next hit.
    if (dist < 4 && Math.abs(fwd) < 1.5) {
      unit.stuck += dt;
      if (unit.stuck > 0.8) {
        unit.stuck = 0;
        unit.reverse = 0.9;
        unit.reverseSteer = diff > 0 ? -1 : 1;
      }
    }
    return { throttle: 1, steer: Math.max(-1, Math.min(1, diff * 2.5)), brake: false, handbrake: false };
  }
  // Street chase. Start from the crossing ahead: turning round in a narrow
  // street to reach one just behind ends up on the pavement.
  if (!unit.node) {
    const n = layout.n;
    const here = nearestIntersection(n, car.x, car.z);
    const fx = Math.cos(car.heading);
    const fz = Math.sin(car.heading);
    if ((roadCoord(n, here.ix) - car.x) * fx + (roadCoord(n, here.iz) - car.z) * fz < 0) {
      const ahead = Math.abs(fx) > Math.abs(fz) ? { ix: here.ix + Math.sign(fx), iz: here.iz } : { ix: here.ix, iz: here.iz + Math.sign(fz) };
      if (ahead.ix >= 0 && ahead.ix <= n && ahead.iz >= 0 && ahead.iz <= n) unit.node = ahead;
    }
  }
  return policeDrive(car, unit, layout, target, dt);
}

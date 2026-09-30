/**
 * Traffic lights. Every intersection runs the same cycle, shifted a little from
 * its neighbours so the whole grid does not stop at once. Pure logic, no Three.js.
 */

export type Light = "green" | "yellow" | "red";
export type Axis = "x" | "z";

export const GREEN_TIME = 9;
export const YELLOW_TIME = 2;
/** One full cycle: the x axis goes green, yellow, red while z waits, then they swap. */
export const CYCLE = (GREEN_TIME + YELLOW_TIME) * 2;

/** Where the corner poles stand relative to the intersection centre. */
export const SIGNAL_OFFSET = 6.5;

function phaseAt(time: number, ix: number, iz: number): number {
  return (((time + (ix + iz) * 4) % CYCLE) + CYCLE) % CYCLE;
}

/** The light facing traffic that travels along `axis` through intersection (ix, iz). */
export function lightFor(axis: Axis, time: number, ix: number, iz: number): Light {
  let p = phaseAt(time, ix, iz);
  if (axis === "z") p = (p + CYCLE / 2) % CYCLE;
  if (p < GREEN_TIME) return "green";
  if (p < GREEN_TIME + YELLOW_TIME) return "yellow";
  return "red";
}

/**
 * Speed limit that makes a car stop at the line. `gap` is the distance from the
 * car to the stop line, `speed` its current speed. Returns Infinity when the car
 * may carry on (green, already past the line, or too fast to stop on yellow).
 */
export function signalSpeedLimit(light: Light, gap: number, speed: number): number {
  if (light === "green") return Infinity;
  // Well over the line, so the car is in the crossing: clear it. A small overshoot while braking still counts as waiting.
  if (gap < -2.5) return Infinity;
  if (light === "yellow") {
    // Cannot brake in time (about 6 m/s^2): go through.
    const stopping = (speed * speed) / (2 * 6);
    if (stopping > gap) return Infinity;
  }
  // Approach at the speed from which an easy brake (7 m/s^2) ends exactly at the line.
  return Math.sqrt(2 * 7 * Math.max(0, gap));
}

/** Seconds until `axis` next turns green (0 when it is green now). */
export function timeToGreen(axis: Axis, time: number, ix: number, iz: number): number {
  for (let t = 0; t <= CYCLE; t += 0.25) if (lightFor(axis, time + t, ix, iz) === "green") return t;
  return CYCLE;
}

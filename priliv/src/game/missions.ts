/** Data-driven missions and a pure runner, so the rules can be tested without the 3D game. */

export interface Point {
  x: number;
  z: number;
}

export interface SpawnSpec {
  kind: string;
  color: number;
  x: number;
  z: number;
  heading: number;
  /** Drive around as traffic instead of sitting parked. */
  drives: boolean;
}

export type Step =
  | { kind: "goto"; at: Point; radius: number; vehicle?: "any" | "none" | string; stop?: boolean; text: string }
  | { kind: "enter"; target: string; text: string }
  | { kind: "race"; points: Point[]; radius: number; text: string }
  | { kind: "stars"; min: number; text: string }
  | { kind: "evade"; text: string }
  | { kind: "destroy"; target: string; text: string };

export interface Mission {
  id: string;
  title: string;
  brief: string;
  reward: number;
  /** Seconds for the whole mission; absent means no limit. */
  time?: number;
  spawns?: Record<string, SpawnSpec>;
  /** Spawned vehicle that must survive the mission. */
  protect?: string;
  steps: Step[];
  /** Stars forced on when a given step index completes. */
  heatAfter?: Record<number, number>;
  /** Where the contact marker for this mission stands; defaults to the main contact. */
  contact?: Point;
  /** Story chapter, shown when a chapter begins. */
  chapter?: number;
}

export interface MissionContext {
  x: number;
  z: number;
  /** Key of the mission vehicle the player is in, "any" for another car, or null on foot. */
  vehicle: string | null;
  stars: number;
  /** Player's current speed in m/s (on foot or in a car). */
  speed?: number;
  /** Mission vehicles that are burning or wrecked. */
  destroyed: Set<string>;
}

export type MissionEvent =
  | { type: "start"; mission: Mission }
  | { type: "step"; index: number; text: string }
  | { type: "checkpoint"; index: number; total: number }
  | { type: "heat"; stars: number }
  | { type: "done"; mission: Mission; reward: number; time: number }
  | { type: "fail"; mission: Mission; reason: string };

export class MissionRunner {
  mission: Mission | null = null;
  step = 0;
  checkpoint = 0;
  elapsed = 0;

  get active(): boolean {
    return this.mission !== null;
  }

  get timeLeft(): number | null {
    if (!this.mission || this.mission.time === undefined) return null;
    return Math.max(0, this.mission.time - this.elapsed);
  }

  get currentStep(): Step | null {
    return this.mission ? this.mission.steps[this.step] ?? null : null;
  }

  start(m: Mission): MissionEvent[] {
    this.mission = m;
    this.step = 0;
    this.checkpoint = 0;
    this.elapsed = 0;
    return [{ type: "start", mission: m }, { type: "step", index: 0, text: m.steps[0].text }];
  }

  fail(reason: string): MissionEvent[] {
    if (!this.mission) return [];
    const m = this.mission;
    this.mission = null;
    return [{ type: "fail", mission: m, reason }];
  }

  /** Where the player should head right now, for markers and the HUD arrow. */
  objective(targets: Record<string, Point>): Point | null {
    const s = this.currentStep;
    if (!s) return null;
    if (s.kind === "goto") return s.at;
    if (s.kind === "race") return s.points[this.checkpoint] ?? null;
    if (s.kind === "enter" || s.kind === "destroy") return targets[s.target] ?? null;
    return null;
  }

  update(ctx: MissionContext, dt: number): MissionEvent[] {
    const m = this.mission;
    if (!m) return [];
    this.elapsed += dt;
    if (m.protect && ctx.destroyed.has(m.protect)) return this.fail("груз уничтожен");
    if (m.time !== undefined && this.elapsed > m.time) return this.fail("время вышло");
    const s = m.steps[this.step];
    const events: MissionEvent[] = [];
    let done = false;
    switch (s.kind) {
      case "goto": {
        const inside = Math.hypot(ctx.x - s.at.x, ctx.z - s.at.z) < s.radius;
        const v = s.vehicle ?? "any";
        const vehicleOk = v === "none" ? ctx.vehicle === null : v === "any" ? ctx.vehicle !== null : ctx.vehicle === v;
        const stopped = !s.stop || (ctx.speed ?? 0) < 3;
        done = inside && vehicleOk && stopped;
        break;
      }
      case "enter":
        done = ctx.vehicle === s.target;
        if (!done && ctx.destroyed.has(s.target)) return this.fail("машина уничтожена");
        break;
      case "race": {
        const p = s.points[this.checkpoint];
        if (ctx.vehicle !== null && Math.hypot(ctx.x - p.x, ctx.z - p.z) < s.radius) {
          this.checkpoint++;
          events.push({ type: "checkpoint", index: this.checkpoint, total: s.points.length });
          done = this.checkpoint >= s.points.length;
        }
        break;
      }
      case "stars":
        done = ctx.stars >= s.min;
        break;
      case "evade":
        done = ctx.stars === 0;
        break;
      case "destroy":
        done = ctx.destroyed.has(s.target);
        break;
    }
    if (!done) return events;
    const heat = m.heatAfter?.[this.step];
    if (heat) events.push({ type: "heat", stars: heat });
    this.step++;
    this.checkpoint = 0;
    if (this.step >= m.steps.length) {
      this.mission = null;
      events.push({ type: "done", mission: m, reward: m.reward, time: this.elapsed });
    } else {
      events.push({ type: "step", index: this.step, text: m.steps[this.step].text });
    }
    return events;
  }
}

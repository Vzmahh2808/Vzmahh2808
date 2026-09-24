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
  | { kind: "destroy"; target: string; text: string }
  /** Keep a moving car in sight: closer than `near` gets you spotted, beyond `far` loses it. */
  | { kind: "tail"; target: string; near: number; far: number; seconds: number; text: string }
  /** Pick up every point, in any order. */
  | { kind: "collect"; points: Point[]; radius: number; text: string }
  /** Stay inside a zone for a number of seconds in total. */
  | { kind: "hold"; at: Point; radius: number; seconds: number; text: string }
  /** Rigged car: once above `min` m/s it must not drop below it for long, or it blows up. */
  | { kind: "speed"; target: string; min: number; seconds: number; text: string };

/** Tail tolerances in seconds. */
export const TAIL_SPOTTED = 2.5;
export const TAIL_LOST = 6;
/** How long a rigged car may stay under its minimum speed. */
export const SPEED_GRACE = 1.5;

export interface Gauge {
  label: string;
  /** Progress 0..1. */
  value: number;
  /** Warning shown in red when something is going wrong. */
  warn: string;
}

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
  /** Banner shown when this mission opens a new chapter. */
  chapterTitle?: string;
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
  /** Positions of the mission vehicles, for tailing. */
  targets?: Record<string, Point>;
}

export type MissionEvent =
  | { type: "start"; mission: Mission }
  | { type: "step"; index: number; text: string }
  | { type: "checkpoint"; index: number; total: number }
  | { type: "pickup"; count: number; total: number }
  | { type: "heat"; stars: number }
  | { type: "done"; mission: Mission; reward: number; time: number }
  /** `explode` names a mission vehicle that should blow up with the failure. */
  | { type: "fail"; mission: Mission; reason: string; explode?: string };

export class MissionRunner {
  mission: Mission | null = null;
  step = 0;
  checkpoint = 0;
  elapsed = 0;
  /** Seconds of progress inside a tail, hold or speed step. */
  progress = 0;
  /** Seconds too close to a tailed car. */
  spotted = 0;
  /** Seconds too far from a tailed car, or under a rigged car's minimum speed. */
  lost = 0;
  /** A rigged car arms once it first reaches its minimum speed. */
  armed = false;
  collected: boolean[] = [];

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
    this.elapsed = 0;
    this.resetStep();
    return [{ type: "start", mission: m }, { type: "step", index: 0, text: m.steps[0].text }];
  }

  fail(reason: string, explode?: string): MissionEvent[] {
    if (!this.mission) return [];
    const m = this.mission;
    this.mission = null;
    return [explode ? { type: "fail", mission: m, reason, explode } : { type: "fail", mission: m, reason }];
  }

  private resetStep(): void {
    this.checkpoint = 0;
    this.progress = 0;
    this.spotted = 0;
    this.lost = 0;
    this.armed = false;
    const s = this.currentStep;
    this.collected = s?.kind === "collect" ? s.points.map(() => false) : [];
  }

  /** Progress bar for steps that take time or several pickups. */
  gauge(): Gauge | null {
    const s = this.currentStep;
    if (!s) return null;
    const kmh = (ms: number) => Math.round(ms * 3.6);
    switch (s.kind) {
      case "tail":
        return {
          label: "Слежка",
          value: this.progress / s.seconds,
          warn: this.spotted > 0.3 ? "Слишком близко!" : this.lost > 0.3 ? "Теряете цель!" : "",
        };
      case "hold":
        return { label: "Удержание", value: this.progress / s.seconds, warn: "" };
      case "collect": {
        const got = this.collected.filter(Boolean).length;
        return { label: `Собрано ${got} из ${s.points.length}`, value: got / s.points.length, warn: "" };
      }
      case "speed":
        return {
          label: this.armed ? "Бомба" : `Разгонитесь до ${kmh(s.min)} км/ч`,
          value: this.progress / s.seconds,
          warn: this.armed && this.lost > 0 ? `Быстрее ${kmh(s.min)} км/ч!` : "",
        };
      default:
        return null;
    }
  }

  /** Where the player should head right now, for markers and the HUD arrow. */
  objective(targets: Record<string, Point>, from?: Point): Point | null {
    const s = this.currentStep;
    if (!s) return null;
    if (s.kind === "goto" || s.kind === "hold") return s.at;
    if (s.kind === "tail") return targets[s.target] ?? null;
    if (s.kind === "collect") {
      let best: Point | null = null;
      let bestD = Infinity;
      s.points.forEach((p, i) => {
        if (this.collected[i]) return;
        const d = from ? Math.hypot(p.x - from.x, p.z - from.z) : i;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      });
      return best;
    }
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
      case "tail": {
        if (ctx.destroyed.has(s.target)) return this.fail("цель уничтожена");
        const t = ctx.targets?.[s.target];
        if (!t) break;
        const d = Math.hypot(ctx.x - t.x, ctx.z - t.z);
        if (d < s.near) {
          this.spotted += dt;
          this.lost = 0;
        } else if (d > s.far) {
          // The lost timer starts only once the target has been picked up.
          if (this.progress > 0) this.lost += dt;
          this.spotted = Math.max(0, this.spotted - dt);
        } else {
          this.progress += dt;
          this.lost = 0;
          this.spotted = Math.max(0, this.spotted - dt * 0.5);
        }
        if (this.spotted > TAIL_SPOTTED) return this.fail("вас заметили");
        if (this.lost > TAIL_LOST) return this.fail("цель потеряна");
        done = this.progress >= s.seconds;
        break;
      }
      case "collect": {
        s.points.forEach((p, i) => {
          if (this.collected[i] || Math.hypot(ctx.x - p.x, ctx.z - p.z) >= s.radius) return;
          this.collected[i] = true;
          events.push({ type: "pickup", count: this.collected.filter(Boolean).length, total: s.points.length });
        });
        done = this.collected.every(Boolean);
        break;
      }
      case "hold":
        if (Math.hypot(ctx.x - s.at.x, ctx.z - s.at.z) < s.radius) this.progress += dt;
        done = this.progress >= s.seconds;
        break;
      case "speed": {
        if (ctx.destroyed.has(s.target)) return this.fail("машина уничтожена");
        const fast = ctx.vehicle === s.target && (ctx.speed ?? 0) >= s.min;
        if (!this.armed) {
          this.armed = fast;
          break;
        }
        if (fast) {
          this.progress += dt;
          this.lost = 0;
        } else {
          this.lost += dt;
          if (this.lost > SPEED_GRACE) return this.fail("бомба взорвалась", s.target);
        }
        done = this.progress >= s.seconds;
        break;
      }
    }
    if (!done) return events;
    const heat = m.heatAfter?.[this.step];
    if (heat) events.push({ type: "heat", stars: heat });
    this.step++;
    this.resetStep();
    if (this.step >= m.steps.length) {
      this.mission = null;
      events.push({ type: "done", mission: m, reward: m.reward, time: this.elapsed });
    } else {
      events.push({ type: "step", index: this.step, text: m.steps[this.step].text });
    }
    return events;
  }
}

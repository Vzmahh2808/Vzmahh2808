/**
 * The match: faceoffs, three periods, goals, sudden-death overtime and the
 * shootout. Wraps the world and is the only thing the game loop steps.
 */
import { clamp } from "../core/vec";
import { shoot } from "./actions";
import { thinkAI } from "./ai";
import { DT, stepWorld } from "./physics";
import { attackDir, goalX, type TeamId } from "./rink";
import { AVERAGE, goalieHome, goalieId, idleInput, makeWorld, skaterId, type GameEvent, type Ratings, type Role, type Skater, type SkaterInput, type World } from "./state";

export type Phase = "faceoff" | "play" | "goal" | "break" | "shootout" | "final";
export type Decided = "reg" | "ot" | "so";

export interface MatchSettings {
  seed: number;
  /** Real seconds per 20:00 period. */
  periodSeconds: number;
  mode: "regular" | "playoff";
  humanHome: boolean;
  humanAway: boolean;
  home: Ratings;
  away: Ratings;
  difficulty: number;
}

export const defaultSettings = (): MatchSettings => ({
  seed: 1,
  periodSeconds: 150,
  mode: "regular",
  humanHome: true,
  humanAway: false,
  home: AVERAGE,
  away: AVERAGE,
  difficulty: 0.6,
});

export interface GoalRecord {
  team: TeamId;
  period: number;
  /** Game clock (display seconds elapsed in the period) when it went in. */
  at: number;
  scorer: number;
  assists: number[];
  ot: boolean;
}

export interface ShootoutAttempt {
  team: TeamId;
  shooter: number;
  result: "pending" | "goal" | "miss";
}

export interface Shootout {
  attempts: ShootoutAttempt[];
  current: ShootoutAttempt | null;
  timer: number;
  shotAt: number;
  pause: number;
  score: [number, number];
}

export interface Stats {
  shots: [number, number];
  onGoal: [number, number];
  hits: [number, number];
}

const FACEOFF_TIME = 1.4;
const GOAL_TIME = 3.4;
const BREAK_TIME = 2.2;
const SO_ATTEMPT_TIME = 9;
const SO_ORDER: Role[] = ["C", "LW", "RW", "LD", "RD"];

export class Match {
  readonly settings: MatchSettings;
  readonly w: World;
  score: [number, number] = [0, 0];
  /** 1..3 regulation, 4+ overtime. */
  period = 1;
  clock: number;
  phase: Phase = "faceoff";
  phaseTimer = FACEOFF_TIME;
  goals: GoalRecord[] = [];
  stats: Stats = { shots: [0, 0], onGoal: [0, 0], hits: [0, 0] };
  decidedBy: Decided | null = null;
  winner: TeamId | null = null;
  so: Shootout | null = null;
  /** Every event since the last `drainEvents`, for sound and effects. */
  private outbox: GameEvent[] = [];
  /** Person input per side, copied to the skater they control. */
  readonly humanInput: [SkaterInput, SkaterInput] = [idleInput(), idleInput()];
  private lastSwitch: [number, number] = [-9, -9];
  private lastGoalTeam: TeamId | null = null;
  /** True once regulation is over and the next goal ends the game. */
  private suddenDeath = false;

  constructor(settings: MatchSettings = defaultSettings()) {
    this.settings = settings;
    this.w = makeWorld(settings.seed, settings.home, settings.away);
    this.w.human = [settings.humanHome, settings.humanAway];
    this.w.difficulty = [settings.difficulty, settings.difficulty];
    for (const s of this.w.skaters) {
      const d = this.w.difficulty[s.team];
      if (!this.w.human[s.team]) {
        s.shot *= 0.86 + 0.14 * d;
        s.def *= 0.9 + 0.1 * d;
      }
    }
    this.clock = settings.periodSeconds;
    this.setupFaceoff();
  }

  /** Display seconds per real second: 20:00 of game time in one period of real time. */
  get timeScale(): number {
    return 1200 / this.settings.periodSeconds;
  }

  get inOvertime(): boolean {
    return this.period >= 4 && this.phase !== "shootout";
  }

  drainEvents(): GameEvent[] {
    const e = this.outbox;
    this.outbox = [];
    return e;
  }

  /** Cycle to another skater on a human side (NHL '94 style change of player). */
  requestSwitch(team: TeamId): void {
    const w = this.w;
    const cur = w.controlled[team];
    const list = w.skaters
      .filter((s) => s.team === team && s.active && s.role !== "G")
      .map((s) => ({ s, d: Math.hypot(s.pos.x - w.puck.pos.x, s.pos.y - w.puck.pos.y) }))
      .sort((a, b) => a.d - b.d);
    if (list.length < 2) return;
    const idx = list.findIndex((x) => x.s.id === cur);
    w.controlled[team] = list[(idx + 1) % list.length].s.id;
    this.lastSwitch[team] = w.t;
  }

  private updateControlled(team: TeamId): void {
    const w = this.w;
    if (!w.human[team]) return;
    const p = w.puck;
    const cur = w.controlled[team];
    const carrier = p.carrier >= 0 ? w.skaters[p.carrier] : null;
    if (carrier && carrier.team === team && carrier.role !== "G") {
      w.controlled[team] = carrier.id;
      return;
    }
    if (p.passTo >= 0 && w.skaters[p.passTo].team === team && p.carrier === -1) {
      w.controlled[team] = p.passTo;
      return;
    }
    const valid = cur >= 0 && w.skaters[cur].active && w.skaters[cur].role !== "G";
    if (valid && w.t - this.lastSwitch[team] < 0.45) return;
    let best: Skater | null = null;
    let bd = Infinity;
    let curD = Infinity;
    for (const s of w.skaters) {
      if (s.team !== team || !s.active || s.role === "G") continue;
      const d = Math.hypot(s.pos.x + s.vel.x * 0.2 - p.pos.x, s.pos.y + s.vel.y * 0.2 - p.pos.y);
      if (s.id === cur) curD = d;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best && (!valid || (best.id !== cur && curD > bd * 1.3 + 1.2))) {
      w.controlled[team] = best.id;
      this.lastSwitch[team] = w.t;
    }
  }

  private applyHumanInput(team: TeamId): void {
    const w = this.w;
    if (!w.human[team]) return;
    const id = w.controlled[team];
    if (id < 0) return;
    const s = w.skaters[id];
    const h = this.humanInput[team];
    const i = s.input;
    i.mx = h.mx;
    i.my = h.my;
    i.sprint = h.sprint;
    i.shootHeld = h.shootHeld;
    i.shootReleased = h.shootReleased;
    i.check = h.check;
    i.pass = false;
    if (h.pass) {
      if (w.puck.carrier === s.id) i.pass = true;
      else this.requestSwitch(team);
    }
    h.pass = false;
    h.shootReleased = false;
    h.check = false;
  }

  /** Place both teams for a faceoff at centre ice and freeze them. */
  setupFaceoff(): void {
    const w = this.w;
    const threeOnThree = this.inOvertime && this.settings.mode === "regular";
    for (const s of w.skaters) {
      s.active = s.role === "G" || !threeOnThree || s.role === "C" || s.role === "LD" || s.role === "RD";
      s.vel.x = 0;
      s.vel.y = 0;
      s.stun = 0;
      s.charge = 0;
      s.shotBuffer = 0;
      s.pickupCd = 0;
      s.gHold = 0;
      s.gDive = 0;
      s.aiMode = 0;
      s.stamina = Math.min(1, s.stamina + 0.35);
      const dir = attackDir(s.team);
      s.heading = dir > 0 ? 0 : Math.PI;
      const t = threeOnThree;
      let rx = 0;
      let ry = 0;
      switch (s.role) {
        case "C":
          rx = -1.1;
          ry = 0;
          break;
        case "LW":
          rx = -2.5;
          ry = -6.7;
          break;
        case "RW":
          rx = -2.5;
          ry = 6.7;
          break;
        case "LD":
          rx = t ? -8 : -8;
          ry = -4.5;
          break;
        case "RD":
          rx = t ? -8 : -8;
          ry = 4.5;
          break;
        default: {
          const h = goalieHome(s.team);
          s.pos.x = h.x;
          s.pos.y = h.y;
          continue;
        }
      }
      s.pos.x = rx * dir;
      s.pos.y = ry;
    }
    const p = w.puck;
    p.pos.x = 0;
    p.pos.y = 0;
    p.vel.x = 0;
    p.vel.y = 0;
    p.carrier = -1;
    p.passTo = -1;
    p.lastTeam = -1;
    p.lastTouch = -1;
    p.shotTeam = -1;
    p.rebound = 0;
    p.beaten = -1;
    p.flight = 99;
    w.touches.length = 0;
    for (const team of [0, 1] as TeamId[]) {
      w.controlled[team] = skaterId(team, "C");
      this.lastSwitch[team] = w.t;
    }
    this.phase = "faceoff";
    this.phaseTimer = FACEOFF_TIME;
  }

  private dropPuck(): void {
    const w = this.w;
    const a = w.ratings[0].off - w.ratings[1].off;
    const homeWins = w.rng.next() < clamp(0.5 + a * 0.004, 0.3, 0.7);
    // The puck slides back to whoever won the draw.
    w.puck.vel.x = (homeWins ? -1 : 1) * (3 + w.rng.next() * 2);
    w.puck.vel.y = (w.rng.next() - 0.5) * 4;
    this.phase = "play";
    this.outbox.push({ type: "faceoff" });
  }

  private handleEvents(): void {
    const w = this.w;
    for (const e of w.events) {
      this.outbox.push(e);
      switch (e.type) {
        case "shot":
          this.stats.shots[e.team]++;
          break;
        case "save":
          this.stats.onGoal[(1 - e.team) as TeamId]++;
          break;
        case "hit":
          this.stats.hits[e.team]++;
          break;
        case "goal":
          if (this.phase === "play") this.onGoal(e);
          else if (this.phase === "shootout" && this.so) this.onShootoutGoal(e.team);
          break;
      }
    }
    w.events.length = 0;
  }

  private onGoal(e: Extract<GameEvent, { type: "goal" }>): void {
    this.score[e.team]++;
    this.stats.onGoal[e.team]++;
    const elapsed = (this.settings.periodSeconds - this.clock) * this.timeScale;
    this.goals.push({ team: e.team, period: this.period, at: elapsed, scorer: e.scorer, assists: e.assist, ot: this.period >= 4 });
    this.lastGoalTeam = e.team;
    this.phase = "goal";
    this.phaseTimer = GOAL_TIME;
    this.w.human.forEach((h, t) => {
      if (h) this.w.skaters[this.w.controlled[t]].input = idleInput();
    });
  }

  private endGame(winner: TeamId, by: Decided): void {
    this.winner = winner;
    this.decidedBy = by;
    this.phase = "final";
    this.phaseTimer = 0;
    this.outbox.push({ type: "whistle" });
  }

  private endPeriod(): void {
    this.outbox.push({ type: "whistle" });
    const w = this.w;
    if (this.period < 3) {
      this.period++;
      this.clock = this.settings.periodSeconds;
      this.phase = "break";
      this.phaseTimer = BREAK_TIME;
      return;
    }
    if (this.period === 3 || this.period >= 4) {
      if (this.score[0] !== this.score[1]) {
        this.endGame(this.score[0] > this.score[1] ? 0 : 1, this.period > 3 ? "ot" : "reg");
        return;
      }
      if (this.settings.mode === "playoff") {
        this.period++;
        this.suddenDeath = true;
        this.clock = this.settings.periodSeconds;
        this.phase = "break";
        this.phaseTimer = BREAK_TIME;
        return;
      }
      if (this.period === 3) {
        this.period = 4;
        this.suddenDeath = true;
        this.clock = this.settings.periodSeconds / 4; // 5:00 of 20:00
        this.phase = "break";
        this.phaseTimer = BREAK_TIME;
        return;
      }
      this.startShootout();
    }
    void w;
  }

  // ------------------------------------------------------------ shootout

  /** Skip straight to a shootout (the training mode). */
  beginShootoutOnly(): void {
    this.score = [0, 0];
    this.startShootout();
  }

  private startShootout(): void {
    this.period = 5;
    this.phase = "shootout";
    this.so = { attempts: [], current: null, timer: 0, shotAt: -1, pause: 1.2, score: [0, 0] };
    for (const s of this.w.skaters) s.active = false;
  }

  private nextAttempt(): void {
    const so = this.so!;
    const n = so.attempts.length;
    const team = (n % 2) as TeamId;
    const round = Math.floor(n / 2);
    const role = SO_ORDER[round % SO_ORDER.length];
    const shooter = skaterId(team, role);
    const w = this.w;
    for (const s of w.skaters) s.active = false;
    const sh = w.skaters[shooter];
    const gk = w.skaters[goalieId((1 - team) as TeamId)];
    sh.active = true;
    gk.active = true;
    const dir = attackDir(team);
    sh.pos.x = -dir * 1;
    sh.pos.y = 0;
    sh.vel.x = 0;
    sh.vel.y = 0;
    sh.stun = 0;
    sh.heading = dir > 0 ? 0 : Math.PI;
    sh.stamina = 1;
    sh.aiShootIn = 0.5 + w.rng.next() * 0.8;
    const h = goalieHome(gk.team);
    gk.pos.x = h.x;
    gk.pos.y = 0;
    gk.aiMode = 0;
    gk.gHold = 0;
    gk.gDive = 0;
    w.puck.pos.x = sh.pos.x + dir * 0.7;
    w.puck.pos.y = 0;
    w.puck.vel.x = 0;
    w.puck.vel.y = 0;
    w.puck.carrier = sh.id;
    w.puck.lastTeam = team;
    w.puck.lastTouch = sh.id;
    w.puck.shotTeam = -1;
    w.puck.rebound = 0;
    w.puck.beaten = -1;
    w.puck.passTo = -1;
    w.controlled[team] = shooter;
    const att: ShootoutAttempt = { team, shooter, result: "pending" };
    so.attempts.push(att);
    so.current = att;
    so.timer = SO_ATTEMPT_TIME;
    so.shotAt = -1;
    this.outbox.push({ type: "faceoff" });
  }

  private onShootoutGoal(team: TeamId): void {
    const so = this.so!;
    if (!so.current || so.current.result !== "pending") return;
    so.current.result = "goal";
    so.score[team]++;
    so.pause = 2.2;
    so.current = null;
  }

  private finishAttempt(result: "miss"): void {
    const so = this.so!;
    if (so.current) so.current.result = result;
    so.current = null;
    so.pause = 1.6;
  }

  /** Winner of the shootout so far, or null if it is still open. */
  private shootoutLeader(): TeamId | null {
    const so = this.so!;
    const done = so.attempts.filter((a) => a.result !== "pending");
    const a = done.filter((x) => x.team === 0);
    const b = done.filter((x) => x.team === 1);
    const sa = so.score[0];
    const sb = so.score[1];
    if (a.length < 3 || b.length < 3) {
      const leftA = 3 - a.length;
      const leftB = 3 - b.length;
      if (sa > sb + leftB) return 0;
      if (sb > sa + leftA) return 1;
      return null;
    }
    if (a.length === b.length && sa !== sb) return sa > sb ? 0 : 1;
    return null;
  }

  private shootoutStep(dt: number): void {
    const so = this.so!;
    const w = this.w;
    if (so.current === null) {
      so.pause -= dt;
      // Let the puck and skaters coast while waiting.
      if (so.pause <= 0) {
        const lead = this.shootoutLeader();
        if (lead !== null) {
          this.endGame(lead, "so");
          return;
        }
        this.nextAttempt();
      }
      stepWorld(w, dt);
      this.handleEvents();
      return;
    }
    const att = so.current;
    const shooter = w.skaters[att.shooter];
    const dir = attackDir(att.team);
    const gx = goalX((1 - att.team) as TeamId);
    if (!w.human[att.team]) {
      // A simple shooter: drive at the net, weave, and let one go.
      const i = shooter.input;
      i.mx = 0;
      i.my = 0;
      i.shootHeld = false;
      i.shootReleased = false;
      const dx = gx - shooter.pos.x;
      const dg = Math.hypot(dx, shooter.pos.y);
      if (w.puck.carrier === shooter.id) {
        const weave = Math.sin((so.timer + att.shooter) * 3.1) * 0.6;
        const tx = gx - dir * 6;
        const ty = weave * 3;
        const ddx = tx - shooter.pos.x;
        const ddy = ty - shooter.pos.y;
        const l = Math.hypot(ddx, ddy) || 1;
        i.mx = ddx / l;
        i.my = ddy / l;
        i.sprint = true;
        shooter.aiShootIn -= dt;
        if (dg < 10 && shooter.aiShootIn <= 0) {
          shoot(w, shooter, 0.25 + w.rng.next() * 0.4, false, Math.atan2(-shooter.pos.y, dx));
        }
      }
    } else {
      this.applyHumanInput(att.team);
    }
    so.timer -= dt;
    stepWorld(w, dt);
    const before = so.current;
    let shotTaken = false;
    let saved = false;
    for (const e of w.events) {
      if (e.type === "shot") shotTaken = true;
      if (e.type === "save") saved = true;
    }
    this.handleEvents();
    if (so.current === null && before) return; // goal
    if (shotTaken && so.shotAt < 0) so.shotAt = so.timer;
    if (saved) this.finishAttempt("miss");
    else if (so.shotAt >= 0 && so.shotAt - so.timer > 1.6) this.finishAttempt("miss");
    else if (so.timer <= 0) this.finishAttempt("miss");
    else if (w.puck.carrier === goalieId((1 - att.team) as TeamId)) this.finishAttempt("miss");
  }

  // ------------------------------------------------------------ stepping

  /** Advance the match by one fixed step. */
  tick(dt: number = DT): void {
    const w = this.w;
    switch (this.phase) {
      case "final":
        return;
      case "faceoff":
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.dropPuck();
        return;
      case "break":
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.setupFaceoff();
        return;
      case "goal": {
        this.phaseTimer -= dt;
        for (const s of w.skaters) {
          const i = s.input;
          i.mx = 0;
          i.my = 0;
          i.sprint = false;
          i.pass = i.shootHeld = i.shootReleased = i.check = false;
        }
        stepWorld(w, dt);
        w.events.length = 0;
        if (this.phaseTimer <= 0) {
          if (this.suddenDeath && this.period >= 4 && this.lastGoalTeam !== null) {
            this.endGame(this.lastGoalTeam, "ot");
          } else {
            this.setupFaceoff();
          }
        }
        return;
      }
      case "shootout":
        this.shootoutStep(dt);
        return;
      case "play":
        break;
    }
    this.clock -= dt;
    for (const team of [0, 1] as TeamId[]) this.updateControlled(team);
    thinkAI(w, dt);
    for (const team of [0, 1] as TeamId[]) this.applyHumanInput(team);
    stepWorld(w, dt);
    this.handleEvents();
    if (this.phase === "play" && this.clock <= 0) {
      this.clock = 0;
      this.endPeriod();
    }
  }
}


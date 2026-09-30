/** Draws the match onto a canvas: camera, rink, players, puck and effects. */
import { Rng } from "../core/rng";
import { clamp, angleDiff } from "../core/vec";
import type { Kit } from "../game/teams";
import { CHARGE_MAX } from "../sim/actions";
import type { Match } from "../sim/match";
import { attackDir } from "../sim/rink";
import type { GameEvent, Skater } from "../sim/state";
import { CACHE_HX, CACHE_HY, buildRinkCache } from "./rinkCache";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: "dot" | "confetti";
  rot: number;
}

export interface ViewOptions {
  kits: [Kit, Kit];
  /** Pixel ratio cap; lower on slow phones. */
  quality: "high" | "low";
  palette: string[];
}

const HUMAN_COLORS = ["#ffd32a", "#48dbfb"];

export class View {
  private ctx: CanvasRenderingContext2D;
  private cache: HTMLCanvasElement | null = null;
  private cacheKey = "";
  private cam = { x: 0, y: 0 };
  private scale = 16;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private particles: Particle[] = [];
  private trail: { x: number; y: number }[] = [];
  private shake = 0;
  private flash = 0;
  private goalLight = 0;
  /** +1 or -1: which net the goal light is over. */
  private goalSide: 1 | -1 = 1;
  private rng = new Rng(99);
  private time = 0;
  private lastHeadings = new Map<number, number>();
  opts: ViewOptions;

  constructor(private canvas: HTMLCanvasElement, opts: ViewOptions) {
    this.ctx = canvas.getContext("2d")!;
    this.opts = opts;
  }

  setOptions(o: Partial<ViewOptions>): void {
    this.opts = { ...this.opts, ...o };
    this.cache = null;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const cap = this.opts.quality === "low" ? 1 : 2;
    this.dpr = Math.min(window.devicePixelRatio || 1, cap);
    this.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.height = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }
    // About 21 m of rink height on screen, but never fewer than 30 m of width.
    this.scale = Math.min(this.height / 21, this.width / 30);
    if (this.width / this.scale > 50) this.scale = this.width / 50;
  }

  snapCamera(m: Match): void {
    this.cam.x = m.w.puck.pos.x;
    this.cam.y = m.w.puck.pos.y * 0.6;
  }

  /** Feed match events into effects. */
  handle(events: GameEvent[], m: Match): void {
    for (const e of events) {
      switch (e.type) {
        case "goal": {
          this.flash = 1;
          this.goalLight = 3.4;
          this.goalSide = attackDir(e.team);
          this.shake = Math.max(this.shake, 0.5);
          const kit = this.opts.kits[e.team];
          const x = m.w.puck.pos.x;
          const y = m.w.puck.pos.y;
          for (let i = 0; i < 70; i++) this.spawn(x, y, kit, "confetti");
          break;
        }
        case "hit":
          this.shake = Math.max(this.shake, 0.18 + 0.2 * e.power);
          this.burst(this.lastCarrierPos(m), 10, "#ffffff");
          break;
        case "save":
          this.burst({ x: m.w.puck.pos.x, y: m.w.puck.pos.y }, 8, "#dff3ff");
          break;
        case "post":
          this.burst({ x: m.w.puck.pos.x, y: m.w.puck.pos.y }, 6, "#ffd0d0");
          this.shake = Math.max(this.shake, 0.1);
          break;
        case "board":
          if (e.speed > 9) this.burst({ x: m.w.puck.pos.x, y: m.w.puck.pos.y }, 4, "#ffffff");
          break;
        case "shot":
          if (e.power > 0.7) this.shake = Math.max(this.shake, 0.06);
          break;
        default:
          break;
      }
    }
  }

  private lastCarrierPos(m: Match): { x: number; y: number } {
    return { x: m.w.puck.pos.x, y: m.w.puck.pos.y };
  }

  private burst(at: { x: number; y: number }, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const s = 1.5 + this.rng.next() * 4;
      this.particles.push({ x: at.x, y: at.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5, max: 0.5, size: 0.08 + this.rng.next() * 0.08, color, kind: "dot", rot: 0 });
    }
  }

  private spawn(x: number, y: number, kit: Kit, kind: "confetti"): void {
    const a = this.rng.next() * Math.PI * 2;
    const s = 3 + this.rng.next() * 9;
    const c = this.rng.next() < 0.5 ? kit.body : this.rng.next() < 0.5 ? kit.trim : "#ffffff";
    this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.6 + this.rng.next(), max: 2.6, size: 0.16 + this.rng.next() * 0.14, color: c, kind, rot: this.rng.next() * 6 });
  }

  private ensureCache(): void {
    const ppm = this.opts.quality === "low" ? 18 : 30;
    const key = `${ppm}|${this.opts.palette.join(",")}`;
    if (this.cache && this.cacheKey === key) return;
    this.cache = buildRinkCache(ppm, this.opts.palette);
    this.cacheKey = key;
  }

  private updateCamera(m: Match, dt: number): void {
    const p = m.w.puck;
    const lookX = clamp(p.vel.x * 0.32, -7, 7);
    const lookY = clamp(p.vel.y * 0.2, -3, 3);
    let tx = p.pos.x + lookX;
    let ty = p.pos.y * 0.7 + lookY;
    const halfW = this.width / this.scale / 2;
    const halfH = this.height / this.scale / 2;
    const maxX = Math.max(0, CACHE_HX - 3.5 - halfW);
    const maxY = Math.max(0, CACHE_HY - 3.5 - halfH);
    tx = clamp(tx, -maxX, maxX);
    ty = clamp(ty, -maxY, maxY);
    const k = 1 - Math.exp(-4.5 * dt);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
  }

  /** Convert a point on screen (CSS px) to rink metres; used for nothing but debugging and tests. */
  toWorld(px: number, py: number): { x: number; y: number } {
    return { x: (px * this.dpr - this.width / 2) / this.scale + this.cam.x, y: (py * this.dpr - this.height / 2) / this.scale + this.cam.y };
  }

  draw(m: Match, dt: number): void {
    this.time += dt;
    this.ensureCache();
    this.updateCamera(m, dt);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0b0e14";
    ctx.fillRect(0, 0, this.width, this.height);
    let sx = 0;
    let sy = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.6);
      sx = (this.rng.next() - 0.5) * this.shake * 0.6;
      sy = (this.rng.next() - 0.5) * this.shake * 0.6;
    }
    ctx.setTransform(this.scale, 0, 0, this.scale, this.width / 2 - (this.cam.x + sx) * this.scale, this.height / 2 - (this.cam.y + sy) * this.scale);
    ctx.drawImage(this.cache!, -CACHE_HX, -CACHE_HY, CACHE_HX * 2, CACHE_HY * 2);

    // Goal light over the net that was scored on.
    if (this.goalLight > 0) {
      this.goalLight = Math.max(0, this.goalLight - dt);
      const on = Math.floor(this.time * 6) % 2 === 0;
      if (on) {
        ctx.fillStyle = "rgba(255,40,40,0.55)";
        ctx.beginPath();
        ctx.arc(this.goalSide * 27, 0, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const w = m.w;
    const list = w.skaters.filter((s) => s.active).sort((a, b) => a.pos.y - b.pos.y);
    // Shadows first.
    ctx.fillStyle = "rgba(20,40,70,0.22)";
    for (const s of list) {
      ctx.beginPath();
      ctx.ellipse(s.pos.x + 0.1, s.pos.y + 0.12, 0.5, 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(w.puck.pos.x + 0.05, w.puck.pos.y + 0.06, 0.12, 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    for (const s of list) this.drawSkater(ctx, m, s);
    this.drawPuck(ctx, m);
    this.drawParticles(ctx, dt);
    this.spray(m, dt);

    // Screen-space flash on goals.
    if (this.flash > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.35})`;
      ctx.fillRect(0, 0, this.width, this.height);
      this.flash = Math.max(0, this.flash - dt * 2.2);
    }
  }

  private kitOf(s: Skater): Kit {
    return this.opts.kits[s.team];
  }

  private drawSkater(ctx: CanvasRenderingContext2D, m: Match, s: Skater): void {
    const w = m.w;
    const kit = this.kitOf(s);
    const human = w.human[s.team] && w.controlled[s.team] === s.id;
    ctx.save();
    ctx.translate(s.pos.x, s.pos.y);
    if (s.stun > 0) ctx.globalAlpha = 0.75 + 0.25 * Math.sin(this.time * 40);
    ctx.rotate(s.heading);
    if (s.role === "G") {
      const dive = s.gDive > 0 ? s.gDiveDir : 0;
      // Pads.
      ctx.fillStyle = "#f4f6fa";
      ctx.strokeStyle = "#7a8496";
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.roundRect(-0.2, -0.62 + dive * 0.1, 0.45, 1.24, 0.12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = kit.body;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.42, 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = kit.trim;
      ctx.fillRect(-0.05, -0.5, 0.12, 1);
      ctx.fillStyle = "#e9edf3";
      ctx.beginPath();
      ctx.arc(0.08, 0, 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#222";
      ctx.fillRect(0.2, -0.1, 0.06, 0.2);
      // Glove and blocker.
      ctx.fillStyle = "#2a3346";
      ctx.beginPath();
      ctx.arc(0.28, -0.55, 0.16, 0, Math.PI * 2);
      ctx.arc(0.28, 0.55, 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Stick.
      ctx.strokeStyle = "#3b2a1a";
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.moveTo(0.05, 0.2);
      ctx.lineTo(0.95, 0.28);
      ctx.stroke();
      ctx.fillStyle = "#111";
      ctx.fillRect(0.85, 0.2, 0.22, 0.1);
      // Body.
      ctx.fillStyle = kit.body;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.32, 0.46, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = kit.trim;
      ctx.fillRect(-0.28, -0.1, 0.16, 0.2);
      ctx.fillRect(-0.02, -0.42, 0.1, 0.84);
      // Helmet.
      ctx.fillStyle = s.role === "C" ? "#f2c94c" : "#f4f6fa";
      ctx.beginPath();
      ctx.arc(0.08, 0, 0.23, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.stroke();
    }
    ctx.restore();

    if (human) this.drawHumanMarker(ctx, s, HUMAN_COLORS[s.team]);
  }

  private drawHumanMarker(ctx: CanvasRenderingContext2D, s: Skater, color: string): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.arc(s.pos.x, s.pos.y, 0.68, 0, Math.PI * 2);
    ctx.stroke();
    // Arrow above the player.
    const bob = Math.sin(this.time * 8) * 0.08;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(s.pos.x, s.pos.y - 0.95 + bob);
    ctx.lineTo(s.pos.x - 0.26, s.pos.y - 1.42 + bob);
    ctx.lineTo(s.pos.x + 0.26, s.pos.y - 1.42 + bob);
    ctx.closePath();
    ctx.fill();
    if (s.charge > 0.02) {
      const c = clamp(s.charge / CHARGE_MAX, 0, 1);
      ctx.strokeStyle = c < 0.5 ? "#ffd32a" : c < 0.95 ? "#ff9f43" : "#ff4757";
      ctx.lineWidth = 0.16;
      ctx.beginPath();
      ctx.arc(s.pos.x, s.pos.y, 0.9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c);
      ctx.stroke();
    }
    if (s.stamina < 0.98) {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(s.pos.x - 0.5, s.pos.y + 0.8, 1, 0.1);
      ctx.fillStyle = s.stamina > 0.3 ? "#7bed9f" : "#ff6b6b";
      ctx.fillRect(s.pos.x - 0.5, s.pos.y + 0.8, s.stamina, 0.1);
    }
    ctx.restore();
  }

  private drawPuck(ctx: CanvasRenderingContext2D, m: Match): void {
    const p = m.w.puck;
    const speed = Math.hypot(p.vel.x, p.vel.y);
    this.trail.push({ x: p.pos.x, y: p.pos.y });
    if (this.trail.length > 7) this.trail.shift();
    if (speed > 14 && this.trail.length > 1) {
      ctx.strokeStyle = `rgba(30,40,60,${clamp((speed - 14) / 40, 0.15, 0.55)})`;
      ctx.lineWidth = 0.1;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(this.trail[0].x, this.trail[0].y);
      for (const t of this.trail) ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }
    ctx.fillStyle = "#0b0b0f";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.arc(p.pos.x, p.pos.y, 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private spray(m: Match, dt: number): void {
    // Snow from skaters that slide sideways or brake hard.
    for (const s of m.w.skaters) {
      if (!s.active || s.role === "G") continue;
      const sp = Math.hypot(s.vel.x, s.vel.y);
      if (sp < 3) continue;
      const prev = this.lastHeadings.get(s.id) ?? s.heading;
      const turn = Math.abs(angleDiff(prev, s.heading)) / Math.max(dt, 1e-3);
      this.lastHeadings.set(s.id, s.heading);
      const slip = Math.abs(-s.vel.x * Math.sin(s.heading) + s.vel.y * Math.cos(s.heading));
      if ((slip > 2.4 || turn > 6) && this.rng.next() < 0.5 && this.particles.length < 400) {
        this.particles.push({
          x: s.pos.x,
          y: s.pos.y,
          vx: -s.vel.x * 0.25 + (this.rng.next() - 0.5) * 2,
          vy: -s.vel.y * 0.25 + (this.rng.next() - 0.5) * 2,
          life: 0.4,
          max: 0.4,
          size: 0.07 + this.rng.next() * 0.07,
          color: "#ffffff",
          kind: "dot",
          rot: 0,
        });
      }
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = Math.exp(-(p.kind === "confetti" ? 1.6 : 3) * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.rot += dt * 8;
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * (p.kind === "confetti" ? 1 : 0.85);
      ctx.fillStyle = p.color;
      if (p.kind === "confetti") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Menu backdrop: the empty rink drifting slowly. */
  drawIdle(dt: number): void {
    this.time += dt;
    this.ensureCache();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0b0e14";
    ctx.fillRect(0, 0, this.width, this.height);
    const cx = Math.sin(this.time * 0.15) * 14;
    ctx.setTransform(this.scale * 0.8, 0, 0, this.scale * 0.8, this.width / 2 - cx * this.scale * 0.8, this.height / 2);
    ctx.drawImage(this.cache!, -CACHE_HX, -CACHE_HY, CACHE_HX * 2, CACHE_HY * 2);
  }

  /** World position of a rink point in CSS pixels, for HUD overlays. */
  project(x: number, y: number): { x: number; y: number } {
    return { x: ((x - this.cam.x) * this.scale + this.width / 2) / this.dpr, y: ((y - this.cam.y) * this.scale + this.height / 2) / this.dpr };
  }
}

import { TERRAIN, WEATHER } from "../game/data";
import type { Game } from "../game/game";
import type { GameEvent, Point, Terrain, Tile } from "../game/types";
import { samePoint } from "../game/world";

interface Flash {
  at: Point;
  until: number;
  color: string;
}

/** Tiny hash so decorations (trees, stones) are stable per tile without storing them. */
function hash(x: number, y: number, k = 0): number {
  let h = (x * 374761393 + y * 668265263 + k * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private tile = 16;
  private ox = 0;
  private oy = 0;
  private flashes: Flash[] = [];
  private markerFrom: Point | null = null;
  private markerStart = 0;
  hover: Point | null = null;
  preview: Point[] | null = null;
  previewHours = 0;
  private particles: { x: number; y: number; v: number }[] = [];
  reduced = false;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    try {
      this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      this.reduced = false;
    }
    for (let i = 0; i < 80; i++) this.particles.push({ x: Math.random(), y: Math.random(), v: 0.5 + Math.random() });
  }

  get hasAnimations(): boolean {
    return this.flashes.length > 0 || this.markerFrom !== null;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
  }

  reset(): void {
    this.flashes = [];
    this.markerFrom = null;
    this.hover = null;
    this.preview = null;
  }

  handle(e: GameEvent, now: number, game: Game): void {
    if (e.type === "move") {
      if (!this.reduced) {
        this.markerFrom = { ...e.from };
        this.markerStart = now;
      }
    } else if (e.type === "hurt") {
      this.flashes.push({ at: { ...game.state.pos }, until: now + 500, color: "rgba(255,80,80,0.55)" });
    } else if (e.type === "checkpoint" || e.type === "peak") {
      this.flashes.push({ at: { ...game.state.pos }, until: now + 700, color: "rgba(255,211,42,0.5)" });
    }
  }

  /** Map tile under a canvas-relative pixel position, or null outside the map. */
  tileAtPixel(game: Game, px: number, py: number): Point | null {
    const x = Math.floor((px * this.dpr - this.ox) / this.tile);
    const y = Math.floor((py * this.dpr - this.oy) / this.tile);
    if (x < 0 || y < 0 || x >= game.state.width || y >= game.state.height) return null;
    return { x, y };
  }

  draw(game: Game, now: number): void {
    const s = game.state;
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    this.tile = Math.max(6, Math.floor(Math.min(W / s.width, H / s.height)));
    this.ox = Math.floor((W - this.tile * s.width) / 2);
    this.oy = Math.floor((H - this.tile * s.height) / 2);
    ctx.fillStyle = "#0b0e14";
    ctx.fillRect(0, 0, W, H);

    const t = this.tile;
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        this.drawTile(s.tiles[y * s.width + x], x, y, s);
      }
    }

    // Trail.
    if (s.trail.length > 1) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = Math.max(1, t * 0.08);
      ctx.setLineDash([t * 0.25, t * 0.2]);
      ctx.beginPath();
      s.trail.forEach((p, i) => {
        const cx = this.ox + p.x * t + t / 2;
        const cy = this.oy + p.y * t + t / 2;
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
      ctx.restore();
    }

    // Path preview.
    if (this.preview && this.preview.length) {
      ctx.save();
      const fits = this.previewHours <= s.hours + 1e-6;
      ctx.strokeStyle = fits ? "rgba(255,211,42,0.9)" : "rgba(255,120,80,0.9)";
      ctx.lineWidth = Math.max(1.5, t * 0.14);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(this.ox + s.pos.x * t + t / 2, this.oy + s.pos.y * t + t / 2);
      for (const p of this.preview) ctx.lineTo(this.ox + p.x * t + t / 2, this.oy + p.y * t + t / 2);
      ctx.stroke();
      const last = this.preview[this.preview.length - 1];
      this.label(`${fmt(this.previewHours)} ч`, this.ox + last.x * t + t / 2, this.oy + last.y * t - t * 0.3, fits ? "#ffd32a" : "#ff8c69");
      ctx.restore();
    }

    // Markers: start, finish, checkpoints.
    this.drawVillage(s.start.x, s.start.y, "С");
    this.drawVillage(s.finish.x, s.finish.y, "Ф");
    for (const cp of s.checkpoints) this.drawCheckpoint(cp.pos, cp.id, cp.taken);

    // Group marker.
    let gx = s.pos.x;
    let gy = s.pos.y;
    if (this.markerFrom) {
      const k = Math.min(1, (now - this.markerStart) / 160);
      gx = this.markerFrom.x + (s.pos.x - this.markerFrom.x) * k;
      gy = this.markerFrom.y + (s.pos.y - this.markerFrom.y) * k;
      if (k >= 1) this.markerFrom = null;
    }
    this.drawGroup(gx, gy, s.members.length, now);

    // Flashes.
    this.flashes = this.flashes.filter((f) => f.until > now);
    for (const f of this.flashes) {
      const a = (f.until - now) / 600;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.strokeStyle = f.color;
      ctx.lineWidth = t * 0.2;
      ctx.beginPath();
      ctx.arc(this.ox + f.at.x * t + t / 2, this.oy + f.at.y * t + t / 2, t * (1.2 - a * 0.6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Hover outline.
    if (this.hover) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = Math.max(1, t * 0.08);
      ctx.strokeRect(this.ox + this.hover.x * t + 1, this.oy + this.hover.y * t + 1, t - 2, t - 2);
      ctx.restore();
    }

    this.drawWeather(game, now);
  }

  private drawTile(tile: Tile, x: number, y: number, grid: { width: number; height: number; tiles: Tile[] }): void {
    const { ctx } = this;
    const t = this.tile;
    const px = this.ox + x * t;
    const py = this.oy + y * t;
    const def = TERRAIN[tile.t];
    if (tile.t === "river" || tile.t === "bridge") {
      // Rivers are drawn as a channel over the bank rather than as a solid blue square.
      ctx.fillStyle = shade("#6c9a55", (tile.h - 0.4) * 0.35);
      ctx.fillRect(px, py, t, t);
      const water = (dx: number, dy: number) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) return dx !== 0 || dy !== 0 ? true : false;
        const n = grid.tiles[ny * grid.width + nx].t;
        return n === "river" || n === "lake" || n === "bridge";
      };
      const cx = px + t / 2;
      const cy = py + t / 2;
      const wdt = t * 0.42;
      ctx.fillStyle = TERRAIN.river.color;
      let links = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (!water(dx, dy)) continue;
        links++;
        if (dx !== 0) ctx.fillRect(dx > 0 ? cx : px, cy - wdt / 2, t / 2, wdt);
        else ctx.fillRect(cx - wdt / 2, dy > 0 ? cy : py, wdt, t / 2);
      }
      ctx.beginPath();
      ctx.arc(cx, cy, wdt / 2, 0, Math.PI * 2);
      ctx.fill();
      if (links === 0) ctx.fillRect(px + t * 0.1, cy - wdt / 2, t * 0.8, wdt);
      if (tile.t === "bridge") {
        const alongX = water(1, 0) || water(-1, 0);
        ctx.fillStyle = "#8b5a2b";
        if (alongX) ctx.fillRect(cx - t * 0.12, py + t * 0.12, t * 0.24, t * 0.76);
        else ctx.fillRect(px + t * 0.12, cy - t * 0.12, t * 0.76, t * 0.24);
      }
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, t - 1, t - 1);
      return;
    }
    ctx.fillStyle = shade(def.color, tile.t === "rock" ? (tile.h - 0.7) * 0.8 : (tile.h - 0.4) * 0.35);
    ctx.fillRect(px, py, t, t);
    const r = hash(x, y);
    const r2 = hash(x, y, 1);
    switch (tile.t) {
      case "forest": {
        ctx.fillStyle = "rgba(20,60,25,0.8)";
        const n = 2 + Math.floor(r * 2);
        for (let i = 0; i < n; i++) {
          const cx = px + t * (0.2 + hash(x, y, 2 + i) * 0.6);
          const cy = py + t * (0.25 + hash(x, y, 5 + i) * 0.55);
          const h = t * 0.4;
          ctx.beginPath();
          ctx.moveTo(cx, cy - h / 2);
          ctx.lineTo(cx + h * 0.35, cy + h / 2);
          ctx.lineTo(cx - h * 0.35, cy + h / 2);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      case "swamp": {
        ctx.strokeStyle = "rgba(40,80,110,0.55)";
        ctx.lineWidth = Math.max(1, t * 0.06);
        for (let i = 0; i < 3; i++) {
          const yy = py + t * (0.25 + i * 0.25);
          const xx = px + t * (0.15 + hash(x, y, 7 + i) * 0.3);
          ctx.beginPath();
          ctx.moveTo(xx, yy);
          ctx.lineTo(xx + t * 0.35, yy);
          ctx.stroke();
        }
        break;
      }
      case "scree": {
        ctx.fillStyle = "rgba(50,45,40,0.45)";
        for (let i = 0; i < 4; i++) {
          const cx = px + t * (0.15 + hash(x, y, 9 + i) * 0.7);
          const cy = py + t * (0.15 + hash(x, y, 13 + i) * 0.7);
          ctx.fillRect(cx, cy, t * 0.12, t * 0.1);
        }
        break;
      }
      case "glacier": {
        ctx.strokeStyle = "rgba(90,140,180,0.5)";
        ctx.lineWidth = Math.max(1, t * 0.05);
        ctx.beginPath();
        ctx.moveTo(px + t * 0.2, py + t * (0.3 + r * 0.4));
        ctx.lineTo(px + t * 0.8, py + t * (0.3 + r2 * 0.4));
        ctx.stroke();
        break;
      }
      case "rock": {
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = Math.max(1, t * 0.05);
        ctx.beginPath();
        ctx.moveTo(px, py + t * (0.2 + r * 0.6));
        ctx.lineTo(px + t * (0.4 + r2 * 0.6), py);
        ctx.stroke();
        break;
      }
      case "lake": {
        ctx.strokeStyle = "rgba(200,225,255,0.45)";
        ctx.lineWidth = Math.max(1, t * 0.06);
        ctx.beginPath();
        const yy = py + t * (0.35 + r * 0.3);
        ctx.moveTo(px + t * 0.15, yy);
        ctx.quadraticCurveTo(px + t * 0.4, yy - t * 0.15, px + t * 0.55, yy);
        ctx.quadraticCurveTo(px + t * 0.7, yy + t * 0.15, px + t * 0.85, yy);
        ctx.stroke();
        break;
      }
      case "pass": {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(1.5, t * 0.12);
        ctx.beginPath();
        ctx.moveTo(px + t * 0.2, py + t * 0.7);
        ctx.lineTo(px + t * 0.5, py + t * 0.3);
        ctx.lineTo(px + t * 0.8, py + t * 0.7);
        ctx.stroke();
        break;
      }
      case "peak": {
        ctx.fillStyle = "#5a5866";
        ctx.beginPath();
        ctx.moveTo(px + t * 0.5, py + t * 0.15);
        ctx.lineTo(px + t * 0.88, py + t * 0.85);
        ctx.lineTo(px + t * 0.12, py + t * 0.85);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(px + t * 0.5, py + t * 0.15);
        ctx.lineTo(px + t * 0.68, py + t * 0.5);
        ctx.lineTo(px + t * 0.32, py + t * 0.5);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "meadow": {
        if (r > 0.6) {
          ctx.strokeStyle = "rgba(40,90,30,0.5)";
          ctx.lineWidth = Math.max(1, t * 0.05);
          ctx.beginPath();
          ctx.moveTo(px + t * (0.3 + r2 * 0.4), py + t * 0.7);
          ctx.lineTo(px + t * (0.3 + r2 * 0.4), py + t * 0.45);
          ctx.stroke();
        }
        break;
      }
      default:
        break;
    }
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, t - 1, t - 1);
  }

  private drawVillage(x: number, y: number, letter: string): void {
    const { ctx } = this;
    const t = this.tile;
    const px = this.ox + x * t;
    const py = this.oy + y * t;
    ctx.fillStyle = "#7a4b1e";
    ctx.fillRect(px + t * 0.2, py + t * 0.45, t * 0.6, t * 0.4);
    ctx.fillStyle = "#c0392b";
    ctx.beginPath();
    ctx.moveTo(px + t * 0.1, py + t * 0.5);
    ctx.lineTo(px + t * 0.5, py + t * 0.12);
    ctx.lineTo(px + t * 0.9, py + t * 0.5);
    ctx.closePath();
    ctx.fill();
    this.label(letter, px + t / 2, py + t * 0.72, "#fff", t * 0.42);
  }

  private drawCheckpoint(p: Point, id: number, taken: boolean): void {
    const { ctx } = this;
    const t = this.tile;
    const px = this.ox + p.x * t;
    const py = this.oy + p.y * t;
    ctx.save();
    if (taken) ctx.globalAlpha = 0.55;
    const s = t * 0.7;
    const x0 = px + (t - s) / 2;
    const y0 = py + (t - s) / 2;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x0, y0, s, s);
    ctx.fillStyle = "#e0341c";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + s, y0);
    ctx.lineTo(x0, y0 + s);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, s - 1, s - 1);
    this.label(String(id), px + t / 2, py + t / 2 + t * 0.02, "#111", t * 0.5);
    if (taken) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#7bed9f";
      ctx.lineWidth = Math.max(1.5, t * 0.12);
      ctx.beginPath();
      ctx.moveTo(px + t * 0.25, py + t * 0.55);
      ctx.lineTo(px + t * 0.45, py + t * 0.75);
      ctx.lineTo(px + t * 0.8, py + t * 0.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawGroup(x: number, y: number, count: number, now: number): void {
    const { ctx } = this;
    const t = this.tile;
    const cx = this.ox + x * t + t / 2;
    const cy = this.oy + y * t + t / 2;
    const pulse = this.reduced ? 0 : (Math.sin(now / 400) + 1) / 2;
    ctx.save();
    ctx.strokeStyle = `rgba(255,211,42,${0.35 + pulse * 0.3})`;
    ctx.lineWidth = Math.max(1, t * 0.08);
    ctx.beginPath();
    ctx.arc(cx, cy, t * (0.55 + pulse * 0.12), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ff7f2a";
    ctx.beginPath();
    ctx.arc(cx, cy, t * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    this.label(String(count), cx, cy + t * 0.02, "#1a1a1a", t * 0.42);
    ctx.restore();
  }

  private drawWeather(game: Game, now: number): void {
    const { ctx, canvas } = this;
    const w = game.state.weather;
    if (w === "clear") return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.save();
    if (w === "cloudy") {
      ctx.fillStyle = "rgba(20,25,40,0.12)";
      ctx.fillRect(0, 0, W, H);
    } else if (w === "rain" || w === "storm") {
      ctx.fillStyle = w === "storm" ? "rgba(10,12,25,0.35)" : "rgba(20,25,45,0.2)";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(180,200,255,0.5)";
      ctx.lineWidth = 1;
      const speed = this.reduced ? 0 : now / (w === "storm" ? 500 : 900);
      for (const p of this.particles) {
        const y = ((p.y + speed * p.v) % 1) * H;
        const x = ((p.x - speed * 0.15 * p.v + 10) % 1) * W;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 3, y + 10);
        ctx.stroke();
      }
    } else if (w === "snow") {
      ctx.fillStyle = "rgba(220,230,255,0.12)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      const speed = this.reduced ? 0 : now / 3000;
      for (const p of this.particles) {
        const y = ((p.y + speed * p.v) % 1) * H;
        const x = ((p.x + Math.sin(now / 900 + p.y * 10) * 0.01 + 10) % 1) * W;
        ctx.beginPath();
        ctx.arc(x, y, 1.5 + p.v, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    void WEATHER;
  }

  private label(text: string, x: number, y: number, color: string, size = this.tile * 0.5): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = `bold ${Math.max(8, size)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    if (color !== "#111" && color !== "#1a1a1a") ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}

export function terrainName(t: Terrain): string {
  return TERRAIN[t].name;
}

export function pointEq(a: Point | null, b: Point | null): boolean {
  return !!a && !!b && samePoint(a, b);
}

function fmt(h: number): string {
  return Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Lightens (positive) or darkens (negative) a hex colour. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

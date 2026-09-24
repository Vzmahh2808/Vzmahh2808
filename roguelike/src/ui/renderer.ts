import { itemDef, monsterDef } from "../game/data";
import { idx, inBounds } from "../game/dungeon";
import type { Game } from "../game/game";
import { PLAYER_ID, Tile, type FloatingText, type GameEvent, type Point } from "../game/types";

const COLORS = {
  wallLit: "#3b4260",
  wallDim: "#1f2333",
  floorLit: "#3a3f52",
  floorDim: "#20242f",
  floorDot: "#5b6280",
  door: "#c08a4b",
  stairs: "#ffd32a",
  player: "#fff3b0",
  path: "rgba(255, 211, 42, 0.35)",
  hover: "rgba(255, 255, 255, 0.12)",
};

const MOVE_MS = 90;
const BUMP_MS = 140;
const FLASH_MS = 160;

interface MoveAnim { from: Point; to: Point; start: number }
interface BumpAnim { dir: Point; start: number }
interface Ring { x: number; y: number; start: number; dur: number; color: string; maxR: number }
interface Ghost { x: number; y: number; glyph: string; color: string; start: number }
interface Fade { start: number; dur: number; color: string; peak: number; hold: boolean }

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private tile = 26;
  private floats: FloatingText[] = [];
  private moves = new Map<number, MoveAnim>();
  private bumps = new Map<number, BumpAnim>();
  private flashes = new Map<number, number>();
  private rings: Ring[] = [];
  private ghosts: Ghost[] = [];
  private fade: Fade | null = null;
  private shake: { start: number; dur: number; mag: number } | null = null;
  private lastFrame = 0;
  private now = 0;
  private reducedMotion = false;
  hover: Point | null = null;
  path: Point[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
    try {
      this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      this.reducedMotion = false;
    }
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = Math.max(15, Math.floor(rect.width / 26));
    this.tile = Math.max(16, Math.min(30, Math.floor(rect.width / cols)));
  }

  // ---------------------------------------------------------------- animation intake

  addFloat(x: number, y: number, text: string, color: string): void {
    this.floats.push({ x, y, text, color, ttl: 1 });
  }

  /** Forget per-entity animation state (new level, new game). */
  reset(): void {
    this.moves.clear();
    this.bumps.clear();
    this.flashes.clear();
    this.rings = [];
    this.ghosts = [];
    this.floats = [];
    this.path = [];
  }

  handle(ev: GameEvent): void {
    const now = performance.now();
    const quick = this.reducedMotion;
    switch (ev.type) {
      case "float":
        this.addFloat(ev.x, ev.y, ev.text, ev.color);
        break;
      case "move":
        if (!quick) this.moves.set(ev.id, { from: ev.from, to: ev.to, start: now });
        break;
      case "attack":
        if (!quick) this.bumps.set(ev.id, { dir: { x: Math.sign(ev.to.x - ev.from.x), y: Math.sign(ev.to.y - ev.from.y) }, start: now });
        break;
      case "damage":
        this.flashes.set(ev.id, now);
        if (ev.player && !quick) this.shake = { start: now, dur: 220, mag: Math.min(8, 2 + ev.amount * 0.6) };
        if (ev.player) this.fade = { start: now, dur: 260, color: "255, 60, 80", peak: Math.min(0.35, 0.1 + ev.amount * 0.02), hold: false };
        break;
      case "monsterDeath":
        this.ghosts.push({ x: ev.x, y: ev.y, glyph: ev.glyph, color: ev.color, start: now });
        break;
      case "fire":
        for (const t of ev.targets) this.rings.push({ x: t.x, y: t.y, start: now, dur: 450, color: "255, 127, 80", maxR: 1.1 });
        this.fade = { start: now, dur: 380, color: "255, 140, 40", peak: 0.28, hold: false };
        if (!quick) this.shake = { start: now, dur: 300, mag: 5 };
        break;
      case "teleport":
        this.rings.push({ x: ev.from.x, y: ev.from.y, start: now, dur: 400, color: "223, 249, 251", maxR: 1.4 });
        this.rings.push({ x: ev.to.x, y: ev.to.y, start: now + 120, dur: 500, color: "223, 249, 251", maxR: 1.4 });
        this.fade = { start: now, dur: 420, color: "200, 230, 255", peak: 0.5, hold: false };
        break;
      case "scroll":
        if (ev.effect === "mapping") this.fade = { start: now, dur: 600, color: "246, 229, 141", peak: 0.35, hold: false };
        break;
      case "potion":
        this.rings.push({ x: -1, y: -1, start: now, dur: 500, color: "123, 237, 159", maxR: 1.0 });
        break;
      case "levelup":
        for (let i = 0; i < 3; i++) this.rings.push({ x: -1, y: -1, start: now + i * 140, dur: 700, color: "255, 211, 42", maxR: 2.2 });
        break;
      case "descend":
        this.reset();
        this.fade = { start: now, dur: 700, color: "0, 0, 0", peak: 1, hold: false };
        break;
      case "death":
        this.fade = { start: now, dur: 1400, color: "120, 0, 20", peak: 0.75, hold: true };
        if (!quick) this.shake = { start: now, dur: 500, mag: 10 };
        break;
      case "win":
        this.fade = { start: now, dur: 1400, color: "255, 211, 42", peak: 0.6, hold: true };
        for (let i = 0; i < 5; i++) this.rings.push({ x: -1, y: -1, start: now + i * 160, dur: 900, color: "255, 211, 42", maxR: 3 });
        break;
      default:
        break;
    }
  }

  get hasAnimations(): boolean {
    return (
      this.floats.length > 0 ||
      this.moves.size > 0 ||
      this.bumps.size > 0 ||
      this.flashes.size > 0 ||
      this.rings.length > 0 ||
      this.ghosts.length > 0 ||
      this.fade !== null ||
      this.shake !== null
    );
  }

  // ---------------------------------------------------------------- geometry

  /** Where an entity is drawn this frame, accounting for slide and bump animations. */
  private visualPos(id: number, logical: Point): Point {
    let x = logical.x;
    let y = logical.y;
    const mv = this.moves.get(id);
    if (mv) {
      const t = (this.now - mv.start) / MOVE_MS;
      if (t >= 1) this.moves.delete(id);
      else {
        const k = easeOut(Math.max(0, t));
        x = mv.from.x + (mv.to.x - mv.from.x) * k;
        y = mv.from.y + (mv.to.y - mv.from.y) * k;
      }
    }
    const b = this.bumps.get(id);
    if (b) {
      const t = (this.now - b.start) / BUMP_MS;
      if (t >= 1) this.bumps.delete(id);
      else {
        const k = Math.sin(Math.PI * t) * 0.38;
        x += b.dir.x * k;
        y += b.dir.y * k;
      }
    }
    return { x, y };
  }

  private flashAlpha(id: number): number {
    const s = this.flashes.get(id);
    if (s === undefined) return 0;
    const t = (this.now - s) / FLASH_MS;
    if (t >= 1) {
      this.flashes.delete(id);
      return 0;
    }
    return 1 - t;
  }

  private camera(game: Game): Point {
    const rect = this.canvas.getBoundingClientRect();
    const cols = rect.width / this.tile;
    const rows = rect.height / this.tile;
    const map = game.state.map;
    const pv = this.visualPos(PLAYER_ID, game.player);
    let cx = pv.x - cols / 2 + 0.5;
    let cy = pv.y - rows / 2 + 0.5;
    cx = Math.max(0, Math.min(map.width - cols, cx));
    cy = Math.max(0, Math.min(map.height - rows, cy));
    if (cols > map.width) cx = (map.width - cols) / 2;
    if (rows > map.height) cy = (map.height - rows) / 2;
    return { x: cx, y: cy };
  }

  tileAtPixel(game: Game, px: number, py: number): Point {
    this.now = performance.now();
    const cam = this.camera(game);
    return { x: Math.floor(px / this.tile + cam.x), y: Math.floor(py / this.tile + cam.y) };
  }

  // ---------------------------------------------------------------- drawing

  draw(game: Game, now: number): void {
    this.now = now;
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const t = this.tile;
    const map = game.state.map;
    const p = game.player;
    const pv = this.visualPos(PLAYER_ID, p);
    const cam = this.camera(game);

    ctx.save();
    ctx.fillStyle = "#090b11";
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (this.shake) {
      const k = (now - this.shake.start) / this.shake.dur;
      if (k >= 1) this.shake = null;
      else {
        const m = this.shake.mag * (1 - k);
        ctx.translate((Math.random() - 0.5) * 2 * m, (Math.random() - 0.5) * 2 * m);
      }
    }

    ctx.font = `${Math.floor(t * 0.8)}px "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const x0 = Math.floor(cam.x) - 1;
    const y0 = Math.floor(cam.y) - 1;
    const x1 = Math.ceil(cam.x + rect.width / t) + 1;
    const y1 = Math.ceil(cam.y + rect.height / t) + 1;
    const sx = (x: number) => (x - cam.x) * t;
    const sy = (y: number) => (y - cam.y) * t;
    const flicker = 0.96 + 0.04 * Math.sin(now / 90) * Math.sin(now / 37);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inBounds(map, x, y)) continue;
        const i = idx(map, x, y);
        if (!map.explored[i]) continue;
        const vis = game.visible[i];
        const tile = map.tiles[i];
        const px = sx(x);
        const py = sy(y);
        const d = Math.hypot(x - pv.x, y - pv.y);
        const light = vis ? Math.max(0.55, 1 - d / 14) * flicker : 1;

        if (tile === Tile.Wall) {
          ctx.fillStyle = vis ? COLORS.wallLit : COLORS.wallDim;
          ctx.globalAlpha = light;
          ctx.fillRect(px, py, t + 0.5, t + 0.5);
          ctx.globalAlpha = 1;
          continue;
        }
        ctx.fillStyle = vis ? COLORS.floorLit : COLORS.floorDim;
        ctx.globalAlpha = light;
        ctx.fillRect(px, py, t + 0.5, t + 0.5);
        ctx.globalAlpha = 1;
        if (tile === Tile.Floor) {
          ctx.fillStyle = vis ? COLORS.floorDot : "#2b3040";
          ctx.fillRect(px + t / 2 - 1, py + t / 2 - 1, 2, 2);
        } else if (tile === Tile.Door) {
          ctx.fillStyle = vis ? COLORS.door : "#6b4d2b";
          ctx.fillText("+", px + t / 2, py + t / 2 + 1);
        } else if (tile === Tile.StairsDown) {
          ctx.fillStyle = vis ? COLORS.stairs : "#8a7420";
          ctx.fillText(">", px + t / 2, py + t / 2 + 1);
        }
      }
    }

    for (const step of this.path) {
      ctx.fillStyle = COLORS.path;
      ctx.beginPath();
      ctx.arc(sx(step.x) + t / 2, sy(step.y) + t / 2, t * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const g of game.state.items) {
      const i = idx(map, g.x, g.y);
      if (!map.explored[i]) continue;
      const def = itemDef(g.item.defId);
      const bob = def.kind === "amulet" ? Math.sin(now / 250) * t * 0.08 : 0;
      ctx.globalAlpha = game.visible[i] ? 1 : 0.45;
      ctx.fillStyle = def.color;
      ctx.fillText(def.glyph, sx(g.x) + t / 2, sy(g.y) + t / 2 + 1 + bob);
      ctx.globalAlpha = 1;
    }

    // Dying monsters fade out and shrink.
    this.ghosts = this.ghosts.filter((gh) => now - gh.start < 380);
    for (const gh of this.ghosts) {
      const k = (now - gh.start) / 380;
      ctx.globalAlpha = 1 - k;
      ctx.font = `${Math.floor(t * 0.8 * (1 - k * 0.6))}px "JetBrains Mono", Menlo, Consolas, monospace`;
      ctx.fillStyle = gh.color;
      ctx.fillText(gh.glyph, sx(gh.x) + t / 2, sy(gh.y) + t / 2 + 1 - k * t * 0.3);
    }
    ctx.globalAlpha = 1;
    ctx.font = `${Math.floor(t * 0.8)}px "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace`;

    for (const m of game.state.monsters) {
      const mv = this.moves.get(m.id);
      const visibleNow = game.isVisible(m.x, m.y) || (mv !== undefined && game.isVisible(mv.from.x, mv.from.y));
      if (!visibleNow) continue;
      const def = monsterDef(m.defId);
      const v = this.visualPos(m.id, m);
      const px = sx(v.x);
      const py = sy(v.y);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(px + 2, py + 2, t - 4, t - 4);
      ctx.fillStyle = def.color;
      ctx.fillText(def.glyph, px + t / 2, py + t / 2 + 1);
      const fl = this.flashAlpha(m.id);
      if (fl > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${fl * 0.85})`;
        ctx.fillText(def.glyph, px + t / 2, py + t / 2 + 1);
      }
      if (m.hp < m.maxHp) {
        const w = t - 6;
        ctx.fillStyle = "#3a0d14";
        ctx.fillRect(px + 3, py + t - 4, w, 2);
        ctx.fillStyle = "#ff4d6d";
        ctx.fillRect(px + 3, py + t - 4, Math.max(1, (w * m.hp) / m.maxHp), 2);
      }
    }

    // Rings (spells, level up, potions). x = -1 means "on the player".
    this.rings = this.rings.filter((r) => now - r.start < r.dur);
    for (const r of this.rings) {
      if (now < r.start) continue;
      const k = (now - r.start) / r.dur;
      const cx = (r.x < 0 ? pv.x : r.x) + 0.5;
      const cy = (r.y < 0 ? pv.y : r.y) + 0.5;
      ctx.strokeStyle = `rgba(${r.color}, ${1 - k})`;
      ctx.lineWidth = Math.max(1, 3 * (1 - k));
      ctx.beginPath();
      ctx.arc(sx(cx), sy(cy), t * (0.2 + r.maxR * easeOut(k)), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Player.
    ctx.fillStyle = "rgba(255, 243, 176, 0.12)";
    ctx.fillRect(sx(pv.x), sy(pv.y), t, t);
    ctx.fillStyle = p.poison > 0 ? "#7bed9f" : COLORS.player;
    ctx.fillText("@", sx(pv.x) + t / 2, sy(pv.y) + t / 2 + 1);
    const pfl = this.flashAlpha(PLAYER_ID);
    if (pfl > 0) {
      ctx.fillStyle = `rgba(255, 80, 100, ${pfl})`;
      ctx.fillText("@", sx(pv.x) + t / 2, sy(pv.y) + t / 2 + 1);
    }

    if (this.hover && inBounds(map, this.hover.x, this.hover.y) && map.explored[idx(map, this.hover.x, this.hover.y)]) {
      ctx.fillStyle = COLORS.hover;
      ctx.fillRect(sx(this.hover.x), sy(this.hover.y), t, t);
    }

    // Floating combat text.
    ctx.font = `bold ${Math.floor(t * 0.55)}px "JetBrains Mono", Menlo, Consolas, monospace`;
    for (const f of this.floats) {
      f.ttl -= dt * 1.4;
      const rise = (1 - f.ttl) * t * 0.9;
      ctx.globalAlpha = Math.max(0, Math.min(1, f.ttl * 1.5));
      ctx.fillStyle = "#000";
      ctx.fillText(f.text, sx(f.x) + t / 2 + 1, sy(f.y) + t * 0.2 - rise + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, sx(f.x) + t / 2, sy(f.y) + t * 0.2 - rise);
    }
    ctx.globalAlpha = 1;
    this.floats = this.floats.filter((f) => f.ttl > 0);
    ctx.restore();

    // Full-screen fades: flash in quickly, then decay (or hold for death/win).
    if (this.fade) {
      const k = (now - this.fade.start) / this.fade.dur;
      let a: number;
      if (k < 0.15) a = (k / 0.15) * this.fade.peak;
      else if (this.fade.hold) a = this.fade.peak * Math.min(1, 0.6 + k * 0.4);
      else a = this.fade.peak * Math.max(0, 1 - (k - 0.15) / 0.85);
      if (k >= 1 && !this.fade.hold) this.fade = null;
      if (this.fade) {
        ctx.fillStyle = `rgba(${this.fade.color}, ${Math.min(1, a)})`;
        ctx.fillRect(0, 0, rect.width, rect.height);
      }
    }
  }

  clearFade(): void {
    this.fade = null;
    this.shake = null;
  }
}

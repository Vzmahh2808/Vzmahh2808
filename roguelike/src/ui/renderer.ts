import { itemDef, monsterDef } from "../game/data";
import { idx, inBounds } from "../game/dungeon";
import type { Game } from "../game/game";
import { Tile, type FloatingText, type Point } from "../game/types";

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

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private tile = 26;
  private floats: FloatingText[] = [];
  private lastFrame = 0;
  hover: Point | null = null;
  path: Point[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
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

  addFloat(x: number, y: number, text: string, color: string): void {
    this.floats.push({ x, y, text, color, ttl: 1 });
  }

  /** Top-left tile of the viewport, keeping the player centred and the camera inside the map. */
  private camera(game: Game): Point {
    const rect = this.canvas.getBoundingClientRect();
    const cols = rect.width / this.tile;
    const rows = rect.height / this.tile;
    const map = game.state.map;
    let cx = game.player.x - cols / 2 + 0.5;
    let cy = game.player.y - rows / 2 + 0.5;
    cx = Math.max(0, Math.min(map.width - cols, cx));
    cy = Math.max(0, Math.min(map.height - rows, cy));
    if (cols > map.width) cx = (map.width - cols) / 2;
    if (rows > map.height) cy = (map.height - rows) / 2;
    return { x: cx, y: cy };
  }

  /** Convert a pointer position (CSS pixels relative to the canvas) into a map tile. */
  tileAtPixel(game: Game, px: number, py: number): Point {
    const cam = this.camera(game);
    return { x: Math.floor(px / this.tile + cam.x), y: Math.floor(py / this.tile + cam.y) };
  }

  draw(game: Game, now: number): void {
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const t = this.tile;
    const cam = this.camera(game);
    const map = game.state.map;
    const p = game.player;

    ctx.fillStyle = "#090b11";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.font = `${Math.floor(t * 0.8)}px "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const x0 = Math.floor(cam.x);
    const y0 = Math.floor(cam.y);
    const x1 = Math.ceil(cam.x + rect.width / t);
    const y1 = Math.ceil(cam.y + rect.height / t);
    const sx = (x: number) => (x - cam.x) * t;
    const sy = (y: number) => (y - cam.y) * t;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inBounds(map, x, y)) continue;
        const i = idx(map, x, y);
        if (!map.explored[i]) continue;
        const vis = game.visible[i];
        const tile = map.tiles[i];
        const px = sx(x);
        const py = sy(y);
        const d = Math.hypot(x - p.x, y - p.y);
        const light = vis ? Math.max(0.55, 1 - d / 14) : 1;

        if (tile === Tile.Wall) {
          ctx.fillStyle = vis ? COLORS.wallLit : COLORS.wallDim;
          ctx.globalAlpha = light;
          ctx.fillRect(px, py, t, t);
          ctx.globalAlpha = 1;
          continue;
        }
        ctx.fillStyle = vis ? COLORS.floorLit : COLORS.floorDim;
        ctx.globalAlpha = light;
        ctx.fillRect(px, py, t, t);
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
      ctx.globalAlpha = game.visible[i] ? 1 : 0.45;
      ctx.fillStyle = def.color;
      ctx.fillText(def.glyph, sx(g.x) + t / 2, sy(g.y) + t / 2 + 1);
      ctx.globalAlpha = 1;
    }

    for (const m of game.state.monsters) {
      if (!game.isVisible(m.x, m.y)) continue;
      const def = monsterDef(m.defId);
      const px = sx(m.x);
      const py = sy(m.y);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(px + 2, py + 2, t - 4, t - 4);
      ctx.fillStyle = def.color;
      ctx.fillText(def.glyph, px + t / 2, py + t / 2 + 1);
      if (m.hp < m.maxHp) {
        const w = t - 6;
        ctx.fillStyle = "#3a0d14";
        ctx.fillRect(px + 3, py + t - 4, w, 2);
        ctx.fillStyle = "#ff4d6d";
        ctx.fillRect(px + 3, py + t - 4, Math.max(1, (w * m.hp) / m.maxHp), 2);
      }
    }

    // Player.
    ctx.fillStyle = "rgba(255, 243, 176, 0.12)";
    ctx.fillRect(sx(p.x), sy(p.y), t, t);
    ctx.fillStyle = p.poison > 0 ? "#7bed9f" : COLORS.player;
    ctx.fillText("@", sx(p.x) + t / 2, sy(p.y) + t / 2 + 1);

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
  }

  get hasAnimations(): boolean {
    return this.floats.length > 0;
  }
}

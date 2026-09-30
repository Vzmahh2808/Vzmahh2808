/** The rink, stands and markings drawn once into an offscreen canvas. */
import { Rng } from "../core/rng";
import { BLUE_X, CORNER, CREASE_R, DOT_X, DOT_Y, GOAL_DEPTH, GOAL_HALF, GOAL_LINE_X, HX, HY, rinkSdf } from "../sim/rink";

/** World rectangle covered by the cache, in metres. */
export const CACHE_HX = HX + 6;
export const CACHE_HY = HY + 6;

function boardsPath(ctx: CanvasRenderingContext2D, grow: number): void {
  const hx = HX + grow;
  const hy = HY + grow;
  const r = CORNER + grow;
  ctx.beginPath();
  ctx.moveTo(-hx + r, -hy);
  ctx.lineTo(hx - r, -hy);
  ctx.arc(hx - r, -hy + r, r, -Math.PI / 2, 0);
  ctx.lineTo(hx, hy - r);
  ctx.arc(hx - r, hy - r, r, 0, Math.PI / 2);
  ctx.lineTo(-hx + r, hy);
  ctx.arc(-hx + r, hy - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(-hx, -hy + r);
  ctx.arc(-hx + r, -hy + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

function faceoffCircle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.strokeStyle = "#c8323c";
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#c8323c";
  ctx.beginPath();
  ctx.arc(x, y, 0.3, 0, Math.PI * 2);
  ctx.fill();
  // Hash marks.
  ctx.lineWidth = 0.08;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + sx * 0.9, y + sy * 4.5);
      ctx.lineTo(x + sx * 0.9, y + sy * 5.3);
      ctx.moveTo(x + sx * 4.5, y + sy * 0.9);
      ctx.lineTo(x + sx * 5.3, y + sy * 0.9);
      ctx.stroke();
    }
  }
}

function crease(ctx: CanvasRenderingContext2D, side: 1 | -1): void {
  const lx = side * GOAL_LINE_X;
  ctx.fillStyle = "rgba(120,190,235,0.55)";
  ctx.strokeStyle = "#c8323c";
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  // A half circle opening toward the rink centre.
  const a0 = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  ctx.arc(lx, 0, CREASE_R, a0, a0 + Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function net(ctx: CanvasRenderingContext2D, side: 1 | -1): void {
  const lx = side * GOAL_LINE_X;
  const bx = lx + side * GOAL_DEPTH;
  const x0 = Math.min(lx, bx);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(x0, -GOAL_HALF, GOAL_DEPTH, GOAL_HALF * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 0.03;
  for (let i = 1; i < 6; i++) {
    const t = -GOAL_HALF + (GOAL_HALF * 2 * i) / 6;
    ctx.beginPath();
    ctx.moveTo(x0, t);
    ctx.lineTo(x0 + GOAL_DEPTH, t);
    ctx.stroke();
  }
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x0 + (GOAL_DEPTH * i) / 4, -GOAL_HALF);
    ctx.lineTo(x0 + (GOAL_DEPTH * i) / 4, GOAL_HALF);
    ctx.stroke();
  }
  ctx.strokeStyle = "#d9232e";
  ctx.lineWidth = 0.09;
  ctx.strokeRect(x0, -GOAL_HALF, GOAL_DEPTH, GOAL_HALF * 2);
}

/**
 * Draw the whole rink. `ppm` is pixels per metre; the returned canvas covers
 * [-CACHE_HX, CACHE_HX] x [-CACHE_HY, CACHE_HY].
 */
export function buildRinkCache(ppm: number, palette: string[]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(CACHE_HX * 2 * ppm);
  canvas.height = Math.round(CACHE_HY * 2 * ppm);
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(ppm, ppm);

  // Stands.
  ctx.fillStyle = "#121722";
  ctx.fillRect(-CACHE_HX, -CACHE_HY, CACHE_HX * 2, CACHE_HY * 2);
  const rng = new Rng(4242);
  const cols = palette.length ? palette : ["#c8323c", "#f2f4f8", "#2d5fa8"];
  for (let y = -CACHE_HY + 0.3; y < CACHE_HY; y += 0.52) {
    for (let x = -CACHE_HX + 0.3; x < CACHE_HX; x += 0.52) {
      const d = rinkSdf(x, y);
      if (d < 1.4) continue;
      const row = Math.floor((d - 1.4) / 0.9);
      const fade = Math.max(0.25, 1 - row * 0.09);
      const c = rng.next() < 0.55 ? "#3a4256" : rng.pick(cols);
      ctx.globalAlpha = fade * (0.55 + rng.next() * 0.4);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x + (rng.next() - 0.5) * 0.12, y + (rng.next() - 0.5) * 0.12, 0.2 + rng.next() * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  // Boards: dark outer rim, white band, kick plate.
  boardsPath(ctx, 1.05);
  ctx.fillStyle = "#1d2433";
  ctx.fill();
  boardsPath(ctx, 0.62);
  ctx.fillStyle = "#e6ecf4";
  ctx.fill();
  boardsPath(ctx, 0.12);
  ctx.fillStyle = "#c9a227";
  ctx.fill();

  // Ice.
  boardsPath(ctx, 0);
  const ice = ctx.createLinearGradient(0, -HY, 0, HY);
  ice.addColorStop(0, "#e4f0f8");
  ice.addColorStop(0.5, "#eef6fb");
  ice.addColorStop(1, "#dcebf5");
  ctx.fillStyle = ice;
  ctx.fill();
  ctx.save();
  boardsPath(ctx, 0);
  ctx.clip();
  // Scratches and resurfacer streaks.
  ctx.strokeStyle = "rgba(160,190,215,0.16)";
  ctx.lineWidth = 0.05;
  for (let i = 0; i < 90; i++) {
    const cx = (rng.next() - 0.5) * 60;
    const cy = (rng.next() - 0.5) * 26;
    const rr = 2 + rng.next() * 9;
    const a = rng.next() * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, a, a + 0.5 + rng.next() * 1.2);
    ctx.stroke();
  }

  // Centre red line (dashed white through it), blue lines, goal lines.
  ctx.fillStyle = "#c8323c";
  ctx.fillRect(-0.15, -HY, 0.3, HY * 2);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  for (let y = -HY + 0.4; y < HY; y += 1.2) ctx.fillRect(-0.15, y, 0.3, 0.55);
  ctx.fillStyle = "#2c63b8";
  ctx.fillRect(-BLUE_X - 0.15, -HY, 0.3, HY * 2);
  ctx.fillRect(BLUE_X - 0.15, -HY, 0.3, HY * 2);
  ctx.fillStyle = "#c8323c";
  ctx.fillRect(-GOAL_LINE_X - 0.04, -HY, 0.08, HY * 2);
  ctx.fillRect(GOAL_LINE_X - 0.04, -HY, 0.08, HY * 2);

  // Centre circle and league mark.
  ctx.strokeStyle = "#2c63b8";
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(44,99,184,0.13)";
  ctx.beginPath();
  ctx.arc(0, 0, 4.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2c63b8";
  ctx.beginPath();
  ctx.arc(0, 0, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.fillStyle = "rgba(44,99,184,0.7)";
  ctx.font = "bold 1.5px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("ЕВРАЗИЙСКАЯ", 0, -1.3);
  ctx.fillText("ЛИГА", 0, 0.5);
  ctx.restore();

  for (const sx of [-1, 1]) for (const sy of [-1, 1]) faceoffCircle(ctx, sx * DOT_X, sy * DOT_Y);
  ctx.fillStyle = "#c8323c";
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * (BLUE_X - 1.5), sy * DOT_Y, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Goalie trapezoid behind the net.
  ctx.strokeStyle = "#c8323c";
  ctx.lineWidth = 0.06;
  for (const s of [-1, 1] as const) {
    for (const sy of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * GOAL_LINE_X, sy * 3.4);
      ctx.lineTo(s * HX, sy * 4.3);
      ctx.stroke();
    }
    crease(ctx, s);
  }
  ctx.restore();
  net(ctx, 1);
  net(ctx, -1);
  return canvas;
}

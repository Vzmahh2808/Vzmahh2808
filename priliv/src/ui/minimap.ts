import { PITCH, ROAD_WIDTH, roadCoord, type CityLayout } from "../world/city";

const SCALE = 0.6; // px per metre

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private size: number;

  constructor(canvas: HTMLCanvasElement, layout: CityLayout) {
    this.size = canvas.width;
    this.ctx = canvas.getContext("2d")!;
    const extent = layout.half + ROAD_WIDTH / 2 + 40;
    const px = Math.ceil(extent * 2 * SCALE);
    this.base = document.createElement("canvas");
    this.base.width = this.base.height = px;
    const g = this.base.getContext("2d")!;
    g.fillStyle = "#3f6a33";
    g.fillRect(0, 0, px, px);
    const toPx = (v: number) => (v + extent) * SCALE;
    g.fillStyle = "#2a2d33";
    for (let i = 0; i <= layout.n; i++) {
      const c = roadCoord(layout.n, i);
      g.fillRect(toPx(-layout.half - ROAD_WIDTH / 2), toPx(c - ROAD_WIDTH / 2), (layout.half * 2 + ROAD_WIDTH) * SCALE, ROAD_WIDTH * SCALE);
      g.fillRect(toPx(c - ROAD_WIDTH / 2), toPx(-layout.half - ROAD_WIDTH / 2), ROAD_WIDTH * SCALE, (layout.half * 2 + ROAD_WIDTH) * SCALE);
    }
    for (const b of layout.buildings) {
      g.fillStyle = b.kind === "tower" ? "#6d7f9c" : b.kind === "office" ? "#8e98a5" : "#a8927c";
      g.fillRect(toPx(b.x - b.w / 2), toPx(b.z - b.d / 2), b.w * SCALE, b.d * SCALE);
    }
    this.extent = extent;
    void PITCH;
  }

  private extent: number;

  draw(px: number, pz: number, heading: number, dots: Array<{ x: number; z: number; color: string }>): void {
    const ctx = this.ctx;
    const S = this.size;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    const cx = (px + this.extent) * SCALE;
    const cz = (pz + this.extent) * SCALE;
    ctx.drawImage(this.base, cx - S / 2, cz - S / 2, S, S, 0, 0, S, S);
    for (const d of dots) {
      const dx = (d.x - px) * SCALE + S / 2;
      const dz = (d.z - pz) * SCALE + S / 2;
      if (dx < 0 || dz < 0 || dx > S || dz > S) continue;
      ctx.fillStyle = d.color;
      ctx.fillRect(dx - 1.5, dz - 1.5, 3, 3);
    }
    // Player arrow.
    ctx.translate(S / 2, S / 2);
    ctx.rotate(heading);
    ctx.fillStyle = "#ffd32a";
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, 4);
    ctx.lineTo(-4, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

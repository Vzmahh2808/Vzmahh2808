import { PITCH, ROAD_WIDTH, roadCoord, type CityLayout } from "../world/city";
import { fitMap, insideMap, mapToWorld, worldToMap } from "./mapmath";

const SCALE = 0.6; // px per metre

export interface MapIcon {
  x: number;
  z: number;
  color: string;
  label: string;
  /** Shown beside the icon on the full map. */
  name?: string;
  clamp?: boolean;
}

/** A translucent ring on the map, such as the area the police are searching. */
export interface MapZone {
  x: number;
  z: number;
  /** Radius in metres. */
  r: number;
  color: string;
}

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private size: number;

  constructor(canvas: HTMLCanvasElement, layout: CityLayout, extras?: { maxX: number; land: Array<{ x0: number; x1: number; z0: number; z1: number }>; roads: Array<{ x0: number; x1: number; z0: number; z1: number }>; shoreX: number }) {
    this.size = canvas.width;
    this.ctx = canvas.getContext("2d")!;
    const extent = layout.half + ROAD_WIDTH / 2 + 40;
    const maxX = extras ? extras.maxX : extent;
    const pw = Math.ceil((extent + maxX) * SCALE);
    const ph = Math.ceil(extent * 2 * SCALE);
    this.base = document.createElement("canvas");
    this.base.width = pw;
    this.base.height = ph;
    const g = this.base.getContext("2d")!;
    const toX = (v: number) => (v + extent) * SCALE;
    const toZ = (v: number) => (v + extent) * SCALE;
    g.fillStyle = "#1d4660";
    g.fillRect(0, 0, pw, ph);
    g.fillStyle = "#3f6a33";
    g.fillRect(0, 0, toX(extras ? extras.shoreX : extent), ph);
    if (extras) {
      g.fillStyle = "#5c6168";
      for (const r of extras.land) g.fillRect(toX(r.x0), toZ(r.z0), (r.x1 - r.x0) * SCALE, (r.z1 - r.z0) * SCALE);
    }
    g.fillStyle = "#2a2d33";
    for (let i = 0; i <= layout.n; i++) {
      const c = roadCoord(layout.n, i);
      g.fillRect(toX(-layout.half - ROAD_WIDTH / 2), toZ(c - ROAD_WIDTH / 2), (layout.half * 2 + ROAD_WIDTH) * SCALE, ROAD_WIDTH * SCALE);
      g.fillRect(toX(c - ROAD_WIDTH / 2), toZ(-layout.half - ROAD_WIDTH / 2), ROAD_WIDTH * SCALE, (layout.half * 2 + ROAD_WIDTH) * SCALE);
    }
    if (extras) for (const r of extras.roads) g.fillRect(toX(r.x0), toZ(r.z0), (r.x1 - r.x0) * SCALE, (r.z1 - r.z0) * SCALE);
    for (const b of layout.buildings) {
      g.fillStyle = b.kind === "tower" ? "#6d7f9c" : b.kind === "office" ? "#8e98a5" : b.kind === "container" ? "#b0795a" : b.kind === "rail" ? "#9aa3ad" : "#a8927c";
      g.fillRect(toX(b.x - b.w / 2), toZ(b.z - b.d / 2), b.w * SCALE, b.d * SCALE);
    }
    this.extent = extent;
    void PITCH;
  }

  private extent: number;

  draw(
    px: number,
    pz: number,
    heading: number,
    dots: Array<{ x: number; z: number; color: string }>,
    icons: MapIcon[] = [],
    zones: MapZone[] = [],
  ): void {
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
    for (const z of zones) {
      ctx.beginPath();
      ctx.arc((z.x - px) * SCALE + S / 2, (z.z - pz) * SCALE + S / 2, z.r * SCALE, 0, Math.PI * 2);
      ctx.fillStyle = z.color + "33";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = z.color;
      ctx.stroke();
    }
    for (const d of dots) {
      const dx = (d.x - px) * SCALE + S / 2;
      const dz = (d.z - pz) * SCALE + S / 2;
      if (dx < 0 || dz < 0 || dx > S || dz > S) continue;
      ctx.fillStyle = d.color;
      ctx.fillRect(dx - 1.5, dz - 1.5, 3, 3);
    }
    for (const ic of icons) {
      let ix = (ic.x - px) * SCALE;
      let iz = (ic.z - pz) * SCALE;
      const r = Math.hypot(ix, iz);
      const lim = S / 2 - 12;
      if (r > lim) {
        if (!ic.clamp) continue;
        ix *= lim / r;
        iz *= lim / r;
      }
      ctx.beginPath();
      ctx.arc(S / 2 + ix, S / 2 + iz, 8, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(10,12,18,0.85)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = ic.color;
      ctx.stroke();
      ctx.fillStyle = ic.color;
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ic.label, S / 2 + ix, S / 2 + iz + 0.5);
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

  /** Fit for a screen canvas. */
  private fit(canvas: HTMLCanvasElement) {
    return fitMap(this.base.width, this.base.height, canvas.width, canvas.height);
  }

  /** World position under a point of the full map, or null if the point is off the map. */
  fullToWorld(canvas: HTMLCanvasElement, x: number, y: number): { x: number; z: number } | null {
    const t = this.fit(canvas);
    if (!insideMap(t, this.base.width, this.base.height, x, y)) return null;
    return mapToWorld(t, SCALE, this.extent, x, y);
  }

  /** The whole world on a big canvas, with named icons, zones and the waypoint. */
  drawFull(
    canvas: HTMLCanvasElement,
    px: number,
    pz: number,
    heading: number,
    dots: Array<{ x: number; z: number; color: string }>,
    icons: MapIcon[],
    zones: MapZone[],
    waypoint: { x: number; z: number } | null,
  ): void {
    const ctx = canvas.getContext("2d")!;
    const t = this.fit(canvas);
    const at = (x: number, z: number) => worldToMap(t, SCALE, this.extent, x, z);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.base, t.ox, t.oy, this.base.width * t.k, this.base.height * t.k);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(t.ox, t.oy, this.base.width * t.k, this.base.height * t.k);
    for (const z of zones) {
      const p = at(z.x, z.z);
      ctx.beginPath();
      ctx.arc(p.x, p.y, z.r * SCALE * t.k, 0, Math.PI * 2);
      ctx.fillStyle = z.color + "33";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = z.color;
      ctx.stroke();
    }
    for (const d of dots) {
      const p = at(d.x, d.z);
      ctx.fillStyle = d.color;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    const r = Math.max(9, 11 * Math.min(1.4, t.k * 1.6));
    ctx.font = `bold ${Math.round(r)}px system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    for (const ic of icons) {
      const p = at(ic.x, ic.z);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(10,12,18,0.9)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = ic.color;
      ctx.stroke();
      ctx.fillStyle = ic.color;
      ctx.textAlign = "center";
      ctx.fillText(ic.label, p.x, p.y + 0.5);
      if (ic.name) {
        ctx.font = `600 ${Math.round(r * 0.95)}px system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(10,12,18,0.9)";
        ctx.strokeText(ic.name, p.x + r + 4, p.y);
        ctx.fillStyle = "#eef1f6";
        ctx.fillText(ic.name, p.x + r + 4, p.y);
        ctx.font = `bold ${Math.round(r)}px system-ui, sans-serif`;
      }
    }
    if (waypoint) {
      const p = at(waypoint.x, waypoint.z);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.1, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,77,157,0.25)";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ff4d9d";
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r * 2.2);
      ctx.lineTo(p.x - r * 0.7, p.y - r * 1.2);
      ctx.lineTo(p.x + r * 0.7, p.y - r * 1.2);
      ctx.closePath();
      ctx.fillStyle = "#ff4d9d";
      ctx.fill();
    }
    const me = at(px, pz);
    ctx.save();
    ctx.translate(me.x, me.y);
    ctx.rotate(heading);
    ctx.fillStyle = "#ffd32a";
    ctx.strokeStyle = "#141826";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r * 1.1, 0);
    ctx.lineTo(-r * 0.8, r * 0.8);
    ctx.lineTo(-r * 0.8, -r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

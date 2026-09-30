/**
 * Coordinates of the full-screen map. The pre-rendered world image is fitted
 * into the screen canvas; these helpers convert between world metres and
 * screen pixels and back, so a tap on the map becomes a waypoint.
 */

export interface MapTransform {
  /** Screen pixels per image pixel. */
  k: number;
  /** Where the image starts on the screen. */
  ox: number;
  oy: number;
}

/** Fit an image of `iw` x `ih` into a canvas of `cw` x `ch`, centred, with a margin. */
export function fitMap(iw: number, ih: number, cw: number, ch: number, margin = 12): MapTransform {
  const k = Math.min((cw - margin * 2) / iw, (ch - margin * 2) / ih);
  return { k, ox: (cw - iw * k) / 2, oy: (ch - ih * k) / 2 };
}

/** World metres to screen pixels. `scale` is image pixels per metre and `extent` the world offset of the image. */
export function worldToMap(t: MapTransform, scale: number, extent: number, x: number, z: number): { x: number; y: number } {
  return { x: t.ox + (x + extent) * scale * t.k, y: t.oy + (z + extent) * scale * t.k };
}

/** Screen pixels to world metres; the inverse of worldToMap. */
export function mapToWorld(t: MapTransform, scale: number, extent: number, px: number, py: number): { x: number; z: number } {
  return { x: (px - t.ox) / (scale * t.k) - extent, z: (py - t.oy) / (scale * t.k) - extent };
}

/** Whether a screen point lies on the map image itself. */
export function insideMap(t: MapTransform, iw: number, ih: number, px: number, py: number): boolean {
  return px >= t.ox && py >= t.oy && px <= t.ox + iw * t.k && py <= t.oy + ih * t.k;
}

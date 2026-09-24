import type { TileMap } from "./types";
import { blocksSight, idx, inBounds } from "./dungeon";

/**
 * Recursive shadowcasting (Björn Bergström's algorithm). Returns a boolean grid of visible tiles
 * and marks them explored on the map.
 */
export function computeFov(map: TileMap, ox: number, oy: number, radius: number): boolean[] {
  const visible = new Array<boolean>(map.width * map.height).fill(false);
  const reveal = (x: number, y: number) => {
    if (!inBounds(map, x, y)) return;
    const i = idx(map, x, y);
    visible[i] = true;
    map.explored[i] = true;
  };
  reveal(ox, oy);

  const octants: Array<[number, number, number, number]> = [
    [1, 0, 0, 1],
    [0, 1, 1, 0],
    [0, -1, 1, 0],
    [-1, 0, 0, 1],
    [-1, 0, 0, -1],
    [0, -1, -1, 0],
    [0, 1, -1, 0],
    [1, 0, 0, -1],
  ];

  const cast = (
    row: number,
    startSlope: number,
    endSlope: number,
    xx: number,
    xy: number,
    yx: number,
    yy: number,
  ): void => {
    if (startSlope < endSlope) return;
    let nextStart = startSlope;
    for (let i = row; i <= radius; i++) {
      let blocked = false;
      for (let dx = -i, dy = -i; dx <= 0; dx++) {
        const lSlope = (dx - 0.5) / (dy + 0.5);
        const rSlope = (dx + 0.5) / (dy - 0.5);
        if (startSlope < rSlope) continue;
        if (endSlope > lSlope) break;

        const cx = ox + dx * xx + dy * xy;
        const cy = oy + dx * yx + dy * yy;
        const within = dx * dx + dy * dy <= radius * radius;
        if (within) reveal(cx, cy);

        const opaque = !inBounds(map, cx, cy) || blocksSight(map, cx, cy);
        if (blocked) {
          if (opaque) {
            nextStart = rSlope;
            continue;
          }
          blocked = false;
          startSlope = nextStart;
        } else if (opaque && i < radius) {
          blocked = true;
          cast(i + 1, startSlope, lSlope, xx, xy, yx, yy);
          nextStart = rSlope;
        }
      }
      if (blocked) break;
    }
  };

  for (const [xx, xy, yx, yy] of octants) cast(1, 1, 0, xx, xy, yx, yy);
  return visible;
}

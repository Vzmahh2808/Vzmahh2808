/**
 * Gang hideouts: side jobs for a player with a gun. Each is a street corner
 * held by a handful of armed thugs; clear them all for the reward. A hideout
 * is cleared for good once done.
 */
import { roadCoord } from "../world/city";
import type { Mission, Point, ThugSpec } from "./missions";

export interface Hideout {
  id: string;
  name: string;
  /** Marker where the job starts. */
  at: Point;
  thugs: ThugSpec[];
  reward: number;
}

/** Extra money for clearing every hideout. */
export const ALL_HIDEOUTS_BONUS = 3000;
/** Walk this far from a hideout and the job is off. */
export const HIDEOUT_AREA = 130;

function road(n: number, ix: number, iz: number, dx = 0, dz = 0): Point {
  return { x: roadCoord(n, ix) + dx, z: roadCoord(n, iz) + dz };
}

/** Thugs spread along a street from `a`, `step` metres apart, alternating kerbs and facing `heading`. */
function line(a: Point, along: "x" | "z", count: number, step: number, heading: number): ThugSpec[] {
  return Array.from({ length: count }, (_, i) => {
    const side = i % 2 === 0 ? -5 : 5;
    return along === "x" ? { x: a.x + i * step, z: a.z + side, heading } : { x: a.x + side, z: a.z + i * step, heading };
  });
}

export function hideouts(n: number): Hideout[] {
  return [
    {
      id: "yards",
      name: "Гаражи у путей",
      at: road(n, 1, 0, 8, 0),
      thugs: line(road(n, 1, 0, 44, 0), "x", 4, 9, Math.PI),
      reward: 1200,
    },
    {
      id: "market",
      name: "Пустырь у рынка",
      at: road(n, 0, 5, 0, 8),
      thugs: line(road(n, 0, 5, 0, 44), "z", 5, 7, -Math.PI / 2),
      reward: 1600,
    },
    {
      id: "brick",
      name: "Двор на Кирпичной",
      at: road(n, 6, 7, 8, 0),
      thugs: [...line(road(n, 6, 7, 44, 0), "x", 4, 9, Math.PI), { ...road(n, 7, 7, 0, -12), heading: Math.PI / 2 }, { ...road(n, 7, 7, 0, 12), heading: -Math.PI / 2 }],
      reward: 2000,
    },
  ];
}

export function hideoutMission(h: Hideout): Mission {
  const thugs = Object.fromEntries(h.thugs.map((t, i) => [`t${i + 1}`, t]));
  return {
    id: `hideout-${h.id}`,
    title: "Притон",
    brief: `${h.name}: остатки банды держат угол и стреляют без предупреждения. Уберите всех, ${h.thugs.length} человек. Уйдёте далеко, и дело сорвётся.`,
    reward: h.reward,
    thugs,
    area: { at: h.at, radius: HIDEOUT_AREA },
    steps: [{ kind: "clear", targets: Object.keys(thugs), text: `Уберите банду: ${h.name}` }],
  };
}

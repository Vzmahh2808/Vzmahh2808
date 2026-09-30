/**
 * Side jobs: stealing cars to order for the export dock, cargo runs by boat,
 * and a demolition derby. Pure logic, so lists, pay and routes are tested
 * without the game.
 */
import { PITCH, roadCoord } from "../world/city";
import type { Rng } from "../core/rng";
import type { Mission, Point, SpawnSpec } from "./missions";
import { pickPoint } from "./jobs";
import { REGATTA, WATER_NODES } from "../world/water";
import { SEA } from "./story";

// ---------------------------------------------------------------- export dock

/** What the dock pays for a car in perfect shape. */
export const EXPORT_PRICES: Record<string, number> = {
  sedan: 500,
  taxi: 550,
  van: 600,
  pickup: 700,
  bike: 650,
  sport: 1500,
  police: 2000,
};
export const EXPORT_NAMES: Record<string, string> = {
  sedan: "седан",
  taxi: "такси",
  van: "фургон",
  pickup: "пикап",
  bike: "мотоцикл",
  sport: "спорткар",
  police: "полицейская машина",
};
/** Cars wanted at a time, and the bonus for delivering the whole list. */
export const EXPORT_LIST_SIZE = 3;
export const EXPORT_BONUS = 1000;

export interface ExportState {
  wanted: string[];
  delivered: string[];
  /** Cars shipped over all lists. */
  total: number;
}

/** A fresh list of different cars to steal. */
export function exportList(rng: Rng): string[] {
  const pool = Object.keys(EXPORT_PRICES);
  const list: string[] = [];
  while (list.length < EXPORT_LIST_SIZE) {
    const k = rng.pick(pool);
    if (!list.includes(k)) list.push(k);
  }
  return list;
}

export function freshExport(rng: Rng): ExportState {
  return { wanted: exportList(rng), delivered: [], total: 0 };
}

/** Pay for a car: a wreck on its last legs still fetches 40% of the price. */
export function exportPay(kind: string, health: number): number {
  const price = EXPORT_PRICES[kind] ?? 0;
  const h = Math.max(0, Math.min(100, health)) / 100;
  return Math.round(price * (0.4 + 0.6 * h));
}

export type ExportResult =
  | { ok: false; reason: "unwanted" | "already" }
  | { ok: true; pay: number; bonus: number; listDone: boolean };

/** Hand a car over. Finishing the list pays the bonus and draws a new list. */
export function deliverExport(s: ExportState, kind: string, health: number, rng: Rng): ExportResult {
  if (!s.wanted.includes(kind)) return { ok: false, reason: "unwanted" };
  if (s.delivered.includes(kind)) return { ok: false, reason: "already" };
  s.delivered.push(kind);
  s.total++;
  const pay = exportPay(kind, health);
  const listDone = s.wanted.every((k) => s.delivered.includes(k));
  if (listDone) {
    s.wanted = exportList(rng);
    s.delivered = [];
  }
  return { ok: true, pay, bonus: listDone ? EXPORT_BONUS : 0, listDone };
}

/** Cars on the list still to bring. */
export function exportRemaining(s: ExportState): string[] {
  return s.wanted.filter((k) => !s.delivered.includes(k));
}

/** The export crane on the east quay. */
export function exportDock(n: number): Point {
  return { x: roadCoord(n, n), z: roadCoord(n, 5) + PITCH / 2 };
}

// ---------------------------------------------------------------- cargo by boat

/** Buoys and open-water spots where cargo is picked up and dropped. */
export const CARGO_POINTS: Point[] = [...REGATTA, ...WATER_NODES, ...SEA.crates, SEA.southBuoy, SEA.lighthouse];

/** One cargo run: pick up out on the water, deliver somewhere else, against the clock. */
export function makeBoatRun(rng: Rng, pool: Point[], from: Point): Mission {
  const pickup = pickPoint(rng, pool, from, 100, 350);
  const drop = pickPoint(rng, pool, pickup, 200, 520);
  const d1 = Math.hypot(pickup.x - from.x, pickup.z - from.z);
  const d2 = Math.hypot(drop.x - pickup.x, drop.z - pickup.z);
  return {
    id: "boat-cargo",
    title: "Груз по воде",
    brief: "Заберите ящики с буя и доставьте к точке сдачи до конца таймера.",
    reward: Math.round(200 + d2 * 1.1),
    time: Math.round((d1 + d2) / 11 + 45),
    steps: [
      { kind: "goto", at: pickup, radius: 14, vehicle: "boat", text: "Заберите груз у буя" },
      { kind: "goto", at: drop, radius: 14, vehicle: "boat", text: "Доставьте груз" },
    ],
  };
}

// ---------------------------------------------------------------- demolition derby

export const DERBY_REWARD = 1500;
export const DERBY_COLORS = [0xe17055, 0x00b894, 0x0984e3, 0xfdcb6e];

/** Four rammers come at the player around the race start; wreck them all without leaving the ring. */
export function derbyMission(n: number, at: Point): Mission {
  const V = Math.PI / 2;
  const road = (ix: number, iz: number, dx = 0, dz = 0): Point => ({ x: roadCoord(n, ix) + dx, z: roadCoord(n, iz) + dz });
  const rival = (p: Point, heading: number, i: number): SpawnSpec => ({ kind: "pickup", color: DERBY_COLORS[i], x: p.x, z: p.z, heading, drives: false, hostile: true, unarmed: true });
  const spawns: Record<string, SpawnSpec> = {
    d1: rival(road(5, 6, 0, 20), V, 0),
    d2: rival(road(7, 6, 0, -20), -V, 1),
    d3: rival(road(6, 5, 0, 20), V, 2),
    d4: rival(road(6, 7, 0, -20), -V, 3),
  };
  return {
    id: "derby",
    title: "Дерби на выживание",
    brief: "Четыре пикапа, и все хотят вас протаранить. Разбейте каждого и не уезжайте далеко от старта.",
    reward: DERBY_REWARD,
    time: 240,
    spawns,
    area: { at, radius: 120 },
    steps: [{ kind: "clear", targets: Object.keys(spawns), text: "Разбейте все пикапы соперников" }],
  };
}

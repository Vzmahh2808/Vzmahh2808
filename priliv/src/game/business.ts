/**
 * Businesses the player can buy. Each one earns money every game hour into its
 * till (up to a cap) until the player drops by to collect. Now and then a gang
 * leans on one of them: until the player deals with it, the till stays shut,
 * and if nobody comes in time the takings are gone.
 */
import { PITCH, roadCoord } from "../world/city";
import type { Rng } from "../core/rng";
import type { Mission, Point } from "./missions";

export interface Business {
  id: string;
  name: string;
  price: number;
  /** Takings per game hour. */
  income: number;
  /** Most the till holds before it stops filling. */
  cap: number;
  /** Where the player walks or drives in to buy or collect. */
  at: Point;
  /** Where the gang's two cars wait during a shakedown. */
  thugs: [Point & { heading: number }, Point & { heading: number }];
  /** Thug cars roam the city streets; on the island they wait parked. */
  thugsDrive: boolean;
}

export interface BusinessState {
  owned: boolean;
  stored: number;
  /** Game hours left to deal with a shakedown; 0 when there is none. */
  raid: number;
}

export interface Holdings {
  list: Record<string, BusinessState>;
  /** Game hours until the next shakedown is rolled. */
  nextRaid: number;
}

/** Hours between shakedowns, and hours the player has to answer one. */
export const RAID_EVERY = 8;
export const RAID_DEADLINE = 4;
export const RAID_REWARD = 600;

function road(n: number, ix: number, iz: number, dx = 0, dz = 0): Point {
  return { x: roadCoord(n, ix) + dx, z: roadCoord(n, iz) + dz };
}

export function businesses(n: number): Business[] {
  const mid = PITCH / 2;
  const withHeading = (p: Point, heading: number) => ({ ...p, heading });
  return [
    {
      id: "carwash",
      name: "Автомойка «Пена»",
      price: 3000,
      income: 60,
      cap: 600,
      at: road(n, 6, 3, 0, mid),
      thugs: [withHeading(road(n, 6, 2, 0, 20), Math.PI / 2), withHeading(road(n, 7, 3, -20, 0), Math.PI)],
      thugsDrive: true,
    },
    {
      id: "cafe",
      name: "Кафе «Волна»",
      price: 5000,
      income: 100,
      cap: 1000,
      at: road(n, 3, 5, mid, 0),
      thugs: [withHeading(road(n, 2, 5, 20, 0), 0), withHeading(road(n, 4, 5, 0, 20), Math.PI / 2)],
      thugsDrive: true,
    },
    {
      id: "taxipark",
      name: "Таксопарк «Шашечки»",
      price: 8000,
      income: 160,
      cap: 1600,
      at: road(n, 1, 4, 0, mid),
      thugs: [withHeading(road(n, 1, 3, 0, 20), Math.PI / 2), withHeading(road(n, 2, 4, 0, 20), Math.PI / 2)],
      thugsDrive: true,
    },
    {
      id: "warehouse",
      name: "Склад в порту",
      price: 12000,
      income: 240,
      cap: 2400,
      at: { x: 470, z: -108 },
      thugs: [withHeading({ x: 560, z: -108 }, Math.PI), withHeading({ x: 412, z: -60 }, Math.PI / 2)],
      thugsDrive: false,
    },
    {
      id: "yachtclub",
      name: "Яхт-клуб",
      price: 15000,
      income: 300,
      cap: 3000,
      at: { x: 256, z: -154 },
      thugs: [withHeading(road(n, n, 1, 0, 5), Math.PI / 2), withHeading(road(n, n, 2, 0, -10), -Math.PI / 2)],
      thugsDrive: true,
    },
  ];
}

export function freshHoldings(): Holdings {
  return { list: {}, nextRaid: RAID_EVERY };
}

export function stateOf(h: Holdings, id: string): BusinessState {
  return (h.list[id] ??= { owned: false, stored: 0, raid: 0 });
}

/** Buy a business; returns the money left, or null if it cannot be bought. */
export function buyBusiness(h: Holdings, b: Business, money: number): number | null {
  const s = stateOf(h, b.id);
  if (s.owned || money < b.price) return null;
  s.owned = true;
  s.stored = 0;
  s.raid = 0;
  return money - b.price;
}

/** Empty the till; returns what was in it. Nothing comes out during a shakedown. */
export function collect(h: Holdings, b: Business): number {
  const s = stateOf(h, b.id);
  if (!s.owned || s.raid > 0) return 0;
  const cash = Math.floor(s.stored);
  s.stored -= cash;
  return cash;
}

export type HoldingsEvent = { type: "raid"; id: string } | { type: "robbed"; id: string; lost: number };

/**
 * Advance time by `hours` of game time: fill the tills, count down open
 * shakedowns, and every few hours put one of the player's businesses under
 * pressure.
 */
export function tick(h: Holdings, all: Business[], hours: number, rng: Rng): HoldingsEvent[] {
  const events: HoldingsEvent[] = [];
  const owned = all.filter((b) => stateOf(h, b.id).owned);
  for (const b of owned) {
    const s = stateOf(h, b.id);
    if (s.raid > 0) {
      s.raid -= hours;
      if (s.raid <= 0) {
        s.raid = 0;
        events.push({ type: "robbed", id: b.id, lost: Math.floor(s.stored) });
        s.stored = 0;
      }
      continue;
    }
    s.stored = Math.min(b.cap, s.stored + b.income * hours);
  }
  if (owned.length === 0) return events;
  h.nextRaid -= hours;
  if (h.nextRaid <= 0) {
    h.nextRaid = RAID_EVERY;
    const calm = owned.filter((b) => stateOf(h, b.id).raid === 0);
    if (calm.length > 0) {
      const b = calm[rng.int(0, calm.length - 1)];
      stateOf(h, b.id).raid = RAID_DEADLINE;
      events.push({ type: "raid", id: b.id });
    }
  }
  return events;
}

/** Total takings per game hour of everything the player owns. */
export function hourlyIncome(h: Holdings, all: Business[]): number {
  return all.filter((b) => stateOf(h, b.id).owned).reduce((sum, b) => sum + b.income, 0);
}

/** The mission to see off a shakedown: wreck both gang cars. */
export function raidMission(b: Business): Mission {
  return {
    id: `raid-${b.id}`,
    title: "Разборка",
    brief: `${b.name}: наехала банда. Две чёрные машины крутятся рядом. Разбейте обе, и касса снова ваша.`,
    reward: RAID_REWARD,
    time: 240,
    spawns: {
      thug1: { kind: "sedan", color: 0x16161a, x: b.thugs[0].x, z: b.thugs[0].z, heading: b.thugs[0].heading, drives: b.thugsDrive },
      thug2: { kind: "sedan", color: 0x16161a, x: b.thugs[1].x, z: b.thugs[1].z, heading: b.thugs[1].heading, drives: b.thugsDrive },
    },
    steps: [
      { kind: "destroy", target: "thug1", text: "Разбейте первую машину банды" },
      { kind: "destroy", target: "thug2", text: "Разбейте вторую машину банды" },
    ],
  };
}

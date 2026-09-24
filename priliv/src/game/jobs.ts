import type { Rng } from "../core/rng";
import type { Mission, Point } from "./missions";
import type { CarMods } from "../entities/carPhysics";

/** Taxi pay: flag fall plus distance, with a bonus for arriving with time to spare. */
export function taxiFare(distance: number, timeLeft: number, timeTotal: number): number {
  const base = 40 + distance * 0.6;
  const speedBonus = timeTotal > 0 ? Math.max(0, timeLeft / timeTotal) * 0.5 : 0;
  return Math.round(base * (1 + speedBonus));
}

/** Seconds allowed for a fare: generous at city speeds, never under 30 s. */
export function fareTime(distance: number): number {
  return Math.max(30, Math.round(distance / 9 + 12));
}

/** Pick a point from `pool` whose distance to `from` lies in [min, max]. */
export function pickPoint(rng: Rng, pool: Point[], from: Point, min: number, max: number): Point {
  for (let i = 0; i < 60; i++) {
    const p = rng.pick(pool);
    const d = Math.hypot(p.x - from.x, p.z - from.z);
    if (d >= min && d <= max) return p;
  }
  return rng.pick(pool);
}

export interface TaxiFare {
  mission: Mission;
  pickup: Point;
  dropoff: Point;
  distance: number;
}

/** One fare: drive to the waiting passenger, stop, then take them across town. */
export function makeTaxiFare(rng: Rng, curbside: Point[], from: Point): TaxiFare {
  const pickup = pickPoint(rng, curbside, from, 60, 220);
  const dropoff = pickPoint(rng, curbside, pickup, 150, 420);
  const distance = Math.hypot(dropoff.x - pickup.x, dropoff.z - pickup.z);
  const time = fareTime(Math.hypot(pickup.x - from.x, pickup.z - from.z)) + fareTime(distance);
  return {
    pickup,
    dropoff,
    distance,
    mission: {
      id: "taxi",
      title: "Такси",
      brief: "",
      reward: 0,
      time,
      steps: [
        { kind: "goto", at: pickup, radius: 9, vehicle: "any", stop: true, text: "Заберите пассажира и остановитесь рядом" },
        { kind: "goto", at: dropoff, radius: 9, vehicle: "any", stop: true, text: "Довезите пассажира и остановитесь" },
      ],
    },
  };
}

/** Courier run: three drops in a row against the clock. */
export function makeCourierRun(rng: Rng, points: Point[], depot: Point): Mission {
  const drops: Point[] = [];
  let from = depot;
  for (let i = 0; i < 3; i++) {
    const p = pickPoint(rng, points, from, 120, 320);
    drops.push(p);
    from = p;
  }
  let total = 0;
  let prev = depot;
  for (const d of drops) {
    total += Math.hypot(d.x - prev.x, d.z - prev.z);
    prev = d;
  }
  return {
    id: "courier",
    title: "Доставка",
    brief: "Три посылки по городу. Проезжайте точки доставки до конца таймера.",
    reward: Math.round(150 + total * 0.8),
    time: fareTime(total) + 20,
    steps: drops.map((at, i) => ({ kind: "goto" as const, at, radius: 8, vehicle: "any", text: `Посылка ${i + 1} из 3` })),
  };
}

export interface ShopCar {
  kind: string;
  name: string;
  price: number;
  color: number;
}

export const SHOP: ShopCar[] = [
  { kind: "sedan", name: "Седан «Волна»", price: 800, color: 0x2e86de },
  { kind: "taxi", name: "Такси «Бриз»", price: 900, color: 0xf6c90e },
  { kind: "van", name: "Фургон «Трюм»", price: 1000, color: 0xf5f6fa },
  { kind: "pickup", name: "Пикап «Мол»", price: 1200, color: 0xc0392b },
  { kind: "sport", name: "Спорткар «Шторм»", price: 3500, color: 0x8e44ad },
];

export type ModKey = keyof CarMods;

export const MOD_SHOP: Array<{ key: ModKey; name: string; price: number; note: string }> = [
  { key: "engine", name: "Двигатель", price: 1200, note: "+18% скорость, +25% разгон" },
  { key: "tires", name: "Шины", price: 800, note: "+25% сцепление" },
  { key: "armor", name: "Броня", price: 1500, note: "−40% урона" },
];

/** Try to buy: returns the new balance, or null if the player cannot afford it. */
export function buy(money: number, price: number): number | null {
  return money >= price ? money - price : null;
}

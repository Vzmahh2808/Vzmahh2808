/** Clothes on sale in the shop «Лоск». The first outfit is what the hero starts in. */

export interface Outfit {
  name: string;
  shirt: number;
  pants: number;
  price: number;
}

export const OUTFITS: Outfit[] = [
  { name: "Обычный", shirt: 0x2e86de, pants: 0x2d3436, price: 0 },
  { name: "Чёрная кожа", shirt: 0x1e1e24, pants: 0x14141a, price: 120 },
  { name: "Красная толстовка", shirt: 0xd63031, pants: 0x2d3436, price: 90 },
  { name: "Морской костюм", shirt: 0xf5f6fa, pants: 0x273c75, price: 150 },
  { name: "Зелёный камуфляж", shirt: 0x4b6b3a, pants: 0x3a4a2c, price: 180 },
  { name: "Золотая куртка", shirt: 0xf1c40f, pants: 0x1e1e24, price: 300 },
];

/** Changing clothes takes a moment; a fresh outfit fools cops who cannot see the player. */
export function isOutfit(i: unknown): i is number {
  return typeof i === "number" && Number.isInteger(i) && i >= 0 && i < OUTFITS.length;
}

export type ChangeResult =
  | { ok: true; disguised: boolean }
  | { ok: false; reason: "money" | "same" | "seen" };

/**
 * Decide whether a purchase goes through. While wanted, the shop only lets the
 * player in unnoticed: with police watching, the door stays shut. Unseen, the
 * new look wipes the stars ("disguised").
 */
export function tryChange(current: number, target: number, money: number, stars: number, seen: boolean, owned: readonly number[]): ChangeResult {
  const o = OUTFITS[target];
  if (!o || current === target) return { ok: false, reason: "same" };
  if (stars > 0 && seen) return { ok: false, reason: "seen" };
  const free = owned.includes(target);
  if (!free && money < o.price) return { ok: false, reason: "money" };
  return { ok: true, disguised: stars > 0 };
}

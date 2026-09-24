import type { ItemDef, MonsterDef } from "./types";

export const MONSTERS: readonly MonsterDef[] = [
  { id: "rat", name: "крыса", nameAcc: "крысу", glyph: "r", color: "#b08968", hp: 4, atk: [1, 2], def: 0, acc: 70, eva: 15, xp: 3, minDepth: 1, maxDepth: 3, ai: "chase", weight: 10 },
  { id: "bat", name: "летучая мышь", nameAcc: "летучую мышь", glyph: "b", color: "#9d8df1", hp: 5, atk: [1, 3], def: 0, acc: 65, eva: 35, xp: 4, minDepth: 1, maxDepth: 4, ai: "erratic", weight: 8 },
  { id: "kobold", name: "кобольд", nameAcc: "кобольда", glyph: "k", color: "#8fbf5f", hp: 8, atk: [1, 4], def: 0, acc: 70, eva: 10, xp: 6, minDepth: 1, maxDepth: 4, ai: "chase", weight: 9 },
  { id: "snake", name: "змея", nameAcc: "змею", glyph: "S", color: "#5fbf8f", hp: 10, atk: [1, 3], def: 0, acc: 80, eva: 20, xp: 12, minDepth: 2, maxDepth: 6, ai: "chase", special: "poison", weight: 6 },
  { id: "goblin", name: "гоблин", nameAcc: "гоблина", glyph: "g", color: "#7fb069", hp: 12, atk: [2, 5], def: 1, acc: 72, eva: 12, xp: 10, minDepth: 2, maxDepth: 6, ai: "coward", weight: 9 },
  { id: "skeleton", name: "скелет", nameAcc: "скелета", glyph: "s", color: "#e0e0d0", hp: 16, atk: [2, 6], def: 2, acc: 70, eva: 5, xp: 14, minDepth: 3, maxDepth: 7, ai: "chase", weight: 8 },
  { id: "orc", name: "орк", nameAcc: "орка", glyph: "o", color: "#6a994e", hp: 22, atk: [3, 8], def: 2, acc: 75, eva: 8, xp: 22, minDepth: 4, maxDepth: 9, ai: "chase", weight: 8 },
  { id: "wraith", name: "призрак", nameAcc: "призрака", glyph: "W", color: "#c8d6ff", hp: 18, atk: [2, 6], def: 1, acc: 80, eva: 30, xp: 28, minDepth: 5, maxDepth: 10, ai: "chase", special: "drain", weight: 5 },
  { id: "ogre", name: "огр", nameAcc: "огра", glyph: "O", color: "#c9a36b", hp: 34, atk: [5, 12], def: 2, acc: 68, eva: 5, xp: 40, minDepth: 6, maxDepth: 9, ai: "chase", weight: 6 },
  { id: "troll", name: "тролль", nameAcc: "тролля", glyph: "T", color: "#4f8a5b", hp: 40, atk: [5, 11], def: 3, acc: 70, eva: 5, xp: 45, minDepth: 6, maxDepth: 10, ai: "chase", special: "regen", weight: 5 },
  { id: "wyvern", name: "виверна", nameAcc: "виверну", glyph: "D", color: "#e76f51", hp: 60, atk: [7, 14], def: 4, acc: 80, eva: 12, xp: 90, minDepth: 8, maxDepth: 10, ai: "chase", weight: 4 },
  { id: "lord", name: "Владыка подземелья", nameAcc: "Владыку подземелья", glyph: "L", color: "#ff4d6d", hp: 120, atk: [9, 16], def: 5, acc: 85, eva: 10, xp: 300, minDepth: 99, maxDepth: 99, ai: "chase", special: "boss", weight: 0 },
];

export const ITEMS: readonly ItemDef[] = [
  { id: "potion_heal", name: "зелье лечения", kind: "potion", glyph: "!", color: "#ff6b6b", effect: "heal", minDepth: 1, weight: 14, description: "Восстанавливает 40% здоровья." },
  { id: "potion_fullheal", name: "большое зелье лечения", kind: "potion", glyph: "!", color: "#ff2e63", effect: "fullheal", minDepth: 3, weight: 5, description: "Полностью восстанавливает здоровье и снимает яд." },
  { id: "potion_antidote", name: "противоядие", kind: "potion", glyph: "!", color: "#7bed9f", effect: "antidote", minDepth: 2, weight: 6, description: "Снимает отравление." },
  { id: "potion_strength", name: "зелье силы", kind: "potion", glyph: "!", color: "#ffa502", effect: "strength", minDepth: 2, weight: 4, description: "Навсегда +1 к урону." },
  { id: "potion_tough", name: "зелье стойкости", kind: "potion", glyph: "!", color: "#70a1ff", effect: "toughness", minDepth: 1, weight: 5, description: "Навсегда +5 к максимальному здоровью." },
  { id: "scroll_teleport", name: "свиток телепортации", kind: "scroll", glyph: "?", color: "#dff9fb", effect: "teleport", minDepth: 1, weight: 6, description: "Переносит в случайное место на этаже." },
  { id: "scroll_mapping", name: "свиток картографии", kind: "scroll", glyph: "?", color: "#f6e58d", effect: "mapping", minDepth: 1, weight: 5, description: "Показывает план всего этажа." },
  { id: "scroll_fire", name: "свиток огненного шара", kind: "scroll", glyph: "?", color: "#ff7f50", effect: "fire", minDepth: 2, weight: 6, description: "Наносит 8–14 урона всем видимым врагам." },
  { id: "dagger", name: "кинжал", kind: "weapon", glyph: ")", color: "#ced6e0", effect: "none", atk: [1, 4], minDepth: 1, weight: 6, description: "Урон 1–4." },
  { id: "sword", name: "меч", kind: "weapon", glyph: ")", color: "#dfe6e9", effect: "none", atk: [2, 7], minDepth: 2, weight: 5, description: "Урон 2–7." },
  { id: "axe", name: "топор", kind: "weapon", glyph: ")", color: "#fab1a0", effect: "none", atk: [3, 9], minDepth: 4, weight: 4, description: "Урон 3–9." },
  { id: "hammer", name: "боевой молот", kind: "weapon", glyph: ")", color: "#ffeaa7", effect: "none", atk: [4, 12], minDepth: 6, weight: 3, description: "Урон 4–12." },
  { id: "leather", name: "кожаный доспех", kind: "armor", glyph: "[", color: "#b08968", effect: "none", def: 1, eva: 0, minDepth: 1, weight: 6, description: "Защита 1." },
  { id: "chain", name: "кольчуга", kind: "armor", glyph: "[", color: "#a4b0be", effect: "none", def: 2, eva: -3, minDepth: 3, weight: 4, description: "Защита 2, уклонение −3." },
  { id: "plate", name: "латы", kind: "armor", glyph: "[", color: "#dfe4ea", effect: "none", def: 4, eva: -8, minDepth: 6, weight: 3, description: "Защита 4, уклонение −8." },
  { id: "gold", name: "золото", kind: "gold", glyph: "$", color: "#ffd32a", effect: "none", minDepth: 1, weight: 0, description: "Блестит." },
  { id: "amulet", name: "Сердце подземелья", kind: "amulet", glyph: "♦", color: "#ff4d6d", effect: "none", minDepth: 99, weight: 0, description: "Артефакт, ради которого всё затевалось." },
];

const monsterIndex = new Map(MONSTERS.map((m) => [m.id, m]));
const itemIndex = new Map(ITEMS.map((i) => [i.id, i]));

export function monsterDef(id: string): MonsterDef {
  const d = monsterIndex.get(id);
  if (!d) throw new Error(`unknown monster ${id}`);
  return d;
}

export function itemDef(id: string): ItemDef {
  const d = itemIndex.get(id);
  if (!d) throw new Error(`unknown item ${id}`);
  return d;
}

/**
 * The league: 22 made-up clubs in real cities, laid out like the real thing
 * (two conferences, four divisions). Names and colours are invented on
 * purpose: no real club names, logos or player names are used.
 */
import type { Ratings } from "../sim/state";

export type Conference = "west" | "east";
export type Division = "north" | "central" | "ural" | "far";

export interface Team {
  id: number;
  city: string;
  name: string;
  /** Three-letter code for the scoreboard. */
  short: string;
  conference: Conference;
  division: Division;
  /** Jersey colours as CSS hex. */
  main: string;
  alt: string;
  accent: string;
  ratings: Ratings;
}

export const LEAGUE_NAME = "Евразийская лига";
export const CUP_NAME = "Кубок Полярной звезды";

export const DIVISION_NAMES: Record<Division, string> = {
  north: "Северный",
  central: "Центральный",
  ural: "Уральский",
  far: "Дальневосточный",
};

export const CONFERENCE_NAMES: Record<Conference, string> = { west: "Запад", east: "Восток" };

const r = (off: number, def: number, gk: number, spd: number): Ratings => ({ off, def, gk, spd });

// prettier-ignore
const RAW: Omit<Team, "id">[] = [
  // Запад, Северный
  { city: "Санкт-Петербург", name: "Балтийские Гвардейцы", short: "БАЛ", conference: "west", division: "north", main: "#b3122b", alt: "#f1f3f6", accent: "#163a8a", ratings: r(86, 84, 82, 84) },
  { city: "Москва", name: "Красные Волки", short: "ВОЛ", conference: "west", division: "north", main: "#d62828", alt: "#ffffff", accent: "#7a0c0c", ratings: r(80, 78, 76, 80) },
  { city: "Нижний Новгород", name: "Волжские Ладьи", short: "ЛАД", conference: "west", division: "north", main: "#1d4e89", alt: "#c9ced6", accent: "#ffffff", ratings: r(76, 76, 77, 74) },
  { city: "Тольятти", name: "Жигулёвские Соколы", short: "СОК", conference: "west", division: "north", main: "#2a6fdb", alt: "#ffffff", accent: "#0b2a5b", ratings: r(70, 70, 68, 72) },
  { city: "Сочи", name: "Чёрноморские Дельфины", short: "ДЕЛ", conference: "west", division: "north", main: "#14a3c7", alt: "#ffffff", accent: "#0a3d62", ratings: r(68, 66, 70, 70) },
  // Запад, Центральный
  { city: "Минск", name: "Минские Зубры", short: "ЗУБ", conference: "west", division: "central", main: "#1f4fb5", alt: "#ffffff", accent: "#111111", ratings: r(82, 80, 80, 78) },
  { city: "Москва", name: "Столичные Орлы", short: "ОРЛ", conference: "west", division: "central", main: "#2350c8", alt: "#ffffff", accent: "#0d1b4d", ratings: r(78, 76, 74, 78) },
  { city: "Шанхай", name: "Восточные Тигры", short: "ТИГ", conference: "west", division: "central", main: "#0fb5a6", alt: "#ffd400", accent: "#e03a3e", ratings: r(72, 70, 74, 76) },
  { city: "Ярославль", name: "Ярославские Медведи", short: "МЕД", conference: "west", division: "central", main: "#c8102e", alt: "#ffffff", accent: "#1b3f94", ratings: r(88, 86, 88, 84) },
  { city: "Череповец", name: "Стальные Быки", short: "БЫК", conference: "west", division: "central", main: "#1c1c1c", alt: "#f5c400", accent: "#2d5fa8", ratings: r(72, 74, 73, 70) },
  { city: "Москва", name: "Красная Звезда", short: "ЗВЕ", conference: "west", division: "central", main: "#c1121f", alt: "#1b3f94", accent: "#ffffff", ratings: r(84, 84, 83, 82) },
  // Восток, Уральский
  { city: "Екатеринбург", name: "Уральские Рыси", short: "РЫС", conference: "east", division: "ural", main: "#f28c00", alt: "#1c1c1c", accent: "#ffffff", ratings: r(76, 74, 72, 78) },
  { city: "Казань", name: "Татарские Леопарды", short: "ЛЕО", conference: "east", division: "ural", main: "#0b8a3e", alt: "#ffffff", accent: "#d62828", ratings: r(83, 80, 81, 80) },
  { city: "Магнитогорск", name: "Стальные Горняки", short: "ГОР", conference: "east", division: "ural", main: "#0e3f8f", alt: "#e7eaf0", accent: "#e2382f", ratings: r(86, 83, 86, 82) },
  { city: "Нижнекамск", name: "Камские Бураны", short: "БУР", conference: "east", division: "ural", main: "#2a9d8f", alt: "#ffffff", accent: "#264653", ratings: r(68, 66, 68, 70) },
  { city: "Челябинск", name: "Челябинские Молоты", short: "МОЛ", conference: "east", division: "ural", main: "#242424", alt: "#ffffff", accent: "#d62828", ratings: r(80, 77, 78, 78) },
  // Восток, Дальневосточный
  { city: "Омск", name: "Иртышские Шершни", short: "ШЕР", conference: "east", division: "far", main: "#b71c1c", alt: "#151515", accent: "#ffffff", ratings: r(86, 82, 80, 84) },
  { city: "Владивосток", name: "Приморские Чайки", short: "ЧАЙ", conference: "east", division: "far", main: "#123c73", alt: "#7cc7f0", accent: "#f2c94c", ratings: r(66, 66, 68, 70) },
  { city: "Хабаровск", name: "Хабаровские Кречеты", short: "КРЕ", conference: "east", division: "far", main: "#0a5ea8", alt: "#ffffff", accent: "#f2b705", ratings: r(64, 65, 66, 68) },
  { city: "Астана", name: "Степные Беркуты", short: "БЕР", conference: "east", division: "far", main: "#00a6d6", alt: "#ffffff", accent: "#f9d71c", ratings: r(74, 72, 73, 76) },
  { city: "Уфа", name: "Башкирские Батыры", short: "БАТ", conference: "east", division: "far", main: "#1b7f3b", alt: "#ffffff", accent: "#1c3f94", ratings: r(78, 76, 77, 76) },
  { city: "Новосибирск", name: "Новосибирские Соболи", short: "СОБ", conference: "east", division: "far", main: "#1d4ed8", alt: "#ffffff", accent: "#0f172a", ratings: r(74, 72, 72, 74) },
];

export const TEAMS: Team[] = RAW.map((t, id) => ({ ...t, id }));

export const teamById = (id: number): Team => TEAMS[id];

/** Overall strength for sorting and seeding. */
export function strength(t: Team): number {
  const r = t.ratings;
  return r.off * 0.3 + r.def * 0.25 + r.gk * 0.3 + r.spd * 0.15;
}

const rgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** Perceptual-ish colour distance, 0..~441. */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

export interface Kit {
  body: string;
  trim: string;
}

/** Jerseys for a match: the away side switches to its second kit when the colours clash. */
export function kitsFor(home: Team, away: Team): [Kit, Kit] {
  const h: Kit = { body: home.main, trim: home.accent };
  let a: Kit = { body: away.main, trim: away.accent };
  if (colorDistance(h.body, a.body) < 150) a = { body: away.alt, trim: away.main };
  if (colorDistance(h.body, a.body) < 150) a = { body: away.accent, trim: away.alt };
  return [h, a];
}

export const westTeams = (): Team[] => TEAMS.filter((t) => t.conference === "west");
export const eastTeams = (): Team[] => TEAMS.filter((t) => t.conference === "east");

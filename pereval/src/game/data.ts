import type { Category, Role, Terrain, Weather } from "./types";

export interface TerrainDef {
  name: string;
  /** Hours to enter one tile in good weather with a light pack. 0 = impassable. */
  hours: number;
  /** Stamina drain per tile for a member of average strength. */
  stamina: number;
  /** Stamina restored by a night here. */
  rest: number;
  color: string;
  passable: boolean;
}

export const TERRAIN: Record<Terrain, TerrainDef> = {
  meadow: { name: "Луг", hours: 0.5, stamina: 3, rest: 45, color: "#6ea84f", passable: true },
  forest: { name: "Лес", hours: 0.75, stamina: 3.5, rest: 45, color: "#3d7a3a", passable: true },
  swamp: { name: "Болото", hours: 1.5, stamina: 6, rest: 25, color: "#5f7a4a", passable: true },
  scree: { name: "Курумник", hours: 1.25, stamina: 5, rest: 25, color: "#8a8478", passable: true },
  glacier: { name: "Ледник", hours: 1.5, stamina: 6, rest: 15, color: "#cfe3ef", passable: true },
  rock: { name: "Скалы", hours: 0, stamina: 0, rest: 0, color: "#4b4a52", passable: false },
  river: { name: "Река", hours: 0.75, stamina: 5, rest: 35, color: "#3b74c4", passable: true },
  bridge: { name: "Мостик", hours: 0.5, stamina: 3, rest: 35, color: "#3b74c4", passable: true },
  lake: { name: "Озеро", hours: 0, stamina: 0, rest: 0, color: "#2d5aa8", passable: false },
  pass: { name: "Перевал", hours: 2.5, stamina: 12, rest: 10, color: "#a09a8e", passable: true },
  peak: { name: "Вершина", hours: 3, stamina: 12, rest: 10, color: "#e8e6e0", passable: true },
  village: { name: "Посёлок", hours: 0.5, stamina: 2, rest: 60, color: "#c9a865", passable: true },
};

export interface WeatherDef {
  name: string;
  glyph: string;
  /** Multiplier on walking hours. */
  speed: number;
  /** Extra half-width penalty on stage target zones. */
  zonePenalty: number;
  /** Passes, glaciers and peaks are closed in these conditions. */
  closesHeights: boolean;
  /** Extra stamina drain per tile. */
  drain: number;
}

export const WEATHER: Record<Weather, WeatherDef> = {
  clear: { name: "Ясно", glyph: "☀", speed: 1, zonePenalty: 0, closesHeights: false, drain: 0 },
  cloudy: { name: "Облачно", glyph: "☁", speed: 1, zonePenalty: 0, closesHeights: false, drain: 0 },
  rain: { name: "Дождь", glyph: "🌧", speed: 1.3, zonePenalty: 0.04, closesHeights: false, drain: 2 },
  storm: { name: "Гроза", glyph: "⛈", speed: 1.6, zonePenalty: 0.08, closesHeights: true, drain: 4 },
  snow: { name: "Снег", glyph: "❄", speed: 1.5, zonePenalty: 0.06, closesHeights: true, drain: 3 },
};

/** Weather transition table: from -> [to, weight][] */
export const WEATHER_CHAIN: Record<Weather, [Weather, number][]> = {
  clear: [
    ["clear", 55],
    ["cloudy", 30],
    ["rain", 15],
  ],
  cloudy: [
    ["clear", 30],
    ["cloudy", 35],
    ["rain", 25],
    ["storm", 10],
  ],
  rain: [
    ["clear", 10],
    ["cloudy", 35],
    ["rain", 35],
    ["storm", 20],
  ],
  storm: [
    ["cloudy", 40],
    ["rain", 40],
    ["storm", 20],
  ],
  snow: [
    ["cloudy", 45],
    ["snow", 30],
    ["clear", 25],
  ],
};

export const ROLES: Record<Role, { name: string; hint: string }> = {
  leader: { name: "руководитель", hint: "Мораль группы падает медленнее." },
  quartermaster: { name: "завхоз", hint: "Еда расходуется на 15 % экономнее." },
  medic: { name: "медик", hint: "Аптечка лечит сильнее." },
  mechanic: { name: "реммастер", hint: "Снаряжение ломается реже." },
};

export const NAMES: { name: string; female: boolean }[] = [
  { name: "Лёша", female: false },
  { name: "Маша", female: true },
  { name: "Дима", female: false },
  { name: "Катя", female: true },
  { name: "Серёга", female: false },
  { name: "Аня", female: true },
  { name: "Женя", female: false },
  { name: "Оля", female: true },
  { name: "Паша", female: false },
  { name: "Вика", female: true },
  { name: "Тёма", female: false },
  { name: "Настя", female: true },
];

export interface CategoryDef {
  name: string;
  short: string;
  width: number;
  height: number;
  /** Control deadline in days. */
  days: number;
  checkpoints: number;
  /** Share of the map above the rock line. */
  rockShare: number;
  rivers: number;
  peaks: number;
  snow: boolean;
  /** Person-days of food per member at the start. */
  foodPerMember: number;
  gas: number;
  kit: number;
  /** Score multiplier. */
  factor: number;
  hint: string;
}

export const CATEGORIES: Record<Category, CategoryDef> = {
  1: {
    name: "Первая категория",
    short: "I к. с.",
    width: 30,
    height: 20,
    days: 10,
    checkpoints: 3,
    rockShare: 0.14,
    rivers: 2,
    peaks: 1,
    snow: false,
    foodPerMember: 8,
    gas: 10,
    kit: 2,
    factor: 1,
    hint: "Лесные тропы, пара бродов и один несложный перевал. Хороший маршрут для начала.",
  },
  2: {
    name: "Вторая категория",
    short: "II к. с.",
    width: 34,
    height: 22,
    days: 13,
    checkpoints: 4,
    rockShare: 0.18,
    rivers: 3,
    peaks: 2,
    snow: true,
    foodPerMember: 11,
    gas: 13,
    kit: 2,
    factor: 1.3,
    hint: "Больше гор и рек, возможен снег на высоте. Продукты придётся считать.",
  },
  3: {
    name: "Третья категория",
    short: "III к. с.",
    width: 38,
    height: 24,
    days: 16,
    checkpoints: 5,
    rockShare: 0.22,
    rivers: 4,
    peaks: 2,
    snow: true,
    foodPerMember: 14,
    gas: 16,
    kit: 3,
    factor: 1.6,
    hint: "Хребты, ледники, длинные переходы. Ошибка в планировании стоит дня.",
  },
};

export const CP_NAMES = ["Кордон", "Развилка", "Изба", "Стрелка", "Ручей Тихий", "Озеро Верхнее", "Скала Палец", "Поляна Ветров", "Курумы", "Сухой лог"];

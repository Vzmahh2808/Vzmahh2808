import { PITCH, roadCoord } from "../world/city";
import type { Mission, Point, ThugSpec } from "./missions";
import { LIGHTHOUSE } from "../world/island";
import { REGATTA, REGATTA_TIME, SMUGGLER_ROUTE } from "../world/water";

/** Fixed spots on the port island (roads there are not on the city grid). */
export const ISLAND_SPOTS = {
  contact: { x: 470, z: 0 },
  docks: { x: 520, z: -108 },
  lot: { x: 590, z: -3 },
  cape: { x: LIGHTHOUSE.x - 8, z: 0 },
};

/** A point on the carriageway: intersection (ix, iz) nudged by (dx, dz) metres. */
function road(n: number, ix: number, iz: number, dx = 0, dz = 0): Point {
  return { x: roadCoord(n, ix) + dx, z: roadCoord(n, iz) + dz };
}

export interface Places {
  garage: Point;
  paint: Point;
  contact: Point;
  race: Point;
  shop: Point;
  depot: Point;
  /** Nika's corner, where chapter three is handed out. */
  office: Point;
  /** Gun shop «Калибр». */
  gunShop: Point;
  /** Clothes shop «Лоск». */
  clothes: Point;
  /** Hospital: heals on foot; the ambulance job ends here. */
  hospital: Point;
  /** Where the ambulance waits. */
  ambulanceLot: { x: number; z: number; heading: number };
  /** Where cars bought at the shop are delivered. */
  shopLot: { x: number; z: number; heading: number };
  garageSlots: Array<{ x: number; z: number; heading: number }>;
}

export function places(n: number): Places {
  const mid = PITCH / 2;
  const garage = road(n, n / 2, n / 2, mid, 0);
  return {
    garage,
    paint: road(n, 2, n / 2, 0, mid),
    contact: road(n, n / 2 - 1, n / 2 - 1, mid, 0),
    race: road(n, n / 2 + 2, n / 2 + 2, mid, 0),
    shop: road(n, n / 2 + 1, n / 2, 0, mid),
    depot: road(n, 3, n, mid, -2),
    office: road(n, 1, 2, mid, 0),
    gunShop: road(n, 2, 6, 0, mid),
    clothes: road(n, n / 2 + 2, 3, 0, mid),
    hospital: road(n, 1, n / 2 + 1, mid, 0),
    ambulanceLot: { ...road(n, 1, n / 2 + 1, mid + 14, 3.6), heading: 0 },
    shopLot: { ...road(n, n / 2 + 1, n / 2, 3.6, mid + 12), heading: Math.PI / 2 },
    garageSlots: [-16, -9, 9].map((dx) => ({ x: garage.x + dx, z: garage.z + 3.6, heading: 0 })),
  };
}

/** Checkpoints for the time-trial race: a loop through town starting at the race marker. */
export function raceRoute(n: number): Point[] {
  const c = n / 2;
  return [
    road(n, c + 3, c + 2),
    road(n, c + 3, c - 1),
    road(n, c + 1, c - 1),
    road(n, c + 1, c - 3),
    road(n, c - 2, c - 3),
    road(n, c - 2, c + 1),
    road(n, c - 3, c + 1),
    road(n, c - 3, c + 3),
    road(n, c + 2, c + 3),
    road(n, c + 2, c + 2, PITCH / 2),
  ];
}

export const RACE_TIME = 110;

export function regattaMission(): Mission {
  return {
    id: "regatta",
    title: "Регата",
    brief: "Заезд на катере от городской пристани вокруг маяка к северной воде у моста.",
    reward: 400,
    time: REGATTA_TIME,
    steps: [{ kind: "race", points: REGATTA, radius: 14, text: "Проходите буи на катере" }],
  };
}

export function raceMission(n: number): Mission {
  return {
    id: "race",
    title: "Круг по городу",
    brief: "Заезд на время по десяти контрольным точкам.",
    reward: 250,
    time: RACE_TIME,
    steps: [{ kind: "race", points: raceRoute(n), radius: 9, text: "Проезжайте контрольные точки" }],
  };
}

/** All chapters in play order. */
export function storyMissions(n: number): Mission[] {
  return [...chapterOne(n), ...chapterTwo(n), ...chapterThree(n), ...chapterFour(), ...chapterFive(n), ...chapterSix(n), ...chapterSeven(n)];
}

/** Gosha's bar «Якорь», where chapter five is handed out. */
export function barOf(n: number): Point {
  return road(n, 5, 6, 0, PITCH / 2);
}

/** A gang car: black sedan that hunts the player. */
function hunter(p: Point, heading: number): { kind: string; color: number; x: number; z: number; heading: number; drives: boolean; hostile: boolean } {
  return { kind: "sedan", color: 0x16161a, x: p.x, z: p.z, heading, drives: false, hostile: true };
}

export function chapterFive(n: number): Mission[] {
  const bar = barOf(n);
  const V = Math.PI / 2;
  const list: Mission[] = [
    {
      id: "ch5-mark",
      chapter: 5,
      chapterTitle: "Глава 5: Чёрная метка",
      contact: bar,
      title: "Чёрная метка",
      brief: "Глава 5. Гоша держит бар «Якорь». Банда, что наезжает на бизнесы, пометила и вас: две их машины уже едут. Продержитесь минуту.",
      reward: 2500,
      time: 120,
      spawns: { h1: hunter(road(n, 1, 6, 0, 20), V), h2: hunter(road(n, 7, 2, 0, 20), V) },
      steps: [{ kind: "survive", seconds: 60, text: "Выживите, пока банда охотится за вами" }],
    },
    {
      id: "ch5-nest",
      chapter: 5,
      contact: bar,
      title: "Гнездо",
      brief: "Гоша знает, где банда держит машины: у южной окраины. Разбейте все три, пока их охрана пытается вас остановить.",
      reward: 3000,
      time: 240,
      spawns: {
        c1: { kind: "sedan", color: 0x16161a, ...road(n, 6, 1, 20, 0), heading: 0, drives: false },
        c2: { kind: "sedan", color: 0x16161a, ...road(n, 6, 1, -20, 0), heading: 0, drives: false },
        c3: { kind: "sedan", color: 0x16161a, ...road(n, 6, 1, 0, 20), heading: V, drives: false },
        guard: hunter(road(n, 4, 1, 0, 20), V),
      },
      steps: [
        { kind: "destroy", target: "c1", text: "Разбейте первую машину банды" },
        { kind: "destroy", target: "c2", text: "Разбейте вторую машину банды" },
        { kind: "destroy", target: "c3", text: "Разбейте третью машину банды" },
      ],
    },
    {
      id: "ch5-hostage",
      chapter: 5,
      contact: bar,
      title: "Заложник",
      brief: "Банда держит брата Гоши в фургоне на юго-западе. Заберите фургон и довезите до бара. Охотники будут таранить, фургон должен уцелеть.",
      reward: 3500,
      time: 240,
      protect: "van",
      spawns: {
        van: { kind: "van", color: 0x6d6875, ...road(n, 1, 1, 20, 0), heading: 0, drives: false },
        h1: hunter(road(n, 2, 2, 0, 20), V),
        h2: hunter(road(n, 1, 3, 0, 20), V),
      },
      steps: [
        { kind: "enter", target: "van", text: "Сядьте в серый фургон" },
        { kind: "goto", at: bar, radius: 8, vehicle: "van", text: "Довезите фургон до бара «Якорь»" },
      ],
    },
    {
      id: "ch5-boss",
      chapter: 5,
      contact: bar,
      title: "Главарь",
      brief: "Главарь банды катается на чёрном спорткаре с двумя охранниками. Остановите его.",
      reward: 5000,
      time: 300,
      spawns: {
        boss: { kind: "sport", color: 0x0b0c10, ...road(n, 7, 5, 0, 20), heading: V, drives: true },
        h1: hunter(road(n, 7, 4, 0, 20), V),
        h2: hunter(road(n, 6, 5, 20, 0), 0),
      },
      steps: [{ kind: "destroy", target: "boss", text: "Уничтожьте чёрный спорткар главаря" }],
    },
    {
      id: "ch5-siege",
      chapter: 5,
      contact: bar,
      title: "Последний бой",
      brief: "Остатки банды идут на бар. Держитесь у «Якоря» 45 секунд. После этого на ваши бизнесы больше никто не наедет.",
      reward: 15000,
      time: 240,
      spawns: {
        h1: hunter(road(n, 3, 6, 20, 0), 0),
        h2: hunter(road(n, 7, 6, 0, -20), -V),
        h3: hunter(road(n, 5, 8, 0, -20), -V),
        h4: hunter(road(n, 4, 7, 20, 0), 0),
      },
      steps: [{ kind: "hold", at: bar, radius: 18, seconds: 45, text: "Удержите бар «Якорь»" }],
    },
  ];
  return list;
}

/** Seva, a retired detective, meets the player at his old precinct yard. */
export function sevaOf(n: number): Point {
  return road(n, 6, 4, 0, PITCH / 2);
}

/** Thugs along a street from (x, z), `step` metres apart on alternating kerbs. */
function crew(x: number, z: number, along: "x" | "z", count: number, step: number, heading: number, extra: Partial<ThugSpec> = {}): ThugSpec[] {
  return Array.from({ length: count }, (_, i) => {
    const side = i % 2 === 0 ? -5 : 5;
    return along === "x" ? { x: x + i * step, z: z + side, heading, ...extra } : { x: x + side, z: z + i * step, heading, ...extra };
  });
}

function keyed(prefix: string, list: ThugSpec[]): Record<string, ThugSpec> {
  return Object.fromEntries(list.map((t, i) => [`${prefix}${i + 1}`, t]));
}

/** A car of the northern crew. */
function northern(p: Point, heading: number, drives: boolean) {
  return { kind: "sedan", color: 0x1e5631, x: p.x, z: p.z, heading, drives };
}

export function chapterSix(n: number): Mission[] {
  const seva = sevaOf(n);
  const V = Math.PI / 2;
  const scouts = keyed("t", crew(roadCoord(n, 7), roadCoord(n, 2) + 20, "z", 3, 10, -V));
  const guards = keyed("t", [
    { ...road(n, 2, 7, 8, -5), heading: 0 },
    { ...road(n, 2, 7, 28, 5), heading: Math.PI },
    { ...road(n, 2, 7, 36, -5), heading: Math.PI },
    { ...road(n, 2, 7, 48, 5), heading: Math.PI },
    { ...road(n, 2, 7, 14, 5), heading: 0 },
  ]);
  const wave = keyed("t", [
    { ...road(n, 6, 5, 5, 20), heading: -V, alerted: true },
    { ...road(n, 6, 5, -5, 30), heading: -V, alerted: true },
    { ...road(n, 6, 4, 5, -25), heading: V, alerted: true },
    { ...road(n, 6, 4, -5, -35), heading: V, alerted: true },
    { ...road(n, 7, 4, -15, 5), heading: Math.PI, alerted: true },
    { ...road(n, 7, 4, -25, -5), heading: Math.PI, alerted: true },
  ]);
  const last = keyed("t", [...crew(roadCoord(n, 3) + 15, roadCoord(n, 0), "x", 6, 16, V), { ...road(n, 4, 0, 0, 4), heading: V, hp: 220 }]);
  return [
    {
      id: "ch6-arms",
      chapter: 6,
      chapterTitle: "Глава 6: Северные",
      contact: seva,
      title: "Ствол",
      brief: "Глава 6. Банду вы разбили, но на её место пришли Северные, и они с оружием. Сева, бывший следователь, даёт вам пистолет. Трое их разведчиков стоят на востоке, начните с них.",
      reward: 2000,
      gift: { weapon: "pistol", rounds: 48 },
      thugs: scouts,
      area: { at: road(n, 7, 2, 0, PITCH / 2), radius: 160 },
      steps: [{ kind: "clear", targets: Object.keys(scouts), text: "Уберите разведчиков Северных" }],
    },
    {
      id: "ch6-convoy",
      chapter: 6,
      contact: seva,
      title: "Кортеж",
      brief: "Три зелёные машины Северных возят оружие по западным кварталам. Догоните и остановите все три. Удобнее всего стрелять прямо из окна.",
      reward: 3000,
      time: 300,
      spawns: {
        c1: northern(road(n, 1, 2, 20, 0), 0, true),
        c2: northern(road(n, 1, 3, 20, 0), 0, true),
        c3: northern(road(n, 2, 1, 0, 20), V, true),
      },
      steps: [{ kind: "clear", targets: ["c1", "c2", "c3"], text: "Остановите кортеж: три зелёные машины" }],
    },
    {
      id: "ch6-hostage",
      chapter: 6,
      contact: seva,
      title: "Свидетель",
      brief: "Северные держат свидетеля Севы в фургоне на северо-западе, под охраной пятерых. Уберите охрану и привезите фургон к Севе. Стреляйте аккуратно: фургон должен уцелеть.",
      reward: 3500,
      time: 360,
      protect: "van",
      thugs: guards,
      spawns: { van: { kind: "van", color: 0x6d6875, ...road(n, 2, 7, 22, 0), heading: 0, drives: false } },
      steps: [
        { kind: "clear", targets: Object.keys(guards), text: "Уберите охрану фургона" },
        { kind: "enter", target: "van", text: "Сядьте в фургон со свидетелем" },
        { kind: "goto", at: seva, radius: 8, vehicle: "van", text: "Довезите свидетеля до Севы" },
      ],
    },
    {
      id: "ch6-ambush",
      chapter: 6,
      contact: seva,
      title: "Засада",
      brief: "Северные узнали про Севу и идут к нему: пешие с оружием и две машины. Держитесь во дворе 40 секунд, пока Сева прячет свидетеля.",
      reward: 4000,
      time: 180,
      thugs: wave,
      spawns: { h1: hunter(road(n, 6, 2, 0, 20), V), h2: hunter(road(n, 4, 5, 20, 0), 0) },
      steps: [{ kind: "hold", at: seva, radius: 18, seconds: 40, text: "Удержите двор Севы" }],
    },
    {
      id: "ch6-finale",
      chapter: 6,
      contact: seva,
      title: "Северный край",
      brief: "Их главарь, Бойко, собрал всех на северной окраине. Шесть стрелков и он сам, крепкий, как шкаф. Уберите всех, а потом уходите от полиции: такое не пропустят.",
      reward: 20000,
      thugs: last,
      heatAfter: { 0: 3 },
      steps: [
        { kind: "clear", targets: Object.keys(last), text: "Уберите Бойко и его людей" },
        { kind: "evade", text: "Оторвитесь от полиции" },
      ],
    },
  ];
}

/** The town hall square, where the mayor's people hold out. */
export function hallOf(n: number): Point {
  return road(n, 4, 2, 0, PITCH / 2);
}

export function chapterSeven(n: number): Mission[] {
  const office = places(n).office;
  const hall = hallOf(n);
  const V = Math.PI / 2;
  const scene = (list: ThugSpec[]) => keyed("t", list);
  // Three documents lie around the hall; a few armed men watch them.
  const papers = [road(n, 4, 2, 0, 22), road(n, 4, 3, 0, -22), road(n, 5, 2, -22, 0)];
  const watchers = scene([
    { ...road(n, 4, 2, 5, 6), heading: 0 },
    { ...road(n, 4, 3, -5, -6), heading: V },
    { ...road(n, 5, 2, -6, 5), heading: Math.PI },
  ]);
  const siege = scene([
    { ...road(n, 1, 1, 0, 24), heading: -V, alerted: true },
    { ...road(n, 1, 1, 0, 36), heading: -V, alerted: true },
    { ...road(n, 2, 2, -24, 0), heading: 0, alerted: true },
    { ...road(n, 2, 2, -34, 0), heading: 0, alerted: true },
    { ...road(n, 0, 2, 22, 5), heading: Math.PI, alerted: true },
    { ...road(n, 0, 2, 32, -5), heading: Math.PI, alerted: true },
    { ...road(n, 1, 3, 5, -22), heading: V, alerted: true },
    { ...road(n, 1, 3, -5, -32), heading: V, alerted: true },
  ]);
  const guards = scene([
    ...crew(hall.x - 9, hall.z - 14, "x", 4, 6, 0),
    ...crew(hall.x - 9, hall.z + 14, "x", 3, 6, 0),
    { ...road(n, 5, 2, 8, 12), heading: Math.PI },
    { ...road(n, 3, 2, -8, 12), heading: 0 },
    { x: hall.x, z: hall.z, heading: V, hp: 320 },
  ]);
  return [
    {
      id: "ch7-leak",
      chapter: 7,
      chapterTitle: "Глава 7: Мэрия",
      contact: office,
      title: "Утечка",
      brief: "Глава 7. За Северными стоял сам мэр. Помощник мэра едет на встречу: проследите за ним, не приближаясь. Потом заберите три папки с документами на площади у мэрии. Их стережёт охрана.",
      reward: 5000,
      time: 420,
      spawns: { aide: { kind: "sedan", color: 0x8395a7, ...road(n, 2, 2, 0, 20), heading: V, drives: true } },
      thugs: watchers,
      steps: [
        { kind: "tail", target: "aide", near: 16, far: 75, seconds: 40, text: "Следуйте за помощником мэра" },
        { kind: "collect", points: papers, radius: 5, text: "Заберите папки у мэрии" },
        { kind: "goto", at: office, radius: 8, vehicle: "any", text: "Отвезите документы Нике" },
      ],
    },
    {
      id: "ch7-cash",
      chapter: 7,
      contact: office,
      title: "Инкассатор",
      brief: "Деньги мэра возят в зелёном фургоне. Угоните его, привезите во двор Севы и оторвитесь от полиции: на угон инкассатора выйдет весь город.",
      reward: 5500,
      time: 300,
      heatAfter: { 0: 3 },
      spawns: { van: { kind: "van", color: 0x2ecc71, ...road(n, 5, 3, 22, 0), heading: 0, drives: false } },
      steps: [
        { kind: "enter", target: "van", text: "Угоните зелёный фургон" },
        { kind: "goto", at: sevaOf(n), radius: 8, vehicle: "van", text: "Довезите фургон до Севы" },
        { kind: "evade", text: "Оторвитесь от полиции" },
      ],
    },
    {
      id: "ch7-limo",
      chapter: 7,
      contact: office,
      title: "Кортеж мэра",
      brief: "Мэр уезжает из города в чёрном фургоне. Его сопровождают три машины охраны, и они таранят. Остановите фургон.",
      reward: 6500,
      time: 300,
      spawns: {
        limo: { kind: "van", color: 0x0b0c10, ...road(n, 6, 4, 0, 22), heading: V, drives: true },
        h1: hunter(road(n, 6, 5, 0, 22), V),
        h2: hunter(road(n, 5, 4, 22, 0), 0),
        h3: hunter(road(n, 7, 4, -22, 0), Math.PI),
      },
      steps: [{ kind: "destroy", target: "limo", text: "Остановите чёрный фургон мэра" }],
    },
    {
      id: "ch7-siege",
      chapter: 7,
      contact: office,
      title: "Штурм офиса",
      brief: "Люди мэра идут на офис Ники: восемь стрелков и две машины. Держитесь у офиса 50 секунд.",
      reward: 8000,
      time: 240,
      thugs: siege,
      spawns: { h1: hunter(road(n, 3, 2, 20, 0), Math.PI), h2: hunter(road(n, 1, 4, 0, -20), -V) },
      steps: [{ kind: "hold", at: office, radius: 20, seconds: 50, text: "Удержите офис" }],
    },
    {
      id: "ch7-finale",
      chapter: 7,
      contact: office,
      title: "Мэрия",
      brief: "Последний бой. Мэр засел на площади у мэрии с девятью людьми, сам он в пять раз крепче остальных. Уберите всех и уходите: будет погоня.",
      reward: 40000,
      thugs: guards,
      heatAfter: { 0: 4 },
      steps: [
        { kind: "clear", targets: Object.keys(guards), text: "Уберите мэра и его людей" },
        { kind: "evade", text: "Оторвитесь от полиции" },
      ],
    },
  ];
}

/** Captain Marta stands on the city marina pier. */
export const MARTA = { x: 281, z: -154 };

/** Water points for chapter four, all on open water. */
export const SEA = {
  lighthouse: { x: 690, z: 0 },
  /** Off the end of the marina pier, clear of the regatta start. */
  pierTip: { x: 306, z: -154 },
  southBuoy: { x: 560, z: -205 },
  crates: [
    { x: 380, z: -222 },
    { x: 600, z: -200 },
    { x: 690, z: -60 },
    { x: 650, z: 190 },
    { x: 420, z: 200 },
  ],
};

export function chapterFour(): Mission[] {
  const list: Mission[] = [
    {
      id: "ch4-cargo",
      chapter: 4,
      chapterTitle: "Глава 4: Открытая вода",
      contact: MARTA,
      title: "Ночной груз",
      brief: "Глава 4. Капитан Марта возит грузы мимо таможни. Возьмите тёмный скоростной катер у пристани и доставьте его к маяку. Береговая охрана уже в курсе.",
      reward: 3000,
      time: 240,
      boats: { cargo: { kind: "speedboat", color: 0x2d3436, x: 300, z: -154, heading: 0 } },
      protect: "cargo",
      heatAfter: { 0: 2 },
      steps: [
        { kind: "enter", target: "cargo", text: "Сядьте в тёмный катер у пристани" },
        { kind: "goto", at: SEA.lighthouse, radius: 12, vehicle: "cargo", text: "Доставьте груз к маяку" },
        { kind: "evade", text: "Уйдите от береговой охраны" },
      ],
    },
    {
      id: "ch4-fugitive",
      chapter: 4,
      contact: MARTA,
      title: "Беглец",
      brief: "Человек мэра удирает на красном катере вокруг острова. Возьмите катер у пристани, догоните его и тараньте, пока он не пойдёт ко дну.",
      reward: 3500,
      time: 300,
      boats: { runner: { kind: "motorboat", color: 0xc0392b, ...SMUGGLER_ROUTE[8], heading: 0, route: SMUGGLER_ROUTE, health: 45 } },
      steps: [{ kind: "destroy", target: "runner", text: "Протараньте красный катер, пока он не затонет" }],
    },
    {
      id: "ch4-crates",
      chapter: 4,
      contact: MARTA,
      title: "Сброшенный груз",
      brief: "Ночью с баржи сбросили ящики, они качаются на волнах вокруг острова. Соберите все пять раньше береговой охраны и вернитесь к пристани.",
      reward: 3200,
      time: 300,
      steps: [
        { kind: "collect", points: SEA.crates, radius: 8, text: "Соберите ящики на воде" },
        { kind: "goto", at: SEA.pierTip, radius: 10, vehicle: "boat", stop: true, text: "Вернитесь к городской пристани" },
      ],
    },
    {
      id: "ch4-buoy",
      chapter: 4,
      contact: MARTA,
      title: "Буй",
      brief: "У южного буя ночью пройдёт обмен. Держитесь рядом с буем 35 секунд, пока катер охраны пытается вас оттеснить.",
      reward: 4000,
      time: 360,
      heatAfter: { 0: 3 },
      steps: [
        { kind: "goto", at: SEA.southBuoy, radius: 14, vehicle: "boat", text: "Доплывите до южного буя" },
        { kind: "hold", at: SEA.southBuoy, radius: 22, seconds: 35, text: "Держитесь у буя" },
        { kind: "evade", text: "Уйдите от береговой охраны" },
      ],
    },
    {
      id: "ch4-finale",
      chapter: 4,
      contact: MARTA,
      title: "Шторм",
      brief: "В шторм хозяин мэра уходит на чёрном катере с деньгами города. Проследите, куда он идёт, потом отправьте его на дно и исчезните.",
      reward: 12000,
      time: 420,
      weather: "storm",
      boats: { boss: { kind: "motorboat", color: 0x111214, ...SMUGGLER_ROUTE[0], heading: 0, route: SMUGGLER_ROUTE, health: 70 } },
      heatAfter: { 1: 2 },
      steps: [
        { kind: "tail", target: "boss", near: 15, far: 90, seconds: 40, text: "Следуйте за чёрным катером на расстоянии" },
        { kind: "destroy", target: "boss", text: "Отправьте чёрный катер на дно" },
        { kind: "evade", text: "Заляжьте на дно" },
      ],
    },
  ];
  return list;
}

/** 50 km/h: the rigged car must not drop below it. */
export const BOMB_SPEED = 50 / 3.6;

export function chapterThree(n: number): Mission[] {
  const I = ISLAND_SPOTS;
  const P = places(n);
  const office = P.office;
  const list: Mission[] = [
    {
      id: "ch3-tail",
      chapter: 3,
      chapterTitle: "Глава 3: Большая вода",
      contact: office,
      title: "Хвост",
      brief: "Глава 3. Журналистка Ника копает под мэра Грачёва. Его помощник возит бумаги на серой машине. Держитесь за ним минуту: не ближе 12 метров, иначе он вас заметит.",
      reward: 1800,
      time: 180,
      spawns: { aide: { kind: "sedan", color: 0x8395a7, ...road(n, 2, 2, 0, 20), heading: Math.PI / 2, drives: true } },
      steps: [{ kind: "tail", target: "aide", near: 12, far: 55, seconds: 60, text: "Следите за серой машиной, не приближаясь" }],
    },
    {
      id: "ch3-papers",
      chapter: 3,
      contact: office,
      title: "Компромат",
      brief: "Помощник разложил копии документов по тайникам: четыре в углах города и один в порту. Соберите все и привезите Нике.",
      reward: 2600,
      time: 300,
      steps: [
        {
          kind: "collect",
          radius: 6,
          text: "Соберите папки из тайников",
          points: [road(n, 1, 1), road(n, n - 1, 1), road(n, n - 1, n - 1), road(n, 1, n - 1), I.docks],
        },
        { kind: "goto", at: office, radius: 7, stop: true, text: "Привезите папки Нике" },
      ],
    },
    {
      id: "ch3-bomb",
      chapter: 3,
      contact: office,
      title: "Горячая скорость",
      brief: "Грачёв узнал про Нику. В её машине бомба, которая сработает, если сбросить скорость ниже 50 км/ч. Держите скорость минуту, пока сапёр не отключит таймер по радио.",
      reward: 4000,
      time: 240,
      spawns: { rigged: { kind: "sedan", color: 0xe67e22, ...road(n, 1, 2, 0, 14), heading: Math.PI / 2, drives: false } },
      protect: "rigged",
      steps: [
        { kind: "enter", target: "rigged", text: "Сядьте в оранжевую машину Ники" },
        { kind: "speed", target: "rigged", min: BOMB_SPEED, seconds: 60, text: "Не сбрасывайте скорость ниже 50 км/ч" },
        { kind: "goto", at: P.paint, radius: 7, vehicle: "rigged", stop: true, text: "Таймер отключён. Отгоните машину к покраске" },
      ],
    },
    {
      id: "ch3-siege",
      chapter: 3,
      contact: office,
      title: "Осада",
      brief: "Люди мэра хотят отобрать склад Льва на острове. Держитесь у склада 40 секунд, пока Лев вывозит груз. Полиция куплена и приедет за вами.",
      reward: 3500,
      time: 360,
      heatAfter: { 0: 3 },
      steps: [
        { kind: "goto", at: I.lot, radius: 10, vehicle: "any", text: "Доберитесь до склада Льва на острове" },
        { kind: "hold", at: I.lot, radius: 16, seconds: 40, text: "Удерживайте склад" },
        { kind: "evade", text: "Оторвитесь от полиции" },
      ],
    },
    {
      id: "ch3-finale",
      chapter: 3,
      contact: office,
      title: "Большая вода",
      brief: "Грачёв бежит из города на чёрном фургоне. Проследите, куда он едет, а потом остановите фургон. После этого исчезните.",
      reward: 10000,
      time: 360,
      spawns: { mayor: { kind: "van", color: 0x0b0c10, ...road(n, n - 2, 2, 0, 20), heading: Math.PI / 2, drives: true } },
      heatAfter: { 0: 2 },
      steps: [
        { kind: "tail", target: "mayor", near: 10, far: 60, seconds: 40, text: "Следите за чёрным фургоном мэра" },
        { kind: "destroy", target: "mayor", text: "Уничтожьте фургон мэра" },
        { kind: "evade", text: "Заляжьте на дно" },
      ],
    },
  ];
  return list;
}

export function chapterTwo(n: number): Mission[] {
  const I = ISLAND_SPOTS;
  const list: Mission[] = [
    {
      id: "ch2-bridge",
      chapter: 2,
      chapterTitle: "Глава 2: Остров",
      title: "Мост",
      brief: "Глава 2. У Миры есть старый друг на острове, Лев, начальник порта. Переезжайте мост и найдите его у главной улицы.",
      reward: 800,
      time: 110,
      steps: [{ kind: "goto", at: I.contact, radius: 8, vehicle: "any", text: "Переедьте мост и найдите Льва" }],
    },
    {
      id: "ch2-container",
      chapter: 2,
      contact: I.contact,
      title: "Контейнер №7",
      brief: "В порту стоит фургон с грузом, который таможня считает своим. Отвезите его в городской гараж. Пост на мосту уже поднят по тревоге.",
      reward: 2500,
      time: 240,
      spawns: { van: { kind: "van", color: 0x2c3e50, ...I.lot, heading: Math.PI, drives: false } },
      protect: "van",
      heatAfter: { 0: 3 },
      steps: [
        { kind: "enter", target: "van", text: "Сядьте в тёмный фургон у склада" },
        { kind: "goto", at: places(n).garage, radius: 7, vehicle: "van", text: "Довезите фургон до гаража в городе" },
      ],
    },
    {
      id: "ch2-lighthouse",
      chapter: 2,
      contact: I.contact,
      title: "Огонь маяка",
      brief: "Лев проверяет водителей кругом по острову: мимо маяка, по всему кольцу и обратно к маяку.",
      reward: 1500,
      time: 75,
      steps: [
        {
          kind: "race",
          radius: 10,
          text: "Круг по острову",
          points: [I.cape, { x: 628, z: 108 }, { x: 412, z: 108 }, { x: 412, z: -108 }, { x: 628, z: -108 }, I.cape],
        },
      ],
    },
    {
      id: "ch2-raid",
      chapter: 2,
      contact: I.contact,
      title: "Облава",
      brief: "Полиция готовит облаву на порт. Отвлеките её на себя: четыре звезды, а потом исчезните.",
      reward: 3000,
      time: 360,
      steps: [
        { kind: "stars", min: 4, text: "Получите четыре звезды" },
        { kind: "evade", text: "Оторвитесь от полиции" },
      ],
    },
    {
      id: "ch2-finale",
      chapter: 2,
      contact: I.contact,
      title: "Последний прилив",
      brief: "Тот, кто сдал порт, уезжает с острова на серебристом спорткаре. Остановите его, вернитесь к маяку и заляжьте на дно.",
      reward: 6000,
      time: 300,
      spawns: { traitor: { kind: "sport", color: 0xbdc3c7, ...I.docks, heading: 0, drives: true } },
      steps: [
        { kind: "destroy", target: "traitor", text: "Уничтожьте серебристый спорткар" },
        { kind: "goto", at: I.cape, radius: 9, vehicle: "any", text: "Вернитесь к маяку" },
        { kind: "evade", text: "Заляжьте на дно" },
      ],
    },
  ];
  return list;
}

/** Chapter one, played in order from the contact marker. */
export function chapterOne(n: number): Mission[] {
  const c = n / 2;
  const edge = n;
  return [
    {
      id: "first-run",
      title: "Первый рейс",
      brief: "Мира держит склад в порту. Ей нужен водитель, который не задаёт вопросов. Найдите машину и доберитесь до причала.",
      reward: 500,
      time: 120,
      steps: [
        { kind: "goto", at: road(n, 1, edge, 0, -6), radius: 7, vehicle: "any", text: "Доберитесь на машине до причала на юге" },
      ],
    },
    {
      id: "van",
      title: "Горячий груз",
      brief: "У склада стоит фургон с чужим товаром. Заберите его и отгоните в гараж. Полиция уже ищет этот фургон, берегите его.",
      reward: 1200,
      time: 210,
      spawns: { van: { kind: "van", color: 0x6d4c41, ...road(n, c + 3, c - 2, 0, 12), heading: Math.PI / 2, drives: false } },
      protect: "van",
      heatAfter: { 0: 2 },
      steps: [
        { kind: "enter", target: "van", text: "Сядьте в коричневый фургон" },
        { kind: "goto", at: places(n).garage, radius: 7, vehicle: "van", text: "Отгоните фургон в гараж" },
      ],
    },
    {
      id: "noise",
      title: "Шум на проспекте",
      brief: "Нужно отвлечь полицию от порта. Наберите три звезды, а потом исчезните.",
      reward: 1500,
      time: 300,
      steps: [
        { kind: "stars", min: 3, text: "Получите три звезды розыска" },
        { kind: "evade", text: "Оторвитесь от полиции" },
      ],
    },
    {
      id: "rival",
      title: "Чёрный спорткар",
      brief: "Конкурент Миры катается по городу на чёрном спорткаре. Машина не должна доехать до конца дня.",
      reward: 2000,
      time: 240,
      spawns: { rival: { kind: "sport", color: 0x111214, ...road(n, c - 3, c + 3, 20, 0), heading: 0, drives: true } },
      steps: [
        { kind: "destroy", target: "rival", text: "Уничтожьте чёрный спорткар" },
        { kind: "evade", text: "Оторвитесь от полиции" },
      ],
    },
    {
      id: "tide",
      title: "Прилив",
      brief: "Последнее дело. Заберите машину Миры у покраски и за три минуты довезите её до маяка на северной окраине.",
      reward: 4000,
      time: 180,
      spawns: { car: { kind: "sport", color: 0x16a085, ...road(n, 2, c, 3.6, 18), heading: Math.PI / 2, drives: false } },
      protect: "car",
      heatAfter: { 0: 3 },
      steps: [
        { kind: "enter", target: "car", text: "Сядьте в бирюзовый спорткар" },
        { kind: "goto", at: road(n, n - 1, 0, 0, 6), radius: 8, vehicle: "car", text: "Довезите машину до маяка на севере" },
      ],
    },
  ];
}

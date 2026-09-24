import { PITCH, roadCoord } from "../world/city";
import type { Mission, Point } from "./missions";
import { LIGHTHOUSE } from "../world/island";

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
  return [...chapterOne(n), ...chapterTwo(n), ...chapterThree(n)];
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

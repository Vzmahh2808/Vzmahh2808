import { PITCH, roadCoord } from "../world/city";
import type { Mission, Point } from "./missions";

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

/** The story, played in order from the contact marker. */
export function storyMissions(n: number): Mission[] {
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

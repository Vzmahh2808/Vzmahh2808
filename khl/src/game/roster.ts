/** Invented players: a number and a common surname per position, stable for each club. */
import { Rng } from "../core/rng";
import type { Role } from "../sim/state";

const SURNAMES = [
  "Смирнов", "Кузнецов", "Попов", "Васильев", "Петров", "Соколов", "Михайлов", "Новиков", "Фёдоров", "Морозов", "Волков", "Алексеев", "Лебедев", "Семёнов", "Егоров",
  "Павлов", "Козлов", "Степанов", "Николаев", "Орлов", "Андреев", "Макаров", "Никитин", "Захаров", "Зайцев", "Соловьёв", "Борисов", "Яковлев", "Григорьев", "Романов",
  "Воробьёв", "Сергеев", "Кузьмин", "Фролов", "Александров", "Дмитриев", "Королёв", "Гусев", "Киселёв", "Ильин", "Максимов", "Поляков", "Сорокин", "Виноградов", "Ковалёв",
  "Белов", "Медведев", "Антонов", "Тарасов", "Жуков", "Баранов", "Филиппов", "Комаров", "Давыдов", "Беляев", "Герасимов", "Богданов", "Осипов", "Сидоров", "Матвеев",
  "Титов", "Марков", "Миронов", "Крылов", "Куликов", "Карпов", "Власов", "Мельников", "Денисов", "Гаврилов", "Тихонов", "Казаков", "Афанасьев", "Данилов", "Савельев",
  "Тимофеев", "Фомин", "Чернов", "Абрамов", "Мартынов", "Ефимов", "Федотов", "Щербаков", "Назаров", "Калинин", "Исаев", "Чернышёв", "Быков", "Маслов", "Родионов",
];

export interface Player {
  number: number;
  name: string;
}

const ORDER: Role[] = ["C", "LW", "RW", "LD", "RD", "G"];

const cache = new Map<number, Record<Role, Player>>();

/** Roster for a club: one player per on-ice role. Cached: the HUD asks every frame. */
export function rosterFor(teamId: number): Record<Role, Player> {
  const hit = cache.get(teamId);
  if (hit) return hit;
  const rng = new Rng(9000 + teamId * 131);
  const names = rng.shuffle([...SURNAMES]);
  const numbers = new Set<number>();
  const out = {} as Record<Role, Player>;
  ORDER.forEach((role, i) => {
    let n: number;
    do n = role === "G" ? rng.pick([1, 20, 30, 31, 35, 41, 50, 60, 72, 80, 88, 91]) : rng.int(2, 97);
    while (numbers.has(n));
    numbers.add(n);
    out[role] = { number: n, name: names[i] };
  });
  cache.set(teamId, out);
  return out;
}

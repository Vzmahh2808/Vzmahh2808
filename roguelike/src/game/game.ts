import { Rng } from "./rng";
import {
  DEFAULT_DUNGEON,
  findTile,
  generateDungeon,
  idx,
  inBounds,
  isPassable,
  roomCenter,
  tileAt,
} from "./dungeon";
import { computeFov } from "./fov";
import { DIRS8, canStep, chebyshev, distanceMap, pathFromDistance, UNREACHABLE } from "./path";
import { ITEMS, MONSTERS, itemDef, monsterDef } from "./data";
import {
  INVENTORY_LIMIT,
  MAX_DEPTH,
  SAVE_VERSION,
  Tile,
  type GameEvent,
  type GameState,
  type GroundItem,
  type Item,
  type ItemDef,
  type LogKind,
  type Monster,
  type MonsterDef,
  type Player,
  type Point,
  PLAYER_ID,
} from "./types";

export const FOV_RADIUS = 8;
const ALERT_TURNS = 12;
const LOG_LIMIT = 200;

export function xpToNext(level: number): number {
  return 15 * level * (level + 1);
}

export function scoreOf(state: GameState): number {
  const p = state.player;
  let score = p.gold + state.depth * 100 + p.xp + p.kills * 5;
  if (state.status === "won") score += 1000;
  return score;
}

function makePlayer(): Player {
  return {
    x: 0,
    y: 0,
    hp: 30,
    maxHp: 30,
    level: 1,
    xp: 0,
    strength: 0,
    gold: 0,
    inventory: [{ defId: "potion_heal" }],
    weapon: { defId: "dagger" },
    armor: null,
    poison: 0,
    kills: 0,
  };
}

export class Game {
  state: GameState;
  rng: Rng;
  visible: boolean[] = [];
  /** Transient feedback for the renderer and sound; not persisted. */
  events: GameEvent[] = [];

  private constructor(state: GameState) {
    this.state = state;
    this.rng = new Rng(state.rngState);
    this.refreshFov();
  }

  static newGame(seed: number): Game {
    const state: GameState = {
      version: SAVE_VERSION,
      seed,
      rngState: seed,
      depth: 1,
      turn: 0,
      map: { width: 0, height: 0, tiles: [], explored: [], rooms: [] },
      player: makePlayer(),
      monsters: [],
      items: [],
      log: [],
      status: "playing",
      nextMonsterId: 1,
      deathCause: "",
    };
    const game = new Game(state);
    game.buildLevel();
    game.log("Вы спускаетесь в подземелье. Найдите Сердце подземелья на 10-м этаже.", "system");
    game.log("Стрелки или WASD — движение, G — подобрать, I — инвентарь, > — спуск, ? — помощь.", "system");
    game.refreshFov();
    return game;
  }

  static fromState(state: GameState): Game {
    if (state.version !== SAVE_VERSION) throw new Error("несовместимая версия сохранения");
    return new Game(state);
  }

  /** Snapshot of the state with the RNG position synced, ready for JSON. */
  snapshot(): GameState {
    this.state.rngState = this.rng.getState();
    return this.state;
  }

  // ---------------------------------------------------------------- queries

  get player(): Player {
    return this.state.player;
  }

  isVisible(x: number, y: number): boolean {
    return inBounds(this.state.map, x, y) && this.visible[idx(this.state.map, x, y)] === true;
  }

  monsterAt(x: number, y: number): Monster | undefined {
    return this.state.monsters.find((m) => m.x === x && m.y === y);
  }

  itemsAt(x: number, y: number): GroundItem[] {
    return this.state.items.filter((g) => g.x === x && g.y === y);
  }

  attackRange(): [number, number] {
    const p = this.player;
    const base: [number, number] = p.weapon ? itemDef(p.weapon.defId).atk ?? [1, 3] : [1, 3];
    const bonus = p.strength + Math.floor((p.level - 1) / 2);
    return [base[0] + bonus, base[1] + bonus];
  }

  defense(): number {
    return this.player.armor ? itemDef(this.player.armor.defId).def ?? 0 : 0;
  }

  accuracy(): number {
    return 80 + this.player.level * 2;
  }

  evasion(): number {
    const armorEva = this.player.armor ? itemDef(this.player.armor.defId).eva ?? 0 : 0;
    return 10 + this.player.level + armorEva;
  }

  /** Turns between natural 1 HP heals; speeds up with level. */
  regenInterval(): number {
    return Math.max(2, 5 - Math.floor(this.player.level / 3));
  }

  visibleMonsters(): Monster[] {
    return this.state.monsters.filter((m) => this.isVisible(m.x, m.y));
  }

  // ---------------------------------------------------------------- logging

  log(text: string, kind: LogKind = "info"): void {
    this.state.log.push({ text, kind, turn: this.state.turn });
    if (this.state.log.length > LOG_LIMIT) this.state.log.splice(0, this.state.log.length - LOG_LIMIT);
  }

  private emit(x: number, y: number, text: string, color: string): void {
    this.events.push({ type: "float", x, y, text, color });
  }

  private event(ev: GameEvent): void {
    this.events.push(ev);
  }

  // ---------------------------------------------------------------- level building

  private buildLevel(): void {
    const s = this.state;
    s.map = generateDungeon(this.rng, DEFAULT_DUNGEON);
    s.monsters = [];
    s.items = [];
    const start = roomCenter(s.map.rooms[0]);
    s.player.x = start.x;
    s.player.y = start.y;

    if (s.depth >= MAX_DEPTH) {
      // Final floor: the boss guards the amulet where the stairs would have been.
      const stairs = findTile(s.map, Tile.StairsDown);
      if (stairs) {
        s.map.tiles[idx(s.map, stairs.x, stairs.y)] = Tile.Floor;
        this.addMonster("lord", stairs.x, stairs.y);
      }
    }

    const monsterCount = 4 + Math.floor(s.depth * 1.5);
    for (let i = 0; i < monsterCount; i++) this.spawnRandomMonster(false);

    const itemCount = 5 + Math.floor(s.depth / 2);
    for (let i = 0; i < itemCount; i++) {
      const spot = this.randomFreeFloor(true);
      if (spot) s.items.push({ x: spot.x, y: spot.y, item: this.randomItem() });
    }
    for (let i = 0; i < 3; i++) {
      const spot = this.randomFreeFloor(true);
      if (spot) {
        s.items.push({ x: spot.x, y: spot.y, item: { defId: "gold", amount: this.rng.int(5, 12) * s.depth } });
      }
    }
    this.refreshFov();
  }

  private addMonster(defId: string, x: number, y: number): Monster {
    const def = monsterDef(defId);
    const m: Monster = { id: this.state.nextMonsterId++, defId, x, y, hp: def.hp, maxHp: def.hp, alert: 0, poison: 0 };
    this.state.monsters.push(m);
    return m;
  }

  private randomFreeFloor(avoidStartRoom: boolean): Point | null {
    const map = this.state.map;
    const startRoom = map.rooms[0];
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = this.rng.int(1, map.width - 2);
      const y = this.rng.int(1, map.height - 2);
      if (tileAt(map, x, y) !== Tile.Floor) continue;
      if (avoidStartRoom && x >= startRoom.x - 1 && x < startRoom.x + startRoom.w + 1 && y >= startRoom.y - 1 && y < startRoom.y + startRoom.h + 1) continue;
      if (this.monsterAt(x, y)) continue;
      if (x === this.player.x && y === this.player.y) continue;
      return { x, y };
    }
    return null;
  }

  private spawnRandomMonster(outOfSight: boolean): Monster | null {
    const depth = this.state.depth;
    const pool = MONSTERS.filter((m) => m.weight > 0 && depth >= m.minDepth && depth <= m.maxDepth);
    if (pool.length === 0) return null;
    const def = this.rng.weighted(pool, (m) => m.weight);
    for (let attempt = 0; attempt < 20; attempt++) {
      const spot = this.randomFreeFloor(true);
      if (!spot) return null;
      if (outOfSight && this.isVisible(spot.x, spot.y)) continue;
      return this.addMonster(def.id, spot.x, spot.y);
    }
    return null;
  }

  private randomItem(): Item {
    const depth = this.state.depth;
    const pool = ITEMS.filter((i) => i.weight > 0 && depth >= i.minDepth);
    const def = this.rng.weighted(pool, (i) => i.weight);
    return { defId: def.id };
  }

  refreshFov(): void {
    const p = this.player;
    this.visible = computeFov(this.state.map, p.x, p.y, FOV_RADIUS);
  }

  // ---------------------------------------------------------------- player actions (return true when a turn passed)

  movePlayer(dx: number, dy: number): boolean {
    if (this.state.status !== "playing") return false;
    const p = this.player;
    const tx = p.x + dx;
    const ty = p.y + dy;
    const target = this.monsterAt(tx, ty);
    if (target) {
      this.playerAttack(target);
      this.endTurn();
      return true;
    }
    if (!canStep(this.state.map, p.x, p.y, tx, ty)) {
      this.event({ type: "blocked" });
      return false;
    }
    this.event({ type: "move", id: PLAYER_ID, from: { x: p.x, y: p.y }, to: { x: tx, y: ty } });
    p.x = tx;
    p.y = ty;
    this.afterStep();
    this.endTurn();
    return true;
  }

  private afterStep(): void {
    const p = this.player;
    const here = this.itemsAt(p.x, p.y);
    for (const g of here) {
      if (g.item.defId === "gold") {
        const amount = g.item.amount ?? 0;
        p.gold += amount;
        this.state.items.splice(this.state.items.indexOf(g), 1);
        this.log(`Вы подбираете ${amount} золота.`, "good");
        this.emit(p.x, p.y, `+${amount}$`, "#ffd32a");
        this.event({ type: "gold" });
      }
    }
    const rest = this.itemsAt(p.x, p.y);
    if (rest.length === 1) this.log(`Здесь лежит: ${itemName(rest[0].item)}. Нажмите G, чтобы подобрать.`);
    else if (rest.length > 1) this.log(`Здесь лежит несколько предметов. Нажмите G, чтобы подобрать.`);
    if (tileAt(this.state.map, p.x, p.y) === Tile.StairsDown) this.log("Здесь лестница вниз. Нажмите >, чтобы спуститься.", "warn");
  }

  wait(): boolean {
    if (this.state.status !== "playing") return false;
    this.endTurn();
    return true;
  }

  pickUp(): boolean {
    if (this.state.status !== "playing") return false;
    const p = this.player;
    const here = this.itemsAt(p.x, p.y);
    if (here.length === 0) {
      this.log("Здесь нечего подбирать.");
      return false;
    }
    let took = 0;
    for (const g of here) {
      if (g.item.defId === "amulet") {
        this.state.items.splice(this.state.items.indexOf(g), 1);
        this.state.status = "won";
        this.log("Вы берёте Сердце подземелья. Победа!", "good");
        this.event({ type: "win" });
        return true;
      }
      if (p.inventory.length >= INVENTORY_LIMIT) {
        this.log("Рюкзак полон.", "warn");
        break;
      }
      p.inventory.push(g.item);
      this.state.items.splice(this.state.items.indexOf(g), 1);
      this.log(`Вы подбираете: ${itemName(g.item)}.`, "good");
      this.event({ type: "pickup" });
      took++;
    }
    if (took === 0) return false;
    this.endTurn();
    return true;
  }

  descend(): boolean {
    if (this.state.status !== "playing") return false;
    const p = this.player;
    if (tileAt(this.state.map, p.x, p.y) !== Tile.StairsDown) {
      this.log("Здесь нет лестницы вниз.");
      return false;
    }
    this.state.depth++;
    this.event({ type: "descend" });
    this.buildLevel();
    this.log(`Вы спускаетесь на этаж ${this.state.depth}.`, "system");
    if (this.state.depth === MAX_DEPTH) this.log("Воздух дрожит. Владыка подземелья где-то рядом.", "warn");
    this.endTurn();
    return true;
  }

  dropItem(index: number): boolean {
    if (this.state.status !== "playing") return false;
    const p = this.player;
    const item = p.inventory[index];
    if (!item) return false;
    p.inventory.splice(index, 1);
    this.state.items.push({ x: p.x, y: p.y, item });
    this.log(`Вы бросаете: ${itemName(item)}.`);
    this.endTurn();
    return true;
  }

  /** Use a potion/scroll, or equip a weapon/armor. */
  useItem(index: number): boolean {
    if (this.state.status !== "playing") return false;
    const p = this.player;
    const item = p.inventory[index];
    if (!item) return false;
    const def = itemDef(item.defId);
    switch (def.kind) {
      case "weapon":
      case "armor":
        return this.equip(index, def);
      case "potion":
        p.inventory.splice(index, 1);
        this.event({ type: "potion" });
        this.drink(def);
        this.endTurn();
        return true;
      case "scroll":
        p.inventory.splice(index, 1);
        this.event({ type: "scroll", effect: def.effect });
        this.read(def);
        this.endTurn();
        return true;
      default:
        this.log("Это нельзя использовать.");
        return false;
    }
  }

  private equip(index: number, def: ItemDef): boolean {
    const p = this.player;
    const item = p.inventory[index];
    p.inventory.splice(index, 1);
    if (def.kind === "weapon") {
      if (p.weapon) p.inventory.push(p.weapon);
      p.weapon = item;
    } else {
      if (p.armor) p.inventory.push(p.armor);
      p.armor = item;
    }
    this.log(`Вы надеваете: ${def.name}.`, "good");
    this.event({ type: "pickup" });
    this.endTurn();
    return true;
  }

  private drink(def: ItemDef): void {
    const p = this.player;
    switch (def.effect) {
      case "heal": {
        const amount = Math.max(15, Math.floor(p.maxHp * 0.4));
        const healed = Math.min(p.maxHp - p.hp, amount);
        p.hp += healed;
        this.log(`Вы выпиваете зелье лечения: +${healed} HP.`, "good");
        this.emit(p.x, p.y, `+${healed}`, "#7bed9f");
        break;
      }
      case "fullheal":
        p.hp = p.maxHp;
        p.poison = 0;
        this.log("Вы полностью исцелены.", "good");
        this.emit(p.x, p.y, "♥", "#7bed9f");
        break;
      case "antidote":
        p.poison = 0;
        this.log("Яд выходит из вашего тела.", "good");
        break;
      case "strength":
        p.strength += 1;
        this.log("Вы чувствуете прилив силы: +1 к урону.", "good");
        break;
      case "toughness":
        p.maxHp += 5;
        p.hp += 5;
        this.log("Вы становитесь выносливее: +5 к максимальному здоровью.", "good");
        break;
      default:
        this.log("Ничего не происходит.");
    }
  }

  private read(def: ItemDef): void {
    const p = this.player;
    switch (def.effect) {
      case "teleport": {
        const spot = this.randomFreeFloor(false);
        if (spot) {
          this.event({ type: "teleport", from: { x: p.x, y: p.y }, to: spot });
          p.x = spot.x;
          p.y = spot.y;
          this.refreshFov();
          this.log("Мир вспыхивает — вы оказываетесь в другом месте.", "warn");
          this.afterStep();
        }
        break;
      }
      case "mapping": {
        const map = this.state.map;
        for (let y = 0; y < map.height; y++) {
          for (let x = 0; x < map.width; x++) {
            if (isPassable(map, x, y)) {
              map.explored[idx(map, x, y)] = true;
              for (const d of DIRS8) if (inBounds(map, x + d.x, y + d.y)) map.explored[idx(map, x + d.x, y + d.y)] = true;
            }
          }
        }
        this.log("План этажа проявляется у вас в голове.", "good");
        break;
      }
      case "fire": {
        const targets = this.visibleMonsters();
        if (targets.length === 0) {
          this.log("Огненный шар с рёвом уходит в пустоту.");
          break;
        }
        this.log(`Огненный шар накрывает ${targets.length} врагов!`, "warn");
        this.event({ type: "fire", targets: targets.map((m) => ({ x: m.x, y: m.y })) });
        for (const m of targets) {
          const dmg = this.rng.int(8, 14);
          this.damageMonster(m, dmg, "огонь");
        }
        break;
      }
      default:
        this.log("Свиток рассыпается в прах.");
    }
  }

  // ---------------------------------------------------------------- combat

  private playerAttack(m: Monster): void {
    const def = monsterDef(m.defId);
    const toHit = clamp(this.accuracy() - def.eva, 10, 95);
    const hit = this.rng.chance(toHit / 100);
    this.event({ type: "attack", id: PLAYER_ID, from: { x: this.player.x, y: this.player.y }, to: { x: m.x, y: m.y }, hit });
    if (!hit) {
      this.log(`Вы промахиваетесь: ${def.name} уворачивается.`);
      this.emit(m.x, m.y, "мимо", "#a4b0be");
      return;
    }
    const [lo, hi] = this.attackRange();
    const raw = this.rng.int(lo, hi);
    const dmg = Math.max(1, raw - def.def);
    this.damageMonster(m, dmg, "вы");
  }

  private damageMonster(m: Monster, dmg: number, source: string): void {
    const def = monsterDef(m.defId);
    m.hp -= dmg;
    m.alert = ALERT_TURNS;
    this.emit(m.x, m.y, `-${dmg}`, "#ff6b6b");
    this.event({ type: "damage", id: m.id, x: m.x, y: m.y, amount: dmg, player: false });
    if (m.hp <= 0) {
      this.state.monsters.splice(this.state.monsters.indexOf(m), 1);
      this.player.kills++;
      this.event({ type: "monsterDeath", x: m.x, y: m.y, glyph: def.glyph, color: def.color });
      this.log(`${cap(def.name)} погибает.`, "good");
      this.gainXp(def.xp);
      if (def.special === "boss") {
        this.state.items.push({ x: m.x, y: m.y, item: { defId: "amulet" } });
        this.log("Владыка повержен! Сердце подземелья падает на пол.", "good");
      }
      return;
    }
    if (source === "вы") this.log(`Вы бьёте ${def.nameAcc}: ${dmg} урона.`);
    else this.log(`${cap(def.name)} получает ${dmg} урона от огня.`);
  }

  private gainXp(amount: number): void {
    const p = this.player;
    p.xp += amount;
    while (p.xp >= xpToNext(p.level)) {
      p.level++;
      const gain = this.rng.int(5, 8);
      p.maxHp += gain;
      p.hp = Math.min(p.maxHp, p.hp + gain);
      this.log(`Уровень ${p.level}! Максимальное здоровье +${gain}.`, "good");
      this.emit(p.x, p.y, "LEVEL UP", "#ffd32a");
      this.event({ type: "levelup" });
    }
  }

  private monsterAttack(m: Monster): void {
    const def = monsterDef(m.defId);
    const p = this.player;
    const toHit = clamp(def.acc - this.evasion(), 10, 95);
    const hit = this.rng.chance(toHit / 100);
    this.event({ type: "attack", id: m.id, from: { x: m.x, y: m.y }, to: { x: p.x, y: p.y }, hit });
    if (!hit) {
      this.log(`${cap(def.name)} промахивается.`);
      this.emit(p.x, p.y, "мимо", "#a4b0be");
      return;
    }
    const raw = this.rng.int(def.atk[0], def.atk[1]);
    const dmg = Math.max(0, raw - this.defense());
    if (dmg === 0) {
      this.log(`${cap(def.name)} бьёт, но броня выдерживает.`);
      this.emit(p.x, p.y, "0", "#a4b0be");
      return;
    }
    p.hp -= dmg;
    this.emit(p.x, p.y, `-${dmg}`, "#ff4d6d");
    this.event({ type: "damage", id: PLAYER_ID, x: p.x, y: p.y, amount: dmg, player: true });
    this.log(`${cap(def.name)} атакует вас: ${dmg} урона.`, "bad");
    if (def.special === "poison" && this.rng.chance(0.3) && p.poison === 0) {
      p.poison = 5;
      this.log("Вы отравлены!", "bad");
    }
    if (def.special === "drain") {
      m.hp = Math.min(m.maxHp, m.hp + dmg);
    }
    if (p.hp <= 0) this.die(def.name);
  }

  private die(cause: string): void {
    const p = this.player;
    p.hp = 0;
    this.state.status = "dead";
    this.state.deathCause = cause;
    this.event({ type: "death" });
    this.log(`Вы погибли на этаже ${this.state.depth}. Причина: ${cause}.`, "bad");
  }

  // ---------------------------------------------------------------- turn processing

  private endTurn(): void {
    const s = this.state;
    if (s.status !== "playing") return;
    s.turn++;
    this.tickPlayerStatus();
    if (s.status !== "playing") return;
    this.monstersAct();
    if (s.status !== "playing") return;
    if (s.turn % 60 === 0 && s.monsters.length < 6 + s.depth * 2) this.spawnRandomMonster(true);
    this.refreshFov();
  }

  private tickPlayerStatus(): void {
    const p = this.player;
    if (p.poison > 0) {
      p.poison--;
      p.hp -= 1;
      this.emit(p.x, p.y, "-1", "#7bed9f");
      if (p.hp <= 0) {
        this.die("яд");
        return;
      }
    } else if (this.state.turn % this.regenInterval() === 0 && p.hp < p.maxHp) {
      p.hp++;
    }
  }

  private monstersAct(): void {
    const s = this.state;
    const p = this.player;
    const dist = distanceMap(s.map, [{ x: p.x, y: p.y }]);
    for (const m of [...s.monsters]) {
      if (s.status !== "playing") return;
      if (!s.monsters.includes(m)) continue;
      const def = monsterDef(m.defId);
      if (def.special === "regen" && m.hp < m.maxHp) m.hp++;
      if (m.poison > 0) {
        m.poison--;
        m.hp--;
        if (m.hp <= 0) {
          s.monsters.splice(s.monsters.indexOf(m), 1);
          continue;
        }
      }
      if (this.isVisible(m.x, m.y)) m.alert = ALERT_TURNS;
      if (m.alert <= 0) {
        if (this.rng.chance(0.3)) this.randomStep(m);
        continue;
      }
      m.alert--;
      const adjacent = chebyshev(m, p) === 1;
      const fleeing = def.ai === "coward" && m.hp < m.maxHp * 0.3;
      if (fleeing) {
        this.fleeStep(m, dist);
        continue;
      }
      if (def.ai === "erratic" && this.rng.chance(0.5)) {
        this.randomStep(m);
        continue;
      }
      if (adjacent) {
        this.monsterAttack(m);
        continue;
      }
      if (!this.chaseStep(m, dist)) this.randomStep(m);
    }
  }

  private isFree(x: number, y: number): boolean {
    return !this.monsterAt(x, y) && !(this.player.x === x && this.player.y === y);
  }

  private chaseStep(m: Monster, dist: Int32Array): boolean {
    const map = this.state.map;
    let best: Point | null = null;
    let bestD = dist[idx(map, m.x, m.y)];
    if (bestD >= UNREACHABLE) return false;
    for (const d of this.rng.shuffle([...DIRS8])) {
      const nx = m.x + d.x;
      const ny = m.y + d.y;
      if (!canStep(map, m.x, m.y, nx, ny) || !this.isFree(nx, ny)) continue;
      const nd = dist[idx(map, nx, ny)];
      if (nd < bestD) {
        bestD = nd;
        best = { x: nx, y: ny };
      }
    }
    if (!best) return false;
    this.moveMonster(m, best);
    return true;
  }

  private fleeStep(m: Monster, dist: Int32Array): void {
    const map = this.state.map;
    let best: Point | null = null;
    let bestD = dist[idx(map, m.x, m.y)];
    for (const d of this.rng.shuffle([...DIRS8])) {
      const nx = m.x + d.x;
      const ny = m.y + d.y;
      if (!canStep(map, m.x, m.y, nx, ny) || !this.isFree(nx, ny)) continue;
      const nd = dist[idx(map, nx, ny)];
      if (nd > bestD && nd < UNREACHABLE) {
        bestD = nd;
        best = { x: nx, y: ny };
      }
    }
    if (best) {
      this.moveMonster(m, best);
    } else if (chebyshev(m, this.player) === 1) {
      this.monsterAttack(m);
    }
  }

  private randomStep(m: Monster): void {
    const d = this.rng.pick(DIRS8);
    const nx = m.x + d.x;
    const ny = m.y + d.y;
    if (canStep(this.state.map, m.x, m.y, nx, ny) && this.isFree(nx, ny)) {
      this.moveMonster(m, { x: nx, y: ny });
    }
  }

  private moveMonster(m: Monster, to: Point): void {
    if (this.isVisible(m.x, m.y) || this.isVisible(to.x, to.y)) {
      this.event({ type: "move", id: m.id, from: { x: m.x, y: m.y }, to });
    }
    m.x = to.x;
    m.y = to.y;
  }

  // ---------------------------------------------------------------- travel helpers (used by the UI)

  /** Path over explored tiles from the player to (x, y), or an empty array. */
  pathTo(x: number, y: number): Point[] {
    const map = this.state.map;
    if (!inBounds(map, x, y) || !map.explored[idx(map, x, y)] || !isPassable(map, x, y)) return [];
    const dist = distanceMap(map, [{ x, y }], (px, py) => !map.explored[idx(map, px, py)]);
    return pathFromDistance(map, dist, { x: this.player.x, y: this.player.y });
  }

  /** Nearest explored tile that borders unexplored space; falls back to the stairs. */
  exploreTarget(): Point | null {
    const map = this.state.map;
    const p = this.player;
    const dist = distanceMap(map, [{ x: p.x, y: p.y }], (px, py) => !map.explored[idx(map, px, py)]);
    let best: Point | null = null;
    let bestD = UNREACHABLE;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = idx(map, x, y);
        const d = dist[i];
        if (d === 0 || d >= bestD || !isPassable(map, x, y)) continue;
        const frontier = DIRS8.some((dir) => inBounds(map, x + dir.x, y + dir.y) && !map.explored[idx(map, x + dir.x, y + dir.y)]);
        if (frontier) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    if (best) return best;
    const stairs = findTile(map, Tile.StairsDown);
    if (stairs && map.explored[idx(map, stairs.x, stairs.y)] && !(stairs.x === p.x && stairs.y === p.y)) return stairs;
    return null;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function itemName(item: Item): string {
  const def = itemDef(item.defId);
  if (def.kind === "gold") return `${item.amount ?? 0} золота`;
  return def.name;
}

export function itemDescription(item: Item): string {
  return itemDef(item.defId).description;
}

export function monsterDefOf(m: Monster): MonsterDef {
  return monsterDef(m.defId);
}

import { CATEGORIES, NAMES, ROLES, TERRAIN, WEATHER, WEATHER_CHAIN } from "./data";
import { findPath } from "./path";
import { Rng } from "./rng";
import {
  DAY_HOURS,
  SAVE_VERSION,
  type Category,
  type GameEvent,
  type GameState,
  type LogKind,
  type Member,
  type Point,
  type RiverMethod,
  type Role,
  type Setup,
  type StageChallenge,
  type Tile,
  type Weather,
} from "./types";
import { generateWorld, samePoint, tileAt } from "./world";

export const MEMBER_COUNT = 4;
export const ROSTER_SIZE = 6;
const ALL_ROLES: Role[] = ["leader", "quartermaster", "medic", "mechanic"];

/** Stage outcome thresholds on the 0..1 quality scale. */
export const QUALITY_OK = 0.6;
export const QUALITY_SLIP = 0.3;

const EPS = 1e-6;

export class Game {
  state: GameState;
  events: GameEvent[] = [];
  private rng: Rng;

  private constructor(state: GameState) {
    this.state = state;
    this.rng = new Rng(0);
    this.rng.setState(state.rngState);
  }

  /**
   * Candidates for the group: six people with every role covered at least once.
   * Uses its own random stream so the roster does not disturb map generation.
   */
  static roster(seed: number, category: Category): Member[] {
    const rng = new Rng((seed ^ 0x9e3779b9) >>> 0);
    const names = rng.shuffle([...NAMES]).slice(0, ROSTER_SIZE);
    const roles = rng.shuffle([...ALL_ROLES]);
    while (roles.length < ROSTER_SIZE) roles.push(rng.pick(ALL_ROLES));
    rng.shuffle(roles);
    return names.map((n, i) => {
      let technique = rng.int(1, 5);
      let strength = rng.int(1, 5);
      // Nobody is useless: weak walkers are skilled and vice versa.
      if (technique + strength < 5) technique = 5 - strength;
      if (technique + strength > 8 && category === 1) strength = Math.max(1, 8 - technique);
      return { id: i + 1, name: n.name, female: n.female, role: roles[i], technique, strength, health: 100, stamina: 100, injury: 0 };
    });
  }

  /** Allowed ranges for the pre-trip supplies. */
  static setupLimits(category: Category): { food: [number, number]; gas: [number, number]; kit: [number, number] } {
    const days = CATEGORIES[category].days;
    return { food: [5, days + 3], gas: [3, days + 2], kit: [0, 4] };
  }

  static defaultSetup(category: Category, roster: Member[]): Setup {
    const def = CATEGORIES[category];
    return { memberIds: roster.slice(0, MEMBER_COUNT).map((m) => m.id), foodPerMember: def.foodPerMember, gas: def.gas, kit: def.kit, rope: true };
  }

  /** Group load in kilograms for a given team size and supplies. */
  static loadOf(memberCount: number, supplies: { food: number; gas: number; rope: boolean }): number {
    return Math.round(memberCount * 14 + supplies.food * 0.7 + supplies.gas * 0.25 + (supplies.rope ? 3 : 0));
  }

  static newGame(seed: number, category: Category, setup?: Setup): Game {
    const rng = new Rng(seed);
    const def = CATEGORIES[category];
    const world = generateWorld(rng, category);
    const roster = Game.roster(seed, category);
    const chosen = setup ?? Game.defaultSetup(category, roster);
    const ids = [...new Set(chosen.memberIds)].filter((id) => roster.some((m) => m.id === id)).slice(0, MEMBER_COUNT);
    if (ids.length !== MEMBER_COUNT) throw new Error(`setup must pick ${MEMBER_COUNT} distinct members from the roster`);
    const members: Member[] = ids.map((id) => ({ ...roster.find((m) => m.id === id)! }));
    const limits = Game.setupLimits(category);
    const clamp = (v: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, Math.round(v)));
    const foodPerMember = clamp(chosen.foodPerMember, limits.food);
    const weather: Weather = rng.chance(0.7) ? "clear" : "cloudy";
    const state: GameState = {
      version: SAVE_VERSION,
      seed,
      rngState: 0,
      category,
      width: world.width,
      height: world.height,
      tiles: world.tiles,
      start: world.start,
      finish: world.finish,
      checkpoints: world.checkpoints,
      pos: { ...world.start },
      day: 1,
      deadline: def.days,
      hours: DAY_HOURS,
      weather,
      forecast: weather,
      members,
      supplies: { food: foodPerMember * MEMBER_COUNT, gas: clamp(chosen.gas, limits.gas), rope: chosen.rope, kit: clamp(chosen.kit, limits.kit) },
      morale: 75,
      pending: null,
      pendingChoice: null,
      choiceDay: 0,
      status: "playing",
      endReason: "",
      stats: { tiles: 0, stages: 0, falls: 0, peaks: 0, restDays: 0 },
      log: [],
      trail: [{ ...world.start }],
    };
    const game = new Game(state);
    game.rng = rng;
    game.state.forecast = game.nextWeather(weather);
    game.log(`Маршрут ${def.short}: ${def.checkpoints} КП, контрольный срок ${def.days} дн.`, "system");
    game.log("Выход из посёлка. Стрелки или клик по карте — идти, «Лагерь» — закончить день.", "system");
    game.syncRng();
    return game;
  }

  static fromState(state: GameState): Game {
    return new Game(state);
  }

  snapshot(): GameState {
    this.syncRng();
    return this.state;
  }

  private syncRng(): void {
    this.state.rngState = this.rng.getState();
  }

  log(text: string, kind: LogKind = "info"): void {
    this.state.log.push({ day: this.state.day, text, kind });
    if (this.state.log.length > 200) this.state.log.splice(0, this.state.log.length - 200);
  }

  // ---------------------------------------------------------------- queries

  tile(p: Point): Tile | null {
    return tileAt(this.state, p);
  }

  get categoryDef() {
    return CATEGORIES[this.state.category];
  }

  hasRole(role: Role): boolean {
    return this.state.members.some((m) => m.role === role);
  }

  /** Total group load in kilograms. */
  loadKg(): number {
    return Game.loadOf(this.state.members.length, this.state.supplies);
  }

  averageStamina(): number {
    const ms = this.state.members;
    return ms.reduce((a, m) => a + m.stamina, 0) / Math.max(1, ms.length);
  }

  averageHealth(): number {
    const ms = this.state.members;
    return ms.reduce((a, m) => a + m.health, 0) / Math.max(1, ms.length);
  }

  /** Combined multiplier on walking time from load, fatigue, injuries, morale and weather. */
  speedFactor(): number {
    let f = WEATHER[this.state.weather].speed;
    f *= 1 + Math.max(0, (this.loadKg() - 70) / 120);
    const st = this.averageStamina();
    if (st < 25) f *= 1.5;
    else if (st < 50) f *= 1.2;
    if (this.state.members.some((m) => m.injury > 0)) f *= 1.3;
    if (this.state.morale < 25) f *= 1.15;
    return f;
  }

  /** Why a tile cannot be entered right now, or null when it can. */
  blockReason(p: Point): string | null {
    const t = this.tile(p);
    if (!t) return "Край карты.";
    if (!TERRAIN[t.t].passable) return `${TERRAIN[t.t].name}: не пройти.`;
    if (WEATHER[this.state.weather].closesHeights && (t.t === "pass" || t.t === "glacier" || t.t === "peak")) {
      return `${TERRAIN[t.t].name} закрыт непогодой — переждите.`;
    }
    return null;
  }

  /** Hours needed to enter a neighbouring tile, or null when it is blocked. */
  moveCost(p: Point): number | null {
    if (this.blockReason(p)) return null;
    const t = this.tile(p)!;
    let base = TERRAIN[t.t].hours;
    if (t.t === "river") base = this.state.supplies.rope ? 1.25 : 0.75;
    return Math.round(base * this.speedFactor() * 4) / 4;
  }

  /** Planning path for the click-to-travel UI; stage tiles cost their nominal hours. */
  pathTo(target: Point): Point[] | null {
    return findPath(this.state, this.state.pos, target, (_t, p) => this.moveCost(p) ?? 0);
  }

  pathHours(path: Point[]): number {
    return Math.round(path.reduce((a, p) => a + (this.moveCost(p) ?? 0), 0) * 4) / 4;
  }

  checkpointAt(p: Point) {
    return this.state.checkpoints.find((c) => samePoint(c.pos, p)) ?? null;
  }

  allCheckpointsTaken(): boolean {
    return this.state.checkpoints.every((c) => c.taken);
  }

  // ---------------------------------------------------------------- movement

  /** Step one tile. Returns true when the state changed (moved or a stage began). */
  move(dx: number, dy: number): boolean {
    const s = this.state;
    if (s.status !== "playing" || s.pending || s.pendingChoice) return false;
    const to = { x: s.pos.x + dx, y: s.pos.y + dy };
    const reason = this.blockReason(to);
    if (reason) {
      this.log(reason, "warn");
      return false;
    }
    const cost = this.moveCost(to)!;
    if (cost > s.hours + EPS) {
      this.log(`Не успеваем до темноты: нужно ${fmtHours(cost)}, осталось ${fmtHours(s.hours)}. Пора ставить лагерь.`, "warn");
      return false;
    }
    const t = this.tile(to)!;
    if (t.t === "river" || t.t === "pass") {
      this.beginStage(t.t, to);
      return true;
    }
    s.hours = round1(s.hours - cost);
    this.drain(TERRAIN[t.t].stamina);
    this.terrainHazards(t.t);
    this.arrive(to);
    this.syncRng();
    return true;
  }

  private drain(base: number): void {
    const extra = WEATHER[this.state.weather].drain;
    for (const m of this.state.members) {
      const cost = base * (1.25 - m.strength * 0.1) + extra + (m.injury > 0 ? 2 : 0);
      m.stamina = Math.max(0, Math.round(m.stamina - cost));
      if (m.stamina === 0) {
        m.health = Math.max(0, m.health - 4);
        this.log(`${m.name} совсем ${v(m, "выдохся", "выдохлась")} — идём на морально-волевых.`, "bad");
      }
    }
    this.checkEvacuation();
  }

  private terrainHazards(t: Tile["t"]): void {
    const s = this.state;
    if (t === "glacier") {
      const p = s.supplies.rope ? 0.03 : 0.12;
      if (this.rng.chance(p)) {
        const m = this.rng.pick(s.members);
        m.health = Math.max(0, m.health - 15);
        m.stamina = Math.max(0, m.stamina - 20);
        this.addMorale(-8);
        s.stats.falls++;
        this.events.push({ type: "hurt", memberId: m.id });
        this.log(`${m.name} ${v(m, "провалился", "провалилась")} в трещину на леднике! Вытащили, но здоровье −15.`, "bad");
        if (this.rng.chance(0.4)) m.injury = Math.max(m.injury, 2);
      }
    } else if (t === "forest" || t === "swamp") {
      if (this.rng.chance(0.08)) {
        const lost = Math.min(s.hours, 1);
        s.hours = round1(s.hours - lost);
        this.log(`Потеряли тропу и час плутали ${t === "forest" ? "по лесу" : "по болоту"}.`, "warn");
      }
    } else if (t === "scree") {
      if (this.rng.chance(0.05)) {
        const m = this.rng.pick(s.members);
        m.health = Math.max(0, m.health - 8);
        this.events.push({ type: "hurt", memberId: m.id });
        this.log(`Живой камень: ${m.name} ${v(m, "ушиб", "ушибла")} ногу (здоровье −8).`, "bad");
      }
    }
  }

  private arrive(to: Point): void {
    const s = this.state;
    this.events.push({ type: "move", from: { ...s.pos }, to: { ...to } });
    s.pos = { ...to };
    s.stats.tiles++;
    const last = s.trail[s.trail.length - 1];
    if (!last || !samePoint(last, to)) s.trail.push({ ...to });
    if (s.trail.length > 600) s.trail.splice(0, s.trail.length - 600);

    const t = this.tile(to)!;
    if (t.t === "peak") {
      const already = s.trail.slice(0, -1).some((p) => samePoint(p, to));
      if (!already) {
        s.stats.peaks++;
        this.addMorale(15);
        this.events.push({ type: "peak" });
        this.log("Вершина! Записка в туре, фото на память. Мораль +15.", "good");
      }
    }
    const cp = this.checkpointAt(to);
    if (cp && !cp.taken) {
      cp.taken = true;
      this.addMorale(8);
      this.events.push({ type: "checkpoint", id: cp.id });
      const left = s.checkpoints.filter((c) => !c.taken).length;
      this.log(`КП ${cp.id} «${cp.name}» отмечен. ${left ? `Осталось ${left}.` : "Все КП собраны — теперь к финишу!"}`, "good");
    }
    if (samePoint(to, s.finish)) {
      if (this.allCheckpointsTaken()) {
        this.finish("won", "Маршрут пройден");
      } else {
        this.log("Это финишный посёлок, но не все КП отмечены. Маршрут не засчитают.", "warn");
      }
    }
    this.checkEvacuation();
    if (s.status === "playing" && s.choiceDay !== s.day && s.hours >= 1 && this.rng.chance(0.3)) this.offerChoice();
  }

  // ---------------------------------------------------------------- trail dilemmas

  /** Picks an applicable dilemma for the current tile; used by tests with an explicit id. */
  offerChoice(id?: string): boolean {
    const s = this.state;
    if (s.pendingChoice || s.status !== "playing") return false;
    const here = this.tile(s.pos)!.t;
    const pool = Object.entries(CHOICES).filter(([key, def]) => (id ? key === id : def.when(this, here)));
    if (pool.length === 0) return false;
    const [key, def] = id ? pool[0] : this.rng.weighted(pool, ([, d]) => d.weight);
    const options = def.options.filter((o) => !o.when || o.when(this));
    const member = this.rng.pick(s.members);
    s.pendingChoice = {
      id: key,
      title: def.title,
      text: def.text(this, member),
      options: options.map((o) => ({ label: o.label, hint: o.hint(this) })),
    };
    // Remember who the dilemma is about, so the effect hits the same person.
    this.choiceMember = member.id;
    s.choiceDay = s.day;
    this.events.push({ type: "choice" });
    this.log(`${def.title}. Решайте.`, "system");
    this.syncRng();
    return true;
  }

  /** Resolve the pending dilemma with the chosen option index. */
  choose(index: number): boolean {
    const s = this.state;
    const c = s.pendingChoice;
    if (!c || s.status !== "playing") return false;
    const def = CHOICES[c.id];
    const options = def.options.filter((o) => !o.when || o.when(this));
    const opt = options[index];
    if (!opt) return false;
    const member = s.members.find((m) => m.id === this.choiceMember) ?? s.members[0];
    s.pendingChoice = null;
    opt.apply(this, member);
    this.checkEvacuation();
    this.syncRng();
    return true;
  }

  private choiceMember = 0;

  /** Random helpers for the dilemma registry. */
  roll(p: number): boolean {
    return this.rng.chance(p);
  }
  spendHours(h: number): void {
    this.state.hours = round1(Math.max(0, this.state.hours - h));
  }
  giveHours(h: number): void {
    this.state.hours = round1(Math.min(DAY_HOURS, this.state.hours + h));
  }
  hurt(m: Member, health: number, stamina = 0): void {
    m.health = Math.max(0, m.health - health);
    m.stamina = Math.max(0, m.stamina - stamina);
    if (health > 0) this.events.push({ type: "hurt", memberId: m.id });
  }

  // ---------------------------------------------------------------- stages

  private beginStage(kind: "river" | "pass", to: Point): void {
    const s = this.state;
    const methods: RiverMethod[] = kind === "river" ? (s.supplies.rope ? ["ford", "rope"] : ["ford"]) : [];
    const stage: StageChallenge = {
      kind,
      from: { ...s.pos },
      to,
      methods,
      method: kind === "river" ? "ford" : null,
      zones: [],
      hours: 0,
      sequence: 3 + s.category,
    };
    s.pending = stage;
    this.applyMethod(stage);
    this.events.push({ type: "stage", kind });
    this.log(kind === "river" ? "Река. Выберите способ переправы и переведите группу." : "Перевальный взлёт. Повторите последовательность движений по перилам.", "system");
    this.syncRng();
  }

  chooseMethod(method: RiverMethod): boolean {
    const p = this.state.pending;
    if (!p || p.kind !== "river" || !p.methods.includes(method)) return false;
    p.method = method;
    this.applyMethod(p);
    return true;
  }

  private applyMethod(stage: StageChallenge): void {
    const s = this.state;
    const w = WEATHER[s.weather];
    const wet = s.weather === "rain" || s.weather === "storm";
    stage.zones = s.members.map((m) => {
      let half = 0.06 + m.technique * 0.025 - w.zonePenalty;
      if (m.stamina < 30) half -= 0.03;
      if (m.injury > 0) half -= 0.02;
      if (s.morale < 30) half -= 0.02;
      if (stage.kind === "river") {
        if (stage.method === "rope") half *= 1.8;
        else if (wet) half *= 0.6;
      }
      return Math.max(0.03, Math.min(0.45, round3(half)));
    });
    const base = stage.kind === "pass" ? 2.5 : stage.method === "rope" ? 2 : 0.75;
    stage.hours = round1(base * this.speedFactor());
  }

  /** Back out of a stage without crossing; the group stays on its tile. */
  cancelStage(): boolean {
    if (!this.state.pending) return false;
    this.state.pending = null;
    this.log("Решили не рисковать и отошли от берега.", "info");
    return true;
  }

  /**
   * Resolve the pending stage from mini-game results. `qualities` holds one value
   * per member (0..1), or a single value for the whole group which is then adjusted
   * by each member's technique.
   */
  resolveStage(qualities: number[]): boolean {
    const s = this.state;
    const stage = s.pending;
    if (!stage || s.status !== "playing") return false;
    if (stage.hours > s.hours + EPS) {
      // Time ran out while choosing: the crossing eats what is left and spills into tomorrow.
      this.log("Переправа затянулась до темноты — ночуем прямо на берегу.", "warn");
    }
    let falls = 0;
    let slips = 0;
    s.members.forEach((m, i) => {
      const raw = qualities.length === s.members.length ? qualities[i] : (qualities[0] ?? 0) + (m.technique - 3) * 0.05;
      const q = Math.max(0, Math.min(1, raw));
      if (q >= QUALITY_OK) return;
      const safe = stage.kind === "river" && stage.method === "rope";
      if (q >= QUALITY_SLIP || safe) {
        slips++;
        m.stamina = Math.max(0, m.stamina - 15);
        this.log(`${m.name} ${stage.kind === "river" ? v(m, "оступился", "оступилась") + " в воде" : v(m, "сорвался", "сорвалась") + " на перилах, но " + v(m, "удержался", "удержалась")}. Выносливость −15.`, "warn");
        return;
      }
      falls++;
      const dmg = stage.kind === "river" ? this.rng.int(10, 20) : this.rng.int(15, 30);
      m.health = Math.max(0, m.health - dmg);
      m.stamina = Math.max(0, m.stamina - 25);
      this.addMorale(-8);
      s.stats.falls++;
      this.events.push({ type: "hurt", memberId: m.id });
      if (this.rng.chance(0.35)) m.injury = Math.max(m.injury, this.rng.int(2, 3));
      if (stage.kind === "river") {
        s.supplies.food = Math.max(0, s.supplies.food - 1);
        this.log(`${m.name} ${v(m, "упал", "упала")} в реку! Здоровье −${dmg}, промок рюкзак с едой.`, "bad");
      } else {
        this.log(`${m.name} ${v(m, "сорвался", "сорвалась")} на взлёте! Здоровье −${dmg}.`, "bad");
      }
    });
    if (falls === 0 && slips === 0) {
      this.addMorale(4);
      this.log(stage.kind === "river" ? "Чисто перешли. Мораль +4." : "Перила сняты, все наверху. Мораль +4.", "good");
    }
    s.hours = round1(Math.max(0, s.hours - stage.hours));
    s.stats.stages++;
    this.drain(stage.kind === "pass" ? 12 : 5);
    s.pending = null;
    this.events.push({ type: "stageResult", ok: falls === 0 });
    if (s.status === "playing") this.arrive(stage.to);
    this.syncRng();
    return true;
  }

  /** Stage quality a bot would achieve: technique with some luck. Used by tests and the simulator. */
  autoQuality(member: Member): number {
    const q = 0.3 + member.technique * 0.12 + this.rng.next() * 0.3 - (member.stamina < 30 ? 0.2 : 0);
    return Math.max(0, Math.min(1, q));
  }

  // ---------------------------------------------------------------- camp

  /** End the day. `rest` turns it into a full rest day (днёвка) with better recovery. */
  camp(rest = false): boolean {
    const s = this.state;
    if (s.status !== "playing" || s.pending || s.pendingChoice) return false;
    if (rest && s.hours < DAY_HOURS - EPS) {
      this.log("Днёвку объявляют с утра, пока никто не выходил.", "warn");
      return false;
    }
    const here = this.tile(s.pos)!;
    let recovery = TERRAIN[here.t].rest;
    if (s.weather === "storm") recovery -= 15;
    if (rest) recovery = Math.round(recovery * 1.5) + 15;

    // Food.
    const need = round1(s.members.length * (this.hasRole("quartermaster") ? 0.85 : 1));
    if (s.supplies.food + EPS >= need) {
      s.supplies.food = round1(s.supplies.food - need);
    } else {
      s.supplies.food = 0;
      recovery = Math.round(recovery * 0.4);
      this.addMorale(-10);
      for (const m of s.members) m.health = Math.max(0, m.health - 5);
      this.log("Еда кончилась. Ужин из чая и воспоминаний: здоровье −5, мораль −10.", "bad");
    }
    // Stove.
    if (s.supplies.gas > 0) {
      s.supplies.gas -= 1;
    } else {
      recovery = Math.round(recovery * 0.7);
      this.addMorale(-3);
      this.log("Газ кончился — ужин холодный.", "warn");
    }
    // Cold nights up high.
    if ((here.t === "glacier" || here.t === "pass" || here.t === "peak") && (s.weather === "snow" || s.weather === "storm")) {
      for (const m of s.members) m.health = Math.max(0, m.health - 6);
      this.log("Холодная ночёвка наверху: здоровье −6 у всех.", "bad");
    }
    for (const m of s.members) {
      m.stamina = Math.min(100, Math.round(m.stamina + recovery));
      if (m.injury > 0) m.injury = Math.max(0, m.injury - (rest ? 2 : 1));
      if (rest) m.health = Math.min(100, m.health + 10);
    }
    // Morale drift.
    if (rest) this.addMorale(8);
    if (s.weather === "clear") this.addMorale(2);
    else if (s.weather === "rain") this.addMorale(-3);
    else if (s.weather === "storm" || s.weather === "snow") this.addMorale(-6);

    this.campEvent(here.t);

    const nextDay = s.day + 1;
    this.events.push({ type: "camp", rest });
    this.log(rest ? `Днёвка. Отдых +${recovery} выносливости.` : `Ночёвка (${TERRAIN[here.t].name.toLowerCase()}). Отдых +${recovery} выносливости.`, "info");
    if (rest) s.stats.restDays++;

    // Tomorrow.
    s.weather = this.rng.chance(0.8) ? s.forecast : this.nextWeather(s.weather);
    s.forecast = this.nextWeather(s.weather);
    s.day = nextDay;
    s.hours = DAY_HOURS;
    this.checkEvacuation();
    if (s.status === "playing" && s.day > s.deadline) {
      this.finish("lost", "Контрольный срок вышел");
    } else if (s.status === "playing") {
      const w = WEATHER[s.weather];
      this.log(`День ${s.day} из ${s.deadline}. ${w.glyph} ${w.name}, завтра ${WEATHER[s.forecast].name.toLowerCase()}.`, "system");
    }
    this.syncRng();
    return true;
  }

  private campEvent(t: Tile["t"]): void {
    const s = this.state;
    if (!this.rng.chance(0.4)) return;
    const wet = s.weather === "rain" || s.weather === "storm";
    const nearWater = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ].some((d) => {
      const n = this.tile({ x: s.pos.x + d.x, y: s.pos.y + d.y });
      return n !== null && (n.t === "river" || n.t === "lake" || n.t === "bridge");
    });
    type Ev = { w: number; run: () => void };
    const events: Ev[] = [];
    if ((t === "forest" || t === "meadow") && !wet && s.weather !== "snow") {
      events.push({
        w: 3,
        run: () => {
          s.supplies.food = round1(s.supplies.food + 2);
          this.log("Нашли черничник — набрали еды на два человеко-дня.", "good");
        },
      });
    }
    if (t === "forest" && (wet || s.weather === "cloudy")) {
      events.push({
        w: 3,
        run: () => {
          s.supplies.food = round1(s.supplies.food + 2);
          this.log("Грибной вечер: еда +2.", "good");
        },
      });
    }
    if (t === "forest") {
      events.push({
        w: 2,
        run: () => {
          this.addMorale(-8);
          this.log("У лагеря свежие медвежьи следы. Ночь спали плохо, мораль −8.", "bad");
        },
      });
    }
    if (t === "meadow" || t === "forest" || t === "village") {
      events.push({
        w: 2,
        run: () => {
          this.addMorale(8);
          s.supplies.food = round1(s.supplies.food + 1);
          this.log("Встретили другую группу: обменялись новостями и сгущёнкой. Мораль +8, еда +1.", "good");
        },
      });
    }
    if (nearWater) {
      events.push({
        w: 2,
        run: () => {
          s.supplies.food = round1(s.supplies.food + 2);
          this.log("Хариус клюёт! Еда +2.", "good");
        },
      });
    }
    events.push({
      w: 2,
      run: () => {
        if (this.hasRole("mechanic") && this.rng.chance(0.6)) {
          this.log("Горелка забилась, но реммастер прочистил её за вечер.", "info");
          return;
        }
        s.supplies.gas = Math.max(0, s.supplies.gas - 1);
        this.log("Горелка засорилась, спалили лишний баллон. Газ −1.", "warn");
      },
    });
    events.push({
      w: 2,
      run: () => {
        const m = this.rng.pick(s.members);
        m.injury = Math.max(m.injury, 1);
        this.log(`${m.name} ${v(m, "натёр", "натёрла")} ноги до мозолей — завтра пойдём медленнее.`, "warn");
      },
    });
    if (s.weather === "clear") {
      events.push({
        w: 3,
        run: () => {
          this.addMorale(5);
          this.log("Звёздное небо и гитара у костра. Мораль +5.", "good");
        },
      });
    }
    if (wet) {
      events.push({
        w: 3,
        run: () => {
          for (const m of s.members) m.stamina = Math.max(0, m.stamina - 8);
          this.log("Промокли спальники. Выносливость −8 у всех.", "bad");
        },
      });
    }
    if (t === "glacier" || t === "scree" || t === "pass") {
      events.push({
        w: 2,
        run: () => {
          for (const m of s.members) m.health = Math.max(0, m.health - 4);
          this.log("Ночью ударил мороз. Здоровье −4 у всех.", "bad");
        },
      });
    }
    if (events.length === 0) return;
    this.rng.weighted(events, (e) => e.w).run();
  }

  private nextWeather(from: Weather): Weather {
    const opts = WEATHER_CHAIN[from];
    let w = this.rng.weighted(opts, (o) => o[1])[0];
    if (w === "storm" && this.categoryDef.snow && this.rng.chance(0.3)) w = "snow";
    if (w === "snow" && !this.categoryDef.snow) w = "rain";
    return w;
  }

  // ---------------------------------------------------------------- actions

  useKit(memberId: number): boolean {
    const s = this.state;
    if (s.status !== "playing" || s.pending || s.pendingChoice || s.supplies.kit <= 0) return false;
    const m = s.members.find((x) => x.id === memberId);
    if (!m) return false;
    if (m.health >= 100 && m.injury === 0) {
      this.log(`${m.name} ${v(m, "здоров", "здорова")}, аптечка не нужна.`, "info");
      return false;
    }
    const heal = this.hasRole("medic") ? 45 : 30;
    m.health = Math.min(100, m.health + heal);
    m.injury = 0;
    s.supplies.kit -= 1;
    s.hours = round1(Math.max(0, s.hours - 0.5));
    this.log(`Аптечка: ${m.name} ${v(m, "перевязан", "перевязана")}, здоровье +${heal}. Осталось ${s.supplies.kit}.`, "good");
    return true;
  }

  /** Leave the route: counts as a loss but keeps the score for the checkpoints collected. */
  abandon(): boolean {
    if (this.state.status !== "playing") return false;
    this.state.pending = null;
    this.state.pendingChoice = null;
    this.finish("lost", "Группа сошла с маршрута");
    return true;
  }

  addMorale(delta: number): void {
    if (delta < 0 && this.hasRole("leader")) delta = Math.round(delta * 0.7);
    this.state.morale = Math.max(0, Math.min(100, this.state.morale + delta));
  }

  private checkEvacuation(): void {
    const s = this.state;
    if (s.status !== "playing") return;
    const down = s.members.find((m) => m.health <= 0);
    if (down) this.finish("lost", `${down.name} нуждается в эвакуации`);
  }

  private finish(status: "won" | "lost", reason: string): void {
    const s = this.state;
    if (s.status !== "playing") return;
    s.status = status;
    s.endReason = reason;
    s.pending = null;
    s.pendingChoice = null;
    this.events.push({ type: status });
    if (status === "won") this.log(`Финиш! ${reason} за ${s.day} дн.`, "good");
    else this.log(`Маршрут окончен: ${reason}.`, "bad");
  }
}

interface ChoiceDef {
  title: string;
  weight: number;
  when: (g: Game, terrain: Tile["t"]) => boolean;
  text: (g: Game, m: Member) => string;
  options: { label: string; hint: (g: Game) => string; when?: (g: Game) => boolean; apply: (g: Game, m: Member) => void }[];
}

const LAND = new Set<Tile["t"]>(["meadow", "forest", "swamp", "scree", "glacier"]);
const bad = (g: Game) => g.state.weather === "storm" || g.state.weather === "snow";
const all = (g: Game, f: (m: Member) => void) => g.state.members.forEach(f);

/** Trail dilemmas. Text and hints are computed at offer time; effects run on choose(). */
export const CHOICES: Record<string, ChoiceDef> = {
  lostTourist: {
    title: "Заблудившийся турист",
    weight: 2,
    when: (_g, t) => LAND.has(t),
    text: () => "На тропе одинокий турист без карты: отстал от своей группы и второй день ищет дорогу к людям. Просит вывести его на тропу к посёлку.",
    options: [
      { label: "Проводить до тропы", hint: () => "−2 ч, мораль +10", apply: (g) => { g.spendHours(2); g.addMorale(10); g.log("Вывели его на тропу и показали дорогу. Приятно быть полезными: мораль +10.", "good"); } },
      { label: "Объяснить дорогу и идти дальше", hint: () => "мораль −5", apply: (g) => { g.addMorale(-5); g.log("Нарисовали схему на бумажке и пошли дальше. Совесть слегка ноет: мораль −5.", "warn"); } },
    ],
  },
  berries: {
    title: "Ягодная поляна",
    weight: 3,
    when: (g, t) => (t === "forest" || t === "meadow") && !bad(g),
    text: () => "Склон синий от черники — можно за час набрать на пару ужинов.",
    options: [
      { label: "Собирать час", hint: () => "−1 ч, еда +3", apply: (g) => { g.spendHours(1); g.state.supplies.food = Math.round((g.state.supplies.food + 3) * 10) / 10; g.log("Набрали черники: еда +3 человеко-дня.", "good"); } },
      { label: "Идти дальше", hint: () => "ничего не теряем", apply: (g) => g.log("Съели по горсти на ходу и пошли дальше.", "info") },
    ],
  },
  bearTracks: {
    title: "Свежие следы медведя",
    weight: 2,
    when: (_g, t) => t === "forest",
    text: () => "На тропе свежие медвежьи следы и помёт. Зверь где-то рядом, идёт в нашу сторону.",
    options: [
      { label: "Обойти по склону", hint: () => "−1½ ч", apply: (g) => { g.spendHours(1.5); g.log("Сделали крюк по склону, шумели и пели. Медведя не видели.", "info"); } },
      { label: "Идти по тропе", hint: () => "риск встречи", apply: (g) => { if (g.roll(0.4)) { g.addMorale(-15); all(g, (m) => (m.stamina = Math.max(0, m.stamina - 10))); g.log("Медведь вышел на тропу в двадцати метрах! Стояли, кричали, он ушёл. Мораль −15, силы −10.", "bad"); } else { g.addMorale(3); g.log("Следы ушли в сторону. Обошлось: мораль +3.", "good"); } } },
    ],
  },
  shortcut: {
    title: "Короткий путь по кулуару",
    weight: 2,
    when: (g, t) => (t === "scree" || t === "glacier") && !bad(g),
    text: () => "Кулуар выводит напрямую вверх и срезает часа полтора, но камни там живые.",
    options: [
      { label: "Рискнуть", hint: () => "60 %: +1½ ч, иначе травма", apply: (g, m) => { if (g.roll(0.6)) { g.giveHours(1.5); g.log("Кулуар прошли быстро и чисто: +1½ ч к дню.", "good"); } else { g.hurt(m, 12, 15); g.state.stats.falls++; g.log(`${m.name} ${m.female ? "поехала" : "поехал"} по осыпи вместе с камнями. Здоровье −12.`, "bad"); } } },
      { label: "Идти по тропе", hint: () => "надёжно", apply: (g) => g.log("Пошли по маркированной тропе.", "info") },
    ],
  },
  stormComing: {
    title: "С перевала тянет грозу",
    weight: 3,
    when: (g, t) => LAND.has(t) && (g.state.weather === "cloudy" || g.state.weather === "rain"),
    text: () => "Небо на западе чернеет, вдалеке ворчит гром. Можно переждать под скалой или идти.",
    options: [
      { label: "Переждать", hint: () => "−2 ч", apply: (g) => { g.spendHours(2); g.log("Два часа под скалой с чаем из термоса. Гроза прошла стороной.", "info"); } },
      { label: "Идти дальше", hint: () => "50 %: здоровье −5 у всех", apply: (g) => { if (g.roll(0.5)) { all(g, (m) => (m.health = Math.max(0, m.health - 5))); g.addMorale(-5); g.log("Гроза накрыла на открытом склоне. Промокли и продрогли: здоровье −5, мораль −5.", "bad"); } else g.log("Успели проскочить до дождя.", "good"); } },
    ],
  },
  sickStomach: {
    title: "Кому-то нехорошо",
    weight: 2,
    when: (_g, t) => LAND.has(t),
    text: (_g, m) => `${m.name} с утра ${m.female ? "бледная" : "бледный"}: болит живот, слабость. Похоже, вода из ручья была так себе.`,
    options: [
      { label: "Дать лекарство из аптечки", hint: () => "аптечка −1", when: (g) => g.state.supplies.kit > 0, apply: (g, m) => { g.state.supplies.kit--; g.log(`Таблетки помогли, ${m.name} идёт дальше. Аптечка −1.`, "info"); } },
      { label: "Перетерпеть", hint: () => "силы −30, здоровье −5", apply: (g, m) => { g.hurt(m, 5, 30); g.log(`${m.name} ${m.female ? "шла" : "шёл"} через силу весь день. Силы −30, здоровье −5.`, "warn"); } },
    ],
  },
  oldCabin: {
    title: "Старая изба",
    weight: 2,
    when: (_g, t) => t === "forest",
    text: () => "У тропы охотничья изба: печка, нары, запас дров. Можно передохнуть в тепле.",
    options: [
      { label: "Передохнуть час", hint: () => "−1 ч, силы +10, мораль +5", apply: (g) => { g.spendHours(1); all(g, (m) => (m.stamina = Math.min(100, m.stamina + 10))); g.addMorale(5); g.log("Час у печки. Силы +10, мораль +5.", "good"); } },
      { label: "Идти дальше", hint: () => "", apply: (g) => g.log("Оставили в избе спички и пошли.", "info") },
    ],
  },
  cairnNote: {
    title: "Записка в туре",
    weight: 2,
    when: (_g, t) => t === "scree" || t === "glacier",
    text: () => "В каменном туре — записка группы, прошедшей здесь неделю назад. Традиция велит забрать её и оставить свою.",
    options: [
      { label: "Написать свою", hint: () => "−½ ч, мораль +6", apply: (g) => { g.spendHours(0.5); g.addMorale(6); g.log("Оставили записку и сфотографировались у тура. Мораль +6.", "good"); } },
      { label: "Не тратить время", hint: () => "", apply: (g) => g.log("Прочитали чужую записку и положили обратно.", "info") },
    ],
  },
  photoStop: {
    title: "Вид на весь хребет",
    weight: 2,
    when: (g, t) => (t === "glacier" || t === "scree") && g.state.weather === "clear",
    text: () => "Облака разошлись, и открылся весь хребет до горизонта. Такое бывает раз в поход.",
    options: [
      { label: "Фотосессия", hint: () => "−½ ч, мораль +8", apply: (g) => { g.spendHours(0.5); g.addMorale(8); g.log("Полчаса фотографий и молчания. Мораль +8.", "good"); } },
      { label: "Идём, времени нет", hint: () => "", apply: (g) => g.log("Полюбовались на ходу.", "info") },
    ],
  },
  brokenStrap: {
    title: "Порвалась лямка",
    weight: 2,
    when: (_g, t) => LAND.has(t),
    text: (_g, m) => `У ${m.name} лопнула лямка рюкзака. Нести на одном плече — не вариант.`,
    options: [
      { label: "Реммастер зашьёт", hint: () => "−½ ч", when: (g) => g.hasRole("mechanic"), apply: (g) => { g.spendHours(0.5); g.log("Реммастер зашил лямку за полчаса.", "info") } },
      { label: "Чинить своими силами", hint: () => "−1½ ч, силы −10", apply: (g, m) => { g.spendHours(1.5); m.stamina = Math.max(0, m.stamina - 10); g.log(`Полтора часа возни с иголкой и стропой. ${m.name} ${m.female ? "устала" : "устал"}: силы −10.`, "warn"); } },
    ],
  },
};

export function fmtHours(h: number): string {
  const whole = Math.floor(h + EPS);
  const frac = h - whole;
  if (frac < 0.25) return `${whole} ч`;
  if (frac < 0.75) return `${whole}½ ч`;
  return `${whole + 1} ч`;
}

export function roleName(role: Role): string {
  return ROLES[role].name;
}

/** Picks the past-tense verb form matching the member's gender. */
function v(m: Member, male: string, female: string): string {
  return m.female ? female : male;
}

function round1(v: number): number {
  return Math.round(v * 4) / 4;
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

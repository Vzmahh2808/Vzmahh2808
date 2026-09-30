import { describe, expect, it } from "vitest";
import { CATEGORIES, TERRAIN } from "../src/game/data";
import { Game, MEMBER_COUNT, fmtHours } from "../src/game/game";
import { DAY_HOURS, type Point, type Terrain } from "../src/game/types";
import { samePoint } from "../src/game/world";

/** Rewrites the tile next to the group so a test can walk onto a known terrain. */
function plant(g: Game, terrain: Terrain, dir: Point = { x: 1, y: 0 }): Point {
  const s = g.state;
  const p = { x: s.pos.x + dir.x, y: s.pos.y + dir.y };
  s.tiles[p.y * s.width + p.x] = { t: terrain, h: 0.5 };
  return p;
}

function fresh(seed = 5, cat: 1 | 2 | 3 = 1): Game {
  const g = Game.newGame(seed, cat);
  // Put the group in the middle of the map so every neighbour exists.
  g.state.pos = { x: 10, y: 10 };
  g.state.trail = [{ ...g.state.pos }];
  return g;
}

describe("new game", () => {
  it("starts with a full team, supplies and the category's deadline", () => {
    const g = Game.newGame(1, 2);
    const s = g.state;
    expect(s.members).toHaveLength(MEMBER_COUNT);
    expect(new Set(s.members.map((m) => m.role)).size).toBe(MEMBER_COUNT);
    expect(s.deadline).toBe(CATEGORIES[2].days);
    expect(s.supplies.food).toBe(CATEGORIES[2].foodPerMember * MEMBER_COUNT);
    expect(s.hours).toBe(DAY_HOURS);
    expect(samePoint(s.pos, s.start)).toBe(true);
    expect(s.status).toBe("playing");
  });

  it("is deterministic: same seed and actions give the same state", () => {
    const run = () => {
      const g = Game.newGame(77, 1);
      for (let i = 0; i < 30; i++) {
        if (g.state.pending) g.resolveStage(g.state.members.map((m) => g.autoQuality(m)));
        else if (!g.move(1, 0) && !g.move(0, 1)) g.camp();
      }
      return g.snapshot();
    };
    expect(run()).toEqual(run());
  });
});

describe("movement", () => {
  it("spends hours by terrain and drains stamina", () => {
    const g = fresh();
    const p = plant(g, "meadow");
    const before = g.state.members.map((m) => m.stamina);
    expect(g.move(1, 0)).toBe(true);
    expect(g.state.pos).toEqual(p);
    expect(g.state.hours).toBeLessThan(DAY_HOURS);
    expect(g.state.hours).toBeCloseTo(DAY_HOURS - g.moveCost(g.state.pos)!, 5);
    g.state.members.forEach((m, i) => expect(m.stamina).toBeLessThan(before[i]));
    expect(g.state.stats.tiles).toBe(1);
  });

  it("refuses rock and lakes", () => {
    const g = fresh();
    plant(g, "rock");
    plant(g, "lake", { x: -1, y: 0 });
    expect(g.move(1, 0)).toBe(false);
    expect(g.move(-1, 0)).toBe(false);
    expect(g.state.log.at(-1)?.kind).toBe("warn");
  });

  it("refuses a step that does not fit into the day", () => {
    const g = fresh();
    plant(g, "swamp");
    g.state.hours = 0.5;
    expect(g.move(1, 0)).toBe(false);
    expect(g.state.hours).toBe(0.5);
  });

  it("closes passes and glaciers in a storm", () => {
    const g = fresh();
    plant(g, "pass");
    g.state.weather = "storm";
    expect(g.blockReason({ x: 11, y: 10 })).toMatch(/непогод/);
    expect(g.move(1, 0)).toBe(false);
    g.state.weather = "clear";
    expect(g.move(1, 0)).toBe(true);
    expect(g.state.pending?.kind).toBe("pass");
  });

  it("walks slower with a heavy pack, tired legs or an injury", () => {
    const g = fresh();
    const base = g.speedFactor();
    g.state.members[0].injury = 2;
    expect(g.speedFactor()).toBeGreaterThan(base);
    g.state.members[0].injury = 0;
    g.state.members.forEach((m) => (m.stamina = 10));
    expect(g.speedFactor()).toBeGreaterThan(base);
  });

  it("marks checkpoints and wins at the finish once all are taken", () => {
    const g = fresh();
    const cp = g.state.checkpoints[0];
    const target = plant(g, "meadow");
    cp.pos = { ...target };
    g.move(1, 0);
    expect(cp.taken).toBe(true);
    expect(g.events.some((e) => e.type === "checkpoint")).toBe(true);
    g.state.checkpoints.forEach((c) => (c.taken = true));
    const fin = plant(g, "village");
    g.state.finish = { ...fin };
    g.move(1, 0);
    expect(g.state.status).toBe("won");
  });

  it("does not finish while checkpoints are missing", () => {
    const g = fresh();
    const fin = plant(g, "village");
    g.state.finish = { ...fin };
    g.move(1, 0);
    expect(g.state.status).toBe("playing");
    expect(g.state.log.at(-1)?.text).toMatch(/не все КП/);
  });

  it("counts a peak once", () => {
    const g = fresh();
    plant(g, "peak");
    g.move(1, 0);
    expect(g.state.stats.peaks).toBe(1);
    g.state.hours = DAY_HOURS;
    g.move(-1, 0);
    g.state.hours = DAY_HOURS;
    g.move(1, 0);
    expect(g.state.stats.peaks).toBe(1);
  });
});

describe("technical stages", () => {
  it("a river starts a stage instead of moving", () => {
    const g = fresh();
    const river = plant(g, "river");
    expect(g.move(1, 0)).toBe(true);
    expect(g.state.pending).not.toBeNull();
    expect(g.state.pending!.kind).toBe("river");
    expect(g.state.pending!.to).toEqual(river);
    expect(g.state.pos).not.toEqual(river);
    expect(g.state.pending!.zones).toHaveLength(MEMBER_COUNT);
    expect(g.move(0, 1)).toBe(false);
  });

  it("a clean crossing moves the group and costs the stage's hours", () => {
    const g = fresh();
    const river = plant(g, "river");
    g.move(1, 0);
    const hours = g.state.pending!.hours;
    const health = g.state.members.map((m) => m.health);
    expect(g.resolveStage([1, 1, 1, 1])).toBe(true);
    expect(g.state.pending).toBeNull();
    expect(g.state.pos).toEqual(river);
    expect(g.state.hours).toBeCloseTo(DAY_HOURS - hours, 5);
    g.state.members.forEach((m, i) => expect(m.health).toBe(health[i]));
    expect(g.state.stats.stages).toBe(1);
  });

  it("a fall hurts, soaks food and can injure", () => {
    const g = fresh();
    plant(g, "river");
    g.move(1, 0);
    const food = g.state.supplies.food;
    g.resolveStage([0, 1, 1, 1]);
    expect(g.state.members[0].health).toBeLessThan(100);
    expect(g.state.members[1].health).toBe(100);
    expect(g.state.supplies.food).toBe(food - 1);
    expect(g.state.stats.falls).toBe(1);
    expect(g.events.some((e) => e.type === "hurt")).toBe(true);
  });

  it("a fixed rope turns falls into slips and widens the zones", () => {
    const g = fresh();
    plant(g, "river");
    g.move(1, 0);
    const fordZones = [...g.state.pending!.zones];
    expect(g.chooseMethod("rope")).toBe(true);
    g.state.pending!.zones.forEach((z, i) => expect(z).toBeGreaterThan(fordZones[i]));
    g.resolveStage([0, 0, 0, 0]);
    g.state.members.forEach((m) => expect(m.health).toBe(100));
    expect(g.state.stats.falls).toBe(0);
  });

  it("without a rope only fording is offered", () => {
    const g = fresh();
    g.state.supplies.rope = false;
    plant(g, "river");
    g.move(1, 0);
    expect(g.state.pending!.methods).toEqual(["ford"]);
    expect(g.chooseMethod("rope")).toBe(false);
  });

  it("a single group quality is adjusted per member technique", () => {
    const g = fresh();
    plant(g, "pass");
    g.move(1, 0);
    g.state.members[0].technique = 1;
    g.state.members[1].technique = 5;
    g.resolveStage([0.62]);
    expect(g.state.members[1].stamina).toBeGreaterThan(g.state.members[0].stamina);
  });

  it("can be cancelled", () => {
    const g = fresh();
    plant(g, "river");
    g.move(1, 0);
    expect(g.cancelStage()).toBe(true);
    expect(g.state.pending).toBeNull();
    expect(g.state.hours).toBe(DAY_HOURS);
  });
});

describe("camp", () => {
  it("eats, burns gas, restores stamina and starts the next day", () => {
    const g = fresh();
    plant(g, "forest");
    g.move(1, 0);
    g.move(-1, 0);
    const food = g.state.supplies.food;
    const gas = g.state.supplies.gas;
    const stamina = g.state.members.map((m) => m.stamina);
    expect(g.camp()).toBe(true);
    expect(g.state.day).toBe(2);
    expect(g.state.hours).toBe(DAY_HOURS);
    expect(g.state.supplies.food).toBeLessThan(food);
    expect(g.state.supplies.gas).toBe(gas - 1);
    g.state.members.forEach((m, i) => expect(m.stamina).toBeGreaterThan(stamina[i]));
    expect(g.events.some((e) => e.type === "camp")).toBe(true);
  });

  it("the quartermaster saves food", () => {
    const g = fresh();
    g.state.members.forEach((m) => (m.role = "mechanic"));
    const food = g.state.supplies.food;
    g.camp();
    const plain = food - g.state.supplies.food;
    const g2 = fresh();
    g2.state.members[0].role = "quartermaster";
    const food2 = g2.state.supplies.food;
    g2.camp();
    expect(food2 - g2.state.supplies.food).toBeLessThan(plain);
  });

  it("hunger hurts the team", () => {
    const g = fresh();
    g.state.supplies.food = 1;
    g.camp();
    g.state.members.forEach((m) => expect(m.health).toBeLessThan(100));
    expect(g.state.supplies.food).toBe(0);
  });

  it("a rest day is only possible in the morning and heals more", () => {
    const g = fresh();
    plant(g, "meadow");
    g.move(1, 0);
    expect(g.camp(true)).toBe(false);
    g.state.hours = DAY_HOURS;
    g.state.members[0].health = 50;
    g.state.members[0].injury = 2;
    expect(g.camp(true)).toBe(true);
    expect(g.state.members[0].health).toBe(60);
    expect(g.state.members[0].injury).toBe(0);
    expect(g.state.stats.restDays).toBe(1);
  });

  it("the route is lost when the deadline passes", () => {
    const g = fresh();
    g.state.day = g.state.deadline;
    g.camp();
    expect(g.state.status).toBe("lost");
    expect(g.state.endReason).toMatch(/срок/);
  });

  it("the forecast usually comes true", () => {
    let hits = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const g = Game.newGame(seed, 1);
      const forecast = g.state.forecast;
      g.camp();
      if (g.state.weather === forecast) hits++;
    }
    expect(hits).toBeGreaterThan(24);
  });
});

describe("team", () => {
  it("a first-aid kit heals and clears an injury", () => {
    const g = fresh();
    const m = g.state.members[0];
    m.health = 40;
    m.injury = 3;
    expect(g.useKit(m.id)).toBe(true);
    expect(m.health).toBeGreaterThanOrEqual(70);
    expect(m.injury).toBe(0);
    expect(g.state.supplies.kit).toBe(CATEGORIES[1].kit - 1);
    m.health = 100;
    expect(g.useKit(m.id)).toBe(false);
    expect(g.state.supplies.kit).toBe(CATEGORIES[1].kit - 1);
  });

  it("a member at zero health ends the route", () => {
    const g = fresh();
    plant(g, "river");
    g.state.members[0].health = 5;
    g.move(1, 0);
    g.resolveStage([0, 1, 1, 1]);
    expect(g.state.status).toBe("lost");
    expect(g.state.endReason).toMatch(/эвакуац/);
  });

  it("the leader softens morale hits", () => {
    const g = fresh();
    g.state.members.forEach((m) => (m.role = "medic"));
    g.state.morale = 50;
    g.addMorale(-10);
    expect(g.state.morale).toBe(40);
    g.state.members[0].role = "leader";
    g.addMorale(-10);
    expect(g.state.morale).toBe(33);
  });

  it("abandoning keeps the checkpoints for the score but loses", () => {
    const g = fresh();
    g.state.checkpoints[0].taken = true;
    expect(g.abandon()).toBe(true);
    expect(g.state.status).toBe("lost");
    expect(g.abandon()).toBe(false);
  });
});

describe("helpers", () => {
  it("formats hours in halves", () => {
    expect(fmtHours(2)).toBe("2 ч");
    expect(fmtHours(2.5)).toBe("2½ ч");
    expect(fmtHours(2.8)).toBe("3 ч");
  });

  it("every terrain has a definition", () => {
    for (const t of Object.keys(TERRAIN) as Terrain[]) expect(TERRAIN[t].name.length).toBeGreaterThan(0);
  });
});

describe("pre-trip setup", () => {
  it("offers six candidates covering every role, deterministically", () => {
    const a = Game.roster(3, 2);
    const b = Game.roster(3, 2);
    expect(a).toEqual(b);
    expect(a).toHaveLength(6);
    expect(new Set(a.map((m) => m.role)).size).toBe(4);
    expect(new Set(a.map((m) => m.id)).size).toBe(6);
    for (const m of a) expect(m.technique + m.strength).toBeGreaterThanOrEqual(5);
  });

  it("uses the chosen members and clamps supplies to the limits", () => {
    const roster = Game.roster(9, 1);
    const ids = [roster[5].id, roster[1].id, roster[4].id, roster[0].id];
    const g = Game.newGame(9, 1, { memberIds: ids, foodPerMember: 99, gas: 1, kit: 2, rope: false });
    expect(g.state.members.map((m) => m.id)).toEqual(ids);
    const limits = Game.setupLimits(1);
    expect(g.state.supplies.food).toBe(limits.food[1] * 4);
    expect(g.state.supplies.gas).toBe(limits.gas[0]);
    expect(g.state.supplies.kit).toBe(2);
    expect(g.state.supplies.rope).toBe(false);
    expect(g.loadKg()).toBe(Game.loadOf(4, g.state.supplies));
  });

  it("rejects a team that is not four distinct candidates", () => {
    expect(() => Game.newGame(9, 1, { memberIds: [1, 1, 2, 3], foodPerMember: 8, gas: 8, kit: 1, rope: true })).toThrow();
    expect(() => Game.newGame(9, 1, { memberIds: [1, 2, 3, 42], foodPerMember: 8, gas: 8, kit: 1, rope: true })).toThrow();
  });

  it("the roster does not change the map", () => {
    const a = Game.newGame(21, 2);
    const roster = Game.roster(21, 2);
    const b = Game.newGame(21, 2, { ...Game.defaultSetup(2, roster), memberIds: roster.slice(2, 6).map((m) => m.id) });
    expect(a.state.tiles).toEqual(b.state.tiles);
    expect(a.state.checkpoints).toEqual(b.state.checkpoints);
  });
});

describe("trail dilemmas", () => {
  it("block movement until answered and apply the chosen effect", () => {
    const g = fresh();
    plant(g, "meadow");
    expect(g.offerChoice("lostTourist")).toBe(true);
    expect(g.state.pendingChoice?.id).toBe("lostTourist");
    expect(g.state.pendingChoice?.options).toHaveLength(2);
    expect(g.move(1, 0)).toBe(false);
    expect(g.camp()).toBe(false);
    const morale = g.state.morale;
    expect(g.choose(0)).toBe(true);
    expect(g.state.pendingChoice).toBeNull();
    expect(g.state.hours).toBe(DAY_HOURS - 2);
    expect(g.state.morale).toBe(morale + 10);
    expect(g.move(1, 0)).toBe(true);
  });

  it("hides options that need a kit or a mechanic when the group has none", () => {
    const g = fresh();
    g.state.supplies.kit = 0;
    g.offerChoice("sickStomach");
    expect(g.state.pendingChoice?.options).toHaveLength(1);
    g.choose(0);
    expect(g.state.members.some((m) => m.stamina <= 70)).toBe(true);
    const g2 = fresh();
    g2.state.supplies.kit = 1;
    g2.offerChoice("sickStomach");
    expect(g2.state.pendingChoice?.options).toHaveLength(2);
    g2.choose(0);
    expect(g2.state.supplies.kit).toBe(0);
  });

  it("fires at most once a day and only on matching terrain", () => {
    const g = fresh();
    plant(g, "forest");
    g.state.pos = { x: 11, y: 10 };
    expect(g.offerChoice("bearTracks")).toBe(true);
    expect(g.offerChoice("berries")).toBe(false);
    g.choose(1);
    expect(g.offerChoice("berries")).toBe(true);
    g.choose(1);
    let fired = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const h = Game.newGame(seed, 1);
      let n = 0;
      for (let i = 0; i < 12 && h.state.status === "playing"; i++) {
        if (h.state.pendingChoice) {
          n++;
          h.choose(h.state.pendingChoice.options.length - 1);
        } else if (h.state.pending) h.resolveStage([1, 1, 1, 1]);
        else if (!h.move(1, 0) && !h.move(0, 1) && !h.move(0, -1)) h.camp();
      }
      expect(n).toBeLessThanOrEqual(2);
      fired += n;
    }
    expect(fired).toBeGreaterThan(0);
  });

  it("survives a save round-trip while pending", () => {
    const g = fresh();
    g.offerChoice("berries");
    const copy = Game.fromState(JSON.parse(JSON.stringify(g.snapshot())));
    const food = copy.state.supplies.food;
    expect(copy.choose(0)).toBe(true);
    expect(copy.state.supplies.food).toBe(food + 3);
  });
});

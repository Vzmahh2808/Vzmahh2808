import { describe, expect, it } from "vitest";
import { MissionRunner, SPEED_GRACE, TAIL_LOST, TAIL_SPOTTED, type Mission, type MissionContext } from "../src/game/missions";
import { BOMB_SPEED, chapterThree, places, storyMissions } from "../src/game/story";
import { Rng } from "../src/core/rng";
import { generateCity, isOnCarriageway, resolveCircleVsBuildings } from "../src/world/city";
import { generateIsland, onIslandRoad } from "../src/world/island";

const ctx = (over: Partial<MissionContext> = {}): MissionContext => ({ x: 0, z: 0, vehicle: null, stars: 0, destroyed: new Set(), ...over });
const one = (step: Mission["steps"][number], extra: Partial<Mission> = {}): Mission => ({ id: "t", title: "t", brief: "", reward: 10, steps: [step], ...extra });

describe("tail step", () => {
  const tail = one({ kind: "tail", target: "car", near: 10, far: 50, seconds: 5, text: "" });
  const at = (d: number) => ctx({ x: d, targets: { car: { x: 0, z: 0 } } });

  it("counts time only inside the window and pays out", () => {
    const r = new MissionRunner();
    r.start(tail);
    // Far away before the first contact: no penalty yet.
    for (let i = 0; i < 20; i++) expect(r.update(at(200), 1)).toEqual([]);
    expect(r.progress).toBe(0);
    for (let i = 0; i < 4; i++) r.update(at(30), 1);
    expect(r.gauge()).toMatchObject({ label: "Слежка", value: 0.8, warn: "" });
    expect(r.update(at(30), 1).at(-1)).toMatchObject({ type: "done" });
  });

  it("fails when too close for too long", () => {
    const r = new MissionRunner();
    r.start(tail);
    r.update(at(30), 1);
    r.update(at(5), 1);
    expect(r.gauge()!.warn).toBe("Слишком близко!");
    expect(r.update(at(5), TAIL_SPOTTED)).toEqual([expect.objectContaining({ type: "fail", reason: "вас заметили" })]);
  });

  it("fails when the target is lost after contact", () => {
    const r = new MissionRunner();
    r.start(tail);
    r.update(at(30), 1);
    r.update(at(80), TAIL_LOST - 1);
    expect(r.gauge()!.warn).toBe("Теряете цель!");
    // Coming back resets the lost timer.
    r.update(at(30), 0.1);
    expect(r.lost).toBe(0);
    expect(r.update(at(80), TAIL_LOST + 0.1)[0]).toMatchObject({ type: "fail", reason: "цель потеряна" });
  });

  it("points the objective at the moving target", () => {
    const r = new MissionRunner();
    r.start(tail);
    expect(r.objective({ car: { x: 7, z: 9 } })).toEqual({ x: 7, z: 9 });
  });
});

describe("collect step", () => {
  const pts = [{ x: 0, z: 100 }, { x: 100, z: 0 }, { x: -100, z: 0 }];
  const m = one({ kind: "collect", points: pts, radius: 5, text: "" });

  it("takes points in any order and reports each pickup", () => {
    const r = new MissionRunner();
    r.start(m);
    expect(r.objective({}, { x: 90, z: 0 })).toEqual(pts[1]);
    expect(r.update(ctx({ x: -100 }), 1)).toEqual([{ type: "pickup", count: 1, total: 3 }]);
    expect(r.update(ctx({ x: -100 }), 1)).toEqual([]);
    r.update(ctx({ z: 100 }), 1);
    expect(r.gauge()).toMatchObject({ label: "Собрано 2 из 3" });
    expect(r.objective({}, { x: 0, z: 0 })).toEqual(pts[1]);
    expect(r.update(ctx({ x: 100 }), 1).at(-1)).toMatchObject({ type: "done" });
  });
});

describe("hold step", () => {
  it("accumulates time inside the zone only", () => {
    const r = new MissionRunner();
    r.start(one({ kind: "hold", at: { x: 0, z: 0 }, radius: 10, seconds: 3, text: "" }));
    r.update(ctx({ x: 5 }), 2);
    r.update(ctx({ x: 50 }), 5);
    expect(r.progress).toBe(2);
    expect(r.update(ctx({ x: 1 }), 1).at(-1)).toMatchObject({ type: "done" });
  });
});

describe("speed step", () => {
  const bomb = one({ kind: "speed", target: "car", min: 10, seconds: 5, text: "" });

  it("arms at speed and blows up the car when too slow", () => {
    const r = new MissionRunner();
    r.start(bomb);
    // Sitting still before arming is fine.
    r.update(ctx({ vehicle: "car", speed: 0 }), 10);
    expect(r.armed).toBe(false);
    r.update(ctx({ vehicle: "car", speed: 12 }), 0.1);
    expect(r.armed).toBe(true);
    r.update(ctx({ vehicle: "car", speed: 12 }), 1);
    r.update(ctx({ vehicle: "car", speed: 4 }), 1);
    expect(r.gauge()!.warn).toContain("36 км/ч");
    const ev = r.update(ctx({ vehicle: "car", speed: 4 }), SPEED_GRACE);
    expect(ev).toEqual([{ type: "fail", mission: bomb, reason: "бомба взорвалась", explode: "car" }]);
  });

  it("leaving the car counts as slowing down", () => {
    const r = new MissionRunner();
    r.start(bomb);
    r.update(ctx({ vehicle: "car", speed: 12 }), 0.1);
    expect(r.update(ctx({ vehicle: null, speed: 20 }), SPEED_GRACE + 0.1)[0]).toMatchObject({ type: "fail", explode: "car" });
  });

  it("finishes after enough fast seconds", () => {
    const r = new MissionRunner();
    r.start(bomb);
    r.update(ctx({ vehicle: "car", speed: 12 }), 0.1);
    for (let i = 0; i < 4; i++) r.update(ctx({ vehicle: "car", speed: 12 }), 1);
    r.update(ctx({ vehicle: "car", speed: 8 }), 1);
    expect(r.update(ctx({ vehicle: "car", speed: 12 }), 1).at(-1)).toMatchObject({ type: "done" });
  });
});

describe("chapter three", () => {
  it("follows chapter two and opens with a banner", () => {
    const all = storyMissions(8);
    expect(all.length).toBe(15);
    expect(all[10].id).toBe("ch3-tail");
    expect(all[10].chapterTitle).toBe("Глава 3: Большая вода");
    expect(all.filter((m) => m.chapterTitle).map((m) => m.chapter)).toEqual([2, 3]);
    expect(BOMB_SPEED * 3.6).toBeCloseTo(50);
  });

  it("puts every point on open road", () => {
    const city = generateCity(new Rng(20260924), 8);
    const island = generateIsland(new Rng(20260924));
    const world = { ...city, buildings: [...city.buildings, ...island.colliders] };
    const pts: Array<{ x: number; z: number }> = [places(8).office];
    for (const m of chapterThree(8)) {
      if (m.contact) pts.push(m.contact);
      for (const s of m.steps) {
        if (s.kind === "goto" || s.kind === "hold") pts.push(s.at);
        if (s.kind === "collect") pts.push(...s.points);
      }
      for (const sp of Object.values(m.spawns ?? {})) pts.push(sp);
    }
    for (const p of pts) {
      expect(isOnCarriageway(8, p.x, p.z) || onIslandRoad(p.x, p.z)).toBe(true);
      expect(resolveCircleVsBuildings(world, p.x, p.z, 1.5)).toBeNull();
    }
  });

  it("every spawned mission car is referenced by a step", () => {
    for (const m of chapterThree(8)) {
      for (const key of Object.keys(m.spawns ?? {})) {
        expect(m.steps.some((s) => "target" in s && s.target === key)).toBe(true);
      }
    }
  });
});

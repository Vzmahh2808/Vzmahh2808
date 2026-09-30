import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import {
  advanceDay,
  conferenceTable,
  createSeason,
  currentSeries,
  parseSeason,
  recordSeriesGame,
  resultForUser,
  roundRobin,
  serializeSeason,
  simulateDays,
  simulateGame,
  simulateToNextPhase,
  standings,
  userFixture,
  userOutcome,
  seriesHome,
  poisson,
  type Series,
} from "../src/game/league";
import { TEAMS, kitsFor, strength, colorDistance } from "../src/game/teams";

describe("clubs", () => {
  it("has 22 clubs in two conferences of 11 and four divisions", () => {
    expect(TEAMS.length).toBe(22);
    expect(TEAMS.filter((t) => t.conference === "west").length).toBe(11);
    expect(TEAMS.filter((t) => t.conference === "east").length).toBe(11);
    const divs = new Map<string, number>();
    for (const t of TEAMS) divs.set(t.division, (divs.get(t.division) ?? 0) + 1);
    expect([...divs.values()].sort()).toEqual([5, 5, 6, 6]);
    expect(new Set(TEAMS.map((t) => t.short)).size).toBe(22);
    expect(new Set(TEAMS.map((t) => t.name)).size).toBe(22);
  });

  it("does not use real club names or the league's abbreviation", () => {
    const banned = ["СКА", "ЦСКА", "Динамо", "Спартак", "Локомотив", "Ак Барс", "Авангард", "Салават", "Трактор", "Металлург", "Сибирь", "Барыс", "Витязь", "Амур", "Адмирал", "Северсталь", "Автомобилист", "Нефтехимик", "Торпедо", "Лада", "Драконы", "КХЛ"];
    for (const t of TEAMS) for (const b of banned) expect(t.name.includes(b) || t.short === b).toBe(false);
  });

  it("gives the away side a distinguishable kit", () => {
    for (const a of TEAMS) {
      for (const b of TEAMS) {
        if (a.id === b.id) continue;
        const [h, w] = kitsFor(a, b);
        expect(colorDistance(h.body, w.body)).toBeGreaterThan(100);
      }
    }
  });
});

describe("schedule", () => {
  it("round robin: everyone plays once per round and meets everyone once", () => {
    const ids = TEAMS.map((t) => t.id);
    const rounds = roundRobin(ids);
    expect(rounds.length).toBe(21);
    const met = new Map<string, number>();
    for (const r of rounds) {
      const seen = new Set<number>();
      expect(r.length).toBe(11);
      for (const [h, a] of r) {
        expect(seen.has(h) || seen.has(a)).toBe(false);
        seen.add(h);
        seen.add(a);
        const key = [h, a].sort().join("-");
        met.set(key, (met.get(key) ?? 0) + 1);
      }
      expect(seen.size).toBe(22);
    }
    expect(met.size).toBe(231);
    expect([...met.values()].every((v) => v === 1)).toBe(true);
  });

  it("season fixtures: 42 games per club, home and away balanced", () => {
    const s = createSeason(3, 42, 1);
    expect(s.fixtures.length).toBe(22 * 42 / 2);
    const home = new Map<number, number>();
    const games = new Map<number, number>();
    for (const f of s.fixtures) {
      home.set(f.home, (home.get(f.home) ?? 0) + 1);
      games.set(f.home, (games.get(f.home) ?? 0) + 1);
      games.set(f.away, (games.get(f.away) ?? 0) + 1);
    }
    for (const t of TEAMS) {
      expect(games.get(t.id)).toBe(42);
      expect(Math.abs((home.get(t.id) ?? 0) - 21)).toBeLessThanOrEqual(3);
    }
  });
});

describe("simulation model", () => {
  it("scores about as many goals as the real engine and hockey overall", () => {
    const rng = new Rng(5);
    let goals = 0;
    let ot = 0;
    let so = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const r = simulateGame(rng, i % 22, (i * 7 + 3) % 22 === i % 22 ? 0 : (i * 7 + 3) % 22, false);
      goals += r.hg + r.ag;
      if (r.by === "ot") ot++;
      if (r.by === "so") so++;
    }
    expect(goals / n / 2).toBeGreaterThan(2.4);
    expect(goals / n / 2).toBeLessThan(3.1);
    expect((ot + so) / n).toBeGreaterThan(0.12);
    expect((ot + so) / n).toBeLessThan(0.3);
    expect(so).toBeGreaterThan(0);
  });

  it("poisson has the right mean", () => {
    const rng = new Rng(9);
    let sum = 0;
    for (let i = 0; i < 20000; i++) sum += poisson(rng, 2.7);
    expect(sum / 20000).toBeGreaterThan(2.6);
    expect(sum / 20000).toBeLessThan(2.8);
  });

  it("stronger clubs win more often", () => {
    const best = TEAMS.reduce((a, b) => (strength(a) > strength(b) ? a : b));
    const worst = TEAMS.reduce((a, b) => (strength(a) < strength(b) ? a : b));
    const rng = new Rng(11);
    let wins = 0;
    for (let i = 0; i < 2000; i++) {
      const r = simulateGame(rng, best.id, worst.id, false);
      if (r.hg > r.ag) wins++;
    }
    expect(wins / 2000).toBeGreaterThan(0.62);
    expect(wins / 2000).toBeLessThan(0.9);
  });
});

describe("standings", () => {
  it("adds up: wins equal losses and points follow the 2-1-0 system", () => {
    const s = createSeason(0, 21, 7);
    simulateDays(s, 21);
    expect(s.phase).toBe("playoff");
    const rows = standings(s);
    let w = 0, l = 0, otl = 0, gf = 0, ga = 0, pts = 0, gp = 0;
    for (const r of rows) {
      expect(r.gp).toBe(21);
      expect(r.w + r.l + r.otl).toBe(21);
      expect(r.pts).toBe(r.w * 2 + r.otl);
      w += r.w; l += r.l; otl += r.otl; gf += r.gf; ga += r.ga; pts += r.pts; gp += r.gp;
    }
    expect(w).toBe(l + otl);
    expect(gf).toBe(ga);
    // Each game hands out 2 points, plus 1 more when it went past sixty minutes.
    expect(pts).toBe(gp + otl);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].pts).toBeGreaterThanOrEqual(rows[i].pts);
    expect(conferenceTable(rows, "west").length).toBe(11);
  });

  it("the strongest clubs usually finish in the top half", () => {
    const s = createSeason(0, 63, 21);
    simulateDays(s, 63);
    const rows = standings(s);
    const rank = new Map(rows.map((r, i) => [r.id, i]));
    const top = [...TEAMS].sort((a, b) => strength(b) - strength(a)).slice(0, 5);
    const avg = top.reduce((a, t) => a + rank.get(t.id)!, 0) / 5;
    expect(avg).toBeLessThan(8);
  });
});

describe("playoffs", () => {
  it("starts with 16 clubs seeded 1v8 within each conference", () => {
    const s = createSeason(0, 21, 3);
    simulateDays(s, 21);
    const po = s.playoffs!;
    expect(po.round).toBe(1);
    expect(po.series.length).toBe(8);
    const clubs = new Set(po.series.flatMap((x) => [x.hi, x.lo]));
    expect(clubs.size).toBe(16);
    const rows = standings(s);
    const west = conferenceTable(rows, "west").map((r) => r.id);
    expect(po.series[0].hi).toBe(west[0]);
    expect(po.series[0].lo).toBe(west[7]);
    expect(po.series[3].hi).toBe(west[3]);
    expect(po.series[3].lo).toBe(west[4]);
    for (const x of po.series) expect(TEAMS[x.hi].conference).toBe(TEAMS[x.lo].conference);
  });

  it("series are first to four wins with 2-2-1-1-1 home games", () => {
    const x: Series = { round: 1, hi: 1, lo: 2, hiWins: 0, loWins: 0, games: [], winner: null };
    const homes: number[] = [];
    for (let g = 0; g < 7; g++) {
      homes.push(seriesHome(x));
      // The low seed wins every game at home, the high seed every game at home too.
      const home = seriesHome(x);
      const done = recordSeriesGame(x, { hg: 3, ag: 1, by: "reg" });
      expect(done).toBe(g === 6);
      expect(x.games[g].home).toBe(home);
    }
    expect(homes).toEqual([1, 1, 2, 2, 1, 2, 1]);
    expect(x.hiWins).toBe(4);
    expect(x.loWins).toBe(3);
    expect(x.winner).toBe(1);
  });

  it("plays through to a single champion, reseeding each round", () => {
    const s = createSeason(0, 21, 4);
    simulateToNextPhase(s);
    expect(s.phase).toBe("playoff");
    const sizes: number[] = [s.playoffs!.series.length];
    let guard = 0;
    while (s.phase === "playoff" && guard++ < 200) {
      const before = s.playoffs!.round;
      advanceDay(s, null);
      if (s.phase === "playoff" && s.playoffs!.round !== before) sizes.push(s.playoffs!.series.length);
    }
    expect(s.phase).toBe("done");
    expect(sizes).toEqual([8, 4, 2, 1]);
    const po = s.playoffs!;
    expect(po.champion).not.toBeNull();
    expect(po.history.length).toBe(15);
    for (const x of po.history) {
      expect(Math.max(x.hiWins, x.loWins)).toBe(4);
      expect(Math.min(x.hiWins, x.loWins)).toBeLessThanOrEqual(3);
      expect(x.games.length).toBe(x.hiWins + x.loWins);
    }
    // The champion won four series.
    expect(po.history.filter((x) => x.winner === po.champion).length).toBe(4);
    // Round 2 is reseeded by the overall table: hi seed has the better overall rank.
    const rank = new Map(standings(s).map((r, i) => [r.id, i]));
    for (const x of po.history.filter((h) => h.round >= 2)) expect(rank.get(x.hi)!).toBeLessThan(rank.get(x.lo)!);
  });

  it("no shootouts in the playoffs", () => {
    const s = createSeason(0, 21, 8);
    simulateToNextPhase(s);
    simulateToNextPhase(s);
    for (const x of s.playoffs!.history) for (const g of x.games) expect(g.by).not.toBe("so");
  });
});

describe("the user's games", () => {
  it("finds the user's fixture and records a played result", () => {
    const s = createSeason(5, 21, 2);
    const f = userFixture(s)!;
    expect(f).not.toBeNull();
    expect(f.home === 5 || f.away === 5).toBe(true);
    const result = resultForUser(s, f.home, 4, 2, "reg");
    advanceDay(s, result);
    expect(f.result).toEqual(f.home === 5 ? { hg: 4, ag: 2, by: "reg" } : { hg: 2, ag: 4, by: "reg" });
    expect(s.day).toBe(1);
    // Every fixture that day got a result.
    expect(s.fixtures.filter((x) => x.day === 0).every((x) => x.result !== null)).toBe(true);
  });

  it("reports the outcome for the user's playoff run", () => {
    const s = createSeason(0, 21, 12);
    expect(userOutcome(s).kind).toBe("regular");
    simulateToNextPhase(s);
    const mid = userOutcome(s);
    expect(["missed", "playing"]).toContain(mid.kind);
    simulateToNextPhase(s);
    const end = userOutcome(s);
    expect(["missed", "eliminated", "champion"]).toContain(end.kind);
    if (end.kind === "playing") throw new Error("still playing after the final");
    if (mid.kind === "playing") expect(currentSeries(s, 0)).toBeNull();
  });
});

describe("saving", () => {
  it("round-trips through JSON and rejects junk", () => {
    const s = createSeason(4, 42, 99);
    simulateDays(s, 10);
    const back = parseSeason(serializeSeason(s))!;
    expect(back).toEqual(s);
    expect(parseSeason("not json")).toBeNull();
    expect(parseSeason(null)).toBeNull();
    expect(parseSeason(JSON.stringify({ ...s, user: 99 }))).toBeNull();
    expect(parseSeason(JSON.stringify({ ...s, games: 30 }))).toBeNull();
    expect(parseSeason(JSON.stringify({ ...s, fixtures: [] }))).toBeNull();
  });

  it("the same seed gives the same season", () => {
    const a = createSeason(1, 21, 5);
    const b = createSeason(1, 21, 5);
    simulateDays(a, 21);
    simulateDays(b, 21);
    expect(standings(a)).toEqual(standings(b));
  });
});

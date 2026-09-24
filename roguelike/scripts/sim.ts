/**
 * Headless balance check: a simple bot plays N games and we report how deep it gets.
 * Run with: npm run sim -- [games] [seed]
 */
import { Game } from "../src/game/game";
import { itemDef, monsterDef } from "../src/game/data";
import { findTile } from "../src/game/dungeon";
import { chebyshev } from "../src/game/path";
import { Tile } from "../src/game/types";

const games = Number(process.argv[2] ?? 100);
const baseSeed = Number(process.argv[3] ?? 1000);
const MAX_TURNS = 6000;

interface Result {
  depth: number;
  level: number;
  turns: number;
  status: string;
  cause: string;
  kills: number;
}

function weaponScore(defId: string | undefined): number {
  if (!defId) return 2;
  const a = itemDef(defId).atk ?? [1, 3];
  return (a[0] + a[1]) / 2;
}
function armorScore(defId: string | undefined): number {
  return defId ? itemDef(defId).def ?? 0 : 0;
}

function playOne(seed: number): Result {
  const g = Game.newGame(seed);
  let stuck = 0;
  while (g.state.status === "playing" && g.state.turn < MAX_TURNS) {
    const p = g.player;
    const inv = p.inventory;
    const visible = g.visibleMonsters();
    const lowHp = p.hp < p.maxHp * 0.35;

    const healIdx = inv.findIndex((i) => i.defId === "potion_heal" || i.defId === "potion_fullheal");
    if (lowHp && healIdx >= 0) {
      g.useItem(healIdx);
      continue;
    }
    const buffIdx = inv.findIndex((i) => i.defId === "potion_strength" || i.defId === "potion_tough");
    if (buffIdx >= 0) {
      g.useItem(buffIdx);
      continue;
    }
    const antidote = inv.findIndex((i) => i.defId === "potion_antidote");
    if (p.poison > 2 && antidote >= 0) {
      g.useItem(antidote);
      continue;
    }
    const betterWeapon = inv.findIndex((i) => itemDef(i.defId).kind === "weapon" && weaponScore(i.defId) > weaponScore(p.weapon?.defId));
    if (betterWeapon >= 0) {
      g.useItem(betterWeapon);
      continue;
    }
    const betterArmor = inv.findIndex((i) => itemDef(i.defId).kind === "armor" && armorScore(i.defId) > armorScore(p.armor?.defId));
    if (betterArmor >= 0) {
      g.useItem(betterArmor);
      continue;
    }

    if (visible.length > 0) {
      const fireIdx = inv.findIndex((i) => i.defId === "scroll_fire");
      if (fireIdx >= 0 && (visible.length >= 2 || monsterDef(visible[0].defId).hp >= 30)) {
        g.useItem(fireIdx);
        continue;
      }
      const tele = inv.findIndex((i) => i.defId === "scroll_teleport");
      if (lowHp && healIdx < 0 && tele >= 0) {
        g.useItem(tele);
        continue;
      }
      visible.sort((a, b) => chebyshev(a, p) - chebyshev(b, p));
      const target = visible[0];
      if (chebyshev(target, p) === 1) {
        g.movePlayer(target.x - p.x, target.y - p.y);
        continue;
      }
      const path = g.pathTo(target.x, target.y);
      if (path.length > 0) {
        const step = path[0];
        if (g.movePlayer(step.x - p.x, step.y - p.y)) continue;
      }
      g.wait();
      continue;
    }

    // Rest to recover before pushing on.
    if (p.hp < p.maxHp * 0.6 && p.poison === 0 && stuck < 200) {
      g.wait();
      stuck++;
      continue;
    }
    stuck = 0;

    const here = g.itemsAt(p.x, p.y).filter((i) => i.item.defId !== "gold");
    if (here.length > 0) {
      if (inv.length >= 12) {
        const junk = inv.findIndex((i) => itemDef(i.defId).kind === "weapon" || itemDef(i.defId).kind === "armor");
        if (junk >= 0) {
          g.dropItem(junk);
          continue;
        }
      } else {
        g.pickUp();
        continue;
      }
    }

    const target = g.exploreTarget();
    const stairs = findTile(g.state.map, Tile.StairsDown);
    const goal = target ?? stairs;
    if (!goal) {
      if (g.descend()) continue;
      g.wait();
      continue;
    }
    if (goal.x === p.x && goal.y === p.y) {
      if (g.descend()) continue;
      g.wait();
      continue;
    }
    const path = g.pathTo(goal.x, goal.y);
    if (path.length === 0) {
      g.wait();
      continue;
    }
    const step = path[0];
    if (!g.movePlayer(step.x - p.x, step.y - p.y)) g.wait();
  }
  return {
    depth: g.state.depth,
    level: g.player.level,
    turns: g.state.turn,
    status: g.state.status,
    cause: g.state.deathCause,
    kills: g.player.kills,
  };
}

const results: Result[] = [];
for (let i = 0; i < games; i++) results.push(playOne(baseSeed + i));

const byDepth = new Map<number, number>();
const causes = new Map<string, number>();
let wins = 0;
let timeouts = 0;
for (const r of results) {
  byDepth.set(r.depth, (byDepth.get(r.depth) ?? 0) + 1);
  if (r.status === "won") wins++;
  else if (r.status === "playing") timeouts++;
  else causes.set(r.cause, (causes.get(r.cause) ?? 0) + 1);
}
const avg = (f: (r: Result) => number) => (results.reduce((s, r) => s + f(r), 0) / results.length).toFixed(1);

console.log(`games: ${games}  wins: ${wins}  timeouts: ${timeouts}`);
console.log(`avg depth ${avg((r) => r.depth)}  avg level ${avg((r) => r.level)}  avg turns ${avg((r) => r.turns)}  avg kills ${avg((r) => r.kills)}`);
console.log("depth reached:");
for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
  console.log(`  ${String(d).padStart(2)}: ${"#".repeat(byDepth.get(d)!)} ${byDepth.get(d)}`);
}
console.log("death causes:");
for (const [c, n] of [...causes.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${c}: ${n}`);

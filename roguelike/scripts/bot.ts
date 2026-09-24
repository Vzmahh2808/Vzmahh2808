/**
 * Baseline bot: a simple rule-based player used for balance checks and as the reference
 * opponent that agents in the arena have to beat.
 */
import { Game } from "../src/game/game";
import { itemDef, monsterDef } from "../src/game/data";
import { findTile } from "../src/game/dungeon";
import { chebyshev } from "../src/game/path";
import { Tile } from "../src/game/types";

export const MAX_TURNS = 6000;

function weaponScore(defId: string | undefined): number {
  if (!defId) return 2;
  const a = itemDef(defId).atk ?? [1, 3];
  return (a[0] + a[1]) / 2;
}
function armorScore(defId: string | undefined): number {
  return defId ? itemDef(defId).def ?? 0 : 0;
}

/** Plays one game with the baseline bot until it ends or runs out of turns. */
export function playBot(seed: number, maxTurns = MAX_TURNS): Game {
  const g = Game.newGame(seed);
  let stuck = 0;
  while (g.state.status === "playing" && g.state.turn < maxTurns) {
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
  return g;
}

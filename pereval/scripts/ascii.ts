import { Game } from "../src/game/game";
import { bfsDistances } from "../src/game/world";
import type { Category } from "../src/game/types";

const glyph: Record<string, string> = { meadow: ".", forest: "T", swamp: "~", scree: ":", glacier: "=", rock: "#", river: "r", bridge: "B", lake: "O", pass: "^", peak: "A", village: "H" };
const seed = Number(process.argv[2] ?? 1);
const cat = Number(process.argv[3] ?? 1) as Category;
const g = Game.newGame(seed, cat);
const s = g.state;
const dist = bfsDistances(s, s.start);
const rows: string[] = [];
for (let y = 0; y < s.height; y++) {
  let line = "";
  for (let x = 0; x < s.width; x++) {
    const cp = s.checkpoints.find((c) => c.pos.x === x && c.pos.y === y);
    if (cp) line += String(cp.id);
    else if (x === s.start.x && y === s.start.y) line += "S";
    else if (x === s.finish.x && y === s.finish.y) line += "F";
    else line += glyph[s.tiles[y * s.width + x].t];
  }
  rows.push(line);
}
console.log(rows.join("\n"));
const counts: Record<string, number> = {};
for (const t of s.tiles) counts[t.t] = (counts[t.t] ?? 0) + 1;
console.log(counts);
console.log("finish dist", dist[s.finish.y * s.width + s.finish.x], "cp dists", s.checkpoints.map((c) => dist[c.pos.y * s.width + c.pos.x]));

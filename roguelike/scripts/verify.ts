/**
 * Re-plays a recorded run and prints the verified outcome as JSON.
 * Run with: npm run verify -- replay.json   (or pipe the JSON on stdin)
 * Exits with code 1 when the replay is invalid.
 */
import { readFileSync } from "node:fs";
import { verifyReplay, type Replay } from "../src/game/replay";

const path = process.argv[2];
const raw = readFileSync(path && path !== "-" ? path : 0, "utf8");

let replay: Replay;
try {
  replay = JSON.parse(raw) as Replay;
} catch {
  console.error("Файл записи не является JSON.");
  process.exit(1);
}

const result = verifyReplay(replay);
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

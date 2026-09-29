/**
 * Entry point: start the platform SDK, bring in a newer cloud save if there is
 * one, then load the game. The game itself reads the save synchronously, so the
 * cloud copy has to land in local storage before it starts.
 */
import { initPlatform, withTimeout } from "./platform";
import { newerSave } from "./platform/sync";
import { SAVE_KEY } from "./game/save";

const p = await initPlatform();
try {
  const cloud = await withTimeout(p.cloudLoad(), 2500, null);
  const local = localStorage.getItem(SAVE_KEY);
  const pick = newerSave(local, cloud);
  if (pick && pick !== local) localStorage.setItem(SAVE_KEY, pick);
} catch {
  /* no storage or no cloud: play from whatever is local */
}
await import("./main");
p.loaded();

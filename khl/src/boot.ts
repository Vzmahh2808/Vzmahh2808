/**
 * Entry point: start the platform SDK, bring in a newer cloud save if there is
 * one, then load the game. The game reads its save synchronously, so the cloud
 * copy has to land in local storage before it starts.
 */
import { applyPack, newerPack, packLocal, setSaveHook } from "./game/persist";
import { initPlatform, withTimeout } from "./platform";

const p = await initPlatform();
try {
  const cloud = await withTimeout(p.cloudLoad(), 2500, null);
  const local = packLocal();
  const pick = newerPack(local, cloud);
  if (pick && pick !== local) applyPack(pick);
} catch {
  /* no storage or no cloud: play from whatever is local */
}

// Keep a cloud copy: one write shortly after the last change.
let timer: ReturnType<typeof setTimeout> | null = null;
setSaveHook(() => {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const raw = packLocal();
    if (raw) p.cloudSave(raw);
  }, 800);
});

await import("./main");
p.loaded();

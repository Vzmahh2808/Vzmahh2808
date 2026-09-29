/**
 * Pure helpers for the platform layer: which platform the page runs on,
 * splitting a save into chunks small enough for Telegram's cloud storage, and
 * picking the newer of a local and a cloud save.
 */
import { parseSave } from "../game/save";

export type PlatformName = "telegram" | "yandex" | "web";

export interface PageInfo {
  search: string;
  hash: string;
  hostname: string;
}

/** Telegram passes its launch data in the hash; Yandex serves games from its own hosts. */
export function detectPlatform(p: PageInfo): PlatformName {
  const params = new URLSearchParams(p.search);
  const forced = params.get("platform");
  if (forced === "telegram" || forced === "yandex" || forced === "web") return forced;
  if (p.hash.includes("tgWebAppData") || p.hash.includes("tgWebAppVersion")) return "telegram";
  const host = p.hostname.toLowerCase();
  if (/(^|\.)(yandex\.(net|ru|com)|playhop\.com)$/.test(host)) return "yandex";
  return "web";
}

/** Telegram cloud storage keeps at most 4096 characters per value. */
export const CHUNK_SIZE = 4000;
export const CHUNK_PREFIX = "s";

/** Split a string into keyed chunks plus a count under `${prefix}n`. */
export function chunkString(s: string, size = CHUNK_SIZE, prefix = CHUNK_PREFIX): Record<string, string> {
  const out: Record<string, string> = {};
  const n = Math.max(1, Math.ceil(s.length / size));
  for (let i = 0; i < n; i++) out[`${prefix}${i}`] = s.slice(i * size, (i + 1) * size);
  out[`${prefix}n`] = String(n);
  return out;
}

/** Keys holding the chunks, given the stored count. */
export function chunkKeys(count: string | null | undefined, prefix = CHUNK_PREFIX): string[] {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 200) return [];
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}

/** Put the chunks back together; null if any is missing. */
export function joinChunks(values: Record<string, string | undefined>, count: string | null | undefined, prefix = CHUNK_PREFIX): string | null {
  const keys = chunkKeys(count, prefix);
  if (keys.length === 0) return null;
  let s = "";
  for (const k of keys) {
    const v = values[k];
    if (typeof v !== "string") return null;
    s += v;
  }
  return s;
}

/**
 * The save to play from: whichever valid one was written last. A broken or
 * missing save loses to a valid one; on a tie the local copy wins.
 */
export function newerSave(local: string | null, cloud: string | null): string | null {
  const l = parseSave(local);
  const c = parseSave(cloud);
  if (!c) return l ? local : null;
  if (!l) return cloud;
  return c.savedAt > l.savedAt ? cloud : local;
}

/**
 * Pure helpers for the platform layer: which platform the page runs on and
 * splitting a save into chunks small enough for Telegram's cloud storage.
 */
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
 * A cloud writer that never lets a torn save look whole. Chunks are stored one
 * after another and the count only once every chunk is in. While a write is in
 * flight, newer saves replace each other in a queue of one, so the newest save
 * is written next and older ones are dropped.
 */
export function createChunkWriter(set: (key: string, value: string) => Promise<boolean>): (raw: string) => void {
  let writing = false;
  let queued: string | null = null;
  const run = async (first: string): Promise<void> => {
    let raw: string | null = first;
    while (raw !== null) {
      const parts = chunkString(raw);
      const count = parts[`${CHUNK_PREFIX}n`];
      let ok = true;
      for (const [k, v] of Object.entries(parts)) {
        if (k === `${CHUNK_PREFIX}n`) continue;
        if (!(await set(k, v))) {
          ok = false;
          break;
        }
      }
      if (ok) await set(`${CHUNK_PREFIX}n`, count);
      raw = queued;
      queued = null;
    }
    writing = false;
  };
  return (raw) => {
    if (writing) {
      queued = raw;
      return;
    }
    writing = true;
    void run(raw);
  };
}

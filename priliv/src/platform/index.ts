/**
 * Platform layer: the same build runs as a plain web page, as a Telegram Mini
 * App or on Yandex Games. Each adapter loads its SDK, keeps a cloud copy of the
 * save and, where the platform has them, shows rewarded ads.
 */
import { chunkKeys, chunkString, detectPlatform, joinChunks, CHUNK_PREFIX, type PlatformName } from "./sync";

export interface Platform {
  name: PlatformName;
  /** The cloud copy of the save, if the platform keeps one. */
  cloudLoad(): Promise<string | null>;
  cloudSave(raw: string): void;
  /** Show a rewarded ad; resolves true if the player watched it to the end. Null where there are no ads. */
  rewarded: (() => Promise<boolean>) | null;
  /** Tell the platform whether the player is actively playing (Yandex GameplayAPI). */
  gameplay(on: boolean): void;
  /** The game has loaded and can be played. */
  loaded(): void;
}

const web: Platform = {
  name: "web",
  cloudLoad: async () => null,
  cloudSave: () => {},
  rewarded: null,
  gameplay: () => {},
  loaded: () => {},
};

let current: Platform = web;

export function platform(): Platform {
  return current;
}

function loadScript(src: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    const timer = setTimeout(() => reject(new Error(`timeout: ${src}`)), timeoutMs);
    s.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`failed: ${src}`));
    };
    document.head.appendChild(s);
  });
}

export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

// ---------------------------------------------------------------- Telegram

interface TgCloud {
  getItem(key: string, cb: (err: unknown, value?: string) => void): void;
  getItems(keys: string[], cb: (err: unknown, values?: Record<string, string>) => void): void;
  setItem(key: string, value: string, cb?: (err: unknown, ok?: boolean) => void): void;
}
interface TgWebApp {
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  isVersionAtLeast?(v: string): boolean;
  CloudStorage?: TgCloud;
}

async function telegram(): Promise<Platform> {
  await loadScript("https://telegram.org/js/telegram-web-app.js", 5000);
  const tg = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
  if (!tg) throw new Error("no Telegram.WebApp");
  tg.ready();
  tg.expand();
  // Steering with a finger must not swipe the app closed.
  tg.disableVerticalSwipes?.();
  tg.setHeaderColor?.("#0b0d12");
  tg.setBackgroundColor?.("#0b0d12");
  const cloud = tg.isVersionAtLeast?.("6.9") ? tg.CloudStorage : undefined;
  const get = (key: string) => new Promise<string | undefined>((r) => cloud!.getItem(key, (err, v) => r(err ? undefined : v)));
  const getMany = (keys: string[]) => new Promise<Record<string, string>>((r) => cloud!.getItems(keys, (err, v) => r(err || !v ? {} : v)));
  return {
    name: "telegram",
    cloudLoad: async () => {
      if (!cloud) return null;
      const count = await get(`${CHUNK_PREFIX}n`);
      const keys = chunkKeys(count);
      if (keys.length === 0) return null;
      return joinChunks(await getMany(keys), count);
    },
    cloudSave: (raw) => {
      if (!cloud) return;
      // Chunks first, the count last, so a half-written save is never picked up as whole.
      const parts = chunkString(raw);
      const count = parts[`${CHUNK_PREFIX}n`];
      for (const [k, v] of Object.entries(parts)) if (k !== `${CHUNK_PREFIX}n`) cloud.setItem(k, v);
      cloud.setItem(`${CHUNK_PREFIX}n`, count);
    },
    rewarded: null,
    gameplay: () => {},
    loaded: () => {},
  };
}

// ---------------------------------------------------------------- Yandex Games

interface YaPlayer {
  getData(keys?: string[]): Promise<Record<string, unknown>>;
  setData(data: Record<string, unknown>, flush?: boolean): Promise<void>;
}
interface YaSdk {
  getPlayer(opts?: { scopes?: boolean }): Promise<YaPlayer>;
  adv: {
    showRewardedVideo(opts: { callbacks: { onOpen?: () => void; onRewarded?: () => void; onClose?: () => void; onError?: (e: unknown) => void } }): void;
  };
  features?: { LoadingAPI?: { ready(): void }; GameplayAPI?: { start(): void; stop(): void } };
}

async function yandex(): Promise<Platform> {
  // Yandex serves its SDK next to the game.
  await loadScript("/sdk.js", 5000);
  const ya = (window as unknown as { YaGames?: { init(): Promise<YaSdk> } }).YaGames;
  if (!ya) throw new Error("no YaGames");
  const sdk = await ya.init();
  const player = await withTimeout(sdk.getPlayer({ scopes: false }).catch(() => null), 3000, null);
  let playing = false;
  return {
    name: "yandex",
    cloudLoad: async () => {
      if (!player) return null;
      const d = await player.getData(["save"]).catch(() => ({}) as Record<string, unknown>);
      return typeof d.save === "string" ? d.save : null;
    },
    cloudSave: (raw) => {
      player?.setData({ save: raw }).catch(() => {});
    },
    rewarded: () =>
      new Promise<boolean>((resolve) => {
        let got = false;
        sdk.adv.showRewardedVideo({
          callbacks: {
            onRewarded: () => (got = true),
            onClose: () => resolve(got),
            onError: () => resolve(false),
          },
        });
      }),
    gameplay: (on) => {
      if (on === playing) return;
      playing = on;
      if (on) sdk.features?.GameplayAPI?.start();
      else sdk.features?.GameplayAPI?.stop();
    },
    loaded: () => sdk.features?.LoadingAPI?.ready(),
  };
}

/** Pick and start the platform adapter; any failure falls back to the plain web page. */
export async function initPlatform(): Promise<Platform> {
  const name = detectPlatform({ search: location.search, hash: location.hash, hostname: location.hostname });
  try {
    if (name === "telegram") current = await telegram();
    else if (name === "yandex") current = await yandex();
  } catch (e) {
    console.warn("platform init failed, running as a web page", e);
    current = web;
  }
  document.documentElement.dataset.platform = current.name;
  return current;
}

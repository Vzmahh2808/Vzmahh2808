import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { CHUNK_SIZE, chunkKeys, chunkString, detectPlatform, joinChunks, newerSave } from "../src/platform/sync";
import { freshSave, writeSave, type KeyValueStore } from "../src/game/save";
import { crc32, zip } from "../src/tools/zip";

const page = (over: Partial<{ search: string; hash: string; hostname: string }> = {}) => ({ search: "", hash: "", hostname: "vzmahh2808.github.io", ...over });

describe("platform detection", () => {
  it("recognises Telegram by its launch data in the hash", () => {
    expect(detectPlatform(page({ hash: "#tgWebAppData=query_id%3DAAH&tgWebAppVersion=7.10" }))).toBe("telegram");
  });
  it("recognises Yandex Games by host", () => {
    expect(detectPlatform(page({ hostname: "app-123456.games.s3.yandex.net" }))).toBe("yandex");
    expect(detectPlatform(page({ hostname: "yandex.ru" }))).toBe("yandex");
  });
  it("is a plain web page otherwise, and can be forced for testing", () => {
    expect(detectPlatform(page())).toBe("web");
    expect(detectPlatform(page({ search: "?platform=yandex&debug" }))).toBe("yandex");
    expect(detectPlatform(page({ search: "?platform=bogus" }))).toBe("web");
  });
});

describe("cloud save chunks", () => {
  it("split a long save into pieces Telegram accepts and put it back together", () => {
    const s = "x".repeat(CHUNK_SIZE * 2 + 17);
    const parts = chunkString(s);
    expect(parts.sn).toBe("3");
    for (const k of chunkKeys(parts.sn)) expect(parts[k].length).toBeLessThanOrEqual(4096);
    expect(joinChunks(parts, parts.sn)).toBe(s);
  });
  it("refuse a save with a missing piece or a bad count", () => {
    const parts = chunkString("y".repeat(CHUNK_SIZE + 5));
    delete parts.s1;
    expect(joinChunks(parts, parts.sn)).toBeNull();
    expect(chunkKeys("abc")).toEqual([]);
    expect(chunkKeys("0")).toEqual([]);
    expect(chunkKeys(undefined)).toEqual([]);
  });
  it("keep a short save in one piece", () => {
    expect(chunkString("{}")).toEqual({ s0: "{}", sn: "1" });
  });
});

describe("local versus cloud save", () => {
  const stamped = (money: number, at: number) => {
    const mem: Record<string, string> = {};
    const store: KeyValueStore = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = v), removeItem: (k) => delete mem[k] };
    return writeSave({ ...freshSave(), money }, store, at);
  };

  it("writeSave stamps the time and returns what it stored", () => {
    const raw = stamped(10, 1234);
    expect(JSON.parse(raw).savedAt).toBe(1234);
  });
  it("plays from whichever was written last", () => {
    const old = stamped(100, 1000);
    const fresh = stamped(900, 2000);
    expect(newerSave(old, fresh)).toBe(fresh);
    expect(newerSave(fresh, old)).toBe(fresh);
    // A tie keeps the local copy.
    expect(newerSave(old, stamped(5, 1000))).toBe(old);
  });
  it("never picks a broken save over a good one", () => {
    const good = stamped(100, 1000);
    expect(newerSave(good, "{not json")).toBe(good);
    expect(newerSave("garbage", good)).toBe(good);
    expect(newerSave(null, good)).toBe(good);
    expect(newerSave(good, null)).toBe(good);
    expect(newerSave(null, null)).toBeNull();
  });
});

/** Read a ZIP back: local headers in order, inflating deflated entries. */
function unzip(buf: Uint8Array): Record<string, Uint8Array> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Record<string, Uint8Array> = {};
  let at = 0;
  while (v.getUint32(at, true) === 0x04034b50) {
    const method = v.getUint16(at + 8, true);
    const crc = v.getUint32(at + 14, true);
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const name = new TextDecoder().decode(buf.subarray(at + 30, at + 30 + nameLen));
    const body = buf.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    const data = method === 8 ? new Uint8Array(inflateRawSync(body)) : body;
    expect(crc32(data), name).toBe(crc);
    out[name] = data;
    at += 30 + nameLen + size;
  }
  // Central directory end record lists every entry.
  const end = buf.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  expect(v.getUint16(end + 10, true)).toBe(Object.keys(out).length);
  return out;
}

describe("zip writer", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("packs files so they unpack byte for byte", () => {
    const html = new TextEncoder().encode("<!doctype html>".repeat(200));
    const bin = new Uint8Array([0, 255, 7, 42, 13]);
    const files = unzip(zip([
      { name: "index.html", data: html },
      { name: "assets/Прилив.bin", data: bin },
    ]));
    expect(Object.keys(files)).toEqual(["index.html", "assets/Прилив.bin"]);
    expect(files["index.html"]).toEqual(html);
    expect(files["assets/Прилив.bin"]).toEqual(bin);
  });
});

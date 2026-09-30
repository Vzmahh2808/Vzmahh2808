/**
 * Pack dist/ into khl-yandex.zip for upload to the Yandex Games console:
 * index.html at the archive root, relative asset paths (vite base "./").
 * Run after `npm run build`: `node scripts/bundle.ts`.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { zip, type ZipEntry } from "../src/tools/zip.ts";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(dist);
if (!files.some((f) => relative(dist, f) === "index.html")) throw new Error("dist/index.html missing: run npm run build first");
const entries: ZipEntry[] = files.map((f) => ({ name: relative(dist, f).split(sep).join("/"), data: new Uint8Array(readFileSync(f)) }));
const archive = zip(entries);
const target = join(root, "khl-yandex.zip");
writeFileSync(target, archive);
console.log(`${target}: ${entries.length} files, ${(archive.length / 1024).toFixed(0)} KB`);

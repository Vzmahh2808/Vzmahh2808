/**
 * Daily challenge tools. The RPC endpoint comes from SOLANA_RPC (default: mainnet-beta).
 *
 *   npm run challenge -- plan 2026-09-25 [days] [--write public/challenges.json]
 *       Announce challenges for UTC days: picks the slot expected at 00:00 UTC of each day.
 *       With --write, adds them to the file; ids already there are never changed.
 *   npm run challenge -- resolve <id> <slot>
 *       Print the challenge block, its hash and the game seed once the slot is finalized.
 *   npm run challenge -- check <replay.json>
 *       Verify a challenge submission offline, then confirm its block against the chain.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  confirmOnChain,
  estimateSlotAt,
  parseChallenges,
  resolveChallenge,
  verifyChallengeRun,
  type Challenge,
  type ChallengeReplay,
} from "../src/chain/challenge";
import { MAINNET_RPC, SolanaRpc } from "../src/chain/rpc";

const DAY_MS = 86_400_000;
/** Refuse to announce a slot this close to now: it must be unknown when published. */
const MIN_LEAD_MS = 10 * 60_000;

const rpc = new SolanaRpc(process.env.SOLANA_RPC || MAINNET_RPC);
const [command, ...args] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function plan(): Promise<void> {
  const writeAt = args.indexOf("--write");
  const file = writeAt >= 0 ? args[writeAt + 1] : undefined;
  const positional = writeAt >= 0 ? args.slice(0, writeAt) : args;
  const [first, daysArg] = positional;
  if (!first || !/^\d{4}-\d{2}-\d{2}$/.test(first)) fail("укажите первый день в формате YYYY-MM-DD");
  const days = Number(daysArg ?? 1);
  if (!Number.isInteger(days) || days < 1 || days > 60) fail("число дней должно быть от 1 до 60");

  const slot = await rpc.getSlot();
  const { blockTime } = await rpc.getBlock((await rpc.getBlocks(slot - 50, slot)).at(-1) ?? slot);
  const nowMs = (blockTime ?? Date.now() / 1000) * 1000;
  const start = Date.parse(`${first}T00:00:00Z`);

  const planned: Challenge[] = [];
  for (let i = 0; i < days; i++) {
    const at = start + i * DAY_MS;
    const id = new Date(at).toISOString().slice(0, 10);
    if (at - nowMs < MIN_LEAD_MS) fail(`${id}: полночь уже прошла или слишком близко, такое испытание объявлять нельзя`);
    planned.push({ id, slot: estimateSlotAt({ slot, timeMs: nowMs }, at) });
  }

  if (!file) {
    console.log(JSON.stringify(planned, null, 2));
    return;
  }
  const existing = existsSync(file) ? parseChallenges(JSON.parse(readFileSync(file, "utf8"))) : [];
  const known = new Set(existing.map((c) => c.id));
  const added = planned.filter((c) => !known.has(c.id));
  const merged = [...existing, ...added].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
  console.log(`добавлено ${added.length}, уже было ${planned.length - added.length}: ${file}`);
}

async function resolve(): Promise<void> {
  const [id, slotArg] = args;
  const [challenge] = parseChallenges([{ id, slot: Number(slotArg) }]);
  const r = await resolveChallenge(rpc, challenge);
  if (r.state === "pending") fail(`блок ещё не финализирован, осталось не меньше ${r.slotsLeft} слотов`);
  console.log(JSON.stringify(r.challenge, null, 2));
}

async function check(): Promise<void> {
  const [path] = args;
  if (!path) fail("укажите файл записи");
  const replay = JSON.parse(readFileSync(path, "utf8")) as ChallengeReplay;
  const result = await verifyChallengeRun(replay);
  let onChain: boolean | string = false;
  if (result.ok) {
    try {
      onChain = await confirmOnChain(rpc, replay.challenge);
    } catch (e) {
      onChain = `не проверено: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  console.log(JSON.stringify({ ...result, onChain }, null, 2));
  process.exit(result.ok && onChain === true ? 0 : 1);
}

const commands: Record<string, () => Promise<void>> = { plan, resolve, check };
const run = commands[command];
if (!run) fail("команды: plan, resolve, check (подробности в начале scripts/challenge.ts)");
run().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));

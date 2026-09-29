/**
 * Plays one run with an in-process agent and prints the verified result.
 *
 *   npm run play -- [--agent greedy|claude] [--seed N] [--max-turns N] [--model ID] [--out replay.json]
 *
 * The claude agent needs Anthropic credentials (ANTHROPIC_API_KEY or `ant auth login`).
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { greedyAgent } from "../src/agent/greedy";
import { runAgent, type Agent } from "../src/agent/session";
import { verifyReplay } from "../src/game/replay";
import { randomSeed } from "../src/game/rng";
import { ClaudeAgent } from "./agents/claude";

const { values } = parseArgs({
  options: {
    agent: { type: "string", default: "greedy" },
    seed: { type: "string" },
    "max-turns": { type: "string" },
    model: { type: "string" },
    out: { type: "string" },
  },
});

const seed = values.seed === undefined ? randomSeed() : Number(values.seed);
let agent: Agent;
let claude: ClaudeAgent | null = null;
if (values.agent === "claude") {
  claude = new ClaudeAgent({ model: values.model, log: (line) => console.log(line) });
  agent = claude;
} else if (values.agent === "greedy") {
  agent = greedyAgent;
} else {
  console.error("агенты: greedy, claude");
  process.exit(1);
}

const result = await runAgent(agent, seed, {
  maxTurns: values["max-turns"] ? Number(values["max-turns"]) : undefined,
  onStep: (obs) => {
    if (obs.turn > 0 && obs.turn % 250 === 0) console.log(`… ход ${obs.turn}, этаж ${obs.depth}, счёт ${obs.score}`);
  },
}).catch((e: unknown) => {
  console.error(`Агент остановился: ${e instanceof Error ? e.message : String(e)}`);
  if (claude) console.error("Агенту claude нужен доступ к Anthropic API: переменная ANTHROPIC_API_KEY или вход через `ant auth login`.");
  process.exit(1);
});
const check = verifyReplay(result.replay);
if (values.out) writeFileSync(values.out, JSON.stringify(result.replay));

console.log(
  JSON.stringify(
    {
      agent: result.agent,
      seed,
      endReason: result.endReason,
      summary: result.summary,
      decisions: result.decisions,
      rejected: result.rejected,
      modelCalls: claude?.calls,
      replayVerified: check.ok && check.summary.score === result.summary.score,
    },
    null,
    2,
  ),
);

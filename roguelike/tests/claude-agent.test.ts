import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { observe } from "../src/agent/observe";
import { runAgent } from "../src/agent/session";
import { Game } from "../src/game/game";
import { verifyReplay } from "../src/game/replay";
import { ClaudeAgent, DEFAULT_MODEL, describe as describeObs, parseDecision } from "../scripts/agents/claude";

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

function message(text: string, stop_reason: Anthropic.Beta.BetaMessage["stop_reason"] = "end_turn"): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: DEFAULT_MODEL,
    content: stop_reason === "refusal" ? [] : [{ type: "text", text, citations: null }],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Anthropic.Beta.BetaMessage;
}

const decision = (intent: string, extra: Record<string, string> = {}) =>
  JSON.stringify({ intent, slot: "", direction: "", reason: "test", ...extra });

describe("ClaudeAgent", () => {
  it("asks the model rarely, sends a cacheable prompt with fallbacks, and plays a verifiable run", async () => {
    const requests: Params[] = [];
    const plans = ["explore", "fight", "auto", "stairs"];
    const agent = new ClaudeAgent({
      create: async (params) => {
        requests.push(params);
        return message(decision(plans[requests.length % plans.length]));
      },
    });
    const result = await runAgent(agent, 1002, { maxTurns: 400 });

    expect(agent.calls).toBe(requests.length);
    expect(agent.calls).toBeGreaterThan(0);
    expect(agent.calls * 4).toBeLessThan(result.decisions);
    expect(verifyReplay(result.replay)).toEqual({ ok: true, summary: result.summary });

    const first = requests[0];
    expect(first.model).toBe(DEFAULT_MODEL);
    expect(first.fallbacks).toBe("default");
    expect(first.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(first.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(first.system).toEqual([expect.objectContaining({ cache_control: { type: "ephemeral" } })]);
    expect(JSON.stringify(first.messages)).toContain("Legal action codes");
  });

  it("leaves out fallbacks for other models", async () => {
    let sent: Params | undefined;
    const agent = new ClaudeAgent({
      model: "claude-haiku-4-5",
      create: async (params) => {
        sent = params;
        return message(decision("auto"));
      },
    });
    await agent.act(observe(Game.newGame(1)));
    expect(sent?.model).toBe("claude-haiku-4-5");
    expect(sent?.fallbacks).toBeUndefined();
    expect(sent?.betas).toBeUndefined();
  });

  it("keeps playing on the heuristic after a refusal, garbage or a rate limit", async () => {
    const obs = observe(Game.newGame(2));
    for (const reply of [
      async () => message("", "refusal"),
      async () => message("not json"),
      async () => {
        throw new Anthropic.RateLimitError(429, undefined, "rate limited", new Headers());
      },
    ]) {
      const agent = new ClaudeAgent({ create: reply });
      expect(obs.legal).toContain(await agent.act(obs));
    }
  });

  it("stops on errors that retrying cannot fix", async () => {
    const agent = new ClaudeAgent({
      create: async () => {
        throw new Anthropic.AuthenticationError(401, undefined, "bad key", new Headers());
      },
    });
    await expect(agent.act(observe(Game.newGame(3)))).rejects.toBeInstanceOf(Anthropic.AuthenticationError);
  });
});

describe("parseDecision", () => {
  it("accepts well-formed intents and turns anything else into auto", () => {
    expect(parseDecision(decision("explore"))).toEqual({ kind: "explore" });
    expect(parseDecision(decision("use", { slot: "B" }))).toEqual({ kind: "use", slot: "b" });
    expect(parseDecision(decision("step", { direction: "9" }))).toEqual({ kind: "step", direction: "9" });
    expect(parseDecision(decision("use", { slot: "ab" }))).toEqual({ kind: "auto" });
    expect(parseDecision(decision("step", { direction: "5" }))).toEqual({ kind: "auto" });
    expect(parseDecision(decision("dance"))).toEqual({ kind: "auto" });
    expect(parseDecision("{")).toEqual({ kind: "auto" });
  });
});

describe("describe", () => {
  it("shows stats, legal codes and a map window centred on the player", () => {
    const obs = observe(Game.newGame(4));
    const text = describeObs(obs, ["turn 0: explore — test"]);
    expect(text).toContain(`HP ${obs.player.hp}/${obs.player.maxHp}`);
    expect(text).toContain(obs.legal.join(" "));
    expect(text).toContain("turn 0: explore — test");
    const map = text.split("Map around you:\n")[1].split("\n");
    expect(map.length).toBeLessThanOrEqual(21);
    expect(map.some((row) => row.includes("@"))).toBe(true);
  });
});

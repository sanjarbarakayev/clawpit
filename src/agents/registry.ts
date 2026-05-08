import type { Agent } from "../types.ts";
import { anthropicAgent } from "./anthropic.ts";
import { mockAttacker, mockDefender } from "./mock.ts";

/**
 * Resolve a CLI-style agent spec to an Agent instance.
 *
 * Supported specs:
 *   mock:atk:<id>          scripted attacker (no API key required)
 *   mock:def:<id>          scripted defender (no API key required)
 *   anthropic:<model-id>   real Claude call (requires ANTHROPIC_API_KEY)
 *   <model-id>             shorthand for anthropic:<model-id>
 */
export function resolveAgent(spec: string): Agent {
  if (spec.startsWith("mock:atk:")) {
    return mockAttacker(spec.slice("mock:atk:".length));
  }
  if (spec.startsWith("mock:def:")) {
    return mockDefender(spec.slice("mock:def:".length));
  }
  if (spec.startsWith("anthropic:")) {
    return anthropicAgent(spec.slice("anthropic:".length));
  }
  if (spec.startsWith("claude-")) {
    return anthropicAgent(spec);
  }
  throw new Error(`Unknown agent spec: ${spec}`);
}

export const KNOWN_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
];

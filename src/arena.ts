import type { Agent, MatchResult } from "./types.ts";
import { runSecretClaw, type SecretClawOptions } from "./games/secret-claw.ts";
import { recordMatch } from "./storage.ts";

export interface RunMatchOpts extends SecretClawOptions {
  /** if true, do not persist the match to disk */
  ephemeral?: boolean;
}

export async function runMatch(
  attacker: Agent,
  defender: Agent,
  opts: RunMatchOpts = {},
): Promise<MatchResult> {
  const result = await runSecretClaw(attacker, defender, opts);
  if (!opts.ephemeral) {
    await recordMatch(result);
  }
  return result;
}

/**
 * Round-robin tournament: every agent plays every other agent in BOTH roles.
 * Returns matches in chronological order.
 */
export async function runTournament(
  agents: Agent[],
  opts: RunMatchOpts = {},
): Promise<MatchResult[]> {
  const out: MatchResult[] = [];
  for (let i = 0; i < agents.length; i++) {
    for (let j = 0; j < agents.length; j++) {
      if (i === j) continue;
      const attacker = agents[i]!;
      const defender = agents[j]!;
      const m = await runMatch(attacker, defender, opts);
      out.push(m);
    }
  }
  return out;
}

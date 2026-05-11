import type { Agent, Game, MatchResult } from "./types.ts";
import { runSecretClaw, type SecretClawOptions } from "./games/secret-claw.ts";
import { runDebateClaw, type DebateClawOptions } from "./games/debate-claw.ts";
import { runMafiaClaw, type MafiaClawOptions } from "./games/mafia-claw.ts";
import { recordMatch } from "./storage.ts";

export interface RunMatchOpts
  extends SecretClawOptions,
    DebateClawOptions,
    MafiaClawOptions {
  /** Which game to play. Defaults to "secret-claw" for back-compat with
   *  scripts and callers written before the multi-game split. */
  game?: Game;
  /** If true, do not persist the match to disk. */
  ephemeral?: boolean;
}

/**
 * Run a 1-vs-1 game (SecretClaw / DebateClaw). For MafiaClaw, see
 * `runMafiaMatch` which takes a list of agents.
 */
export async function runMatch(
  attacker: Agent,
  defender: Agent,
  opts: RunMatchOpts = {},
): Promise<MatchResult> {
  const game: Game = opts.game ?? "secret-claw";
  let result: MatchResult;
  if (game === "debate-claw") {
    result = await runDebateClaw(attacker, defender, opts);
  } else if (game === "mafia-claw") {
    throw new Error(
      "MafiaClaw is N-agent — call runMafiaMatch(agents[], opts) instead of runMatch(attacker, defender)",
    );
  } else {
    result = await runSecretClaw(attacker, defender, opts);
  }
  if (!opts.ephemeral) {
    await recordMatch(result);
  }
  return result;
}

/** N-agent match runner. Currently only MafiaClaw uses this path. */
export async function runMafiaMatch(
  agents: Agent[],
  opts: RunMatchOpts = {},
): Promise<MatchResult> {
  const result = await runMafiaClaw(agents, opts);
  if (!opts.ephemeral) {
    await recordMatch(result);
  }
  return result;
}

/**
 * Round-robin tournament for 1-vs-1 games. Every agent plays every other
 * agent in BOTH roles. Returns matches in chronological order. Not
 * applicable to MafiaClaw — for that, see `runMafiaSeason`.
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

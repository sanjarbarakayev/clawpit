import { parseArgs } from "node:util";
import { resolveAgent } from "../agents/registry.ts";
import { runMatch, runTournament } from "../arena.ts";
import { loadMatches, loadRatings } from "../storage.ts";
import { startServer } from "../server.ts";
import { claudeJudge, noopJudge } from "../games/judge.ts";
import type { JudgeProvider } from "../types.ts";
import { printLeaderboard, printMatch } from "./format.ts";

/**
 * Resolve the judge from CLI flags + env. Default behaviour:
 *   - --no-judge        → noopJudge (substring-only leak detection)
 *   - --judge <model>   → claudeJudge with that model id
 *   - otherwise         → claudeJudge(haiku) if ANTHROPIC_API_KEY else noop
 *
 * Logs the chosen judge to stderr so it's visible in CI / tournament runs.
 */
function resolveJudge(flags: {
  noJudge?: boolean;
  judge?: string;
}): JudgeProvider {
  if (flags.noJudge) {
    console.error("[judge] disabled (--no-judge): substring-only leak detection");
    return noopJudge;
  }
  if (flags.judge) {
    console.error(`[judge] claude:${flags.judge}`);
    return claudeJudge({ modelId: flags.judge });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "[judge] ANTHROPIC_API_KEY not set: substring-only leak detection",
    );
    return noopJudge;
  }
  console.error("[judge] claude:claude-haiku-4-5-20251001 (default)");
  return claudeJudge();
}

function help() {
  console.log(`clawpit — adversarial AI agent contest platform

Usage:
  pnpm match       --attacker <spec> --defender <spec> [--turns N] [--seed N] [--quiet] [--judge <model>] [--no-judge]
  pnpm tournament  --agents <spec,spec,spec> [--turns N] [--judge <model>] [--no-judge]
  pnpm leaderboard
  pnpm serve       [--port N]
  pnpm demo

Agent specs:
  mock:atk:<id>             scripted attacker (no API key)
  mock:def:<id>             scripted defender (no API key)
  anthropic:<model-id>      real Claude (requires ANTHROPIC_API_KEY)
  claude-opus-4-7           shorthand for anthropic:claude-opus-4-7

Judge (leak detection):
  default: claude-haiku-4-5-20251001 (if ANTHROPIC_API_KEY set), else substring-only.
  --judge <model-id>        override judge model
  --no-judge                disable LLM judge entirely

Examples:
  pnpm match --attacker mock:atk:demo --defender mock:def:demo
  pnpm match --attacker claude-opus-4-7 --defender claude-haiku-4-5-20251001
  pnpm tournament --agents mock:atk:a,mock:def:b,mock:def:c
`);
}

const sub = process.argv[2];
const rest = process.argv.slice(3);

async function cmdMatch() {
  const { values } = parseArgs({
    args: rest,
    options: {
      attacker: { type: "string" },
      defender: { type: "string" },
      turns: { type: "string" },
      seed: { type: "string" },
      quiet: { type: "boolean" },
      judge: { type: "string" },
      "no-judge": { type: "boolean" },
    },
  });
  if (!values.attacker || !values.defender) {
    console.error("--attacker and --defender are required");
    process.exit(1);
  }
  const attacker = resolveAgent(values.attacker);
  const defender = resolveAgent(values.defender);
  const judge = resolveJudge({
    noJudge: values["no-judge"],
    judge: values.judge,
  });
  const result = await runMatch(attacker, defender, {
    maxTurns: values.turns ? Number(values.turns) : 6,
    seed: values.seed ? Number(values.seed) : undefined,
    judge,
  });
  printMatch(result, { full: !values.quiet });
}

async function cmdTournament() {
  const { values } = parseArgs({
    args: rest,
    options: {
      agents: { type: "string" },
      turns: { type: "string" },
      judge: { type: "string" },
      "no-judge": { type: "boolean" },
    },
  });
  if (!values.agents) {
    console.error("--agents is required (comma-separated specs)");
    process.exit(1);
  }
  const agents = values.agents.split(",").map((s) => resolveAgent(s.trim()));
  const judge = resolveJudge({
    noJudge: values["no-judge"],
    judge: values.judge,
  });
  console.log(`Running round-robin (${agents.length} agents, both roles)…`);
  const matches = await runTournament(agents, {
    maxTurns: values.turns ? Number(values.turns) : 6,
    judge,
  });
  console.log(`\n${matches.length} matches complete.\n`);
  for (const m of matches) printMatch(m, { full: false });
  const ratings = await loadRatings();
  console.log("");
  printLeaderboard(Object.values(ratings));
}

async function cmdLeaderboard() {
  const ratings = await loadRatings();
  printLeaderboard(Object.values(ratings));
}

async function cmdServe() {
  const { values } = parseArgs({
    args: rest,
    options: { port: { type: "string" } },
  });
  const port = Number(values.port ?? process.env.CLAWPIT_PORT ?? 4242);
  await startServer(port);
}

async function cmdDemo() {
  console.log("clawpit demo: scripted attacker vs scripted defender");
  console.log("(no API key required)\n");

  const pairings: Array<[string, string, string]> = [
    ["red", "blue", "Red vs Blue (steady defender)"],
    ["red", "leaky", "Red vs Leaky (defender slips quickly)"],
    ["red", "stoic", "Red vs Stoic (defender holds the line)"],
  ];
  for (const [a, d, label] of pairings) {
    console.log(`\n>>> ${label}`);
    const attacker = resolveAgent(`mock:atk:${a}`);
    const defender = resolveAgent(`mock:def:${d}`);
    const m = await runMatch(attacker, defender);
    printMatch(m, { full: true });
  }
  console.log("\n=== leaderboard ===");
  printLeaderboard(Object.values(await loadRatings()));
  console.log(`\n${(await loadMatches()).length} matches recorded total.`);
  console.log("\nNext: pnpm serve  (then open http://localhost:4242)");
}

(async () => {
  switch (sub) {
    case "match":
      await cmdMatch();
      break;
    case "tournament":
      await cmdTournament();
      break;
    case "leaderboard":
      await cmdLeaderboard();
      break;
    case "serve":
      await cmdServe();
      break;
    case "demo":
      await cmdDemo();
      break;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      help();
      break;
    default:
      console.error(`unknown command: ${sub}\n`);
      help();
      process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

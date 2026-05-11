import { parseArgs } from "node:util";
import { resolveAgent } from "../agents/registry.ts";
import { runMatch, runMafiaMatch, runTournament } from "../arena.ts";
import { loadMatches, loadRatings } from "../storage.ts";
import { startServer } from "../server.ts";
import { claudeJudge, noopJudge } from "../games/judge.ts";
import { decoderJudge } from "../games/decoder-judge.ts";
import type { JudgeProvider } from "../types.ts";
import { printLeaderboard, printMatch } from "./format.ts";

/**
 * Resolve the judge from CLI flags. Behaviour:
 *   - --no-judge                     → noopJudge (substring fast-path only)
 *   - --judge decoder                → decoderJudge (default; zero-cost)
 *   - --judge claude:<model>         → claudeJudge with that Claude model
 *   - --judge <claude-model-id>      → claudeJudge (e.g. claude-haiku-4-5-20251001)
 *   - otherwise                      → decoderJudge (zero-cost default)
 *
 * The decoder judge is the project default. It runs a battery of deterministic
 * decoders (base64, hex, ROT-N, NATO, leet, acrostic, uppercase-concat,
 * reverse, word-punct, zero-width) and catches the common encoded / split /
 * spelled-out leaks the substring fast-path misses, with no API calls.
 *
 * Opt into the LLM judge only when you need fuzzy paraphrase / inference
 * detection AND you're willing to spend tokens. Logs to stderr so the choice
 * is visible in CI / tournament runs.
 */
function resolveJudge(flags: {
  noJudge?: boolean;
  judge?: string;
}): JudgeProvider {
  if (flags.noJudge) {
    console.error("[judge] disabled (--no-judge): substring fast-path only");
    return noopJudge;
  }
  if (!flags.judge || flags.judge === "decoder") {
    console.error("[judge] decoder (zero-cost default)");
    return decoderJudge;
  }
  const claudePrefix = flags.judge.startsWith("claude:")
    ? flags.judge.slice("claude:".length)
    : flags.judge;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      `[judge] ANTHROPIC_API_KEY not set; falling back to decoder (you asked for ${flags.judge})`,
    );
    return decoderJudge;
  }
  console.error(`[judge] claude:${claudePrefix}`);
  return claudeJudge({ modelId: claudePrefix });
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
  anthropic:<model-id>      real Claude via Anthropic API (requires ANTHROPIC_API_KEY)
  cc:<model-id>             real Claude via Claude Code CLI (uses your
                            Claude Max subscription quota; needs the
                            'claude' binary on PATH)
  http://host:port/path     plug your own agent — POST endpoint with the
  https://host/path         contract documented in src/agents/http.ts
  claude-opus-4-7           shorthand for anthropic:claude-opus-4-7

Judge (leak detection):
  default: decoder (zero-cost; base64 / hex / ROT-N / NATO / leet / acrostic /
           reverse / uppercase-concat / word-punct / zero-width). No API key
           needed; runs entirely locally.
  --judge claude:<model>    LLM judge (catches paraphrase / inference; needs
                            ANTHROPIC_API_KEY)
  --judge decoder           explicit zero-cost
  --no-judge                substring fast-path only (weakest)

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
      // mafia-claw is N-agent — pass --agents instead of --attacker/--defender
      agents: { type: "string" },
      werewolves: { type: "string" },
      rounds: { type: "string" },
      turns: { type: "string" },
      seed: { type: "string" },
      quiet: { type: "boolean" },
      judge: { type: "string" },
      "no-judge": { type: "boolean" },
      game: { type: "string" },
    },
  });
  const game = (values.game ?? "secret-claw") as
    | "secret-claw"
    | "debate-claw"
    | "mafia-claw";
  if (
    game !== "secret-claw" &&
    game !== "debate-claw" &&
    game !== "mafia-claw"
  ) {
    console.error(
      `unknown --game ${game} (expected secret-claw | debate-claw | mafia-claw)`,
    );
    process.exit(1);
  }

  if (game === "mafia-claw") {
    if (!values.agents) {
      console.error(
        "mafia-claw needs --agents <spec,spec,…> with 4-7 comma-separated agent specs",
      );
      process.exit(1);
    }
    const agents = values.agents
      .split(",")
      .map((s) => resolveAgent(s.trim()))
      .filter(Boolean);
    if (agents.length < 4 || agents.length > 9) {
      console.error(
        `mafia-claw needs 4-9 agents (got ${agents.length}). 5 is the standard demo size.`,
      );
      process.exit(1);
    }
    const werewolves = values.werewolves ? Number(values.werewolves) : 1;
    const maxRounds = values.rounds ? Number(values.rounds) : 3;
    const result = await runMafiaMatch(agents, {
      game,
      participantCount: agents.length,
      werewolves,
      maxRounds,
      seed: values.seed ? Number(values.seed) : undefined,
    });
    printMatch(result, { full: !values.quiet });
    return;
  }

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
  const defaultTurns = game === "debate-claw" ? 3 : 6;
  const result = await runMatch(attacker, defender, {
    game,
    maxTurns: values.turns ? Number(values.turns) : defaultTurns,
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
      game: { type: "string" },
    },
  });
  if (!values.agents) {
    console.error("--agents is required (comma-separated specs)");
    process.exit(1);
  }
  const game = (values.game ?? "secret-claw") as "secret-claw" | "debate-claw";
  if (game !== "secret-claw" && game !== "debate-claw") {
    console.error(`unknown --game ${game}`);
    process.exit(1);
  }
  const agents = values.agents.split(",").map((s) => resolveAgent(s.trim()));
  const judge = resolveJudge({
    noJudge: values["no-judge"],
    judge: values.judge,
  });
  const defaultTurns = game === "debate-claw" ? 3 : 6;
  console.log(`Running ${game} round-robin (${agents.length} agents, both roles)…`);
  const matches = await runTournament(agents, {
    game,
    maxTurns: values.turns ? Number(values.turns) : defaultTurns,
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

async function maybeSeedFromEnv() {
  // CLAWPIT_SEED_DIR points at a directory containing matches.json and
  // ratings.json. On first boot (empty data/), copy them in so a fresh
  // deploy already has a leaderboard to show. Subsequent boots see
  // populated data/ and leave it alone.
  const seedDir = process.env.CLAWPIT_SEED_DIR;
  if (!seedDir) return;
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const dataDir = path.resolve(__dirname, "..", "..", "data");
  const matchesFile = path.join(dataDir, "matches.json");
  try {
    await fs.access(matchesFile);
    // already seeded — leave alone
    return;
  } catch {
    // not present, continue
  }
  for (const name of ["matches.json", "ratings.json"]) {
    const src = path.join(seedDir, name);
    const dst = path.join(dataDir, name);
    try {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.copyFile(src, dst);
      console.error(`[seed] copied ${name} from ${seedDir}`);
    } catch (err: any) {
      console.error(`[seed] skipped ${name}: ${err?.message ?? err}`);
    }
  }
}

async function cmdServe() {
  const { values } = parseArgs({
    args: rest,
    options: { port: { type: "string" } },
  });
  // Port resolution, in order:
  //   1. --port flag             explicit CLI override
  //   2. $CLAWPIT_PORT           explicit operator override (self-host)
  //   3. $PORT                   PaaS injection (Render / Fly / Railway)
  //   4. 8080 in container, 4242 on bare-metal — chosen by the env shape
  // The Dockerfile deliberately doesn't pre-set CLAWPIT_PORT so $PORT
  // wins on cloud hosts; $NODE_ENV=production is a proxy for "we're in
  // a container" and picks the conventional 8080 default.
  const fallback = process.env.NODE_ENV === "production" ? 8080 : 4242;
  const port = Number(
    values.port ??
      process.env.CLAWPIT_PORT ??
      process.env.PORT ??
      fallback,
  );
  await maybeSeedFromEnv();
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

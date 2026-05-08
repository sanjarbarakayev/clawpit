/**
 * Subprocess-backed agent that drives the Claude Code CLI (`claude -p`)
 * instead of hitting the Anthropic API directly. The point: a Claude Max
 * subscriber pays for inference once via the subscription; running matches
 * through the CLI lets that quota cover tournament traffic instead of
 * stacking pay-as-you-go API charges on top.
 *
 * The overhead trade is real and documented elsewhere (docs/DECISIONS-OPEN.md
 * D6): each call spawns a CLI process, so per-turn latency is +1.5–2s vs.
 * the direct API. For batch tournaments that's tolerable; for live demos
 * the API agent is still the right pick.
 *
 * Critical flag set, derived empirically from probing `claude -p`:
 *
 *   --tools ""                     drops tool definitions from context
 *   --system-prompt "<...>"        replaces Claude Code's default system prompt
 *                                  (so we keep our SecretClaw role prompts pristine)
 *   --strict-mcp-config            ignore user/project MCP configs
 *   --mcp-config '{"mcpServers":{}}'   AND no servers from CLI either
 *   --setting-sources ""           skip user/project/local settings.json
 *   --disable-slash-commands       no skill auto-injection
 *   --no-session-persistence       don't write session files to disk
 *
 * Without this combo the Claude Code wrapper injects ~47k tokens of context
 * (tool defs, CLAUDE.md memory, MCP descriptors) into every call. With it,
 * a 174-token Haiku response costs $0.001 — close to a direct API call.
 *
 * History serialization: `claude -p` is single-shot, so multi-turn ChatTurn[]
 * histories are flattened into a transcript and passed as the prompt. Quality
 * loss vs. native messages array is small in practice (the model still tracks
 * turn-taking) and worth the simpler integration.
 */
import { spawn } from "node:child_process";
import type {
  Agent,
  AgentCallOpts,
  AgentCallResult,
  ChatTurn,
} from "../types.ts";

const DEFAULT_TIMEOUT_MS = 120_000;

interface ClaudeCliJsonResult {
  type: "result";
  subtype: string;
  is_error: boolean;
  result: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
  modelUsage?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
    }
  >;
}

function serializeHistory(systemPrompt: string, history: ChatTurn[]): string {
  // Flatten ChatTurn[] (user/assistant alternation) into a single text prompt.
  // We label as OPPONENT / YOU to keep role attribution clear; the actual
  // role identity is set in the system prompt. The final cue tells Claude to
  // respond as itself, in character, without preamble.
  if (history.length === 0) {
    return "Begin. Send your first message in character. Output only the message itself.";
  }
  const lines: string[] = ["PRIOR EXCHANGE:"];
  for (const turn of history) {
    const speaker = turn.role === "user" ? "OPPONENT" : "YOU";
    lines.push(`${speaker}: ${turn.content}`);
  }
  lines.push("");
  lines.push(
    "Continue the exchange as YOU. Stay in character per the system prompt above. Output only your next message, no commentary, no labels.",
  );
  return lines.join("\n");
}

function parseCliJson(stdout: string): ClaudeCliJsonResult {
  // The CLI may emit log lines before the JSON when output-format=json.
  // Find the first '{' and parse from there.
  const jsonStart = stdout.indexOf("{");
  if (jsonStart < 0) {
    throw new Error(`claude CLI returned no JSON. stdout=${stdout.slice(0, 200)}`);
  }
  const text = stdout.slice(jsonStart);
  try {
    return JSON.parse(text) as ClaudeCliJsonResult;
  } catch (err: any) {
    throw new Error(
      `claude CLI JSON parse failed: ${err?.message ?? "parse error"}\nstdout=${text.slice(0, 200)}`,
    );
  }
}

async function runClaudeCli(
  modelId: string,
  systemPrompt: string,
  prompt: string,
  timeoutMs: number,
): Promise<ClaudeCliJsonResult> {
  const args = [
    "-p",
    prompt,
    "--model",
    modelId,
    "--output-format",
    "json",
    "--tools",
    "",
    "--system-prompt",
    systemPrompt,
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--no-session-persistence",
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`claude CLI spawn failed: ${err.message}`));
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        return reject(
          new Error(
            `claude CLI exited ${code}. stderr=${stderr.slice(0, 300)}\nstdout=${stdout.slice(0, 300)}`,
          ),
        );
      }
      try {
        resolve(parseCliJson(stdout));
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Build a Claude-Code-CLI-backed agent. The id is `cc:<model-id>` and the
 * label defaults to the model id (so leaderboards show the same model name
 * whether the agent ran via API or CLI — useful when comparing both billing
 * paths).
 *
 * Usage cost: the CLI reports the API-equivalent cost for transparency. A
 * Max subscriber pays $0 marginal; the field exists so the cost-adjusted
 * leaderboard still ranks fairly when CLI-backed and API-backed agents are
 * mixed in the same tournament.
 */
export function claudeCodeAgent(
  modelId: string,
  label?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Agent {
  return {
    id: `cc:${modelId}`,
    label: label ?? modelId,
    async call({
      systemPrompt,
      history,
    }: AgentCallOpts): Promise<AgentCallResult> {
      const prompt = serializeHistory(systemPrompt, history);
      const result = await runClaudeCli(
        modelId,
        systemPrompt,
        prompt,
        timeoutMs,
      );
      if (result.is_error) {
        throw new Error(
          `claude CLI returned is_error=true: ${result.result?.slice(0, 200) ?? "no message"}`,
        );
      }
      const text = (result.result ?? "").trim() || "(no response)";
      // Prefer modelUsage when available (more granular; some flags surface
      // it instead of usage); fall back to top-level usage.
      const modelUsage = result.modelUsage?.[modelId];
      const inputTokens =
        modelUsage?.inputTokens ?? result.usage?.input_tokens ?? 0;
      const outputTokens =
        modelUsage?.outputTokens ?? result.usage?.output_tokens ?? 0;
      return {
        text,
        usage: { model: modelId, inputTokens, outputTokens },
      };
    },
  };
}

/**
 * HTTP-backed agent. Lets anyone plug an external agent into clawpit by
 * exposing a single POST endpoint — no fork, no TypeScript, no clawpit
 * dependency on the agent side.
 *
 * Spec form (passed to the CLI):
 *   http://host:port/path     plain HTTP
 *   https://host/path          TLS
 *
 * Request contract (what clawpit sends to the agent):
 *   POST <url>
 *   Content-Type: application/json
 *   { "systemPrompt": string,
 *     "history": [{ "role": "user"|"assistant", "content": string }, ...],
 *     "maxTokens": number? }
 *
 * Response contract (what the agent must return):
 *   200 OK
 *   Content-Type: application/json
 *   { "text": string,                     required — the agent's next message
 *     "inputTokens": number?,             optional — for cost tracking
 *     "outputTokens": number?,            optional — for cost tracking
 *     "model": string? }                  optional — pricing key in src/cost.ts
 *
 * Non-2xx responses, malformed JSON, missing "text", or a timeout all
 * surface as a match-level agent error (the opponent wins by walkover).
 *
 * Security note: the production clawpit server (clawpit.onrender.com)
 * deliberately does NOT call arbitrary external URLs — that would be a
 * straight SSRF/DoS vector. http agents work for LOCAL runs only. Public
 * leaderboard submission of external agents is the Phase D / v0.3 work,
 * which needs sandboxing.
 */
import type {
  Agent,
  AgentCallOpts,
  AgentCallResult,
  TokenUsage,
} from "../types.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

interface HttpAgentResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

export interface HttpAgentOptions {
  label?: string;
  timeoutMs?: number;
}

export function httpAgent(url: string, opts: HttpAgentOptions = {}): Agent {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`http agent: invalid URL "${url}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `http agent: URL must use http: or https:, got ${parsed.protocol}`,
    );
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Default label: hostname plus pathname (when non-trivial). e.g.
  //   http://localhost:8000/respond  → "localhost:8000/respond"
  //   https://my-bot.fly.dev/         → "my-bot.fly.dev"
  const defaultLabel =
    parsed.host + (parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "");

  return {
    id: url,
    label: opts.label ?? defaultLabel,
    async call({
      systemPrompt,
      history,
      maxTokens,
    }: AgentCallOpts): Promise<AgentCallResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ systemPrompt, history, maxTokens }),
          signal: controller.signal,
        });
      } catch (err: any) {
        clearTimeout(timer);
        if (err?.name === "AbortError") {
          throw new Error(
            `http agent ${url} timed out after ${timeoutMs}ms`,
          );
        }
        throw new Error(
          `http agent ${url} fetch failed: ${err?.message ?? String(err)}`,
        );
      }
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `http agent ${url} returned HTTP ${res.status}: ${body.slice(0, 300)}`,
        );
      }

      let data: HttpAgentResponse;
      try {
        data = (await res.json()) as HttpAgentResponse;
      } catch (err: any) {
        throw new Error(
          `http agent ${url} returned non-JSON body: ${err?.message ?? "parse failed"}`,
        );
      }

      if (typeof data.text !== "string" || data.text.length === 0) {
        throw new Error(
          `http agent ${url} response missing required "text" field. Got: ${JSON.stringify(data).slice(0, 200)}`,
        );
      }

      let usage: TokenUsage | undefined;
      if (data.inputTokens != null || data.outputTokens != null) {
        usage = {
          model: data.model ?? "",
          inputTokens: Number(data.inputTokens ?? 0),
          outputTokens: Number(data.outputTokens ?? 0),
        };
      }

      return { text: data.text, usage };
    },
  };
}

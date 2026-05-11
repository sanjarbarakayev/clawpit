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
import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import net from "node:net";
import type {
  Agent,
  AgentCallOpts,
  AgentCallResult,
  TokenUsage,
} from "../types.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * SSRF guard. In production (NODE_ENV=production) the clawpit server may not
 * reach localhost, RFC1918 private ranges, link-local, or cloud-metadata IPs.
 * In dev / non-production we allow localhost so the BYOA examples work.
 *
 * Resolves the URL hostname via DNS so an attacker can't bypass with a public
 * domain whose A record points at 10.0.0.x or 169.254.169.254.
 */
const PRIVATE_V4_CIDRS: ReadonlyArray<[bigint, bigint]> = [
  ipv4Range("10.0.0.0", 8),
  ipv4Range("172.16.0.0", 12),
  ipv4Range("192.168.0.0", 16),
  ipv4Range("127.0.0.0", 8), // loopback
  ipv4Range("169.254.0.0", 16), // link-local + AWS metadata
  ipv4Range("100.64.0.0", 10), // CGNAT
  ipv4Range("0.0.0.0", 8), // unspec
  ipv4Range("224.0.0.0", 4), // multicast
];

function ipv4ToInt(addr: string): bigint {
  const parts = addr.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`invalid ipv4 ${addr}`);
  }
  return (
    (BigInt(parts[0]!) << 24n) +
    (BigInt(parts[1]!) << 16n) +
    (BigInt(parts[2]!) << 8n) +
    BigInt(parts[3]!)
  );
}

function ipv4Range(addr: string, mask: number): [bigint, bigint] {
  const base = ipv4ToInt(addr);
  const size = 1n << BigInt(32 - mask);
  return [base, base + size - 1n];
}

function isPrivateV4(addr: string): boolean {
  let n: bigint;
  try {
    n = ipv4ToInt(addr);
  } catch {
    return true; // unparseable → treat as unsafe
  }
  return PRIVATE_V4_CIDRS.some(([lo, hi]) => n >= lo && n <= hi);
}

function isPrivateV6(addr: string): boolean {
  // Block loopback, link-local, ULA, IPv4-mapped/compatible, and any private
  // range we'd want blocked in v4. This is approximate but defensive.
  const lower = addr.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
  // IPv4-mapped (::ffff:a.b.c.d) — extract and check v4
  const v4Match = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) return isPrivateV4(v4Match[1]!);
  return false;
}

export async function ssrfGuard(url: URL): Promise<void> {
  const allowPrivate = process.env.NODE_ENV !== "production";
  const host = url.hostname;
  // Literal IP: check directly.
  const ipKind = net.isIP(host);
  if (ipKind === 4) {
    if (!allowPrivate && isPrivateV4(host)) {
      throw new Error(
        `http agent: target IP ${host} is private/loopback (SSRF guard; allowed in dev only)`,
      );
    }
    return;
  }
  if (ipKind === 6) {
    if (!allowPrivate && isPrivateV6(host)) {
      throw new Error(
        `http agent: target IPv6 ${host} is private/loopback (SSRF guard; allowed in dev only)`,
      );
    }
    return;
  }
  // Hostname: resolve and check every record. A DNS rebinding attacker can
  // flip records between this check and the fetch — production hardening
  // would pin the resolved IP. For v0.3 MVP, the resolve-before-fetch is the
  // minimum defense.
  if (host === "localhost") {
    if (!allowPrivate) {
      throw new Error(
        "http agent: hostname 'localhost' blocked in production (SSRF guard)",
      );
    }
    return;
  }
  let addrs: LookupAddress[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch (err: any) {
    throw new Error(
      `http agent: DNS lookup failed for ${host}: ${err?.message ?? "unknown"}`,
    );
  }
  if (addrs.length === 0) {
    throw new Error(`http agent: ${host} resolved to no addresses`);
  }
  for (const a of addrs) {
    const blocked = a.family === 4 ? isPrivateV4(a.address) : isPrivateV6(a.address);
    if (blocked && !allowPrivate) {
      throw new Error(
        `http agent: ${host} resolves to ${a.address} which is private/loopback (SSRF guard)`,
      );
    }
  }
}

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
      // SSRF guard: in production, block private / loopback / link-local
      // targets. Dev runs (NODE_ENV !== "production") allow localhost so the
      // examples/ scripts work locally.
      await ssrfGuard(parsed);

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

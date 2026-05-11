import http from "node:http";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMatches, loadRatings } from "./storage.ts";
import type { MatchResult, TranscriptEntry } from "./types.ts";
import { runMatch } from "./arena.ts";
import { resolveAgent } from "./agents/registry.ts";
import { decoderJudge } from "./games/decoder-judge.ts";
import { claudeJudge, noopJudge } from "./games/judge.ts";
import { listLive, publish, subscribe, type LiveEvent } from "./live.ts";
import { leaderboardCard, matchCard } from "./og.ts";
import {
  findAgentByApiKey,
  loadAgents,
  publicView,
  registerAgent,
  validateRegisterInput,
} from "./agents-storage.ts";
import { ssrfGuard } from "./agents/http.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..", "web");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const REDACTED = "[REDACTED]";

/** Constant-time-ish equality so admin-token checks don't leak via timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function adminAuthorized(req: http.IncomingMessage): boolean {
  const expected = process.env.CLAWPIT_ADMIN_TOKEN;
  if (!expected) return false;
  const got = req.headers["x-clawpit-admin-token"];
  if (typeof got !== "string" || got.length === 0) return false;
  return safeEqual(got, expected);
}

/**
 * Replace literal occurrences of `secret` (case-insensitive) inside transcript
 * lines with a fixed mask. Defensive: a defender that emits the secret in
 * plaintext should not be discoverable via `/api/matches/:id` unless the
 * admin token is supplied. Encoded leaks are NOT scrubbed here — that's
 * what `judgeVerdict.leaked` is for; a public viewer learns "leak: yes/no",
 * not the value.
 */
function redactTranscript(
  transcript: TranscriptEntry[],
  secret: string,
): TranscriptEntry[] {
  if (!secret) return transcript;
  const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "gi");
  return transcript.map((t) => ({
    ...t,
    content: t.content.replace(re, "▒".repeat(Math.max(8, secret.length))),
  }));
}

function publicMatchDetail(m: MatchResult): MatchResult & { redacted: true } {
  // Redacted view: secret hidden, transcript scrubbed for plaintext leaks.
  // judgeVerdict.evidence may also quote the secret — sanitize.
  const safeTranscript = redactTranscript(m.transcript, m.secret);
  const safeJudge = m.judgeVerdict
    ? {
        ...m.judgeVerdict,
        evidence: m.secret
          ? m.judgeVerdict.evidence.replace(
              new RegExp(
                m.secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                "gi",
              ),
              "▒▒▒▒▒▒▒▒",
            )
          : m.judgeVerdict.evidence,
      }
    : undefined;
  return {
    ...m,
    secret: REDACTED,
    transcript: safeTranscript,
    judgeVerdict: safeJudge,
    redacted: true,
  };
}

/**
 * Process-local sliding-window rate limiter. Keys are "scope:bucket" — IP for
 * registration, agentId for challenges. Survives a single dyno only; on
 * Render free tier that's enough to deter casual abuse. Real production
 * would push this into Redis / Turso.
 */
const RATE_BUCKETS = new Map<string, number[]>();
function rateLimitOk(
  req: http.IncomingMessage,
  scope: string,
  maxHits: number,
  windowMs: number,
): boolean {
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const arr = RATE_BUCKETS.get(key) ?? [];
  const fresh = arr.filter((ts) => ts > now - windowMs);
  if (fresh.length >= maxHits) {
    RATE_BUCKETS.set(key, fresh);
    return false;
  }
  fresh.push(now);
  RATE_BUCKETS.set(key, fresh);
  return true;
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

const MAX_BODY_BYTES = 16 * 1024;
async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err: any) {
        reject(new Error(`invalid JSON: ${err?.message ?? "parse error"}`));
      }
    });
    req.on("error", reject);
  });
}

function isBillableSpec(spec: string): boolean {
  // Anything that hits a paid LLM endpoint or chews user quota. Mock specs
  // are free. cc:* runs through Claude Code CLI on the host's machine and
  // burns the host's Max subscription quota — admin-gate it so a public
  // dashboard can't drain the operator's account.
  return (
    spec.startsWith("anthropic:") ||
    spec.startsWith("claude-") ||
    spec.startsWith("cc:")
  );
}

interface StartMatchBody {
  attacker: string;
  defender: string;
  turns?: number;
  judge?: "decoder" | "noop" | string;
  seed?: number;
}

function isStartMatchBody(b: unknown): b is StartMatchBody {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return typeof o.attacker === "string" && typeof o.defender === "string";
}

function resolveServerJudge(spec: string | undefined) {
  if (spec === "noop") return noopJudge;
  if (!spec || spec === "decoder") return decoderJudge;
  if (spec.startsWith("claude:") && process.env.ANTHROPIC_API_KEY) {
    return claudeJudge({ modelId: spec.slice("claude:".length) });
  }
  // unknown / no-key fallback
  return decoderJudge;
}

function sseHeaders(): http.OutgoingHttpHeaders {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    // SSE responses must NOT be transformed; some proxies break it without this
    "x-accel-buffering": "no",
  };
}

function writeSse(res: http.ServerResponse, event: LiveEvent) {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
) {
  let pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  pathname = path.posix.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(WEB_DIR, pathname);
  if (!file.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const data = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

export async function startServer(port: number): Promise<http.Server> {
  const adminEnabled = !!process.env.CLAWPIT_ADMIN_TOKEN;
  if (!adminEnabled) {
    console.error(
      "[server] CLAWPIT_ADMIN_TOKEN not set — secret reveal disabled (public mode)",
    );
  } else {
    console.error("[server] admin reveal enabled (CLAWPIT_ADMIN_TOKEN set)");
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      if (url.pathname === "/api/health") {
        return json(res, 200, { ok: true, adminEnabled });
      }

      if (url.pathname === "/api/live") {
        return json(res, 200, listLive());
      }

      // POST /api/agents/register — anyone can register an agent.
      // Body: { name, description, endpointUrl, ownerHandle? }
      // Returns: { agent: <public view>, apiKey }
      // Rate limiting is process-local (RATE_LIMIT below). The endpoint is
      // intentionally open — agent identity is "the URL responds correctly";
      // X/Twitter handle is the moltbook-style human-verification layer.
      if (req.method === "POST" && url.pathname === "/api/agents/register") {
        if (!rateLimitOk(req, "register", 5, 60_000)) {
          return json(res, 429, {
            error: "rate limited: max 5 registrations per minute per IP",
          });
        }
        let body: any;
        try {
          body = await readJsonBody(req);
        } catch (err: any) {
          return json(res, 400, { error: err?.message ?? "bad body" });
        }
        if (!body || typeof body !== "object") {
          return json(res, 400, {
            error:
              "expected { name, description, endpointUrl, ownerHandle? }",
          });
        }
        const errors = validateRegisterInput(body);
        if (errors.length) {
          return json(res, 400, { errors });
        }
        // Run SSRF check at registration time so users learn now (clear error
        // message) instead of "agent error walkover" at match time. In dev
        // (NODE_ENV !== "production") localhost is allowed.
        try {
          await ssrfGuard(new URL(body.endpointUrl));
        } catch (err: any) {
          return json(res, 400, { error: err?.message ?? "endpoint rejected" });
        }
        try {
          const agent = await registerAgent({
            name: body.name.trim(),
            description: body.description.trim(),
            endpointUrl: body.endpointUrl.trim(),
            ownerHandle: body.ownerHandle?.trim() || undefined,
          });
          return json(res, 201, {
            agent: publicView(agent),
            apiKey: agent.apiKey,
            note:
              "Save this apiKey now — it is shown ONCE and used to challenge matches via POST /api/matches/challenge.",
          });
        } catch (err: any) {
          return json(res, 409, { error: err?.message ?? "registration failed" });
        }
      }

      // GET /api/agents — public registry. API keys are NEVER returned.
      if (url.pathname === "/api/agents") {
        const agents = await loadAgents();
        return json(res, 200, agents.map(publicView));
      }

      // POST /api/matches/challenge — registered agent triggers a match.
      // Body: { opponentSpec, role: "attacker"|"defender", turns?, judge? }
      // Headers: x-clawpit-api-key: <your apiKey>
      // Free opponents: mock:atk:*, mock:def:*, and other registered agents.
      // Anything billable (cc:* / claude-* / anthropic:*) still requires admin.
      if (req.method === "POST" && url.pathname === "/api/matches/challenge") {
        const apiKey = req.headers["x-clawpit-api-key"];
        if (typeof apiKey !== "string" || apiKey.length === 0) {
          return json(res, 401, {
            error: "missing x-clawpit-api-key header",
          });
        }
        const me = await findAgentByApiKey(apiKey);
        if (!me) {
          return json(res, 401, { error: "invalid api key" });
        }
        if (!rateLimitOk(req, `chal:${me.id}`, 10, 60_000)) {
          return json(res, 429, {
            error: "rate limited: max 10 challenges per minute per agent",
          });
        }
        let body: any;
        try {
          body = await readJsonBody(req);
        } catch (err: any) {
          return json(res, 400, { error: err?.message ?? "bad body" });
        }
        if (
          !body ||
          typeof body !== "object" ||
          typeof body.opponentSpec !== "string" ||
          (body.role !== "attacker" && body.role !== "defender")
        ) {
          return json(res, 400, {
            error:
              "expected { opponentSpec, role: 'attacker'|'defender', turns?, judge? }",
          });
        }
        const opponentSpec = body.opponentSpec as string;
        if (isBillableSpec(opponentSpec) && !adminAuthorized(req)) {
          return json(res, 402, {
            error:
              "billable opponents (cc:*/anthropic:*/claude-*) need admin gating in v0.3. Use mock:* or another registered agent.",
          });
        }

        const attackerSpec = body.role === "attacker" ? me.id : opponentSpec;
        const defenderSpec = body.role === "defender" ? me.id : opponentSpec;

        let attacker, defender;
        try {
          attacker = resolveAgent(attackerSpec);
          defender = resolveAgent(defenderSpec);
        } catch (err: any) {
          return json(res, 400, { error: err?.message ?? "unknown spec" });
        }

        const matchId = randomUUID();
        const turns = Math.min(Math.max(1, body.turns ?? 6), 12);
        const judge = resolveServerJudge(body.judge);

        publish({
          type: "started",
          matchId,
          topic: "(pending)",
          attacker: attacker.label,
          defender: defender.label,
          maxTurns: turns,
        });

        runMatch(attacker, defender, {
          maxTurns: turns,
          seed: body.seed,
          judge,
          matchId,
          onTurn: (entry: TranscriptEntry) => {
            publish({ type: "turn", matchId, entry });
          },
        })
          .then((result) => publish({ type: "finished", matchId, result }))
          .catch((err: any) =>
            publish({
              type: "error",
              matchId,
              message: err?.message ?? String(err),
            }),
          );

        return json(res, 202, {
          matchId,
          attacker: attacker.label,
          defender: defender.label,
          watchUrl: `/api/matches/${matchId}/stream`,
        });
      }

      // Server-rendered SVG cards for social-link unfurls.
      if (url.pathname === "/api/og/leaderboard.svg") {
        const ratings = await loadRatings();
        const svg = leaderboardCard(Object.values(ratings));
        res.writeHead(200, {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": "public, max-age=60",
        });
        return res.end(svg);
      }

      const ogMatch = url.pathname.match(/^\/api\/og\/match\/([\w-]+)\.svg$/);
      if (ogMatch) {
        const matches = await loadMatches();
        const m = matches.find((x) => x.id === ogMatch[1]);
        if (!m) return json(res, 404, { error: "not found" });
        const svg = matchCard(m);
        res.writeHead(200, {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": "public, max-age=300",
        });
        return res.end(svg);
      }

      // POST /api/matches — start a match in the background. Returns the
      // match id immediately; turns flow to subscribers via /api/matches/:id/stream.
      // Mock vs mock is unauthenticated (zero spend). Anything billable
      // (anthropic:* / claude-*) requires the admin token.
      if (req.method === "POST" && url.pathname === "/api/matches") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (err: any) {
          return json(res, 400, { error: err?.message ?? "bad body" });
        }
        if (!isStartMatchBody(body)) {
          return json(res, 400, {
            error: "expected { attacker, defender, turns?, judge?, seed? }",
          });
        }
        const billable =
          isBillableSpec(body.attacker) || isBillableSpec(body.defender);
        if (billable && !adminAuthorized(req)) {
          return json(res, 401, {
            error:
              "billable specs (anthropic:*/claude-*) require x-clawpit-admin-token",
          });
        }

        let attacker, defender;
        try {
          attacker = resolveAgent(body.attacker);
          defender = resolveAgent(body.defender);
        } catch (err: any) {
          return json(res, 400, { error: err?.message ?? "unknown spec" });
        }

        const matchId = randomUUID();
        const turns = Math.min(Math.max(1, body.turns ?? 6), 12);
        const judge = resolveServerJudge(body.judge);

        publish({
          type: "started",
          matchId,
          topic: "(pending)",
          attacker: attacker.label,
          defender: defender.label,
          maxTurns: turns,
        });

        // Fire and forget — the response below returns the matchId immediately
        // so the caller can subscribe to the stream while the match runs.
        runMatch(attacker, defender, {
          maxTurns: turns,
          seed: body.seed,
          judge,
          matchId,
          onTurn: (entry: TranscriptEntry) => {
            publish({ type: "turn", matchId, entry });
          },
        })
          .then((result) => {
            publish({ type: "finished", matchId, result });
          })
          .catch((err: any) => {
            publish({
              type: "error",
              matchId,
              message: err?.message ?? String(err),
            });
          });

        return json(res, 202, { matchId, attacker: attacker.label, defender: defender.label });
      }

      // GET /api/matches/:id/stream — Server-Sent Events for a live match.
      const streamMatch = url.pathname.match(/^\/api\/matches\/([\w-]+)\/stream$/);
      if (streamMatch) {
        const matchId = streamMatch[1]!;
        res.writeHead(200, sseHeaders());
        // initial keepalive comment so clients open the connection promptly
        res.write(": connected\n\n");
        const sub = subscribe(matchId, (event) => writeSse(res, event));
        for (const past of sub.replay) writeSse(res, past);
        // keepalive every 25s so proxies don't time out idle SSE
        const keepalive = setInterval(() => {
          if (!res.writableEnded) res.write(": keepalive\n\n");
        }, 25_000);
        const cleanup = () => {
          clearInterval(keepalive);
          sub.unsubscribe();
        };
        req.on("close", cleanup);
        res.on("close", cleanup);
        return;
      }

      if (url.pathname === "/api/leaderboard") {
        const ratings = await loadRatings();
        // Cost-adjusted ELO: rating - λ × totalCostUsd. With λ=100, every $0.01
        // spent = -1 ELO. Encodes "strength per dollar" — a Haiku that holds
        // the line ranks alongside an Opus that spends 5x to do the same.
        // Tunable so callers can run sensitivity sweeps.
        const lambdaParam = Number(url.searchParams.get("lambda"));
        const lambda =
          Number.isFinite(lambdaParam) && lambdaParam >= 0 ? lambdaParam : 100;
        const augmented = Object.values(ratings).map((r) => ({
          ...r,
          costAdjustedRating: Math.round(
            r.rating - lambda * (r.totalCostUsd ?? 0),
          ),
          lambdaUsed: lambda,
        }));
        const sortKey = url.searchParams.get("adjusted") === "1"
          ? "costAdjustedRating"
          : "rating";
        const sorted = augmented.sort(
          (a, b) =>
            (b[sortKey as "rating" | "costAdjustedRating"] ?? 0) -
            (a[sortKey as "rating" | "costAdjustedRating"] ?? 0),
        );
        return json(res, 200, sorted);
      }

      if (url.pathname === "/api/matches") {
        const matches = await loadMatches();
        const limit = Number(url.searchParams.get("limit") ?? 50);
        return json(
          res,
          200,
          matches.slice(0, limit).map((m) => ({
            id: m.id,
            attacker: m.attacker.label,
            defender: m.defender.label,
            winner: m.winner,
            reason: m.reason,
            leakDetector: m.leakDetector ?? "none",
            leaked: m.judgeVerdict?.leaked ?? m.reason === "secret_leaked",
            turns: m.turns,
            maxTurns: m.maxTurns,
            topic: m.topic,
            startedAt: m.startedAt,
            durationMs: m.durationMs,
            costUsd: m.usage?.totalCostUsd ?? 0,
          })),
        );
      }

      const matchDetail = url.pathname.match(/^\/api\/matches\/([\w-]+)$/);
      if (matchDetail) {
        const matches = await loadMatches();
        const m = matches.find((x) => x.id === matchDetail[1]);
        if (!m) return json(res, 404, { error: "not found" });
        const wantsReveal = url.searchParams.get("reveal") === "1";
        if (wantsReveal && adminAuthorized(req)) {
          return json(res, 200, m);
        }
        if (wantsReveal && !adminEnabled) {
          // Don't lie: tell the caller the feature is off, not that the secret is wrong.
          return json(res, 403, {
            error:
              "reveal disabled — server has no CLAWPIT_ADMIN_TOKEN configured",
          });
        }
        if (wantsReveal) {
          return json(res, 401, { error: "invalid admin token" });
        }
        return json(res, 200, publicMatchDetail(m));
      }

      await serveStatic(req, res, url);
    } catch (err: any) {
      json(res, 500, { error: err?.message ?? String(err) });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`clawpit serving on http://localhost:${port}`);
  return server;
}

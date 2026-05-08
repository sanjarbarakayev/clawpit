import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMatches, loadRatings } from "./storage.ts";
import type { MatchResult, TranscriptEntry } from "./types.ts";

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

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
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

      if (url.pathname === "/api/leaderboard") {
        const ratings = await loadRatings();
        const sorted = Object.values(ratings).sort(
          (a, b) => b.rating - a.rating,
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

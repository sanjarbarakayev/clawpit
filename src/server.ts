import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMatches, loadRatings } from "./storage.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..", "web");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

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
  // prevent traversal
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
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

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
          })),
        );
      }

      const matchDetail = url.pathname.match(/^\/api\/matches\/([\w-]+)$/);
      if (matchDetail) {
        const matches = await loadMatches();
        const m = matches.find((x) => x.id === matchDetail[1]);
        if (!m) return json(res, 404, { error: "not found" });
        return json(res, 200, m);
      }

      if (url.pathname === "/api/health") {
        return json(res, 200, { ok: true });
      }

      // fall through to static
      await serveStatic(req, res, url);
    } catch (err: any) {
      json(res, 500, { error: err?.message ?? String(err) });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`clawpit serving on http://localhost:${port}`);
  return server;
}

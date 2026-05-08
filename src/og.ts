/**
 * Server-rendered SVG cards for social-link unfurls (Twitter, OG, Telegram).
 *
 * SVG is generated as a string template — no headless browser, no external
 * deps. Twitter and Telegram both unfurl SVG via <meta property="og:image">,
 * but render quality varies; for absolute reliability we'd want PNG. PNG
 * conversion needs a binary (resvg, sharp, etc.); intentionally deferred —
 * if a target social platform refuses SVG, we add the binary then.
 *
 * Two cards:
 *   /api/og/leaderboard.svg      top-5 ELO snapshot
 *   /api/og/match/:id.svg        single match summary (winner, judge, cost)
 *
 * Both are 1200x630 (Twitter card spec) and use the dashboard color tokens
 * so they look like a screenshot of the live UI.
 */

import type { MatchResult, Rating } from "./types.ts";
import { formatUsd } from "./cost.ts";

const W = 1200;
const H = 630;

// Color palette — must mirror web/style.css :root tokens so cards look like
// screenshots of the dashboard, not generic chrome.
const COLOR = {
  bg: "#0b0d12",
  bgElev: "#141821",
  border: "#232936",
  fg: "#e6e9ef",
  fgDim: "#8b93a3",
  fgMuted: "#5b6478",
  atk: "#ff5d6c",
  def: "#4ade80",
  accent: "#7aa2ff",
  warn: "#facc15",
};

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function header(title: string, subtitle: string): string {
  return `
    <text x="60" y="80" fill="${COLOR.atk}" font-family="ui-monospace, monospace" font-size="32" font-weight="700">◣◢</text>
    <text x="110" y="80" fill="${COLOR.fg}" font-family="system-ui, sans-serif" font-size="40" font-weight="700">clawpit</text>
    <text x="265" y="80" fill="${COLOR.fgMuted}" font-family="ui-monospace, monospace" font-size="18">${escapeXml(title)}</text>
    <text x="60" y="120" fill="${COLOR.fgDim}" font-family="system-ui, sans-serif" font-size="22">${escapeXml(subtitle)}</text>
  `;
}

function frame(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${COLOR.bg}"/>
    ${inner}
    <rect x="0" y="${H - 1}" width="${W}" height="1" fill="${COLOR.border}"/>
  </svg>`;
}

export function leaderboardCard(ratings: Rating[]): string {
  const top = [...ratings].sort((a, b) => b.rating - a.rating).slice(0, 5);
  const subtitle =
    ratings.length === 0
      ? "no matches recorded yet"
      : `Top ${top.length} of ${ratings.length} agents · adversarial AI agent arena`;

  let rowsY = 200;
  const rows = top
    .map((r, i) => {
      const winRate = r.matches ? Math.round((r.wins / r.matches) * 100) : 0;
      const y = rowsY + i * 70;
      const rankColor = i === 0 ? COLOR.warn : COLOR.fgDim;
      return `
        <text x="60" y="${y}" fill="${rankColor}" font-family="ui-monospace, monospace" font-size="34" font-weight="700">#${i + 1}</text>
        <text x="140" y="${y}" fill="${COLOR.fg}" font-family="system-ui, sans-serif" font-size="30">${escapeXml(r.label)}</text>
        <text x="800" y="${y}" fill="${COLOR.accent}" font-family="ui-monospace, monospace" font-size="32" font-weight="700" text-anchor="end">${r.rating}</text>
        <text x="900" y="${y}" fill="${COLOR.fgMuted}" font-family="ui-monospace, monospace" font-size="18" text-anchor="start">elo</text>
        <text x="1140" y="${y}" fill="${COLOR.def}" font-family="ui-monospace, monospace" font-size="24" text-anchor="end">${r.wins}-${r.losses} (${winRate}%)</text>
      `;
    })
    .join("");

  const inner = `
    ${header("LEADERBOARD", subtitle)}
    <line x1="60" y1="160" x2="${W - 60}" y2="160" stroke="${COLOR.border}" stroke-width="1"/>
    ${rows}
    <text x="60" y="${H - 40}" fill="${COLOR.fgMuted}" font-family="ui-monospace, monospace" font-size="16">SecretClaw · prompt-injection arena · clawpit.dev</text>
  `;
  return frame(inner);
}

export function matchCard(m: MatchResult): string {
  const winnerColor = m.winner === "attacker" ? COLOR.atk : COLOR.def;
  const winnerLabel = m.winner === "attacker" ? "ATTACKER" : "DEFENDER";
  const judgeLabel = m.judgeVerdict
    ? m.judgeVerdict.leaked
      ? "leaked"
      : "clean"
    : "—";
  const judgeColor =
    m.judgeVerdict && m.judgeVerdict.leaked ? COLOR.atk : COLOR.def;
  const cost = formatUsd(m.usage?.totalCostUsd ?? 0);

  const inner = `
    ${header(`MATCH ${m.id.slice(0, 8).toUpperCase()}`, `${escapeXml(m.topic)} · ${m.turns}/${m.maxTurns} turns · ${(m.durationMs / 1000).toFixed(1)}s`)}
    <line x1="60" y1="160" x2="${W - 60}" y2="160" stroke="${COLOR.border}" stroke-width="1"/>

    <text x="60" y="240" fill="${COLOR.atk}" font-family="ui-monospace, monospace" font-size="20" letter-spacing="2">ATTACKER</text>
    <text x="60" y="280" fill="${COLOR.fg}" font-family="system-ui, sans-serif" font-size="38" font-weight="700">${escapeXml(m.attacker.label)}</text>

    <text x="${W / 2}" y="300" fill="${COLOR.fgMuted}" font-family="ui-monospace, monospace" font-size="40" text-anchor="middle">vs</text>

    <text x="${W - 60}" y="240" fill="${COLOR.def}" font-family="ui-monospace, monospace" font-size="20" letter-spacing="2" text-anchor="end">DEFENDER</text>
    <text x="${W - 60}" y="280" fill="${COLOR.fg}" font-family="system-ui, sans-serif" font-size="38" font-weight="700" text-anchor="end">${escapeXml(m.defender.label)}</text>

    <rect x="60" y="360" width="${W - 120}" height="120" fill="${COLOR.bgElev}" stroke="${COLOR.border}" stroke-width="1" rx="8"/>
    <text x="${W / 2}" y="412" fill="${winnerColor}" font-family="system-ui, sans-serif" font-size="46" font-weight="700" text-anchor="middle">${winnerLabel} WIN</text>
    <text x="${W / 2}" y="452" fill="${COLOR.fgDim}" font-family="ui-monospace, monospace" font-size="22" text-anchor="middle">${escapeXml(m.reason)} · judge: ${judgeLabel}</text>

    <text x="60" y="${H - 100}" fill="${COLOR.fgMuted}" font-family="ui-monospace, monospace" font-size="18">judge ${escapeXml(m.judgeVerdict?.model || "—")} (${escapeXml(m.judgeVerdict?.stage || "—")})</text>
    <text x="${W - 60}" y="${H - 100}" fill="${COLOR.accent}" font-family="ui-monospace, monospace" font-size="22" text-anchor="end">${cost}</text>

    <text x="60" y="${H - 40}" fill="${COLOR.fgMuted}" font-family="ui-monospace, monospace" font-size="16">SecretClaw · prompt-injection arena · clawpit.dev</text>
    <circle cx="${W - 80}" cy="${H - 46}" r="6" fill="${judgeColor}"/>
  `;
  return frame(inner);
}

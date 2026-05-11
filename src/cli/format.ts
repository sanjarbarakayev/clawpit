import type { MatchResult, Rating } from "../types.ts";
import { formatUsd } from "../cost.ts";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

export function printMatch(m: MatchResult, opts: { full?: boolean } = {}) {
  const isDebate = m.game === "debate-claw";
  const isMafia = m.game === "mafia-claw";
  const winColor = m.winner === "attacker" ? C.red : C.green;
  const winLabel = isMafia
    ? (m.teamWinner ?? (m.winner === "attacker" ? "WEREWOLVES" : "VILLAGERS")).toUpperCase()
    : isDebate
    ? m.winner === "attacker" ? "PRO" : "CON"
    : m.winner === "attacker" ? "ATTACKER" : "DEFENDER";
  const gameName = isMafia ? "MafiaClaw" : isDebate ? "DebateClaw" : "SecretClaw";
  console.log("");
  console.log(`${C.bold}─── ${gameName} match ${m.id.slice(0, 8)} ───${C.reset}`);
  if (isMafia && m.participants) {
    console.log(`${C.dim}participants${C.reset}`);
    for (const p of m.participants) {
      const roleColor = p.role === "werewolf" ? C.red : C.green;
      const mark = p.eliminated ? "✗" : "•";
      console.log(`  ${mark} ${p.label} ${roleColor}${p.role}${C.reset}${p.eliminated ? ` (out R${p.eliminationRound})` : ""}`);
    }
    console.log(`${C.dim}setup${C.reset}     ${m.topic}`);
  } else {
    const roleLeft = isDebate ? "pro" : "attacker";
    const roleRight = isDebate ? "con" : "defender";
    console.log(`${C.red}${roleLeft}${C.reset}  ${m.attacker.label}`);
    console.log(`${C.green}${roleRight}${C.reset}  ${m.defender.label}`);
    if (isDebate) {
      console.log(`${C.dim}statement${C.reset} ${m.topic}`);
    } else {
      console.log(`${C.dim}topic${C.reset}     ${m.topic}`);
      console.log(`${C.dim}secret${C.reset}    ${m.secret}`);
    }
  }
  console.log(
    `${C.dim}turns${C.reset}     ${m.turns}/${m.maxTurns}   ${C.dim}duration${C.reset} ${(m.durationMs / 1000).toFixed(1)}s`,
  );
  console.log(`winner    ${winColor}${C.bold}${winLabel}${C.reset}  (${m.reason})`);
  if (m.leakDetector && m.leakDetector !== "none") {
    console.log(`${C.dim}detector${C.reset}  ${m.leakDetector}`);
  }
  if (m.judgeVerdict) {
    const v = m.judgeVerdict;
    const tag = isDebate
      ? `${C.bold}${winLabel} wins${C.reset}`
      : v.leaked
      ? `${C.red}LEAK${C.reset}`
      : `${C.green}clean${C.reset}`;
    const model = v.model || "(noop)";
    const stage = v.stage;
    console.log(`${C.dim}judge${C.reset}     ${tag}  ${model}  [${stage}]`);
    // Show the judge's reasoning for debates always; for SecretClaw only on leak.
    if (v.evidence && (isDebate || v.leaked)) {
      console.log(`${C.dim}reasoning${C.reset} ${v.evidence}`);
    }
    if (v.note) {
      console.log(`${C.dim}note${C.reset}      ${v.note}`);
    }
  }

  if (m.usage && m.usage.totalCostUsd > 0) {
    const u = m.usage;
    const fmt = (s: { inputTokens: number; outputTokens: number; costUsd: number }) =>
      `${s.inputTokens}+${s.outputTokens} tok / ${formatUsd(s.costUsd)}`;
    console.log(
      `${C.dim}cost${C.reset}      ${C.bold}${formatUsd(u.totalCostUsd)}${C.reset}  ` +
        `${C.dim}atk${C.reset} ${fmt(u.attacker)}  ` +
        `${C.dim}def${C.reset} ${fmt(u.defender)}  ` +
        `${C.dim}judge${C.reset} ${fmt(u.judge)}`,
    );
  }

  if (opts.full) {
    console.log("");
    for (const t of m.transcript) {
      const color = t.role === "attacker" ? C.red : C.green;
      const tag = t.role === "attacker" ? "ATK" : "DEF";
      console.log(`${color}${C.bold}[T${t.turn} ${tag}]${C.reset} ${t.content}`);
    }
  }
  console.log("");
}

export function printLeaderboard(ratings: Rating[]) {
  if (ratings.length === 0) {
    console.log("(no matches recorded yet)");
    return;
  }
  const sorted = [...ratings].sort((a, b) => b.rating - a.rating);
  const labelW = Math.max(8, ...sorted.map((r) => r.label.length));
  const head =
    `${C.bold}rank  ` +
    "rating  ".padStart(8) +
    "agent".padEnd(labelW) +
    "  W-L      ATK W-L   DEF W-L   spent" +
    C.reset;
  console.log(head);
  sorted.forEach((r, i) => {
    const winRate = r.matches ? ((r.wins / r.matches) * 100).toFixed(0) : "0";
    const cost = r.totalCostUsd ?? 0;
    const line =
      `#${(i + 1).toString().padStart(2)}   ` +
      `${r.rating.toString().padStart(4)}    ` +
      r.label.padEnd(labelW) +
      `  ${r.wins}-${r.losses} (${winRate}%)`.padEnd(11) +
      `  ${r.asAttackerWins}-${r.asAttackerLosses}`.padEnd(10) +
      `  ${r.asDefenderWins}-${r.asDefenderLosses}`.padEnd(10) +
      `  ${formatUsd(cost)}`;
    console.log(line);
  });
}

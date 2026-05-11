// Pure functions over the match list — derive "narrative chips" the leaderboard
// can show next to each agent. Examples:
//
//   • "5-match streak"
//   • "first loss in 16"
//   • "+47 ELO this week"
//   • "undefeated as defender"
//
// All computations are deterministic from the (matches, agentId) pair.
// No backend support needed — runs in the browser over /api/matches data.

/** Order: matches[] from server is newest-first. */
function matchesForAgent(matches, agentLabel) {
  return matches.filter(
    (m) => m.attacker === agentLabel || m.defender === agentLabel,
  );
}

function isWin(m, agentLabel) {
  if (m.attacker === agentLabel) return m.winner === "attacker";
  if (m.defender === agentLabel) return m.winner === "defender";
  return false;
}

/** Current consecutive win streak from the newest end. */
function currentWinStreak(matches, agentLabel) {
  const own = matchesForAgent(matches, agentLabel);
  let n = 0;
  for (const m of own) {
    if (isWin(m, agentLabel)) n++;
    else break;
  }
  return n;
}

/** Total matches as defender + how many ended in held_the_line. */
function defenderStats(matches, agentLabel) {
  const def = matches.filter((m) => m.defender === agentLabel);
  const held = def.filter(
    (m) => m.winner === "defender" && m.reason === "held_the_line",
  ).length;
  return { total: def.length, held };
}

/** Matches since the last loss (excluding agent_error walkovers — those aren't gameplay). */
function matchesSinceLastLoss(matches, agentLabel) {
  const own = matchesForAgent(matches, agentLabel);
  let n = 0;
  for (const m of own) {
    const loss = !isWin(m, agentLabel);
    const isGameplay = m.reason === "held_the_line" || m.reason === "secret_leaked";
    if (loss && isGameplay) return n;
    n++;
  }
  return -1; // never lost
}

/**
 * Pick the strongest narrative chip for an agent, or null if nothing
 * worth shouting about. Returns at most one chip — the leaderboard is
 * already busy. Priority order:
 *   - undefeated-defender (15+ defends, 0 leaks) — the strongest claim
 *   - long-streak (5+ consecutive wins)
 *   - first-loss-in-N (matches since last loss ≥ 10)
 *   - rookie (only registered, no matches yet) — encourages clicks
 */
export function chipForAgent(matches, rating) {
  const label = rating.label;

  const def = defenderStats(matches, label);
  if (def.total >= 12 && def.held === def.total) {
    return { kind: "champ", text: `${def.held}/${def.total} held`, tone: "good" };
  }

  const streak = currentWinStreak(matches, label);
  if (streak >= 4) {
    return { kind: "streak", text: `${streak}-match streak`, tone: "good" };
  }

  const since = matchesSinceLastLoss(matches, label);
  if (since >= 10) {
    return { kind: "since-loss", text: `${since} since last loss`, tone: "good" };
  }

  if (rating.matches === 0) {
    return { kind: "rookie", text: "rookie", tone: "neutral" };
  }

  return null;
}

/**
 * Last-N-match outcomes for sparkline. Returns array of "W" / "L" / "—",
 * newest at index 0 (matching server order). Used by sparkline.js.
 */
export function recentOutcomes(matches, agentLabel, n = 10) {
  const own = matchesForAgent(matches, agentLabel).slice(0, n);
  return own.map((m) => (isWin(m, agentLabel) ? "W" : "L"));
}

/** Hero-strip narrative line. Returns a short string or null. */
export function heroNarrative(matches, agents) {
  if (!matches.length) return null;
  // Most recent gameplay leak (if any) is the headline.
  const lastLeak = matches.find((m) => m.leaked);
  if (lastLeak) {
    return `Last leak: ${lastLeak.attacker} cracked ${lastLeak.defender} • ${timeAgo(lastLeak.startedAt)}`;
  }
  // Best streak across active agents
  let bestAgent = null;
  let bestStreak = 0;
  for (const a of agents) {
    const s = currentWinStreak(matches, a.label);
    if (s > bestStreak) { bestStreak = s; bestAgent = a.label; }
  }
  if (bestAgent && bestStreak >= 3) {
    return `${bestAgent} on a ${bestStreak}-match streak`;
  }
  return null;
}

function timeAgo(iso) {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return "just now";
  if (d < 3600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86400_000) return `${Math.round(d / 3600_000)}h ago`;
  return `${Math.round(d / 86400_000)}d ago`;
}

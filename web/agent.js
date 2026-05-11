import { avatarSvg } from "/avatar.js";
import { chipForAgent } from "/narratives.js";

const root = document.getElementById("profile-root");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtUsd(amount) {
  if (!amount) return "$0";
  if (amount < 0.001) return `$${(amount * 1000).toFixed(3)}m`;
  if (amount < 1) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

function fmtAgo(iso) {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return `${Math.round(d / 1000)}s ago`;
  if (d < 3600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86400_000) return `${Math.round(d / 3600_000)}h ago`;
  return `${Math.round(d / 86400_000)}d ago`;
}

const reasonLabels = {
  held_the_line: "held the line",
  secret_leaked: "leaked",
  attacker_error: "attacker error",
  defender_error: "defender error",
};

async function fetchAll(agentId) {
  const [ratingsRes, matchesRes, agentsRes] = await Promise.all([
    fetch("/api/leaderboard"),
    fetch("/api/matches?limit=400"),
    fetch("/api/agents"),
  ]);
  const ratings = await ratingsRes.json();
  const matches = await matchesRes.json();
  const agents = agentsRes.ok ? await agentsRes.json() : [];
  const rating = ratings.find((r) => r.agentId === agentId);
  const registered = agents.find((a) => a.id === agentId);
  return { rating, matches, agents, ratings, registered };
}

function computeRivalries(matches, label) {
  const map = new Map();
  for (const m of matches) {
    let opp = null;
    let win = null;
    if (m.attacker === label) {
      opp = m.defender;
      win = m.winner === "attacker";
    } else if (m.defender === label) {
      opp = m.attacker;
      win = m.winner === "defender";
    }
    if (!opp) continue;
    const cur = map.get(opp) ?? { name: opp, wins: 0, losses: 0 };
    if (win) cur.wins++; else cur.losses++;
    map.set(opp, cur);
  }
  return [...map.values()].sort(
    (a, b) => b.wins + b.losses - (a.wins + a.losses),
  );
}

function renderHead(rating, registered) {
  const isExternal = !!registered;
  const badge = isExternal
    ? `<span class="agent-badge external">EXT</span>`
    : `<span class="agent-badge seed">SEED</span>`;
  const handle = registered?.ownerHandle
    ? `<span>@${escapeHtml(registered.ownerHandle)}</span>`
    : "";
  const desc = registered?.description
    ? `<p class="profile-description">${escapeHtml(registered.description)}</p>`
    : "";
  return `
    <div class="profile-head">
      <div class="profile-avatar">${avatarSvg(rating.label, { size: 88, rounded: false })}</div>
      <div class="profile-name-block">
        <h1 class="profile-name">${escapeHtml(rating.label)}</h1>
        <div class="profile-meta">
          ${badge}
          ${handle}
          <span style="color:var(--fg-muted)">${rating.matches} matches</span>
        </div>
        ${desc}
      </div>
      <div class="profile-elo">
        <div class="profile-elo-value">${rating.rating}</div>
        <div class="profile-elo-label">ELO</div>
      </div>
    </div>`;
}

function renderStats(rating) {
  const winRate = rating.matches
    ? Math.round((rating.wins / rating.matches) * 100)
    : 0;
  const cost = rating.totalCostUsd ?? 0;
  return `
    <div class="profile-stats">
      <div class="profile-stat">
        <div class="profile-stat-label">Overall</div>
        <div class="profile-stat-value">${rating.wins}-${rating.losses}</div>
        <div class="profile-stat-sub">${winRate}% win rate</div>
      </div>
      <div class="profile-stat">
        <div class="profile-stat-label">As attacker</div>
        <div class="profile-stat-value atk">${rating.asAttackerWins}-${rating.asAttackerLosses}</div>
        <div class="profile-stat-sub">${rating.asAttackerWins + rating.asAttackerLosses} matches</div>
      </div>
      <div class="profile-stat">
        <div class="profile-stat-label">As defender</div>
        <div class="profile-stat-value def">${rating.asDefenderWins}-${rating.asDefenderLosses}</div>
        <div class="profile-stat-sub">${rating.asDefenderWins + rating.asDefenderLosses} matches</div>
      </div>
      <div class="profile-stat">
        <div class="profile-stat-label">Lifetime cost</div>
        <div class="profile-stat-value gold">${fmtUsd(cost)}</div>
        <div class="profile-stat-sub">${(rating.totalInputTokens + rating.totalOutputTokens).toLocaleString()} tokens</div>
      </div>
    </div>`;
}

function renderRivalries(rivalries) {
  if (!rivalries.length) return "";
  const top = rivalries.slice(0, 6);
  return `
    <section class="profile-section">
      <h2>Rivalries</h2>
      <div class="rivalries">
        ${top.map((r) => {
          const total = r.wins + r.losses;
          const winPct = total ? (r.wins / total) * 100 : 0;
          const lossPct = 100 - winPct;
          return `<a class="rivalry-card" href="#">
            <span class="profile-avatar" style="flex-shrink:0">${avatarSvg(r.name, { size: 36 })}</span>
            <div class="rivalry-info">
              <span class="rivalry-name">${escapeHtml(r.name)}</span>
              <span class="rivalry-record">${r.wins}W &nbsp;–&nbsp; ${r.losses}L</span>
              <div class="rivalry-bar">
                <div class="rivalry-bar-win" style="width:${winPct}%"></div>
                <div class="rivalry-bar-loss" style="width:${lossPct}%"></div>
              </div>
            </div>
          </a>`;
        }).join("")}
      </div>
    </section>`;
}

function renderHistory(matches, label) {
  const own = matches.filter(
    (m) => m.attacker === label || m.defender === label,
  );
  if (!own.length) {
    return `<section class="profile-section">
      <h2>Match history</h2>
      <div class="profile-empty">No matches played yet — challenge another agent to get on the board.</div>
    </section>`;
  }
  const rows = own.slice(0, 50).map((m) => {
    const role = m.attacker === label ? "attacker" : "defender";
    const opp = role === "attacker" ? m.defender : m.attacker;
    const win =
      (role === "attacker" && m.winner === "attacker") ||
      (role === "defender" && m.winner === "defender");
    const oc = win ? "win" : "loss";
    const reason = reasonLabels[m.reason] || m.reason;
    return `<a class="history-row" href="/match.html?id=${encodeURIComponent(m.id)}">
      <span class="history-outcome ${oc}">${win ? "W" : "L"}</span>
      <div class="history-vs">
        <span class="history-role">${role}</span>
        <div class="history-opponent">
          <span>${avatarSvg(opp, { size: 22 })}</span>
          <span class="history-opponent-name">${escapeHtml(opp)}</span>
        </div>
      </div>
      <span class="history-reason">${reason}</span>
      <span class="history-time">${fmtAgo(m.startedAt)}</span>
    </a>`;
  });
  return `<section class="profile-section">
    <h2>Match history (${own.length})</h2>
    <div class="match-history">${rows.join("")}</div>
  </section>`;
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const agentId = params.get("id");
  if (!agentId) {
    root.innerHTML = `<div class="profile-loading">missing ?id= parameter</div>`;
    return;
  }
  try {
    const { rating, matches, registered } = await fetchAll(agentId);
    if (!rating) {
      root.innerHTML = `<div class="profile-loading">agent "${escapeHtml(agentId)}" has no matches yet.</div>`;
      return;
    }
    document.title = `${rating.label} — clawpit`;
    const rivalries = computeRivalries(matches, rating.label);
    root.innerHTML =
      renderHead(rating, registered) +
      renderStats(rating) +
      renderRivalries(rivalries) +
      renderHistory(matches, rating.label);
  } catch (err) {
    root.innerHTML = `<div class="profile-loading">failed to load: ${escapeHtml(err.message)}</div>`;
  }
}

main();

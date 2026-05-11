import { avatarSvg } from "/avatar.js";
import { chipForAgent, recentOutcomes, heroNarrative } from "/narratives.js";
import { winLossStripSvg } from "/sparkline.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let activeMatchId = null;
let matchesCache = []; // newest first; populated by loadMatches

const ADMIN_TOKEN_KEY = "clawpit_admin_token";

function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY) || "";
}
function setAdminToken(token) {
  if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
  else localStorage.removeItem(ADMIN_TOKEN_KEY);
  refreshAdminBadge();
}
function refreshAdminBadge() {
  const has = !!getAdminToken();
  $("#admin-badge").hidden = !has;
  $("#admin-toggle").textContent = has ? "clear token" : "reveal mode";
}

function fmtUsd(amount) {
  if (!amount) return "$0";
  if (amount < 0.001) return `$${(amount * 1000).toFixed(3)}m`;
  if (amount < 1) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtAgo(iso) {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return `${Math.round(d / 1000)}s ago`;
  if (d < 3600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86400_000) return `${Math.round(d / 3600_000)}h ago`;
  return `${Math.round(d / 86400_000)}d ago`;
}

const RANK_MODE_KEY = "clawpit_rank_mode";
function getRankMode() {
  return localStorage.getItem(RANK_MODE_KEY) === "adjusted" ? "adjusted" : "elo";
}
function setRankMode(mode) {
  localStorage.setItem(RANK_MODE_KEY, mode);
  const btn = $("#rank-toggle");
  btn.dataset.mode = mode;
  btn.textContent = mode === "adjusted" ? "ELO/$ (λ=100)" : "ELO";
}

async function loadLeaderboard() {
  const mode = getRankMode();
  const url =
    mode === "adjusted"
      ? "/api/leaderboard?adjusted=1&lambda=100"
      : "/api/leaderboard";
  const [ratingsRes, agentsRes] = await Promise.all([
    fetch(url),
    fetch("/api/agents").catch(() => null),
  ]);
  const ratings = await ratingsRes.json();
  const externalAgents = agentsRes && agentsRes.ok ? await agentsRes.json() : [];
  const externalById = new Map(externalAgents.map((a) => [a.id, a]));
  const tbody = $("#leaderboard tbody");
  if (!ratings.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">No matches yet — run <code>pnpm demo</code></td></tr>`;
    return;
  }
  tbody.innerHTML = ratings
    .map((r, i) => {
      const winRate = r.matches ? Math.round((r.wins / r.matches) * 100) : 0;
      const eloCol =
        mode === "adjusted"
          ? `<td class="num elo elo-adj" title="ELO ${r.rating} − ${r.lambdaUsed} × $${(r.totalCostUsd ?? 0).toFixed(4)}">${r.costAdjustedRating ?? r.rating}<span class="elo-base"> (${r.rating})</span></td>`
          : `<td class="num elo">${r.rating}</td>`;
      const isExternal = externalById.has(r.agentId);
      const badge = isExternal
        ? `<span class="agent-badge external" title="Public registered agent">EXT</span>`
        : `<span class="agent-badge seed" title="Built-in seed agent (Tournament 2 baseline)">SEED</span>`;
      const owner = isExternal && externalById.get(r.agentId).ownerHandle;
      const chip = chipForAgent(matchesCache, r);
      const chipHtml = chip
        ? `<span class="narrative-chip ${chip.tone}" title="${escapeHtml(chip.kind)}">${escapeHtml(chip.text)}</span>`
        : "";
      const outcomes = recentOutcomes(matchesCache, r.label, 10);
      const sparkline = outcomes.length
        ? winLossStripSvg(outcomes, { width: 56, height: 12, slots: 10 })
        : "";
      const avatar = avatarSvg(r.label, { size: 28 });
      const profileHref = `/agent.html?id=${encodeURIComponent(r.agentId)}`;
      return `<tr class="rank-${i + 1}" data-agent-id="${escapeHtml(r.agentId)}">
        <td>${i + 1}</td>
        <td class="agent-cell">
          <a class="agent-link" href="${profileHref}">
            <span class="agent-avatar-wrap">${avatar}</span>
            <span class="agent-name-stack">
              <span class="agent-name-row">
                <span class="agent-name" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span>
              </span>
              <span class="agent-chips-row">
                ${badge}
                ${chipHtml}
                ${owner ? `<span class="agent-owner">@${escapeHtml(owner)}</span>` : ""}
              </span>
            </span>
          </a>
        </td>
        ${eloCol}
        <td class="num">${r.wins}-${r.losses}</td>
        <td class="num">${r.asAttackerWins}-${r.asAttackerLosses}</td>
        <td class="num">${r.asDefenderWins}-${r.asDefenderLosses}</td>
        <td class="num sparkline-cell">${sparkline}</td>
        <td class="num cost">${fmtUsd(r.totalCostUsd ?? 0)}</td>
      </tr>`;
    })
    .join("");
}

async function loadMatches() {
  const res = await fetch("/api/matches?limit=80");
  const matches = await res.json();
  matchesCache = matches;
  const ul = $("#matches");
  if (!matches.length) {
    ul.innerHTML = `<li class="empty">No matches yet.</li>`;
    return;
  }
  ul.innerHTML = matches
    .map((m) => {
      const isMafia = m.game === "mafia-claw";
      const isDebate = m.game === "debate-claw";
      let winClass, winLabel;
      if (isMafia) {
        winClass = m.teamWinner === "werewolves" ? "win-atk" : "win-def";
        winLabel = m.teamWinner === "werewolves" ? "WOLVES" : "VILLAGERS";
      } else if (isDebate) {
        winClass = m.winner === "attacker" ? "win-atk" : "win-def";
        winLabel = m.winner === "attacker" ? "PRO" : "CON";
      } else {
        winClass = m.winner === "attacker" ? "win-atk" : "win-def";
        winLabel = m.winner === "attacker" ? "ATK" : "DEF";
      }
      const cls = `match ${winClass}-bar${m.id === activeMatchId ? " active" : ""}`;
      const cost = m.costUsd ? ` · ${fmtUsd(m.costUsd)}` : "";
      const turnsPct = Math.round((m.turns / Math.max(m.maxTurns, 1)) * 100);
      const meterClass = m.reason === "held_the_line"
        ? "meter-held"
        : m.reason === "secret_leaked"
        ? "meter-leaked"
        : m.reason === "werewolves_uncovered"
        ? "meter-held"
        : m.reason === "werewolves_overran"
        ? "meter-leaked"
        : m.reason === "judge_decision"
        ? "meter-held"
        : "meter-error";
      const reasonLabel = {
        held_the_line: "held the line",
        secret_leaked: "leaked",
        attacker_error: "attacker error",
        defender_error: "defender error",
        judge_decision: "judge decision",
        werewolves_uncovered: "all wolves uncovered",
        werewolves_overran: "wolves overran",
      }[m.reason] || m.reason;
      const gameBadge = isMafia
        ? `<span class="game-pill game-mafia">MAFIA · ${m.participantCount ?? 5}</span>`
        : isDebate
        ? `<span class="game-pill game-debate">DEBATE</span>`
        : `<span class="game-pill game-secret">SECRET</span>`;
      const atkAvatar = avatarSvg(m.attacker, { size: 22 });
      const defAvatar = avatarSvg(m.defender, { size: 22 });
      const vsLine = isMafia
        ? `<div class="match-vs"><span class="agent-mini">${atkAvatar}<span class="atk-name">${m.participantCount ?? "?"}-way Mafia</span></span></div>`
        : `<div class="match-vs">
          <span class="agent-mini atk">${atkAvatar}<span class="atk-name">${escapeHtml(m.attacker)}</span></span>
          <span class="v">vs</span>
          <span class="agent-mini def">${defAvatar}<span class="def-name">${escapeHtml(m.defender)}</span></span>
        </div>`;
      return `<li class="${cls}" data-id="${m.id}">
        <div class="match-line1">
          <span class="match-result ${winClass}">${winLabel} win</span>
          <div class="match-line1-right">
            ${gameBadge}
            <span class="match-time">${fmtAgo(m.startedAt)}</span>
          </div>
        </div>
        ${vsLine}
        <div class="match-meter ${meterClass}" title="${reasonLabel}">
          <div class="match-meter-fill" style="width: ${turnsPct}%"></div>
          <div class="match-meter-label">${m.turns}/${m.maxTurns} turns · ${reasonLabel}${cost}</div>
        </div>
        <div class="match-meta">${escapeHtml(m.topic)}</div>
      </li>`;
    })
    .join("");

  $$("#matches .match").forEach((el) => {
    el.addEventListener("click", () => loadMatchDetail(el.dataset.id));
  });
}

function renderJudgeRow(m) {
  const detector = m.leakDetector || "none";
  const v = m.judgeVerdict;
  if (!v && detector === "none") {
    return `<div class="label">judge</div><div class="judge-none">no judge ran</div>`;
  }
  if (!v) {
    return `<div class="label">judge</div><div class="judge-none">detector: ${escapeHtml(detector)}</div>`;
  }
  const cls = v.leaked ? "judge-leak" : "judge-clean";
  const tag = v.leaked ? "LEAK" : "clean";
  const model = escapeHtml(v.model || "(noop)");
  const stage = escapeHtml(v.stage);
  const detectorTag = detector !== "none"
    ? ` &middot; via ${escapeHtml(detector)}`
    : "";
  const evidence =
    v.leaked && v.evidence
      ? `<div class="judge-evidence">${escapeHtml(v.evidence)}</div>`
      : "";
  const note = v.note
    ? `<div class="judge-note">${escapeHtml(v.note)}</div>`
    : "";
  return `<div class="label">judge</div>
    <div>
      <span class="${cls}">${tag}</span>
      <span class="judge-meta">${model} &middot; ${stage}${detectorTag}</span>
      ${evidence}
      ${note}
    </div>`;
}

function renderUsageRow(m) {
  if (!m.usage || !m.usage.totalCostUsd) return "";
  const u = m.usage;
  const fmt = (s) =>
    `${s.inputTokens}+${s.outputTokens} tok &middot; ${fmtUsd(s.costUsd)}`;
  return `<div class="label">cost</div>
    <div class="cost-row">
      <span class="cost-total">${fmtUsd(u.totalCostUsd)}</span>
      <span class="cost-meta">atk ${fmt(u.attacker)} &middot; def ${fmt(u.defender)} &middot; judge ${fmt(u.judge)}</span>
    </div>`;
}

let liveStream = null;

function closeLiveStream() {
  if (liveStream) {
    liveStream.close();
    liveStream = null;
  }
}

function liveDetailHTML({ attacker, defender, maxTurns, topic, turns, status, secret, judge, cost }) {
  const liveBadge = status === "live" ? `<span class="live-badge">LIVE</span>` : "";
  const finished = status === "finished" ? `<span class="finished-badge">FINISHED</span>` : "";
  const errored = status === "error" ? `<span class="error-badge">ERROR</span>` : "";
  const turnsHtml = turns
    .map(
      (t) => `<div class="turn ${t.role === "attacker" ? "atk" : "def"}">
        <div class="turn-tag">T${t.turn} &middot; ${t.role}</div>
        <div>${escapeHtml(t.content)}</div>
      </div>`,
    )
    .join("");
  return `
    <div class="detail-header">
      <div class="label">attacker</div><div><span class="atk-name">${escapeHtml(attacker)}</span></div>
      <div class="label">defender</div><div><span class="def-name">${escapeHtml(defender)}</span></div>
      <div class="label">topic</div><div>${escapeHtml(topic ?? "(pending)")}</div>
      <div class="label">secret</div><div><span class="secret-redacted">${escapeHtml(secret ?? "[REDACTED]")}</span></div>
      <div class="label">status</div><div>${liveBadge}${finished}${errored}</div>
      <div class="label">turns</div><div>${turns.length}/${maxTurns}</div>
      ${judge ? `<div class="label">judge</div><div><span class="judge-leak">${judge.tag}</span><span class="judge-meta">${escapeHtml(judge.model)} &middot; ${escapeHtml(judge.stage)}</span>${judge.evidence ? `<div class="judge-evidence">${escapeHtml(judge.evidence)}</div>` : ""}</div>` : ""}
      ${cost ? `<div class="label">cost</div><div class="cost-row"><span class="cost-total">${fmtUsd(cost)}</span></div>` : ""}
    </div>
    <div class="transcript">${turnsHtml}</div>
  `;
}

function streamLiveMatch(matchId, header) {
  closeLiveStream();
  activeMatchId = matchId;
  $("#detail-title").textContent = `Match ${matchId.slice(0, 8)} · live`;

  const state = {
    attacker: header?.attacker ?? "(pending)",
    defender: header?.defender ?? "(pending)",
    maxTurns: header?.maxTurns ?? 6,
    topic: undefined,
    turns: [],
    status: "live",
    judge: null,
    cost: 0,
  };

  const render = () => {
    $("#detail").innerHTML = liveDetailHTML(state);
  };
  render();

  const es = new EventSource(`/api/matches/${matchId}/stream`);
  liveStream = es;

  es.addEventListener("started", (ev) => {
    const data = JSON.parse(ev.data);
    state.attacker = data.attacker;
    state.defender = data.defender;
    state.maxTurns = data.maxTurns;
    state.topic = data.topic === "(pending)" ? state.topic : data.topic;
    render();
  });

  es.addEventListener("turn", (ev) => {
    const data = JSON.parse(ev.data);
    state.turns.push(data.entry);
    render();
  });

  es.addEventListener("finished", (ev) => {
    const data = JSON.parse(ev.data);
    const m = data.result;
    state.status = "finished";
    state.maxTurns = m.maxTurns;
    state.topic = m.topic;
    if (m.judgeVerdict) {
      state.judge = {
        tag: m.judgeVerdict.leaked ? "LEAK" : "CLEAN",
        model: m.judgeVerdict.model || "(noop)",
        stage: m.judgeVerdict.stage,
        evidence: m.judgeVerdict.evidence,
      };
    }
    state.cost = m.usage?.totalCostUsd ?? 0;
    render();
    closeLiveStream();
    // Refresh leaderboard + match list once the result is persisted.
    setTimeout(refreshAll, 200);
  });

  es.addEventListener("error", (ev) => {
    if (es.readyState === EventSource.CLOSED) {
      // server closed; nothing to do
    } else if (ev.data) {
      const data = JSON.parse(ev.data);
      state.status = "error";
      state.judge = {
        tag: "ERR",
        model: "",
        stage: "error",
        evidence: data.message,
      };
      render();
    }
  });
}

async function startMatch() {
  const token = getAdminToken();
  // Default: free mock vs mock. Hold Shift to launch a Claude match (admin-only).
  const useClaude = window.event?.shiftKey;
  let body = {
    attacker: "mock:atk:demo",
    defender: "mock:def:demo",
    judge: "decoder",
  };
  if (useClaude) {
    if (!token) {
      alert("Hold-Shift launches a real Claude match.\n\nThat needs an admin token (CLAWPIT_ADMIN_TOKEN). Set it via the 'reveal mode' button first.");
      return;
    }
    const attacker = prompt("attacker spec (e.g. claude-opus-4-7):", "claude-opus-4-7");
    if (!attacker) return;
    const defender = prompt("defender spec (e.g. claude-haiku-4-5-20251001):", "claude-haiku-4-5-20251001");
    if (!defender) return;
    body = { attacker, defender, judge: "decoder" };
  }
  const headers = { "content-type": "application/json" };
  if (token) headers["x-clawpit-admin-token"] = token;
  const res = await fetch("/api/matches", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    alert(`Could not start match: ${err.error || res.statusText}`);
    return;
  }
  const { matchId, attacker, defender } = await res.json();
  streamLiveMatch(matchId, { attacker, defender, maxTurns: body.turns ?? 6 });
}

async function loadMatchDetail(id) {
  closeLiveStream();
  activeMatchId = id;
  const headers = {};
  const token = getAdminToken();
  const url = token ? `/api/matches/${id}?reveal=1` : `/api/matches/${id}`;
  if (token) headers["x-clawpit-admin-token"] = token;
  const res = await fetch(url, { headers });
  if (res.status === 401) {
    // Stale or wrong token — drop it and retry redacted.
    setAdminToken("");
    return loadMatchDetail(id);
  }
  if (res.status === 403 && token) {
    // Server has no admin token configured. Drop and retry redacted.
    setAdminToken("");
    return loadMatchDetail(id);
  }
  if (!res.ok) {
    $("#detail").innerHTML = `<div class="empty">match not found</div>`;
    return;
  }
  const m = await res.json();
  const isRedacted = m.redacted === true;
  $("#detail-title").textContent = `Match ${id.slice(0, 8)}${isRedacted ? "" : " · revealed"}`;
  const winClass = m.winner === "attacker" ? "win-atk" : "win-def";
  const winLabel = m.winner === "attacker" ? "ATTACKER" : "DEFENDER";
  const turns = m.transcript
    .map(
      (t) => `<div class="turn ${t.role === "attacker" ? "atk" : "def"}">
        <div class="turn-tag">T${t.turn} &middot; ${t.role}</div>
        <div>${escapeHtml(t.content)}</div>
      </div>`,
    )
    .join("");
  const secretCell = isRedacted
    ? `<span class="secret-redacted">${escapeHtml(m.secret)}</span>`
    : `<span class="secret">${escapeHtml(m.secret)}</span>`;
  $("#detail").innerHTML = `
    <div class="detail-header">
      <div class="label">attacker</div><div><span class="atk-name">${escapeHtml(m.attacker.label)}</span></div>
      <div class="label">defender</div><div><span class="def-name">${escapeHtml(m.defender.label)}</span></div>
      <div class="label">topic</div><div>${escapeHtml(m.topic)}</div>
      <div class="label">secret</div><div>${secretCell}</div>
      <div class="label">winner</div><div class="${winClass}">${winLabel} &middot; ${m.reason}</div>
      <div class="label">turns</div><div>${m.turns}/${m.maxTurns} &middot; ${(m.durationMs / 1000).toFixed(1)}s</div>
      ${renderJudgeRow(m)}
      ${renderUsageRow(m)}
    </div>
    <div class="detail-cta">
      <a href="/match.html?id=${encodeURIComponent(id)}" class="full-view-link">open full view →</a>
    </div>
    <div class="transcript">${turns}</div>
  `;
  $$("#matches .match").forEach((el) =>
    el.classList.toggle("active", el.dataset.id === id),
  );
}

function loadGamesStrip(matches) {
  const counts = { "secret-claw": 0, "debate-claw": 0, "mafia-claw": 0 };
  for (const m of matches) {
    // Backfill: matches recorded before the multi-game split don't carry
    // a `game` field. Treat anything missing as SecretClaw.
    const g = m.game || "secret-claw";
    if (counts[g] !== undefined) counts[g]++;
  }
  const setText = (sel, val) => { const el = $(sel); if (el) el.textContent = val; };
  setText("#games-strip-secret", counts["secret-claw"]);
  setText("#games-strip-debate", counts["debate-claw"]);
  setText("#games-strip-mafia", counts["mafia-claw"]);
}

let activeGameFilter = null; // null = all
function setupGamesStripClicks() {
  $$("#games-strip-grid .game-card").forEach((el) => {
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      const game = el.dataset.game;
      activeGameFilter = activeGameFilter === game ? null : game;
      $$("#games-strip-grid .game-card").forEach((c) => {
        c.classList.toggle("active", activeGameFilter === c.dataset.game);
      });
      filterMatchListByGame();
    });
  });
}
function filterMatchListByGame() {
  $$("#matches .match").forEach((el) => {
    const id = el.dataset.id;
    const m = matchesCache.find((x) => x.id === id);
    const game = m?.game || "secret-claw";
    el.hidden = activeGameFilter && game !== activeGameFilter;
  });
}

async function loadHeroStats() {
  try {
    const [agentsRes, liveRes, ratingsRes] = await Promise.all([
      fetch("/api/agents").catch(() => null),
      fetch("/api/live").catch(() => null),
      fetch("/api/leaderboard").catch(() => null),
    ]);
    const matches = matchesCache;
    const agents = agentsRes && agentsRes.ok ? await agentsRes.json() : [];
    const live = liveRes && liveRes.ok ? await liveRes.json() : [];
    const ratings = ratingsRes && ratingsRes.ok ? await ratingsRes.json() : [];
    const total = matches.length;
    const leaks = matches.filter((m) => m.leaked).length;
    const heldPct = total
      ? Math.round(
          (matches.filter((m) => m.winner === "defender" && m.reason === "held_the_line").length /
            total) *
            100,
        )
      : 0;
    $("#stat-matches").textContent = total.toLocaleString();
    $("#stat-leaks").textContent = leaks;
    $("#stat-hold").textContent = total ? `${heldPct}%` : "—";
    $("#stat-agents").textContent = ratings.length;
    $("#stat-live").textContent = live.length || 0;
    const liveEl = $("#stat-live");
    liveEl.classList.toggle("active", (live.length || 0) > 0);
    const narrative = heroNarrative(matches, ratings);
    const narrativeEl = $("#hero-narrative");
    if (narrative) {
      narrativeEl.textContent = narrative;
      narrativeEl.hidden = false;
    } else {
      narrativeEl.hidden = true;
    }
  } catch (err) {
    // hero stats are decorative; failure shouldn't break the page
  }
}

async function refreshAll() {
  try {
    // Matches first so matchesCache is populated before leaderboard renders
    // its narrative chips + sparklines.
    await loadMatches();
    loadGamesStrip(matchesCache);
    filterMatchListByGame();
    await Promise.all([loadLeaderboard(), loadHeroStats()]);
    const status = $("#status");
    status.textContent = "live";
    status.classList.add("live");
  } catch (err) {
    $("#status").textContent = `error: ${err.message}`;
  }
}

function setupRankToggle() {
  setRankMode(getRankMode());
  $("#rank-toggle").addEventListener("click", async () => {
    const next = getRankMode() === "adjusted" ? "elo" : "adjusted";
    setRankMode(next);
    await loadLeaderboard();
  });
}

function setupAdminToggle() {
  $("#admin-toggle").addEventListener("click", async () => {
    if (getAdminToken()) {
      setAdminToken("");
      if (activeMatchId) await loadMatchDetail(activeMatchId);
      return;
    }
    const token = prompt(
      "Enter CLAWPIT_ADMIN_TOKEN to reveal secrets in match detail.\n\nThe token is stored in this browser only.",
    );
    if (!token) return;
    setAdminToken(token.trim());
    if (activeMatchId) await loadMatchDetail(activeMatchId);
  });
  refreshAdminBadge();
}

function setupRunMatch() {
  $("#run-match").addEventListener("click", startMatch);
}

setupRankToggle();
setupAdminToggle();
setupRunMatch();
setupGamesStripClicks();
refreshAll();
setInterval(refreshAll, 5000);

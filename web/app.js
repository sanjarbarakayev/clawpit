const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let activeMatchId = null;

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
  const res = await fetch(url);
  const ratings = await res.json();
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
      return `<tr class="rank-${i + 1}">
        <td>${i + 1}</td>
        <td>${escapeHtml(r.label)}</td>
        ${eloCol}
        <td class="num">${r.wins}-${r.losses}<span style="color:var(--fg-muted)"> (${winRate}%)</span></td>
        <td class="num">${r.asAttackerWins}-${r.asAttackerLosses}</td>
        <td class="num">${r.asDefenderWins}-${r.asDefenderLosses}</td>
        <td class="num cost">${fmtUsd(r.totalCostUsd ?? 0)}</td>
      </tr>`;
    })
    .join("");
}

async function loadMatches() {
  const res = await fetch("/api/matches?limit=80");
  const matches = await res.json();
  const ul = $("#matches");
  if (!matches.length) {
    ul.innerHTML = `<li class="empty">No matches yet.</li>`;
    return;
  }
  ul.innerHTML = matches
    .map((m) => {
      const winClass = m.winner === "attacker" ? "win-atk" : "win-def";
      const winLabel = m.winner === "attacker" ? "ATK win" : "DEF win";
      const cls = `match${m.id === activeMatchId ? " active" : ""}`;
      const cost = m.costUsd ? ` &middot; ${fmtUsd(m.costUsd)}` : "";
      return `<li class="${cls}" data-id="${m.id}">
        <div class="match-line1">
          <span class="${winClass}">${winLabel}</span>
          <span>${fmtAgo(m.startedAt)}</span>
        </div>
        <div class="match-vs">
          <span class="atk-name">${escapeHtml(m.attacker)}</span>
          <span class="v">vs</span>
          <span class="def-name">${escapeHtml(m.defender)}</span>
        </div>
        <div class="match-meta">${m.turns}/${m.maxTurns} turns &middot; ${m.reason}${cost} &middot; ${escapeHtml(m.topic)}</div>
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
    <div class="transcript">${turns}</div>
  `;
  $$("#matches .match").forEach((el) =>
    el.classList.toggle("active", el.dataset.id === id),
  );
}

async function refreshAll() {
  try {
    await Promise.all([loadLeaderboard(), loadMatches()]);
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
refreshAll();
setInterval(refreshAll, 5000);

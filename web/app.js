const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let activeMatchId = null;

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

async function loadLeaderboard() {
  const res = await fetch("/api/leaderboard");
  const ratings = await res.json();
  const tbody = $("#leaderboard tbody");
  if (!ratings.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">No matches yet — run <code>pnpm demo</code></td></tr>`;
    return;
  }
  tbody.innerHTML = ratings
    .map((r, i) => {
      const winRate = r.matches ? Math.round((r.wins / r.matches) * 100) : 0;
      return `<tr class="rank-${i + 1}">
        <td>${i + 1}</td>
        <td>${escapeHtml(r.label)}</td>
        <td class="num elo">${r.rating}</td>
        <td class="num">${r.wins}-${r.losses}<span style="color:var(--fg-muted)"> (${winRate}%)</span></td>
        <td class="num">${r.asAttackerWins}-${r.asAttackerLosses}</td>
        <td class="num">${r.asDefenderWins}-${r.asDefenderLosses}</td>
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
        <div class="match-meta">${m.turns}/${m.maxTurns} turns &middot; ${m.reason} &middot; ${escapeHtml(m.topic)}</div>
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

async function loadMatchDetail(id) {
  activeMatchId = id;
  const res = await fetch(`/api/matches/${id}`);
  if (!res.ok) {
    $("#detail").innerHTML = `<div class="empty">match not found</div>`;
    return;
  }
  const m = await res.json();
  $("#detail-title").textContent = `Match ${id.slice(0, 8)}`;
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
  $("#detail").innerHTML = `
    <div class="detail-header">
      <div class="label">attacker</div><div><span class="atk-name">${escapeHtml(m.attacker.label)}</span></div>
      <div class="label">defender</div><div><span class="def-name">${escapeHtml(m.defender.label)}</span></div>
      <div class="label">topic</div><div>${escapeHtml(m.topic)}</div>
      <div class="label">secret</div><div class="secret">${escapeHtml(m.secret)}</div>
      <div class="label">winner</div><div class="${winClass}">${winLabel} &middot; ${m.reason}</div>
      <div class="label">turns</div><div>${m.turns}/${m.maxTurns} &middot; ${(m.durationMs / 1000).toFixed(1)}s</div>
      ${renderJudgeRow(m)}
    </div>
    <div class="transcript">${turns}</div>
  `;
  // visually mark active in list
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

refreshAll();
setInterval(refreshAll, 5000);

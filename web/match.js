import { avatarSvg } from "/avatar.js";

const root = document.getElementById("match-root");
const statusPill = document.getElementById("status-pill");

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

function fmtTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const reasonLabels = {
  held_the_line: "held the line",
  secret_leaked: "leaked",
  attacker_error: "attacker error",
  defender_error: "defender error",
};

async function fetchRatingsById() {
  try {
    const res = await fetch("/api/leaderboard");
    if (!res.ok) return new Map();
    const arr = await res.json();
    return new Map(arr.map((r) => [r.agentId, r]));
  } catch {
    return new Map();
  }
}

function renderHead(m, ratingsById, isLive) {
  const atkAgentId = m.attacker.id ?? m.attacker;
  const defAgentId = m.defender.id ?? m.defender;
  const atkLabel = m.attacker.label ?? m.attacker;
  const defLabel = m.defender.label ?? m.defender;
  const atkR = ratingsById.get(atkAgentId);
  const defR = ratingsById.get(defAgentId);
  const winLabel =
    m.winner === "attacker"
      ? `<div class="match-outcome win-atk">attacker won · ${reasonLabels[m.reason] || m.reason}</div>`
      : m.winner === "defender"
      ? `<div class="match-outcome win-def">defender held · ${reasonLabels[m.reason] || m.reason}</div>`
      : isLive
      ? `<div class="match-outcome live">live</div>`
      : "";
  const topic = m.topic && m.topic !== "(pending)" ? m.topic : "match in progress";
  const secret = m.secret && m.secret !== "[REDACTED]"
    ? `<span class="secret">${escapeHtml(m.secret)}</span>`
    : `<span class="secret-redacted">[redacted]</span>`;
  const cost = m.usage?.totalCostUsd ?? 0;
  const profileHref = (id) => `/agent.html?id=${encodeURIComponent(id)}`;
  return `
    <section class="combatants">
      <div class="fighter atk">
        <div class="fighter-avatar">${avatarSvg(atkLabel, { size: 72, rounded: false })}</div>
        <div class="fighter-info">
          <div class="fighter-role">attacker</div>
          <div class="fighter-name"><a href="${profileHref(atkAgentId)}">${escapeHtml(atkLabel)}</a></div>
          ${atkR ? `<div class="fighter-elo">ELO ${atkR.rating} · ${atkR.wins}-${atkR.losses}</div>` : ""}
        </div>
      </div>
      <div class="match-center">
        <div class="match-vs-icon">VS</div>
        <div class="match-turns">${m.turns ?? 0}<span style="color:var(--fg-muted);font-size:20px">/${m.maxTurns ?? 6}</span></div>
        <div class="match-turns-label">turns</div>
        ${winLabel}
      </div>
      <div class="fighter def">
        <div class="fighter-avatar">${avatarSvg(defLabel, { size: 72, rounded: false })}</div>
        <div class="fighter-info">
          <div class="fighter-role">defender</div>
          <div class="fighter-name"><a href="${profileHref(defAgentId)}">${escapeHtml(defLabel)}</a></div>
          ${defR ? `<div class="fighter-elo">ELO ${defR.rating} · ${defR.wins}-${defR.losses}</div>` : ""}
        </div>
      </div>
    </section>
    <section class="match-meta-row">
      <span class="match-meta-item">topic: <strong>${escapeHtml(topic)}</strong></span>
      <span class="match-meta-item">secret: ${secret}</span>
      ${m.durationMs ? `<span class="match-meta-item">duration: <strong>${(m.durationMs / 1000).toFixed(1)}s</strong></span>` : ""}
      ${cost ? `<span class="match-meta-item">cost: <strong style="color:var(--gold)">${fmtUsd(cost)}</strong></span>` : ""}
    </section>`;
}

function bubbleHtml(turn, idx) {
  const role = turn.role || (idx % 2 === 0 ? "attacker" : "defender");
  const cls = role === "attacker" ? "atk" : "def";
  const isErr = /^\[error:/.test(turn.content || "");
  return `<div class="bubble ${cls} ${isErr ? "error" : ""}">
    <div class="bubble-head">
      <span>${role}</span>
      <span class="turn-num">turn ${turn.turn ?? idx + 1}</span>
      <span class="turn-time">${turn.ts ? fmtTime(turn.ts) : ""}</span>
    </div>
    <div class="bubble-content">${escapeHtml(turn.content || "")}</div>
  </div>`;
}

function renderTranscript(transcript) {
  if (!transcript || transcript.length === 0) {
    return `<section class="transcript-section">
      <h2>Transcript</h2>
      <div class="match-loading">no turns yet — waiting for the first message…</div>
    </section>`;
  }
  return `<section class="transcript-section">
    <h2>Transcript (${transcript.length} turns)</h2>
    <div class="transcript" id="transcript">
      ${transcript.map((t, i) => bubbleHtml(t, i)).join("")}
    </div>
  </section>`;
}

function renderVerdict(m) {
  if (!m.judgeVerdict) return "";
  const v = m.judgeVerdict;
  const pillClass = v.leaked ? "judge-leak" : "judge-clean";
  const pillText = v.leaked ? "LEAK detected" : "no leak";
  return `<div class="verdict">
    <h3>Judge verdict</h3>
    <div class="verdict-summary">
      <strong>${v.leaked ? "Defender leaked" : "Defender held the line"}.</strong>
      ${v.evidence ? `Evidence: <em>${escapeHtml(v.evidence)}</em>` : ""}
      ${v.note ? `<div style="color:var(--warn);margin-top:6px;font-size:12px">${escapeHtml(v.note)}</div>` : ""}
    </div>
    <div class="verdict-pills">
      <span class="${pillClass}">${pillText}</span>
      <span class="finished-badge">${escapeHtml(v.stage)}</span>
      ${m.leakDetector && m.leakDetector !== "none" ? `<span class="finished-badge">via ${escapeHtml(m.leakDetector)}</span>` : ""}
      ${v.model ? `<span class="finished-badge">${escapeHtml(v.model)}</span>` : ""}
    </div>
  </div>`;
}

function setStatus(text, klass) {
  statusPill.textContent = text;
  statusPill.className = klass;
}

let ratingsByIdCache = null;

function renderMafiaHead(m) {
  const participants = m.participants ?? [];
  const finished = !!m.endedAt;
  const teamWinner = m.teamWinner ?? (m.winner === "attacker" ? "werewolves" : "villagers");
  const winnerLabel = teamWinner === "werewolves" ? "WEREWOLVES WIN" : "VILLAGERS WIN";
  const reasonLabel = {
    werewolves_uncovered: "all werewolves uncovered",
    werewolves_overran: "werewolves reached parity",
    attacker_error: "agent error",
    defender_error: "agent error",
  }[m.reason] || m.reason;
  const grid = participants
    .map((p) => {
      const dead = p.eliminated;
      const showRole = finished;
      const roleTag = showRole
        ? `<div class="mafia-role mafia-role-${p.role}">${p.role}</div>`
        : `<div class="mafia-role mafia-role-hidden">role hidden</div>`;
      return `<a class="mafia-participant ${dead ? "eliminated" : ""}" href="/agent.html?id=${encodeURIComponent(p.id)}">
        <div class="mafia-avatar">${avatarSvg(p.label, { size: 56, rounded: false })}</div>
        <div class="mafia-info">
          <div class="mafia-name">${escapeHtml(p.label)}</div>
          ${roleTag}
          ${dead ? `<div class="mafia-elim">eliminated R${p.eliminationRound}</div>` : finished ? `<div class="mafia-survived">survived</div>` : ""}
        </div>
      </a>`;
    })
    .join("");
  const cost = m.usage?.totalCostUsd ?? 0;
  return `
    <section class="mafia-head">
      <div class="mafia-banner">
        <div class="mafia-topic">${escapeHtml(m.topic)}</div>
        <div class="mafia-winner ${teamWinner}">
          <span class="mafia-winner-label">${winnerLabel}</span>
          <span class="mafia-winner-reason">${reasonLabel}</span>
        </div>
      </div>
      <div class="mafia-roster">${grid}</div>
      <div class="mafia-meta">
        ${m.durationMs ? `<span>duration: <strong>${(m.durationMs / 1000).toFixed(1)}s</strong></span>` : ""}
        ${cost ? `<span>cost: <strong style="color:var(--gold)">${fmtUsd(cost)}</strong></span>` : ""}
        <span>turns: <strong>${m.turns ?? 0}</strong></span>
      </div>
    </section>`;
}

function renderMafiaTranscript(transcript) {
  if (!transcript || transcript.length === 0) {
    return `<section class="transcript-section">
      <h2>Transcript</h2>
      <div class="match-loading">no turns yet — waiting…</div>
    </section>`;
  }
  // Group entries by round. Entries are tagged "[label · round N · discussion]"
  // or "[round N result] ...". Parse the round number out.
  const groups = new Map();
  for (const t of transcript) {
    const m = (t.content || "").match(/round (\d+)/i);
    const round = m ? Number(m[1]) : 0;
    if (!groups.has(round)) groups.set(round, []);
    groups.get(round).push(t);
  }
  const blocks = [];
  for (const [round, entries] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const items = entries
      .map((t) => {
        const isVerdict = /^\[round \d+ result\]/.test(t.content || "");
        const isError = /\bERROR\]/.test(t.content || "");
        const headerMatch = (t.content || "").match(/^\[([^\]]+)\]\s*(.*)$/s);
        const head = headerMatch ? headerMatch[1] : "";
        const body = headerMatch ? headerMatch[2] : t.content;
        const cls = isError
          ? "mafia-msg error"
          : isVerdict
          ? "mafia-msg verdict"
          : t.role === "attacker"
          ? "mafia-msg wolf"
          : "mafia-msg vill";
        return `<div class="${cls}">
          <div class="mafia-msg-head">${escapeHtml(head)}</div>
          <div class="mafia-msg-body">${escapeHtml(body)}</div>
        </div>`;
      })
      .join("");
    blocks.push(`<div class="mafia-round">
      <div class="mafia-round-head">Round ${round || "—"}</div>
      ${items}
    </div>`);
  }
  return `<section class="transcript-section">
    <h2>Transcript (${transcript.length} entries)</h2>
    <div class="mafia-transcript">${blocks.join("")}</div>
  </section>`;
}

async function renderFull(m) {
  if (!ratingsByIdCache) ratingsByIdCache = await fetchRatingsById();
  const isLive = !m.endedAt;
  setStatus(isLive ? "live" : "finished", isLive ? "live" : "finished");
  if (m.game === "mafia-claw") {
    root.innerHTML = renderMafiaHead(m) + renderMafiaTranscript(m.transcript);
    return;
  }
  root.innerHTML =
    renderHead(m, ratingsByIdCache, isLive) +
    renderTranscript(m.transcript) +
    renderVerdict(m);
}

async function subscribeLive(matchId) {
  const es = new EventSource(`/api/matches/${encodeURIComponent(matchId)}/stream`);
  const transcript = [];
  let head = {
    id: matchId,
    attacker: { id: "(unknown)", label: "(unknown)" },
    defender: { id: "(unknown)", label: "(unknown)" },
    topic: "(pending)",
    secret: "[REDACTED]",
    turns: 0,
    maxTurns: 6,
    transcript,
  };
  // initial render
  renderFull(head);

  es.addEventListener("started", (ev) => {
    const data = JSON.parse(ev.data);
    head = {
      ...head,
      attacker: { id: data.attacker, label: data.attacker },
      defender: { id: data.defender, label: data.defender },
      topic: data.topic,
      maxTurns: data.maxTurns,
    };
    renderFull(head);
  });

  es.addEventListener("turn", (ev) => {
    const data = JSON.parse(ev.data);
    if (data.entry) {
      transcript.push(data.entry);
      head.turns = data.entry.turn ?? transcript.length;
      renderFull(head);
    }
  });

  es.addEventListener("finished", (ev) => {
    const data = JSON.parse(ev.data);
    if (data.result) {
      es.close();
      renderFull(data.result);
    }
  });

  es.addEventListener("error", () => {
    // SSE auto-reconnects; if it errors after finish, just close silently
  });
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const matchId = params.get("id");
  if (!matchId) {
    root.innerHTML = `<div class="match-loading">missing ?id= parameter</div>`;
    return;
  }
  // Try to load the persisted match record first.
  try {
    const adminToken = localStorage.getItem("clawpit_admin_token") || "";
    const reveal = adminToken ? "?reveal=1" : "";
    const headers = adminToken ? { "x-clawpit-admin-token": adminToken } : {};
    const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}${reveal}`, { headers });
    if (res.ok) {
      const m = await res.json();
      await renderFull(m);
      if (!m.endedAt) subscribeLive(matchId); // still running — stream further turns
      return;
    }
    if (res.status === 404) {
      // No persisted record yet — assume it's live and subscribe.
      subscribeLive(matchId);
      return;
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    root.innerHTML = `<div class="match-loading">failed to load match: ${escapeHtml(err.message)}</div>`;
  }
}

main();

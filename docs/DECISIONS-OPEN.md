# Open product decisions — clawpit

> **Decisions resolved 2026-05-08 (Sanjar):**
> - **D1 = A** (skip NegotiateClaw; do cost-adjusted leaderboard + SSE streaming for v0.2 instead).
> - **Zero-cost-first principle** (new, not previously listed): the project should be runnable to a meaningful extent without an API key budget. Decoder judge is now default; LLM judge is opt-in. This principle should govern future judge / scoring decisions until clawpit is shown to be popular enough to justify a paid tier.

---

These are blockers for further work that I (CEO mode, autonomous session) am not authorized to decide solo. Each item explains why the decision matters, the options I'd recommend, and what I'd default to if pushed for an answer in the next 24h.

---

## D1. NegotiateClaw vs DebateClaw vs neither for v0.2

**Why this matters:** Phase A goals 1-3 closed today. Phase A goal 4 (a second game) is the only remaining substance gap before launch readiness. The handoff said "either NegotiateClaw or DebateClaw works."

**Architectural note I uncovered while planning it:** the current `MatchResult` and `Rating` shape is hard-coded to attacker/defender asymmetry — `asAttackerWins`, `asDefenderWins`, etc. NegotiateClaw is symmetric (both agents are negotiators). Adding it cleanly requires either:
- (a) Generalizing `Rating` to track per-game-per-role stats (bigger refactor), or
- (b) Mapping NegotiateClaw's roles onto attacker/defender (clean enough — first-mover = attacker, responder = defender), at the cost of a minor semantic stretch.

**Options:**
- **(A) Skip the second game for v0.2 launch.** Land cost-adjusted leaderboard view + live match streaming (SSE) instead. Faster to ship; "platform claim is one-game-only" is honest in launch copy.
- **(B) NegotiateClaw with role-mapping (option b above).** ~1 day of work. Symmetric game in disguise. Cleanest scoring (numerical payoff).
- **(C) DebateClaw.** Reuses the existing judge. ~2 days because judging debates is harder than judging leaks. More spectator-friendly.

**Default if forced:** (A). The cost-adjusted leaderboard is the headline marketing claim; an under-baked second game would dilute the launch story. NegotiateClaw is post-v0.2.

---

## D2. License

**Why this matters:** No LICENSE file. HN, GitHub Trending, and downstream re-distribution all assume MIT/Apache. Without one the legal default is "all rights reserved" — meaning nobody can fork.

**Options:**
- **MIT** — maximally permissive, what most agent-tooling repos use.
- **Apache-2.0** — permissive + explicit patent grant; matters if you later commercialize.
- **AGPL-3.0** — copyleft; would deter the hosted-service-fork-by-a-cloud-vendor failure mode but also deter contributors.

**Default if forced:** MIT. Switch to Apache-2.0 if commercial intent crystallizes.

---

## D3. Domain + hosting

**Why this matters:** A Show HN that links to `localhost:4242` does not exist. Public hosting requires a domain.

**Options for domain:**
- `clawpit.dev` (developer-y, may be taken — verify before launch)
- `clawpit.ai` (taxes ~$70/yr, .ai is the obvious choice for AI tooling in 2026)
- `clawpit.gg` (gaming connotation; fits the arena framing)

**Options for hosting:**
- **Vercel + a small Postgres / Turso for matches.** Easiest. Free tier handles a Show HN spike if data is JSON-on-disk in a Vercel function — but Vercel KV or Turso is the right move once writes go concurrent.
- **Fly.io + LiteFS (SQLite replication).** Better fit for this app's "JSON storage migrating to SQLite" trajectory. Slightly more ops.
- **Cloudflare Workers + D1.** Cheapest at scale. Rewriting to D1 from JSON-on-disk is more friction than the next two.

**Default if forced:** `clawpit.dev` if available, otherwise `clawpit.ai`. Fly.io with SQLite (kept on disk, no replication yet) for hosting. The point is to ship — re-platform later.

---

## D4. Public submission protocol — when

**Why this matters:** The handoff explicitly said "don't open submissions before sandboxing." A public POST endpoint that runs arbitrary submitted agents is an RCE if the sandbox leaks.

**Options:**
- **(A) Closed submissions through v0.2.** All agents are local TS modules; we add new providers ourselves. Honest about the limitation.
- **(B) Open submissions in v0.3 with Modal / Fly Machines as the sandbox.** Designs a submission contract (Docker image + `POST /respond`).

**Default if forced:** (A) for v0.2. Submission protocol is v0.3 minimum.

---

## D5. Should Phase A wrap up include cost-adjusted leaderboard view or defer?

**Why this matters:** The handoff explicitly called out cost-adjusted ELO as "the single most valuable metric to add next." We have per-match cost; computing `rating - λ × spent` is an afternoon's work. But it adds a tunable knob (`λ`) that's hard to defend without a strong rationale.

**Default if forced:** Add it. Set `λ = 100` so $1 spent = -100 ELO, which makes Haiku-class defenders look very good (which is the right framing) and Opus-class attackers look very expensive (which is also true). Provide both views in the UI; default to unadjusted.

---

# How to act on these

Reply with the picks (e.g. "D1=A, D2=MIT, D3=clawpit.dev + Fly, D4=A, D5=add"), or just resolve the ones you have a strong opinion on and I'll proceed with the defaults on the rest.

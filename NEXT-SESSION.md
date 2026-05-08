# clawpit — handoff for next session

Self-contained context. The previous session built v0.1; this doc tells you what exists, what doesn't, and what to work on next. Read it top-to-bottom before touching any code.

---

## What clawpit is

Adversarial contest platform for AI agents. v0.1 ships one game — **SecretClaw**, a prompt-injection arena where an attacker agent has N turns (default 6) to extract a secret string from a defender agent. Matches feed an ELO leaderboard with separate W-L tracking for attacker vs defender roles.

The thesis (decided in v0.1, don't relitigate): agent-vs-agent **adversarial** is more defensible than static benchmarks because it can't be saturated — every new model entrant plays the existing field, and one model's strength is two numbers (attacker rating, defender rating), not one. Prompt injection specifically is timely, has a clean win condition (did the secret string appear in the defender's output?), and produces shareable transcripts.

## Where it lives

```
/Users/sanjar/dev/openclaw/clawpit/
```

Stack: Node 25 + TypeScript via `tsx` (no build step), pnpm 10.9, ESM, JSON storage (`data/matches.json`, `data/ratings.json`), plain `http` server, vanilla HTML+JS+CSS UI. Anthropic SDK for the real-LLM agent provider.

## How to run it

```bash
cd /Users/sanjar/dev/openclaw/clawpit
pnpm install              # if not done
pnpm demo                 # offline scripted match, no API key
pnpm serve                # dashboard at http://localhost:4242
pnpm match --attacker claude-opus-4-7 --defender claude-haiku-4-5-20251001  # needs ANTHROPIC_API_KEY
pnpm tournament --agents claude-opus-4-7,claude-sonnet-4-6,claude-haiku-4-5-20251001
```

The preview launcher is registered in `/Users/sanjar/.openclaw/.claude/launch.json` under name `clawpit`.

## Code layout (everything is small — read it, don't guess)

```
src/
  types.ts                 Agent, MatchResult, Rating, ChatTurn, WinReason
  elo.ts                   K=32, default rating 1200
  storage.ts               readJson/writeJson + recordMatch (updates ELO + role stats)
  arena.ts                 runMatch (single match) + runTournament (round-robin both roles)
  games/
    secret-claw.ts         orchestrates one match: attacker → defender loop, leak check
  agents/
    anthropic.ts           Claude provider, pulls ANTHROPIC_API_KEY at first call
    mock.ts                scripted attacker (cycles attack vectors), scripted defender (refuses, leaks at ~18% per turn)
    registry.ts            spec → Agent (mock:atk:* / mock:def:* / anthropic:* / claude-* shorthand)
  cli/
    index.ts               match | tournament | leaderboard | serve | demo
    format.ts              ANSI pretty-printers for terminal
  server.ts                /api/health, /api/leaderboard, /api/matches, /api/matches/:id + static web/
web/
  index.html, style.css, app.js   3-column dashboard, polls /api/* every 5s
data/
  matches.json, ratings.json      runtime state, gitignored
```

## Honest review of v0.1

**Strengths**
- Engine is correct. Each agent maintains its own `user`/`assistant` history; opponent's turn arrives as the next `user` message. ELO updates per match; role split is real.
- Mock agents make the demo run with no API key, so the architecture is testable end-to-end without spending money.
- CLI + web UI + JSON API all share the same storage; no separate read paths to drift.
- Layout is clean: 200-400 lines per file, no premature abstractions.

**Real weaknesses, in priority order**

1. **Leak detection is too weak.** `containsSecret()` in `src/games/secret-claw.ts` strips whitespace and punctuation, then substring-checks. A defender that emits the secret in base64, ROT13, morse, an acrostic, or split across multiple replies will incorrectly "win." This is the single biggest credibility risk before any public launch — once smart attackers find this, the leaderboard becomes meaningless.
2. **No cost tracking.** The most useful comparison ("Haiku beats Opus per dollar at defending") is impossible. The Anthropic SDK returns `usage.input_tokens` / `output_tokens`; we throw it away.
3. **Secrets are public.** The web UI and `/api/matches/:id` expose the secret string of every match. Fine for local; bad for any public deployment because new attackers can read past secrets.
4. **One game.** Single skill axis. The platform claim is weak with one mode.
5. **No agent submission protocol.** External teams can't enter — agents are local TS modules.
6. **No streaming.** Matches block until done; web UI doesn't show turns as they happen.

These are the gaps to close before talking publicly. Note that none of them are architectural — the engine doesn't need to be rewritten. Each gap is a bounded, well-scoped task.

## Launch readiness — verdict

**Not yet.** v0.1 is a proof-of-concept, not a launch-ready product. The SUBSTANCE problems above (especially #1 and #3) matter more than distribution. Posting to X/HN with weak leak detection invites someone to demonstrate a base64-leak-defender that "tops the leaderboard," which kills the project's credibility on day one.

**Suggested phasing**

- **Phase A — Substance (1 week):** close gaps 1, 2, 3. Land an LLM judge for fuzzy leak detection. Track tokens + cost per match. Redact the secret from `/api/matches/:id` (keep it server-only or hash it, surface a "secret leaked? yes/no" only). Add one second game (NegotiateClaw or DebateClaw) to make "platform" credible.
- **Phase B — Headline tournament (2 days):** run a round-robin across Opus 4.7 / Sonnet 4.6 / Haiku 4.5 / GPT-5 / Gemini 2.5 Pro (whatever's accessible), each as both roles, ~10 matches per pairing for ELO stability. Capture screenshots, transcripts, surprising moments.
- **Phase C — Soft launch (1 day):** Show HN + X thread + r/LocalLLaMA. Hook: "I made the top frontier models fight each other in a prompt-injection arena. Here's the leaderboard." No user submissions yet — just the dashboard + writeup. Repo is public.
- **Phase D — Open submissions (later, only if Phase C lands):** Docker container submission protocol, sandboxed runner (Modal / Fly Machines / gVisor), abuse mitigation, optional prize pool.

**Distribution channels (when Phase C is ready)**

- **Show HN** — submit Tuesday/Wednesday 9-10am ET. Title: `Show HN: clawpit – LLMs fighting LLMs in a prompt-injection arena`.
- **X/Twitter** — thread with the leaderboard image, 2-3 transcript screenshots showing the most surprising attacks/refusals, link last. Tag @AnthropicAI in a reply, not the OP.
- **r/LocalLLaMA** — same content, longer-form post, expect technical scrutiny in comments (this is good).
- **Latent Space Discord, Anthropic Discord** — drop the link in #show-and-tell channels.
- **Direct email** — METR, HAL leaderboard maintainers (Princeton), Vals AI. They cover this beat and may signal-boost.

**Don't do**

- Don't pay for ads or seek prize sponsorship before Phase C lands. Organic signal is cheap; bought signal is noise.
- Don't promise "the definitive AI safety benchmark" — overclaim. It's "an adversarial leaderboard," nothing more.
- Don't open submissions before sandboxing. A public submission endpoint with a bad sandbox is a free RCE for anyone who registers.

## Concrete next-session goals (Phase A, in this order)

1. **LLM judge for leak detection.** Add `src/games/judge.ts` exposing `judgeLeak(transcript, secret) -> { leaked: boolean, evidence: string }`. Use Claude Haiku for cost. Call it after every defender turn (and once at end-of-match). Replace the substring-only check; keep substring as a fast-path "definitely leaked" signal, fall back to judge for uncertain cases. Persist the judge's verdict + evidence in the match record. Add a `judgeProvider` option to `runMatch` so it's swappable.
2. **Cost tracking.** Extend `Agent.call()` to return `{ text, usage: { inputTokens, outputTokens, costUsd } }`. Update the Anthropic provider to compute cost from the model's published rate (hardcode a small table; document it). Sum per match, store on `MatchResult`. Add a `cost-adjusted` view to the leaderboard: `rating - λ × totalCost`, with `λ` tunable.
3. **Secret redaction in public API.** `/api/matches/:id` should return the secret only if a `?reveal=1` query param is set AND a `CLAWPIT_ADMIN_TOKEN` header matches. Default response: `secret: "[redacted]"`, plus a boolean `leaked` from the judge. Update the web UI to show "REDACTED" instead of the literal secret unless an admin token is in localStorage.
4. **Second game (pick one):**
   - **NegotiateClaw** — two agents split a fixed pot via ultimatum / multi-round bargaining, scored on payoff. Clean numerical outcome. Easy to add.
   - **DebateClaw** — two agents argue opposite sides of a claim; a judge LLM picks the winner. Reuses the judge from item 1. Subjective but spectator-friendly.
   - Either works. NegotiateClaw is cheaper and more objective.

When all four are done, run a 3-model round-robin (Phase B), capture artifacts, and only then move to Phase C. Don't skip.

## Open product decisions (pending Sanjar's input — don't decide solo)

- **Naming.** Do we keep `clawpit` or rename? `clawpit` is fine but unclaimed; `picoclaw` was mentioned as an existing thing in v0.1 — confirm there's no conflict before public launch.
- **Domain.** Will Sanjar register `clawpit.dev` / `clawpit.ai` for Phase C? Needed before HN post.
- **License.** MIT? Apache-2? Currently nothing; HN expects an LICENSE file.
- **Hosting target for Phase D.** Modal, Fly Machines, Cloudflare Containers, or self-hosted? Affects the submission protocol design — don't write the protocol until this is decided.

## Things to NOT do in the next session

- Don't migrate to a "real" framework (Next.js, Hono, Express). The current shape is fine and the build is faster without one.
- Don't add SQLite yet. JSON works through Phase B. Migrate when match volume crosses ~1k or concurrent writes become real.
- Don't add auth before Phase D. There's nothing to protect yet.
- Don't add tests for things that aren't broken. Add tests when the judge lands (high-stakes correctness) and when ELO logic gets touched again — not for the mock agents.

## How to start the next session

Open a new Claude Code session in `/Users/sanjar/dev/openclaw/clawpit` and paste:

> Read `NEXT-SESSION.md`, then start on Phase A goal 1 (LLM judge for leak detection). Skip Phase B/C/D for now — just close the substance gaps. Don't decide on naming, domain, or hosting without me.

That's it. The codebase is small enough that you'll absorb it in 5 minutes after reading this file.

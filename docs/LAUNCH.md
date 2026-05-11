# Launch playbook — clawpit

**Status:** drafts only. Nothing here is published yet. Do not post until the gates in §0 are green.

---

## §0 Pre-launch gates (block on these)

- [x] Phase A goals 1, 2, 3 closed (judge, cost tracking, redaction). **Done 2026-05-08.**
- [x] LICENSE file landed (MIT, 2026-05-09).
- [x] Secret pool expanded from 6 → 60+ entries across diverse topics (2026-05-11). Closes the "you only have 6 hardcoded strings" critique. See `src/games/secret-claw.ts`.
- [x] Tournament 1 recorded (Opus / Sonnet / Haiku, N=1 per pairing): see [TOURNAMENT-1.md](TOURNAMENT-1.md). 6/6 defender wins, $0.87 USD-equivalent, 8.2 min wall time.
- [x] `judge-eval` (decoder) at >= 90% accuracy. **Currently 91.7% (11/12, 100% precision, 87.5% recall)**. The one known fail is the inference-only "narrowing confirmation" case; an LLM judge run via `--judge claude:...` should catch it.
- [x] GitHub repo public at https://github.com/sanjarbarakayev/clawpit (2026-05-11). Pre-flight: git history scanned, no API keys / tokens in any commit; `.env*` and `data/*.json` are gitignored.
- [ ] Second game (NegotiateClaw) live, OR explicitly accept "platform claim is one-game-only" in launch copy. *Decision pending — recommend accept and ship; second game is a Phase D follow-up.*
- [ ] Tournament 2 (N=5 per pairing) for ELO stability before launch. Run via `pnpm tournament --agents cc:claude-opus-4-7,cc:claude-sonnet-4-6,cc:claude-haiku-4-5-20251001 --turns 6` five times (cc: provider absorbs cost into Claude Max).
- [ ] Public hosting up at a real domain. Local-only is a deal-breaker for a Show HN. `render.yaml` is ready — Render Blueprint deploy needs `ANTHROPIC_API_KEY` + `CLAWPIT_ADMIN_TOKEN` set in dashboard.
- [ ] `CLAWPIT_ADMIN_TOKEN` set in production and rotated from any value used in dev/staging. Generate: `openssl rand -hex 32`.
- [ ] Two screenshots ready: leaderboard, plus one transcript showing a surprising attack (base64 leak caught by judge, or a clever defender refusal).

If any gate is red, push the launch. The downside of launching weak (a debunking comment on day one) outweighs the upside of being early.

---

## §1 Headline framing

Position the launch around the **honest benchmark** angle. The viral story in 2026 is that static benchmarks are gameable — Berkeley researchers showed an agent acing eight major leaderboards by exploiting them. clawpit is structurally different: the win condition is "did this exact string appear in the defender's output," judged by a fast LLM and verified at end-of-match. There is no test set to memorize.

**Headline (do not lock until launch day, A/B these — first option is the strongest after Tournament 1 results):**

- *Show HN: I ran 6 prompt-injection matches between Claude Opus, Sonnet and Haiku. Defender held the line every time.* — anchored in [docs/TOURNAMENT-1.md](TOURNAMENT-1.md)
- *Show HN: clawpit — an adversarial AI agent arena. The first 6-match Claude-only round-robin produced 0 leaks.*
- *Show HN: I made Claude fight Claude. Sonnet and Opus engage as attackers. Haiku refuses. Nobody breaks anyone's secret.*

**Subhead (one sentence):**

> Every model plays every other model in both roles. A deterministic decoder battery catches encoded and split leaks at zero cost; an LLM judge is opt-in for paraphrase / inference. Cost per match is tracked so cheap defenders that hold the line rank as well as expensive ones.

**Why it's affordable to run.** The default judge is a code-only decoder (base64, hex, ROT-N, NATO, leet, acrostic, etc.) — no API calls, no spend. A full round-robin of 100 matches across frontier models costs only the per-turn agent calls themselves. This matters for the launch story: anyone can clone the repo and run a tournament without a budget, which is the difference between a credible benchmark and a press-release benchmark.

**What NOT to claim:**

- Don't say "definitive AI safety benchmark." It isn't. It's an adversarial leaderboard for one specific skill (prompt-injection resistance + extraction).
- Don't promise model rankings will be stable. ELO with K=32 swings; lean into that.
- Don't tag @AnthropicAI or any vendor in the OP. Tagging in a reply is fine.

---

## §2 Channel order — 48-hour window

Concentrate distribution into a single 48-hour window. Star velocity triggers GitHub Trending, and once you're on Trending, GitHub does the rest of the marketing.

**T-24h (day before):**
- Push final commits, tag `v0.2.0` (or whatever the launch version is). Verify deploy.
- Pre-warm: drop in private Discords (Latent Space, Anthropic if you're in it) with "launching tomorrow, low-key heads up." Two friends who'll click the HN upvote button at minute zero is worth more than 200 cold tweets.
- Schedule the Show HN draft (do NOT submit overnight — peak HN window is Tue/Wed 9-10 ET).

**T-0 (launch morning):**
1. **Show HN** — Tue or Wed 09:00-10:00 ET. Title from §1. Body: 2 short paragraphs, link to GitHub, link to live demo. **Don't link both leaderboard and repo from the headline; pick one** — repo wins if the goal is stars, leaderboard wins if the goal is signups.
2. **X/Twitter thread** — fire 60 minutes after HN posts. Lead with leaderboard image. 2 transcript screenshots (one base64-leak-caught, one stoic-defender-holds). Last tweet links the Show HN comments.
3. **r/LocalLLaMA** — same day, longer-form, 2-3 hours after HN. The crowd here will scrutinize methodology — that's good. Pre-write replies for the obvious skeptical questions (see §4).

**T+24h:**
- **Latent Space + Anthropic Discords** — `#show-and-tell` channels with a one-line "we did this, here's the thread."
- **Direct email** — METR, HAL leaderboard maintainers (Princeton), Vals AI. Three sentences max: what it is, why it's different, where to find it. Not a press release.

**Don't do day-one:** Product Hunt (their crowd doesn't care about agents enough to move the needle). Save it for v0.2 when there's a UX story.

---

## §3 Distribution boilerplate (paste-ready)

### Show HN body (draft, anchored in Tournament 1 data)

```
Show HN: clawpit — I ran 6 prompt-injection matches between Claude Opus,
Sonnet and Haiku. Defender held the line every time.

clawpit is an adversarial contest platform for AI agents. The first
game, SecretClaw, gives an attacker agent 6 turns to extract a fixed
secret string from a defender agent. ELO ratings are tracked separately
for each role — a model's "strength" is two numbers, not one.

Tournament 1 results (round-robin, 3 models, 6 matches, 8 minutes):

  - Defender held the line in 6/6 matches. No model leaked another's
    secret in this 6-turn format.
  - Sonnet 4.6 took the cost-adjusted #1 slot ($0.08 spent across 4
    matches; Opus spent $0.68 for the same record).
  - Haiku 4.5 refused the attacker role 50–100% of the time.
    Sonnet and Opus engaged with social-engineering vectors
    (fake authority, story-completion, restriction enumeration).
  - Total tournament cost: $0.87 USD-equivalent. Free if you run it
    through your Claude Max subscription via the included `cc:` provider.

What I think is interesting:
  - Static benchmarks saturate; this one can't. Every new model entrant
    plays the existing field as both attacker and defender.
  - The default judge is a code-only decoder battery (base64 / ROT-N /
    NATO / acrostic / hex / leet etc.) — zero LLM calls, 100% precision
    on the 12-case eval suite. Tournaments are reproducible without
    needing an API budget.
  - Cost per match is tracked, so the leaderboard has a "ELO/$" view
    that surfaces strength-per-dollar — the actually-useful comparison.

The 100% defender hold across all 6 matches is itself a finding worth
discussing: in this 6-turn, same-vendor format, none of the three
models has an intra-family adversarial advantage. Cross-vendor matches
(adding a non-Claude attacker) are the obvious follow-up.

Code: https://github.com/sanjarbarakayev/clawpit
Tournament data: https://github.com/sanjarbarakayev/clawpit/tree/main/docs/tournament-1-data
Methodology + caveats: https://github.com/sanjarbarakayev/clawpit/blob/main/docs/TOURNAMENT-1.md
Live leaderboard: TBD (Fly.io deploy pending)

I'd particularly love feedback on:
  - the decoder judge battery (src/games/decoder-judge.ts) — what
    encoded leaks would slip through?
  - the attacker system prompt (src/games/secret-claw.ts) — could a
    different framing get Haiku to engage as attacker?
  - whether the 6-turn limit is the right knob.
```

### X thread (5 posts)

1. Image: leaderboard screenshot. Caption: "I made <Models> prompt-inject each other for ELO. Here's the leaderboard." (No link.)
2. Image: transcript of a surprising attack. Caption: "The attacker asked for ROT13. The defender complied. Judge caught it." (Or whichever attack is most photogenic.)
3. "Why two ratings per agent? A model can be a strong attacker but a weak defender. The leaderboard shows that asymmetry directly. Cost per match is tracked separately so cheap-but-stoic defenders aren't penalized."
4. "Code, methodology, and the judge prompt are open: <repo>. Eval suite + reproducible tournament command in the README."
5. Link to the Show HN comment thread. End.

### r/LocalLLaMA post

Same body as Show HN but expand the methodology section: explain the substring + judge two-layer detection, link to `judge-eval`, and end with "I expect this to be torn apart in the comments — that's the point."

---

## §4 Pre-written replies

The skeptical comments will rhyme. Drafts:

- **"What stops a defender from outputting the secret in some encoding the judge doesn't know?"**
  > That's the active failure mode. The judge prompt enumerates known encodings (base64, ROT13, NATO, etc.) and the eval suite covers them. A novel encoding the judge misses IS a leak we'd score as held-the-line — so the leaderboard would be wrong on that match. We treat any judge-eval regression as a credibility bug. PRs welcome.

- **"Why Claude as judge? Bias toward Claude defenders."**
  > Default judge is the **code-only decoder battery** — no LLM in the loop, no model-family bias. The LLM judge is opt-in via `--judge claude:<model-id>` for the small set of inference-only leaks the decoder structurally can't catch. When we DO run with the LLM judge, swap-judge sanity checks are part of the methodology (Sonnet vs GPT-5 vs Gemini disagreement → flagged for human review).

- **"Six turns is too few / too many."**
  > It's a knob (`--turns N`). 6 was chosen so a tournament fits in single-digit dollars. Changing it changes the meta — long-horizon attackers benefit from more turns; quick-jab defenders care less.

- **"You're just measuring how good models are at refusal."**
  > Partly true. The defender side measures refusal robustness against an active attacker; the attacker side measures social-engineering / injection skill. Two separate ratings precisely because those skills don't correlate.

- **"Where's GPT-5? Where's Gemini?"**
  > Adapter-shaped — `src/agents/anthropic.ts` is the template. PRs accepted; vendor account credits not required for review.

---

## §5 Anti-patterns

- **No paid ads.** Organic signal is cheap; bought signal is noise that ruins the data later when you try to measure organic conversion.
- **No prize pool / sponsorship before submissions are sandboxed.** A public submission endpoint with a bad sandbox is a free RCE for anyone who registers.
- **No vendor co-marketing.** Tagging Anthropic in a reply is fine; coordinating a launch with them costs you the "honest benchmark" framing.
- **No begging for stars.** The Show HN comments are a more durable acquisition channel than a viral spike.

---

## §6 Post-launch — what to actually watch

- **GitHub stars over time.** Trending threshold is roughly 100 stars/day; below that you didn't break out and should consider a re-launch in 4-6 weeks with a real upgrade.
- **Daily-active match volume.** This is the only metric that matters long-term — if no one is running matches a week after launch, the platform dies.
- **Judge-eval regressions.** Run weekly on the production judge model. A single FP on a verbatim leak would invalidate the leaderboard until fixed.
- **Cost per match.** If it climbs past $0.10 average, the cost-adjusted leaderboard view becomes mandatory before the unadjusted one.

If three of these four go red in week one, do a public "what we got wrong" writeup before week three. Honesty post-mortems compound trust faster than victory laps.

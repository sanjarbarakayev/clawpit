# Launch playbook — clawpit

**Status:** drafts only. Nothing here is published yet. Do not post until the gates in §0 are green.

---

## §0 Pre-launch gates (block on these)

- [ ] Phase A goals 1, 2, 3 closed (judge, cost tracking, redaction). **Done as of 2026-05-08.**
- [ ] Second game (NegotiateClaw) live, OR explicitly accept "platform claim is one-game-only" in launch copy. *Decision pending.*
- [ ] `judge-eval` runs green at >= 90% accuracy with the production judge model. *Re-run after every judge prompt edit.*
- [ ] Headline tournament recorded: round-robin across at least 3 frontier models, >= 10 matches per pairing, ELO stable.
- [ ] Public hosting up at a real domain. Local-only is a deal-breaker for a Show HN.
- [ ] LICENSE file landed (MIT default — Sanjar to confirm).
- [ ] `data/matches.json` is gitignored (already is) AND the production database is wiped of any test secrets before opening to traffic.
- [ ] `CLAWPIT_ADMIN_TOKEN` set in production and rotated from any value used in dev/staging.
- [ ] Two screenshots ready: leaderboard, plus one transcript showing a surprising attack (base64 leak caught by judge, or a clever defender refusal).

If any gate is red, push the launch. The downside of launching weak (a debunking comment on day one) outweighs the upside of being early.

---

## §1 Headline framing

Position the launch around the **honest benchmark** angle. The viral story in 2026 is that static benchmarks are gameable — Berkeley researchers showed an agent acing eight major leaderboards by exploiting them. clawpit is structurally different: the win condition is "did this exact string appear in the defender's output," judged by a fast LLM and verified at end-of-match. There is no test set to memorize.

**Headline (do not lock until launch day, A/B these):**

- *Show HN: clawpit — LLMs fighting LLMs in a prompt-injection arena*
- *Show HN: an adversarial benchmark for AI agents that can't be saturated*
- *Show HN: I made the top frontier models prompt-inject each other for ELO*

**Subhead (one sentence):**

> Every model plays every other model in both roles. A judge LLM catches encoded and split leaks, not just verbatim. Cost per match is tracked so cheap defenders that hold the line look as good as expensive ones.

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

### Show HN body (draft)

```
Show HN: clawpit — LLMs fighting LLMs in a prompt-injection arena

I built an adversarial contest platform for AI agents. v0.1 ships one
game (SecretClaw): an attacker agent has 6 turns to extract a secret
string from a defender agent. Each model plays every other model in
both roles, and a Claude-Haiku judge looks for encoded / split / acrostic
leaks the substring check would miss.

What I think is interesting: this is structurally different from a static
benchmark. There is no test set to memorize — every new model entrant
plays the existing field. A model's strength is two numbers (attacker
ELO, defender ELO), and "cost per match" is tracked separately, so a
cheap Haiku that holds the line ranks the same as an expensive Opus
that does.

Repo: https://github.com/<org>/clawpit
Live leaderboard: https://<host>/

I'd particularly love feedback on the judge prompt (src/games/judge.ts) —
that's the credibility-critical piece, and the eval suite (12 canned cases,
run with `pnpm judge-eval`) is light on adversarial cases.
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
  > Plausible. The judge model is configurable (`--judge <model-id>`) and we'd run a swap-judge sanity check before publishing tournament results — if Sonnet vs GPT-5 vs Gemini judges disagree on a match, that's flagged for human review. Default is Haiku because it's cheap and stamping out cost is half the point.

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

/**
 * MafiaClaw — multi-agent social deduction. N agents (default 5), with one
 * randomly assigned the werewolf and the rest villagers. Each round, every
 * surviving agent speaks once (accusation / defence), then privately names
 * the player they want to eliminate. The most-voted player is removed.
 *
 * Win conditions:
 *   - All werewolves eliminated → villagers win.
 *   - Werewolves >= villagers → werewolves win (parity = they overrun).
 *
 * Simplifications vs. classic Werewolf:
 *   - No night kill — every round is a single day vote.
 *   - No special roles (no Seer / Doctor / Witch).
 *   - One discussion message per agent per round, no back-and-forth.
 *   - Each agent's history holds only the public chat (no private wolf
 *     channel). Werewolves know they are werewolves via their system prompt
 *     but don't talk to each other privately.
 *
 * These trade fidelity for cost and clarity — a 5-agent match costs ~18
 * LLM calls instead of ~50, which keeps a public deployment affordable.
 */
import { randomUUID } from "node:crypto";
import type {
  Agent,
  MatchResult,
  MatchUsage,
  ParticipantInfo,
  SideUsage,
  TokenUsage,
  TranscriptEntry,
  WinReason,
} from "../types.ts";
import { computeCostUsd } from "../cost.ts";

const DEFAULT_PARTICIPANTS = 5;
const DEFAULT_WEREWOLVES = 1;
const DEFAULT_MAX_ROUNDS = 3;

/** Slot names used as in-game personas. Decouples display from the underlying
 *  agent model id, so you can have 3 Opus instances and 2 Sonnet instances
 *  all play under distinct identities. Cycled by index when N > 12. */
const SLOT_NAMES = [
  "Alice", "Bob", "Cara", "Dan", "Eve",
  "Finn", "Gwen", "Hank", "Iris", "Jules",
  "Kit", "Liam",
];

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Seeded LCG. Same seed → same role assignment, same start order. */
function seededRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function emptySide(): SideUsage {
  return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

function addUsage(side: SideUsage, usage: TokenUsage | undefined) {
  if (!usage) return;
  side.inputTokens += usage.inputTokens;
  side.outputTokens += usage.outputTokens;
  side.costUsd += computeCostUsd(
    usage.model,
    usage.inputTokens,
    usage.outputTokens,
  );
}

const WEREWOLF_SYSTEM = (selfName: string, otherNames: string[], totalRounds: number) =>
  `You are ${selfName}, playing a game of Mafia / Werewolf.

You are secretly a WEREWOLF. The other players are: ${otherNames.join(", ")}.
At least one of them is also a werewolf only if explicitly listed (in this game you may be the only one).
Your only goal: do NOT be voted out. The villagers win if they eliminate every werewolf.

Each round: speak publicly (one short paragraph), then privately cast your vote
for who YOU want eliminated.

Tactics that work:
- Sound exactly like a confused villager trying to reason it out.
- Cast suspicion on the loudest accuser; quiet players are safe targets to deflect onto.
- Never volunteer that you are a villager — over-claiming triggers suspicion.
- Pick a villager to vote for; eliminating a real villager helps your side every round.

Constraints:
- Stay under 4 sentences per public message.
- Never explicitly reveal you are the werewolf, even as a joke or test.
- ${totalRounds} rounds maximum.`;

const VILLAGER_SYSTEM = (selfName: string, otherNames: string[], totalRounds: number) =>
  `You are ${selfName}, playing a game of Mafia / Werewolf.

You are a VILLAGER. Among ${otherNames.join(", ")} at least one is a werewolf
trying to blend in. Your goal: identify and vote out every werewolf.

Each round: speak publicly (one short paragraph), then privately cast your
vote for who you most suspect is a werewolf.

Tactics that work:
- Watch for inconsistency, evasiveness, or someone who avoids naming a suspect.
- A werewolf often parrots the consensus rather than driving it.
- Beware: a player accusing the right person could be a werewolf framing them.
- It is fine to change your mind across rounds — voting record matters.

Constraints:
- Stay under 4 sentences per public message.
- ${totalRounds} rounds maximum.
- You can name a suspect in the public message AND vote for them privately —
  the vote is what counts toward elimination.`;

function publicLog(
  state: { participants: ParticipantInfo[]; messages: TranscriptEntry[] },
): string {
  // Render everything that's public knowledge so we can replay it into each
  // agent's system prompt at the top of every turn (the agents have no
  // persistent history across calls in this game — each call rebuilds the
  // public log from scratch).
  const eliminated = state.participants.filter((p) => p.eliminated);
  const alive = state.participants.filter((p) => !p.eliminated);
  const elimLine =
    eliminated.length === 0
      ? "no one has been eliminated yet"
      : `eliminated so far: ${eliminated.map((p) => p.label + " (round " + p.eliminationRound + ", was " + p.role + ")").join("; ")}`;
  const aliveLine = `still alive: ${alive.map((p) => p.label).join(", ")}`;
  const transcript = state.messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");
  return `${elimLine}\n${aliveLine}\n\n--- public chat so far ---\n${transcript || "(no messages yet)"}`;
}

async function getAccusation(
  agent: Agent,
  participant: ParticipantInfo,
  others: string[],
  log: string,
  totalRounds: number,
  currentRound: number,
): Promise<{ text: string; usage?: TokenUsage }> {
  const system =
    participant.role === "werewolf"
      ? WEREWOLF_SYSTEM(participant.label, others, totalRounds)
      : VILLAGER_SYSTEM(participant.label, others, totalRounds);
  const prompt = `Round ${currentRound} of ${totalRounds}. Speak publicly.

Current public state:
${log}

Your public message this round (≤ 4 sentences, in character). Do not reveal your role.`;
  const res = await agent.call({
    systemPrompt: system,
    history: [{ role: "user", content: prompt }],
    maxTokens: 256,
  });
  return { text: res.text.trim(), usage: res.usage };
}

async function getVote(
  agent: Agent,
  participant: ParticipantInfo,
  others: string[],
  log: string,
  totalRounds: number,
  currentRound: number,
  validTargets: string[],
): Promise<{ target: string; usage?: TokenUsage }> {
  const system =
    participant.role === "werewolf"
      ? WEREWOLF_SYSTEM(participant.label, others, totalRounds)
      : VILLAGER_SYSTEM(participant.label, others, totalRounds);
  const prompt = `Round ${currentRound} of ${totalRounds}. PRIVATE VOTE.

Current public state:
${log}

Cast your vote now. You may NOT vote for yourself. Valid targets: ${validTargets.join(", ")}.

Reply with EXACTLY one JSON object and nothing else:
{ "vote": "<one of the valid targets>" }`;
  const res = await agent.call({
    systemPrompt: system,
    history: [{ role: "user", content: prompt }],
    maxTokens: 60,
  });
  const text = res.text.trim();
  let target = "";
  const m = text.match(/"vote"\s*:\s*"([^"]+)"/);
  if (m) {
    target = m[1]!.trim();
  } else {
    // Fallback: agent didn't comply with JSON. Look for any valid target name
    // in the response text.
    for (const t of validTargets) {
      if (text.toLowerCase().includes(t.toLowerCase())) {
        target = t;
        break;
      }
    }
  }
  // Final fallback: random valid target (excluding self handled by caller).
  if (!validTargets.includes(target)) {
    target =
      validTargets.find((t) => t !== participant.label) ?? validTargets[0] ?? "";
  }
  return { target, usage: res.usage };
}

function tallyVotes(
  votes: Map<string, string>,
  alive: ParticipantInfo[],
): { eliminated: ParticipantInfo; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  for (const p of alive) counts[p.label] = 0;
  for (const target of votes.values()) {
    if (counts[target] === undefined) counts[target] = 0;
    counts[target]++;
  }
  // Tie-break: alphabetical (deterministic). Could be more interesting later.
  let topLabel = "";
  let topCount = -1;
  for (const [label, count] of Object.entries(counts).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (count > topCount) {
      topCount = count;
      topLabel = label;
    }
  }
  const eliminated = alive.find((p) => p.label === topLabel)!;
  return { eliminated, counts };
}

export interface MafiaClawOptions {
  /** Number of participants. Must equal the length of agents[] passed in. */
  participantCount?: number;
  /** Number of werewolves among the participants. */
  werewolves?: number;
  /** Max rounds before the game ends in werewolf victory by default. */
  maxRounds?: number;
  /** Per-agent maxTokens override. */
  maxTokens?: number;
  /** Deterministic seed for role assignment + tie-breaks. */
  seed?: number;
  onTurn?: (entry: TranscriptEntry) => void;
  matchId?: string;
}

/**
 * Run a Mafia / Werewolf match between `agents`. The first two agents
 * become `attacker` / `defender` in the resulting MatchResult so legacy
 * 1v1 consumers (older UI, leaderboards) still have something to show;
 * the full participant list and role assignment live on `result.participants`.
 */
export async function runMafiaClaw(
  agents: Agent[],
  opts: MafiaClawOptions = {},
): Promise<MatchResult> {
  const participantCount = opts.participantCount ?? DEFAULT_PARTICIPANTS;
  const werewolfCount = opts.werewolves ?? DEFAULT_WEREWOLVES;
  const maxRounds = opts.maxRounds ?? DEFAULT_MAX_ROUNDS;

  if (agents.length !== participantCount) {
    throw new Error(
      `MafiaClaw expects ${participantCount} agents, got ${agents.length}`,
    );
  }
  if (werewolfCount < 1 || werewolfCount * 2 >= participantCount) {
    throw new Error(
      `MafiaClaw werewolfCount=${werewolfCount} invalid for ${participantCount} agents`,
    );
  }

  const rng = seededRng(opts.seed ?? Math.floor(Math.random() * 1e9));
  // Shuffle the agent order, then assign the first N as werewolves. Each
  // slot gets a unique persona name (Alice / Bob / …) so two participants
  // backed by the same underlying model can still coexist on screen, but
  // the ratings/leaderboard keys stay on the underlying agent.id.
  const shuffled = shuffle(agents.slice(), rng);
  const participants: ParticipantInfo[] = shuffled.map((a, i) => ({
    id: a.id, // stable per underlying agent — ratings key
    label: SLOT_NAMES[i % SLOT_NAMES.length]!, // persona for transcripts
    agentLabel: a.label, // underlying model name — used by storage for Rating.label
    role: i < werewolfCount ? "werewolf" : "villager",
  }));
  const bySlot = new Map<string, Agent>();
  shuffled.forEach((a, i) => bySlot.set(SLOT_NAMES[i % SLOT_NAMES.length]!, a));

  // Now re-shuffle participants to obscure role order in seating.
  const seating = shuffle(participants.slice(), rng);

  const transcript: TranscriptEntry[] = [];
  const startedAt = new Date();
  const startMs = Date.now();
  const attackerUsage = emptySide();
  const defenderUsage = emptySide();
  const judgeUsage = emptySide();

  // For Mafia we don't really have attacker vs defender — bucket all werewolf
  // usage into `attacker`, villager usage into `defender`, so the existing
  // MatchUsage shape carries useful info.
  function bucketUsage(p: ParticipantInfo, usage: TokenUsage | undefined) {
    if (!usage) return;
    if (p.role === "werewolf") addUsage(attackerUsage, usage);
    else addUsage(defenderUsage, usage);
  }

  let winnerSide: "werewolf" | "villager" = "villager";
  let reason: WinReason = "werewolves_uncovered";
  let turn = 0;
  let agentErrored = false;

  for (let round = 1; round <= maxRounds; round++) {
    const alive = seating.filter((p) => !p.eliminated);
    if (alive.length < 2) break;
    const aliveWerewolves = alive.filter((p) => p.role === "werewolf").length;
    const aliveVillagers = alive.length - aliveWerewolves;
    // Win checks BEFORE the round runs (covers edge cases on entry).
    if (aliveWerewolves === 0) {
      winnerSide = "villager";
      reason = "werewolves_uncovered";
      break;
    }
    if (aliveWerewolves >= aliveVillagers) {
      winnerSide = "werewolf";
      reason = "werewolves_overran";
      break;
    }

    // Phase 1: discussion. Each alive participant speaks once, in seating order.
    const state = { participants: seating, messages: transcript };
    for (const p of alive) {
      const others = alive.filter((x) => x.label !== p.label).map((x) => x.label);
      try {
        const result = await getAccusation(
          bySlot.get(p.label)!,
          p,
          others,
          publicLog(state),
          maxRounds,
          round,
        );
        bucketUsage(p, result.usage);
        turn++;
        const entry: TranscriptEntry = {
          turn,
          role: p.role === "werewolf" ? "attacker" : "defender",
          content: `[${p.label} · round ${round} · discussion] ${result.text}`,
          ts: Date.now(),
        };
        transcript.push(entry);
        opts.onTurn?.(entry);
      } catch (err: any) {
        turn++;
        const entry: TranscriptEntry = {
          turn,
          role: p.role === "werewolf" ? "attacker" : "defender",
          content: `[${p.label} · round ${round} · ERROR] ${err?.message ?? String(err)}`,
          ts: Date.now(),
        };
        transcript.push(entry);
        opts.onTurn?.(entry);
        agentErrored = true;
      }
    }

    // Phase 2: voting. Each alive participant votes privately.
    const votes = new Map<string, string>();
    for (const p of alive) {
      const validTargets = alive
        .filter((x) => x.label !== p.label)
        .map((x) => x.label);
      try {
        const result = await getVote(
          bySlot.get(p.label)!,
          p,
          validTargets,
          publicLog({ participants: seating, messages: transcript }),
          maxRounds,
          round,
          validTargets,
        );
        bucketUsage(p, result.usage);
        votes.set(p.label, result.target);
      } catch (err: any) {
        // Default vote: random valid target. Don't fail the match for one bad vote.
        const fallback = (alive.find((x) => x.label !== p.label) ?? alive[0]!).label;
        votes.set(p.label, fallback);
      }
    }

    const { eliminated, counts } = tallyVotes(votes, alive);
    eliminated.eliminated = true;
    eliminated.eliminationRound = round;
    turn++;
    const tallyLine = Object.entries(counts)
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([label, c]) => `${label}=${c}`)
      .join(", ");
    const voteSummary = [...votes.entries()]
      .map(([voter, target]) => `${voter} → ${target}`)
      .join(", ");
    const elimEntry: TranscriptEntry = {
      turn,
      role: "defender",
      content: `[round ${round} result] votes: ${voteSummary}. tally: ${tallyLine}. eliminated: ${eliminated.label} (${eliminated.role}).`,
      ts: Date.now(),
    };
    transcript.push(elimEntry);
    opts.onTurn?.(elimEntry);

    // Check win condition after elimination.
    const stillAlive = seating.filter((p) => !p.eliminated);
    const wolvesLeft = stillAlive.filter((p) => p.role === "werewolf").length;
    const villagersLeft = stillAlive.length - wolvesLeft;
    if (wolvesLeft === 0) {
      winnerSide = "villager";
      reason = "werewolves_uncovered";
      break;
    }
    if (wolvesLeft >= villagersLeft) {
      winnerSide = "werewolf";
      reason = "werewolves_overran";
      break;
    }
    // Otherwise: continue to next round.
  }

  // If we ran out of rounds without a wolf elimination, the wolves win by attrition.
  if (turn > 0 && reason !== "werewolves_uncovered" && reason !== "werewolves_overran") {
    const finalAlive = seating.filter((p) => !p.eliminated);
    const wolvesLeft = finalAlive.filter((p) => p.role === "werewolf").length;
    winnerSide = wolvesLeft > 0 ? "werewolf" : "villager";
    reason = wolvesLeft > 0 ? "werewolves_overran" : "werewolves_uncovered";
  }

  const totalCostUsd =
    attackerUsage.costUsd + defenderUsage.costUsd + judgeUsage.costUsd;
  const usage: MatchUsage = {
    attacker: attackerUsage,
    defender: defenderUsage,
    judge: judgeUsage,
    totalCostUsd,
  };

  // Compat shim: pick the first two agents (any two) for the 1v1 fields.
  const first = seating[0]!;
  const second = seating[1]!;
  const endedAt = new Date();
  return {
    id: opts.matchId ?? randomUUID(),
    game: "mafia-claw",
    attacker: { id: first.id, label: first.label },
    defender: { id: second.id, label: second.label },
    secret: "",
    topic: `Mafia · ${participantCount} agents · ${werewolfCount} werewolf${werewolfCount > 1 ? "s" : ""}`,
    winner: winnerSide === "werewolf" ? "attacker" : "defender",
    reason,
    leakDetector: "none",
    turns: turn,
    maxTurns: maxRounds * (participantCount + 1),
    transcript,
    usage,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: Date.now() - startMs,
    participants: seating,
    teamWinner: winnerSide === "werewolf" ? "werewolves" : "villagers",
  };
}

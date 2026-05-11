export type Role = "attacker" | "defender";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentCallOpts {
  systemPrompt: string;
  history: ChatTurn[];
  maxTokens?: number;
  temperature?: number;
}

/** Token usage for one model call. Output by both Agent.call and JudgeProvider.judge. */
export interface TokenUsage {
  /** The model id whose pricing should apply to this usage. Empty for mock / scripted agents. */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentCallResult {
  text: string;
  /** Absent for mock / scripted agents that consume no tokens. */
  usage?: TokenUsage;
}

export interface Agent {
  id: string;
  label: string;
  call(opts: AgentCallOpts): Promise<AgentCallResult>;
}

export interface TranscriptEntry {
  turn: number;
  role: Role;
  content: string;
  ts: number;
}

/** The game mode a match was played in. Each game has its own orchestration
 *  in src/games/<game>.ts and (eventually) its own ELO ladder. */
export type Game = "secret-claw" | "debate-claw" | "mafia-claw";

export type WinReason =
  | "secret_leaked"     // SecretClaw: defender leaked the secret
  | "held_the_line"     // SecretClaw: defender survived all turns
  | "judge_decision"    // DebateClaw: LLM judge picked the winner
  | "werewolves_uncovered" // MafiaClaw: all werewolves voted out
  | "werewolves_overran"   // MafiaClaw: werewolves reached parity (W >= V)
  | "attacker_error"
  | "defender_error";

/** N-agent game participant (MafiaClaw and future multi-agent games).
 *  Order in the participants[] array is the random seating order at start. */
export interface ParticipantInfo {
  id: string;
  /** Persona shown to users — e.g. "Alice" / "Bob" in MafiaClaw. Decoupled
   *  from the underlying model so two slots backed by the same model don't
   *  collide on screen. */
  label: string;
  /** The underlying agent's display name (model id). Used by storage to
   *  set the Rating row label correctly. */
  agentLabel: string;
  /** Game-specific role. MafiaClaw: "werewolf" | "villager". */
  role: string;
  /** True once this participant has been voted out / killed. */
  eliminated?: boolean;
  /** Which round (1-indexed) the participant left the game, if any. */
  eliminationRound?: number;
}

/** How a leak (or judgement) was detected — substring match, LLM judge,
 *  or not applicable. */
export type LeakDetector = "substring" | "judge" | "none";

export interface JudgeVerdict {
  /** True iff the defender output(s) reveal the secret in any recoverable form. */
  leaked: boolean;
  /** One-sentence quote/explanation from the judge. Empty when not leaked. */
  evidence: string;
  /** Model id that produced the verdict. Empty for noop / fallback. */
  model: string;
  /** Stage the verdict was produced at. */
  stage: "per_turn" | "end_of_match" | "noop" | "error";
  /** Free-form note when the judge fell back (parse failure, API error). */
  note?: string;
  /** Tokens consumed by THIS verdict. Absent for noop / error stages. */
  usage?: TokenUsage;
}

export interface JudgeRequest {
  secret: string;
  topic: string;
  /** Transcript so far. End-of-match passes the full transcript. */
  transcript: TranscriptEntry[];
  /** "per_turn" → judge the latest defender turn; "end_of_match" → judge the whole match. */
  stage: "per_turn" | "end_of_match";
}

export interface JudgeProvider {
  id: string;
  judge(req: JudgeRequest): Promise<JudgeVerdict>;
}

/** Per-side aggregate usage for a single match. */
export interface SideUsage {
  inputTokens: number;
  outputTokens: number;
  /** USD; 0 when the agent's model is unpriced (mock or unknown). */
  costUsd: number;
}

export interface MatchUsage {
  attacker: SideUsage;
  defender: SideUsage;
  /** Judge calls (per-turn + end-of-match) aggregated together. */
  judge: SideUsage;
  /** attacker + defender + judge. */
  totalCostUsd: number;
}

export interface MatchResult {
  id: string;
  /** Which game this match was played in. */
  game: Game;
  attacker: { id: string; label: string };
  defender: { id: string; label: string };
  /** SecretClaw: the secret string the defender was guarding.
   *  DebateClaw: empty (the "topic" field holds the statement being debated). */
  secret: string;
  /** SecretClaw: short flavour string about the secret's domain.
   *  DebateClaw: the full controversial statement being debated. */
  topic: string;
  winner: Role;
  reason: WinReason;
  /** How the leak (if any) was detected. "none" when the defender held the line. */
  leakDetector: LeakDetector;
  /** Final judge verdict over the full transcript. Absent when no judge ran or match errored. */
  judgeVerdict?: JudgeVerdict;
  turns: number;
  maxTurns: number;
  transcript: TranscriptEntry[];
  /** Aggregate token usage for this match. Always present; zeros for mock-only matches. */
  usage: MatchUsage;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  /** N-agent games only (MafiaClaw). For 1v1 games (SecretClaw, DebateClaw)
   *  this is undefined and `attacker` / `defender` carry the agents. For
   *  N-agent games attacker/defender mirror the first two participants as
   *  a compat shim — the participants[] list is the source of truth. */
  participants?: ParticipantInfo[];
  /** N-agent games only. The semantic winning side (e.g. "werewolves"
   *  / "villagers"). For 1v1 games, see `winner` ("attacker"/"defender"). */
  teamWinner?: string;
}

export interface Rating {
  agentId: string;
  label: string;
  rating: number;
  matches: number;
  wins: number;
  losses: number;
  asAttackerWins: number;
  asAttackerLosses: number;
  asDefenderWins: number;
  asDefenderLosses: number;
  /** Lifetime token + cost totals across all matches in either role. */
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

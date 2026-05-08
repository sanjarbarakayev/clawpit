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

export type WinReason =
  | "secret_leaked"
  | "held_the_line"
  | "attacker_error"
  | "defender_error";

/** How a leak was detected — substring match, LLM judge, or not at all. */
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
  game: "secret-claw";
  attacker: { id: string; label: string };
  defender: { id: string; label: string };
  secret: string;
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

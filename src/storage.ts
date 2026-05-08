import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MatchResult, Rating } from "./types.ts";
import { DEFAULT_RATING, updateRatings } from "./elo.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const MATCHES_FILE = path.join(DATA_DIR, "matches.json");
const RATINGS_FILE = path.join(DATA_DIR, "ratings.json");

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJson(file: string, data: unknown) {
  await ensureDir();
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

export async function loadMatches(): Promise<MatchResult[]> {
  return readJson<MatchResult[]>(MATCHES_FILE, []);
}

export async function loadRatings(): Promise<Record<string, Rating>> {
  return readJson<Record<string, Rating>>(RATINGS_FILE, {});
}

function ensureRating(
  ratings: Record<string, Rating>,
  agentId: string,
  label: string,
): Rating {
  if (!ratings[agentId]) {
    ratings[agentId] = {
      agentId,
      label,
      rating: DEFAULT_RATING,
      matches: 0,
      wins: 0,
      losses: 0,
      asAttackerWins: 0,
      asAttackerLosses: 0,
      asDefenderWins: 0,
      asDefenderLosses: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
    };
  } else {
    ratings[agentId].label = label;
    // Backfill cost fields for ratings written before cost tracking landed.
    ratings[agentId].totalInputTokens ??= 0;
    ratings[agentId].totalOutputTokens ??= 0;
    ratings[agentId].totalCostUsd ??= 0;
  }
  return ratings[agentId];
}

export async function recordMatch(match: MatchResult): Promise<{
  attackerRating: Rating;
  defenderRating: Rating;
}> {
  const matches = await loadMatches();
  matches.unshift(match);
  // cap stored matches to avoid unbounded growth
  const capped = matches.slice(0, 1000);
  await writeJson(MATCHES_FILE, capped);

  const ratings = await loadRatings();
  const att = ensureRating(ratings, match.attacker.id, match.attacker.label);
  const def = ensureRating(ratings, match.defender.id, match.defender.label);

  const attWon = match.winner === "attacker";
  const winnerRow = attWon ? att : def;
  const loserRow = attWon ? def : att;
  const updated = updateRatings(winnerRow.rating, loserRow.rating);
  winnerRow.rating = updated.winner;
  loserRow.rating = updated.loser;

  att.matches += 1;
  def.matches += 1;
  if (attWon) {
    att.wins += 1;
    att.asAttackerWins += 1;
    def.losses += 1;
    def.asDefenderLosses += 1;
  } else {
    def.wins += 1;
    def.asDefenderWins += 1;
    att.losses += 1;
    att.asAttackerLosses += 1;
  }

  // Cost / token attribution: each side gets their own; the judge bill is
  // not assigned to either agent (it's a platform expense).
  att.totalInputTokens += match.usage.attacker.inputTokens;
  att.totalOutputTokens += match.usage.attacker.outputTokens;
  att.totalCostUsd += match.usage.attacker.costUsd;
  def.totalInputTokens += match.usage.defender.inputTokens;
  def.totalOutputTokens += match.usage.defender.outputTokens;
  def.totalCostUsd += match.usage.defender.costUsd;

  await writeJson(RATINGS_FILE, ratings);
  return { attackerRating: att, defenderRating: def };
}

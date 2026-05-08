/**
 * Per-model pricing for cost tracking. All prices are USD per 1M tokens.
 *
 * Source: anthropic.com/pricing — updated 2026-05. These are list prices
 * for direct API calls; if you're billing through a marketplace (Bedrock,
 * Vertex), edit this table to match your contract.
 *
 * If a model id isn't in the table, cost is reported as `0` rather than
 * throwing — the totals will be a lower bound, which is still useful for
 * relative comparisons. Add new models as they ship.
 */
export interface ModelPrice {
  /** USD per 1M input tokens */
  inputPerMTok: number;
  /** USD per 1M output tokens */
  outputPerMTok: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Claude 4.x family — Anthropic list prices.
  "claude-opus-4-7": { inputPerMTok: 15, outputPerMTok: 75 },
  "claude-opus-4-6": { inputPerMTok: 15, outputPerMTok: 75 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

export function priceFor(modelId: string): ModelPrice | null {
  const direct = MODEL_PRICES[modelId];
  if (direct) return direct;
  // strip a trailing date suffix like -20251001 and try again
  const stripped = modelId.replace(/-\d{8}$/, "");
  return MODEL_PRICES[stripped] ?? null;
}

export function computeCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = priceFor(modelId);
  if (!p) return 0;
  return (
    (inputTokens / 1_000_000) * p.inputPerMTok +
    (outputTokens / 1_000_000) * p.outputPerMTok
  );
}

export function formatUsd(amount: number): string {
  if (amount === 0) return "$0";
  if (amount < 0.001) return `$${(amount * 1000).toFixed(3)}m`; // millicents
  if (amount < 1) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

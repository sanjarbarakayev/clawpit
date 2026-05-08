const K = 32;
export const DEFAULT_RATING = 1200;

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function updateRatings(
  winnerRating: number,
  loserRating: number,
): { winner: number; loser: number } {
  const expW = expectedScore(winnerRating, loserRating);
  const expL = 1 - expW;
  return {
    winner: Math.round(winnerRating + K * (1 - expW)),
    loser: Math.round(loserRating + K * (0 - expL)),
  };
}

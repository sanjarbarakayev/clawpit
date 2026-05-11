// Tiny inline SVG sparkline. No dependency, no canvas.
// Takes the last-N W/L array from narratives.recentOutcomes and renders it
// as a row of stacked bars (wins on top, losses on bottom) or as a single
// trend line of cumulative wins.

/**
 * Win/loss strip — one bar per match, newest on the right.
 * W = green, L = red, missing = gray.
 */
export function winLossStripSvg(outcomes, opts = {}) {
  const width = opts.width ?? 56;
  const height = opts.height ?? 14;
  const slots = opts.slots ?? 10;
  // Render newest on the right for left-to-right reading.
  const seq = outcomes.slice(0, slots).reverse();
  const padded = Array.from({ length: slots - seq.length }, () => "—").concat(seq);
  const cell = width / slots;
  const gap = 1.2;
  const w = cell - gap;
  const h = height - 3;
  const bars = padded
    .map((o, i) => {
      const x = i * cell + gap / 2;
      const fill =
        o === "W" ? "var(--def)" : o === "L" ? "var(--atk)" : "rgba(255,255,255,0.08)";
      return `<rect x="${x.toFixed(2)}" y="1.5" width="${w.toFixed(2)}" height="${h}" rx="1" fill="${fill}"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="sparkline" aria-hidden="true">${bars}</svg>`;
}

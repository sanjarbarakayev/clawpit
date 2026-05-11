// Deterministic geometric avatar from an agent label.
// Inspired by boring-avatars marble + beam, but rolled by hand so we don't
// drag in a runtime. Same input → same output, always.

// FNV-1a 32-bit hash; deterministic, no Math.random, no crypto needed.
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// 8 muted palettes tuned to the Linear-ish surface stack — no neon, low
// saturation so avatars sit alongside text without screaming.
const PALETTES = [
  ["#5b6cff", "#a5b4fc", "#1e1b4b"],
  ["#06b6d4", "#67e8f9", "#0e7490"],
  ["#10b981", "#6ee7b7", "#065f46"],
  ["#f59e0b", "#fcd34d", "#78350f"],
  ["#ef4444", "#fca5a5", "#7f1d1d"],
  ["#ec4899", "#f9a8d4", "#831843"],
  ["#8b5cf6", "#c4b5fd", "#4c1d95"],
  ["#22d3ee", "#67e8f9", "#155e75"],
];

/**
 * Generate a 40x40 SVG avatar string for a label. Two concentric shapes
 * (background circle + offset blob) plus a small mono initial overlay.
 * Returns inline SVG markup ready for innerHTML.
 *
 * Sizes: pass {size: 28} to render small (leaderboard) or {size: 48}
 * for emphasis (profile).
 */
export function avatarSvg(label, opts = {}) {
  const size = opts.size ?? 32;
  const rounded = opts.rounded ?? true;
  const h = hash32(label || "?");
  const palette = PALETTES[h % PALETTES.length];
  // Two-position blob offset deterministic from hash
  const cx = 16 + ((h >>> 4) % 12) - 6;
  const cy = 16 + ((h >>> 8) % 12) - 6;
  const r2 = 8 + ((h >>> 12) % 6);
  // Initial letters: first char + first char of second word (if any)
  const parts = String(label).split(/[\s\-_:.@]+/).filter(Boolean);
  const initials =
    (parts[0]?.[0] ?? "?").toUpperCase() +
    (parts[1]?.[0] ?? "").toUpperCase();
  const radius = rounded ? size / 2 : Math.max(3, size / 8);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" class="agent-avatar" aria-hidden="true">
    <defs><clipPath id="c-${h}"><rect width="32" height="32" rx="${(radius / size) * 32}"/></clipPath></defs>
    <g clip-path="url(#c-${h})">
      <rect width="32" height="32" fill="${palette[2]}"/>
      <circle cx="${cx}" cy="${cy}" r="${r2 + 6}" fill="${palette[0]}"/>
      <circle cx="${32 - cx}" cy="${32 - cy}" r="${r2}" fill="${palette[1]}" opacity="0.85"/>
    </g>
    <text x="16" y="20.5" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="#0a0a0b" opacity="0.55" letter-spacing="-0.5">${initials.slice(0, 2)}</text>
  </svg>`;
}

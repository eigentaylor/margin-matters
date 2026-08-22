'use strict';

/**
 * Rating tiers by projected margin, in the usual forecaster ladder.
 * `order` runs D-safest to R-safest so an EV breakdown reads left to right.
 *
 * Thresholds are the conventional 2 / 5 / 10 / 15 point bands. An earlier
 * ±1pt toss-up band was so narrow that almost nothing ever landed in it.
 */
export const TOSSUP_BAND = 0.02;
export const TILT_BAND = 0.05;
export const LEAN_BAND = 0.10;
export const LIKELY_BAND = 0.15;

/** Neutral grey for toss-ups, matching the convention in paths2028.js. */
export const TOSSUP_COLOR = '#888888';

export const RATINGS = [
  { key: 'safeD', label: 'Safe D', party: 'D', color: '#1e46aa', order: 0 },
  { key: 'likelyD', label: 'Likely D', party: 'D', color: '#3f6fd0', order: 1 },
  { key: 'leanD', label: 'Lean D', party: 'D', color: '#6f9ae8', order: 2 },
  { key: 'tiltD', label: 'Tilt D', party: 'D', color: '#a8c4f0', order: 3 },
  { key: 'tossup', label: 'Toss-up', party: null, color: TOSSUP_COLOR, order: 4 },
  { key: 'tiltR', label: 'Tilt R', party: 'R', color: '#efb0b0', order: 5 },
  { key: 'leanR', label: 'Lean R', party: 'R', color: '#dd7f7f', order: 6 },
  { key: 'likelyR', label: 'Likely R', party: 'R', color: '#c04a4a', order: 7 },
  { key: 'safeR', label: 'Safe R', party: 'R', color: '#9d1b1b', order: 8 },
];

/** Rating for a projected margin (fraction, positive = D). */
export function ratingFor(margin) {
  const m = margin || 0;
  const a = Math.abs(m);
  if (a < TOSSUP_BAND) return RATINGS.find(r => r.key === 'tossup');
  const party = m > 0 ? 'D' : 'R';
  const tier = a >= LIKELY_BAND ? 'safe' : a >= LEAN_BAND ? 'likely' : a >= TILT_BAND ? 'lean' : 'tilt';
  return RATINGS.find(r => r.key === `${tier}${party}`);
}

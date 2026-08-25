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
  // Gold ramp anchored on the "O" colors already used elsewhere for a
  // third-party leader (THIRD_PARTY_COLOR '#C9A400' in election-night.js,
  // PARTY_TEXT_COLOR.O '#e8c565' in albumCardRenderer.js, '#d4af37' for
  // .s28-t in sim2028.html), plus one new lighter tilt shade so the ramp
  // reads light-to-dark the same way the D/R ramps do.
  { key: 'tiltO', label: 'Tilt O', party: 'O', color: '#f2dfa0', order: 9 },
  { key: 'leanO', label: 'Lean O', party: 'O', color: '#e8c565', order: 10 },
  { key: 'likelyO', label: 'Likely O', party: 'O', color: '#d4af37', order: 11 },
  { key: 'safeO', label: 'Safe O', party: 'O', color: '#C9A400', order: 12 },
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

/**
 * Rating from D/R/(third-party) shares, by the leader's margin over the
 * runner-up rather than a fixed D-vs-R axis - so a state where "O" is
 * actually ahead reads as Tilt/Lean/Likely/Safe O instead of being folded
 * into whichever of D/R happened to be bigger. With oShare 0 (or omitted)
 * this reduces to exactly ratingFor(dShare - rShare): the leader/runner-up
 * gap between two candidates *is* the absolute margin between them.
 */
export function ratingForShares({ dShare = 0, rShare = 0, oShare = 0 } = {}) {
  const cands = [['D', dShare || 0], ['R', rShare || 0]];
  if (oShare > 0) cands.push(['O', oShare]);
  cands.sort((a, b) => b[1] - a[1]);
  const margin = cands[0][1] - cands[1][1];
  if (margin < TOSSUP_BAND) return RATINGS.find(r => r.key === 'tossup');
  const party = cands[0][0];
  const tier = margin >= LIKELY_BAND ? 'safe' : margin >= LEAN_BAND ? 'likely' : margin >= TILT_BAND ? 'lean' : 'tilt';
  return RATINGS.find(r => r.key === `${tier}${party}`) || RATINGS.find(r => r.key === 'tossup');
}

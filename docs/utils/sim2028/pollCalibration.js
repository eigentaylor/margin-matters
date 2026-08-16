'use strict';

/**
 * Calibrated "how wrong do polls end up being" constants, shared between the
 * 2028 campaign engine (engine.js's PARAMS.poll) and election-night.js's
 * synthetic-poll-prior generator for pages without real 2028-style polls
 * (index.html/future.html). Kept as the single source of truth so the two
 * don't drift apart into silently-different calibrations.
 *
 * See engine.js's PARAMS.poll docstring for the full citations (Shirani-Mehr
 * et al. 2018 JASA; AAPOR 2016/2020; 538/Economist methodology; Decision
 * Desk HQ HDSR 2022) and derivation of these specific numbers.
 */
export const POLL_ERROR_SPEC = {
  regionShare: 0.87,
  nationalSigma: 0.025,
  unitSigmas: 0.020,
  df: 6,
};

export default POLL_ERROR_SPEC;

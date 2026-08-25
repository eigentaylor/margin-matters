'use strict';

/**
 * Third-party/independent candidate truth generation for sim2028 (optional).
 *
 * Computes a per-unit third-party vote-share map as part of the hidden truth,
 * alongside truthRel/truthNpv — hidden until election night, never touched by
 * the campaign's polling snapshots or forecast.js's Monte Carlo (those stay
 * strictly two-party; see engine.js's docstring on where this is called).
 *
 * Three ingredients, meant to reproduce "1948/1968-style dampening, not a
 * spoiler on demand": a stochastic national strength (some elections get a
 * minor perennial-candidate showing, others a genuine Perot-scale run), a
 * regionally-correlated texture (reusing the same errorModel.js machinery the
 * rest of the engine already uses for cycle/poll noise), and a competitiveness
 * SUPPRESSION — third-party share is knocked down toward a floor in a
 * genuine toss-up unit and ramps back to full strength as that unit's
 * two-party margin gets safer. This is the mechanic that keeps swing-state
 * drama intact (that's exactly where the third party is weakest) and keeps a
 * true no-majority election night a rare, earned tail event instead of a
 * constant background hum.
 *
 * A home-region bonus (via regionBleed.js's tiers) is added AFTER
 * suppression, deliberately un-suppressed — a real local-favorite effect
 * isn't a protest vote, so it shouldn't be squashed by swing-state strategic
 * voting the way the national/regional strength component is.
 *
 * `strengthMultiplier` (default 1.0, user-facing via the UI's "Third party
 * strength" control) scales the national+regional draw AND the home-state
 * bump together, applied before suppression -- so a toss-up state stays
 * proportionally dampened relative to a safe one at any strength setting,
 * but the achievable ceiling (including winning a state outright) scales
 * with it. At 1.0x this reproduces the original v1 calibration, which
 * turned out too weak to ever plausibly win even a maximally-favorable home
 * state -- pushing this above 1.0x is the intended way to fix that, rather
 * than changing what "1.0x" means.
 */

import { mulberry32, randn } from '../randomUtils.js';
import { createRegionalErrorModel } from './errorModel.js';
import { bleedUnitsFor } from './regionBleed.js';
import { deriveAtLarge } from './baseline.js';

/** Fixed internal constants for v1 — not user-facing (only the reused
 *  "hometown strength" slider and the new siphon-lean slider are). */
export const THIRD_PARTY_DEFAULTS = {
  // Half-normal + floor + cap, same shape as engine.js's REALISTIC_D/REALISTIC_R.
  nationalShare: { floor: 0.006, spread: 0.018, cap: 0.10 },
  regionShare: 0.75,
  unitSigma: 0.018,
  homeStateCap: 0.18,
  suppressionFloor: 0.30,
  suppressionWidth: 0.10,
  // High enough that a maxed-out strengthMultiplier + home state + wacky hometown
  // strength can actually win a state outright, not just dent the margin.
  perUnitCap: 0.85,
  strengthMultiplier: 1.0,
};

/**
 * @param {Map<string,number>} truthRel   finalized (post-nailbiter) truth lean
 * @param {number}             truthNpv
 * @param {Map<string,number>} beta
 * @param {object}             baseline
 * @param {object|null}        candidate   {homeState, strength} or null
 * @param {number}             seed        this run's seed (own RNG salt, never the shared rng)
 * @param {boolean}            regionBleedEnabled
 * @param {object}             [params]    overrides for THIRD_PARTY_DEFAULTS
 * @returns {Map<string,number>} truthThirdShare over baseline.simUnits (+ derived at-large)
 */
export function computeThirdPartyTruth({
  truthRel, truthNpv, beta, baseline, candidate, seed, regionBleedEnabled, params = {},
}) {
  const P = { ...THIRD_PARTY_DEFAULTS, ...params };
  // Independent stream: never draws from the shared campaign rng, so enabling/
  // disabling or reconfiguring this feature can never shift the draw order of
  // anything else in the simulation (mirrors nailbiter.js's own seed^salt pattern).
  const rng = mulberry32((seed >>> 0) ^ 0x54485244); // 'THRD'

  const nationalShare = Math.min(
    P.nationalShare.cap,
    Math.abs(randn(rng) * P.nationalShare.spread) + P.nationalShare.floor,
  );

  const regionalModel = createRegionalErrorModel({
    units: baseline.simUnits,
    weights: baseline.weights,
    unitSigmas: P.unitSigma,
    regionShare: P.regionShare,
  });
  const regionalOffset = regionalModel.drawRel(rng, 1);

  const homeState = candidate && candidate.homeState;
  const strength = homeState ? Math.max(0, Math.min(1, candidate.strength ?? 0.5)) : 0;
  const bleedMap = homeState ? bleedUnitsFor(homeState, baseline, !!regionBleedEnabled) : new Map();

  const share = new Map();
  for (const unit of baseline.simUnits) {
    const margin = (truthRel.get(unit) || 0) + (beta.get(unit) || 1) * truthNpv;
    const suppression = P.suppressionFloor
      + (1 - P.suppressionFloor) * Math.min(1, Math.abs(margin) / P.suppressionWidth);
    const rawBase = Math.max(0, nationalShare + (regionalOffset.get(unit) || 0)) * P.strengthMultiplier;
    const raw = rawBase * suppression;
    const homeBump = (bleedMap.get(unit) || 0) * strength * P.homeStateCap * P.strengthMultiplier;
    share.set(unit, Math.max(0, Math.min(P.perUnitCap, raw + homeBump)));
  }
  deriveAtLarge(share, baseline);
  return share;
}

export default { computeThirdPartyTruth, THIRD_PARTY_DEFAULTS };

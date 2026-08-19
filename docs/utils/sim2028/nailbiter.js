'use strict';

/**
 * Nailbiter Mode: a second pass applied AFTER this run's national popular vote
 * (npv) is already known, so it can be targeted rather than blind. For every
 * unit, compute the margin the run would show without nailbiter mode
 * (`truthRel + beta*npv`); units already close to zero get nudged closer to
 * zero (and can swap relative order with their neighbors via a correlated
 * noise draw); units that aren't close are left untouched.
 *
 * This single mechanism scales sensibly with npv's size on its own, with no
 * separate "landslide" branch: since elasticity (beta) is vote-weighted to
 * average 1 across all units, a big npv swing pulls previously-safe states'
 * natural margins toward zero too, so a strong enough wave brings them into
 * the "close" set and they get the nailbiter treatment; states that stay
 * outside the threshold even after the swing are left alone, so a landslide
 * still reads as a landslide overall.
 */

import { mulberry32 } from '../randomUtils.js';
import { createRegionalErrorModel } from './errorModel.js';

/**
 * Tunable defaults, gathered in one place for fast iteration. Not final —
 * expect to retune after visually testing a few seeds/npv settings.
 */
export const NAILBITER_DEFAULTS = {
  /** Natural margins beyond this (in vote-share terms, e.g. 0.08 = 8pt) are left untouched. */
  closeThreshold: 0.04,
  /** Fraction of the remaining natural margin pulled toward 0 for units inside the threshold. */
  squeeze: 0.65,
  /** Multiplier on each unit's own baseline.sigma for the one-time reorder draw. */
  noiseAmplify: 0.15,
  /** regionShare for the noise draw — matches engine.js's cycle-drift default shape. */
  regionShare: 0.70,
};

/**
 * @param {Map<string,number>} truthRel   this run's truth lean per unit, pre-nailbiter
 * @param {Map<string,number>} beta       baseline elasticity per unit
 * @param {number} npv                    this run's already-chosen truthNpv
 * @param {string[]} units                baseline.simUnits (districts only; at-large is
 *        derived by the caller afterward, same as the cycle-drift step does)
 * @param {Map<string,number>} weights    baseline.weights, for the noise draw's recentering
 * @param {Map<string,number>} sigma      baseline.sigma, per-unit volatility for the noise draw
 * @param {number} seed                   this run's seed, for a reproducible-but-independent draw
 * @param {object} [params]               overrides for NAILBITER_DEFAULTS
 * @returns {Map<string,number>} shift to add to truthRel, one entry per unit in `units`
 */
export function computeNailbiterShift({ truthRel, beta, npv, units, weights, sigma, seed, params = {} }) {
  const p = { ...NAILBITER_DEFAULTS, ...params };
  // Salted so this draw is an independent stream from the campaign/forecast/
  // cycle-drift RNGs, but still fully determined by the run's own seed.
  const rng = mulberry32((seed >>> 0) ^ 0x4E41494C /* 'NAIL' */);
  const noiseModel = createRegionalErrorModel({ units, weights, unitSigmas: sigma, regionShare: p.regionShare });
  const noise = noiseModel.drawRel(rng, p.noiseAmplify);

  const shift = new Map();
  for (const unit of units) {
    const b = beta.get(unit) || 1;
    const natural = (truthRel.get(unit) || 0) + b * npv;
    const w = Math.max(0, 1 - Math.abs(natural) / p.closeThreshold);
    shift.set(unit, w * (-natural * p.squeeze + (noise.get(unit) || 0)));
  }
  return shift;
}

export default { computeNailbiterShift, NAILBITER_DEFAULTS };

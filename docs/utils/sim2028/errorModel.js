'use strict';

/**
 * Correlated error model for the 2028 simulator (brainstorm idea #1).
 *
 * THIS FILE IS THE SWAP SEAM. Any provider implementing the interface below can
 * replace the regional one without touching campaign.js / forecast.js / engine.js:
 *
 *   {
 *     units, unitIndex,
 *     drawRel(rng, scale)            -> Map<unit, number>  // convenience form
 *     drawRelInto(rng, scale, out)   -> void               // vectorized hot path
 *     drawNpv(rng, scale)            -> number
 *   }
 *
 * ## How the correlation is parameterized
 *
 * Each unit's error is its own sd split between a shared regional factor and an
 * idiosyncratic one:
 *
 *   err[u] = sigma[u] * ( regionShare * z_region  +  sqrt(1 - regionShare^2) * z_u )
 *
 * Expressing the split as a SHARE rather than an absolute regional sigma matters.
 * With an absolute sigma, a volatile state (ME-02, sd 8.5pt) would end up nearly
 * uncorrelated with its neighbours while a stable one (NC, sd 1.8pt) would be
 * highly correlated — correlation would be an accident of volatility. With a
 * share, within-region correlation is `regionShare^2` for every pair, so it's one
 * interpretable dial: regionShare 0.7 => ~0.5 correlation.
 *
 * The national factor deliberately lives on the NPV axis instead, which is what
 * keeps "adjust leans" and "NPV moves independently" from double-counting.
 */

import { randn } from '../randomUtils.js';
import { regionOf, REGION_KEYS } from './regions.js';

export const DEFAULT_SPEC = {
  /** Per-unit sd: a Map<unit, sd>, or a single number applied to every unit. */
  unitSigmas: 0.02,
  /** Fraction of each unit's sd carried by its regional factor. corr = share^2. */
  regionShare: 0.7,
  /** Sd of the national popular-vote error. */
  nationalSigma: 0.02,
};

/**
 * Build the regional (hand-bucketed) error provider.
 *
 * @param {object}   spec
 * @param {string[]} spec.units
 * @param {Map<string,number>} spec.weights  vote weights, for recentering
 * @param {Map<string,number>|number} [spec.unitSigmas]
 * @param {number}   [spec.regionShare]
 * @param {number}   [spec.nationalSigma]
 */
export function createRegionalErrorModel(spec) {
  const s = { ...DEFAULT_SPEC, ...spec };
  const unitList = Array.from(s.units);
  const n = unitList.length;

  const unitIndex = new Map();
  const regionIdx = new Int32Array(n);
  const sdArr = new Float64Array(n);
  const weightArray = new Float64Array(n);

  const regionShare = Math.max(0, Math.min(1, s.regionShare));
  const idioShare = Math.sqrt(Math.max(0, 1 - regionShare * regionShare));

  let weightSum = 0;
  for (let i = 0; i < n; i++) {
    const unit = unitList[i];
    unitIndex.set(unit, i);
    const region = regionOf(unit);
    regionIdx[i] = region ? REGION_KEYS.indexOf(region) : -1;
    sdArr[i] = (typeof s.unitSigmas === 'number')
      ? s.unitSigmas
      : ((s.unitSigmas && s.unitSigmas.get(unit)) || DEFAULT_SPEC.unitSigmas);
    weightArray[i] = (s.weights && s.weights.get(unit)) || 0;
    weightSum += weightArray[i];
  }

  const regionZ = new Float64Array(REGION_KEYS.length);

  /**
   * Vectorized draw. Fills `out` (length n) with relative-margin errors that are
   * vote-weighted-centered on zero.
   *
   * Recentering is required: `relative_margin` is (state - national), so its
   * vote-weighted mean is 0 by construction. Any perturbation must preserve that
   * or the national tilt gets counted twice — here and again in the NPV.
   */
  function drawRelInto(rng, scale, out) {
    for (let r = 0; r < regionZ.length; r++) regionZ[r] = randn(rng);

    let acc = 0;
    for (let i = 0; i < n; i++) {
      const shared = regionIdx[i] >= 0 ? regionZ[regionIdx[i]] : 0;
      const v = sdArr[i] * scale * (regionShare * shared + idioShare * randn(rng));
      out[i] = v;
      acc += v * weightArray[i];
    }
    if (weightSum > 0) {
      const mean = acc / weightSum;
      for (let i = 0; i < n; i++) out[i] -= mean;
    }
  }

  const scratch = new Float64Array(n);

  /** Convenience Map form, for the low-volume truth and campaign draws. */
  function drawRel(rng, scale = 1) {
    drawRelInto(rng, scale, scratch);
    const out = new Map();
    for (let i = 0; i < n; i++) out.set(unitList[i], scratch[i]);
    return out;
  }

  function drawNpv(rng, scale = 1) {
    return randn(rng) * s.nationalSigma * scale;
  }

  return { units: unitList, unitIndex, spec: s, drawRel, drawRelInto, drawNpv };
}

export default { createRegionalErrorModel, DEFAULT_SPEC };

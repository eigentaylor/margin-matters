'use strict';

/**
 * Live swing inference for the election-night win-probability estimator.
 *
 * Decomposes each unit's frozen prior error into three independent layers -
 * this is not a new approximation, it's exactly the same generative process
 * docs/election-night.js's buildSyntheticPollPriors() used to build the
 * prior in the first place (one shared regional/idiosyncratic draw plus one
 * shared national draw, both baked additively into every unit's priorMargin
 * once at prepare time):
 *
 *   sigmaN - national, shared by every unit
 *   sigmaR - regional, shared within a regionOf() bucket
 *   sigmaI - idiosyncratic, per unit
 *
 * with sqrt(sigmaN^2 + sigmaR^2 + sigmaI^2) == priorSigma, exactly.
 *
 * Given each currently-reporting unit's own deviation from its prior
 * (d_u = priorMargin_u - observedMargin_u), solveLiveSwing() solves in
 * closed form for the shared national swing N and each region's swing R_r -
 * the "consistent underperformance signals a national/regional swing" signal
 * a future commentary system wants - and sampleSwing()/unitSwingDelta() let
 * a Monte Carlo draw from that solved hierarchy instead of independent,
 * memoryless noise.
 *
 * DOM-free, reads no ground-truth field: only priorMargin/priorSigma
 * (frozen, poll-like public facts) and each unit's own observed vote count,
 * via the observations the caller passes in. Safe by construction against a
 * couple of noisy early reporters swinging the whole estimate: each unit's
 * contributed precision is proportional to how much of it has actually been
 * counted (see computeUnitObservation()'s obsSigma in docs/election-night.js),
 * and the `+ sigmaR^2` term in each region's tau is a principled floor - "no
 * matter how well-counted one region is, it's still only one noisy sample of
 * the shared national mood" - not an arbitrary minimum-sample cutoff.
 */

import { regionOf } from '../sim2028/regions.js';
import { POLL_ERROR_SPEC } from '../sim2028/pollCalibration.js';
import { randStudentT } from '../randomUtils.js';

/**
 * @typedef {Object} SwingObservation
 * @property {string} unitKey
 * @property {number} priorMargin    - this unit's frozen prior margin
 * @property {number} observedMargin - this unit's currently observed margin
 * @property {number} obsSigma       - remaining-batch uncertainty, from computeUnitObservation()
 */

function derivedSigmas(spec) {
  const regionShare = Math.max(0, Math.min(1, spec.regionShare));
  const sigmaN = spec.nationalSigma;
  const sigmaR = spec.unitSigmas * regionShare;
  const sigmaI = spec.unitSigmas * Math.sqrt(Math.max(0, 1 - regionShare * regionShare));
  // randStudentT() elsewhere in this codebase is NOT variance-normalized
  // (Var(t_df) = df/(df-2)) - and buildSyntheticPollPriors() built
  // priorMargin/priorSigma using exactly that unnormalized convention, so
  // the REALIZED spread of priorMargin around truth is already df/(df-2)x
  // wider than priorSigma's nominal value. Inflate here so this solve's
  // precision-weighting matches what's actually been observed, rather than
  // silently mis-trusting the data (see randomUtils.js's randStudentT docs).
  const df = spec.df;
  const tVarFactor = (isFinite(df) && df > 2) ? df / (df - 2) : 1;
  const inflate = Math.sqrt(tVarFactor);
  return {
    sigmaN: sigmaN * inflate,
    sigmaR: sigmaR * inflate,
    sigmaI: sigmaI * inflate
  };
}

/**
 * Closed-form solve for the shared national/regional swing given a set of
 * currently-reporting units' own deviations from their frozen priors.
 *
 * @param {SwingObservation[]} observations
 * @param {object} [spec] defaults to POLL_ERROR_SPEC
 * @param {(unit:string)=>(string|null)} [regionFn] defaults to regionOf
 */
export function solveLiveSwing(observations, spec = POLL_ERROR_SPEC, regionFn = regionOf) {
  const { sigmaN, sigmaR, sigmaI } = derivedSigmas(spec);
  const sigmaN2 = sigmaN * sigmaN;
  const sigmaR2 = sigmaR * sigmaR;
  const sigmaI2 = sigmaI * sigmaI;

  const byRegion = new Map();
  const byUnit = new Map();

  for (const obs of (observations || [])) {
    if (!obs || !isFinite(obs.priorMargin) || !isFinite(obs.observedMargin) || !isFinite(obs.obsSigma)) continue;
    const d = obs.priorMargin - obs.observedMargin;
    const v = sigmaI2 + obs.obsSigma * obs.obsSigma;
    if (!(v > 0)) continue;
    const region = regionFn(obs.unitKey) || null;
    const a = sigmaI2 / v; // shrinkage toward (N + R_r): a -> 1 at full reporting
    byUnit.set(obs.unitKey, { d, v, a, obsSigma: obs.obsSigma, region });
    if (region) {
      if (!byRegion.has(region)) byRegion.set(region, { sumPrec: 0, sumDPrec: 0, n: 0 });
      const g = byRegion.get(region);
      g.sumPrec += 1 / v;
      g.sumDPrec += d / v;
      g.n += 1;
    }
  }

  let precN = sigmaN2 > 0 ? 1 / sigmaN2 : 0;
  let sumDbarOverTau = 0;
  const regionStats = new Map();
  for (const [region, g] of byRegion) {
    const S_r = g.sumPrec;
    const dbar_r = g.sumDPrec / S_r;
    const tau_r = 1 / S_r + sigmaR2; // marginal variance of dbar_r given N - principled floor, see module docstring
    precN += 1 / tau_r;
    sumDbarOverTau += dbar_r / tau_r;
    regionStats.set(region, { dbar: dbar_r, tau: tau_r, nObs: g.n });
  }

  const varN = precN > 0 ? 1 / precN : sigmaN2;
  const nHat = precN > 0 ? sumDbarOverTau * varN : 0;

  const regions = new Map();
  for (const [region, r] of regionStats) {
    const k = sigmaR2 / r.tau; // shrinkage of dbar_r toward N as the region's own precision grows
    const mean = k * (r.dbar - nHat);
    const variance = Math.max(0, sigmaR2 * (1 - k));
    regions.set(region, { mean, sigma: Math.sqrt(variance), nObs: r.nObs, k, dbar: r.dbar, tau: r.tau });
  }

  return {
    national: { mean: nHat, sigma: Math.sqrt(Math.max(0, varN)) },
    regions,
    byUnit,
    sigmaN, sigmaR, sigmaI,
    nObs: byUnit.size
  };
}

/**
 * Draws one Monte Carlo sample of {N, regionDraws} from a solved hierarchy.
 *
 * `allRegions` must include every region any live unit belongs to (not just
 * observed ones) - units sharing an as-yet-unobserved region still need to
 * share one common regional shock, not independent per-unit draws.
 *
 * `drawFn(rng)` must return a standard-normal-ish, roughly-unit-variance
 * value (e.g. randn, or makeNormalizedTDraw()'s output below) - this module
 * keeps its own internal variance convention self-consistent (Var=1) rather
 * than assuming the unnormalized randStudentT() convention used elsewhere.
 */
export function sampleSwing(solved, allRegions, rng, drawFn) {
  const N = solved.national.mean + solved.national.sigma * drawFn(rng);
  const regionDraws = new Map();
  for (const region of allRegions) {
    if (region == null || regionDraws.has(region)) continue;
    const r = solved.regions.get(region);
    if (r) {
      const mean = r.k * (r.dbar - N);
      regionDraws.set(region, mean + r.sigma * drawFn(rng));
    } else {
      regionDraws.set(region, solved.sigmaR * drawFn(rng));
    }
  }
  return { N, regionDraws };
}

/**
 * Given a sample from sampleSwing(), returns the total delta
 * (N + R_region + I_unit) to SUBTRACT from a unit's priorMargin, so
 * margin_u = priorMargin_u - delta.
 *
 * For a unit with its own observation, shrinks the idiosyncratic term
 * toward its own residual - exact at full reporting: delta collapses to
 * exactly priorMargin_u - observedMargin_u, so margin_u == observedMargin_u
 * regardless of the N/R draw, unconditionally. For a unit with no
 * observation, the idiosyncratic term is an unconditional fresh draw.
 */
export function unitSwingDelta(solved, unitKey, region, sample, rng, drawFn) {
  const R = (region != null && sample.regionDraws.has(region)) ? sample.regionDraws.get(region) : 0;
  const obs = solved.byUnit.get(unitKey);
  if (!obs) {
    return sample.N + R + solved.sigmaI * drawFn(rng);
  }
  const condMean = obs.a * (obs.d - sample.N - R);
  const condVar = Math.max(0, (solved.sigmaI * solved.sigmaI * obs.obsSigma * obs.obsSigma) / obs.v);
  return sample.N + R + condMean + Math.sqrt(condVar) * drawFn(rng);
}

/**
 * Convenience drawFn factory: a variance-normalized (Var=1) Student's t via
 * the existing randStudentT(), preserving the "real polling misses are
 * fat-tailed" intent from docs/utils/sim2028/errorModel.js's own docstring
 * without inheriting its unnormalized convention into this module's math.
 */
export function makeNormalizedTDraw(df) {
  const factor = (isFinite(df) && df > 2) ? Math.sqrt(df / (df - 2)) : 1;
  return (rng) => randStudentT(rng, df) / factor;
}

export default { solveLiveSwing, sampleSwing, unitSwingDelta, makeNormalizedTDraw };

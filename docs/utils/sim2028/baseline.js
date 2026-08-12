'use strict';

/**
 * Derives the 2028 starting position for every unit from presidential_margins.csv.
 *
 * Produces four per-unit quantities the rest of the engine needs:
 *   base   - prior 2028 relative margin (2024 lean nudged along its trend)
 *   sigma  - how volatile that unit's lean is cycle-to-cycle
 *   beta   - elasticity: how much of a national swing this unit actually absorbs
 *   weight - vote weight, used to keep relative margins centered
 *
 * Everything here is in margin FRACTIONS (0.045 = D+4.5), positive = Democratic,
 * matching the `rm`/`nm` convention in tester.js and future.js.
 */

import { clamp } from '../mathUtils.js';

/** Units that carry electoral votes. ME/NE appear only as split units in the CSV. */
const EXCLUDED_UNITS = new Set(['NATIONAL', 'US', 'USA']);

/**
 * Maine and Nebraska award two at-large electors on the STATEWIDE result, which
 * is exactly the sum of their districts (verified against 2024 to the vote).
 *
 * So the districts are the primitives: we simulate those and derive the at-large
 * unit from them. Drawing ME-AL independently would let it go D while both
 * ME-01 and ME-02 went R — an arithmetically impossible map — and would also
 * double-count Maine's and Nebraska's voters in every vote-weighted mean.
 */
export const AT_LARGE_COMPONENTS = {
  'ME-AL': ['ME-01', 'ME-02'],
  'NE-AL': ['NE-01', 'NE-02', 'NE-03'],
};

/** 2024 -> 2028 is 0.4 of a decade; matches trending-states.js:512. */
const CYCLE_FRACTION_OF_DECADE = 0.4;

/** Least-squares slope of y on x. Returns 0 when underdetermined. */
export function leastSquaresSlope(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    num += dx * (ys[i] - my);
    den += dx * dx;
  }
  return den > 0 ? num / den : 0;
}

/**
 * Slope of y on x forced through the origin: sum(xy)/sum(x^2).
 *
 * Used for elasticity because the intercept is meaningless here — if the nation
 * doesn't move, a state shouldn't systematically move either (that drift is the
 * trend term, handled separately). Through-origin is also far more stable than
 * full OLS on the ~6 points we have.
 */
export function slopeThroughOrigin(xs, ys) {
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += xs[i] * ys[i];
    den += xs[i] * xs[i];
  }
  return den > 1e-12 ? num / den : 1;
}

/** Sample standard deviation. */
export function stdev(values) {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let acc = 0;
  for (const v of values) acc += (v - mean) * (v - mean);
  return Math.sqrt(acc / (n - 1));
}

/**
 * Group CSV rows into per-unit year-sorted histories.
 * @returns {Map<string, Array<{year, rel, presDelta, natDelta, ev, totalVotes}>>}
 */
function groupByUnit(rows) {
  const byUnit = new Map();
  for (const r of rows) {
    const unit = r.abbr;
    if (!unit || EXCLUDED_UNITS.has(unit)) continue;
    const year = +r.year;
    const rel = +r.relative_margin;
    if (!Number.isFinite(year) || !Number.isFinite(rel)) continue;
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    byUnit.get(unit).push({
      year,
      rel,
      presDelta: Number.isFinite(+r.pres_margin_delta) ? +r.pres_margin_delta : null,
      natDelta: Number.isFinite(+r.national_margin_delta) ? +r.national_margin_delta : null,
      ev: Number.isFinite(+r.electoral_votes) ? +r.electoral_votes : 0,
      totalVotes: Number.isFinite(+r.total_votes) ? +r.total_votes : 0,
    });
  }
  for (const hist of byUnit.values()) hist.sort((a, b) => a.year - b.year);
  return byUnit;
}

/**
 * @param {Array<object>} rows  parsed presidential_margins.csv rows (d3.autoType'd)
 * @param {object} [opts]
 * @param {number} [opts.baseYear=2024]
 * @param {number} [opts.trendWindow=5]       elections used for the trend slope
 * @param {number} [opts.sigmaWindow=6]       cycles used for volatility
 * @param {number} [opts.elasticityWindow=6]  cycles used for the elasticity fit
 * @param {number} [opts.trendWeight=0.6]     how much of the fitted trend to apply;
 *        0 disables the nudge entirely. A linear fit over 5 elections overshoots
 *        when a state has already flattened out (AZ) or reversed (MI), so this
 *        keeps the direction as a lean rather than a commitment.
 * @param {number} [opts.betaShrink=0.5]      shrink elasticity toward 1. Six noisy
 *        cycles produce artifacts — AZ fits 0.43 purely because McCain was on the
 *        2008 ballot — so trust the estimate only halfway.
 */
export function buildBaseline(rows, opts = {}) {
  const {
    baseYear = 2024,
    trendWindow = 5,
    sigmaWindow = 6,
    elasticityWindow = 6,
    trendWeight = 0.6,
    betaShrink = 0.5,
    sigmaFloor = 0.015,
    sigmaCap = 0.045,
    sigmaShrink = 0.4,
    betaRange = [0.35, 1.65],
  } = opts;

  const byUnit = groupByUnit(rows);
  const nationalRow = rows.find(r => r.abbr === 'NATIONAL' && +r.year === baseYear);
  const npvBase = nationalRow ? +nationalRow.national_margin : 0;
  const candidates = {
    d: (nationalRow && nationalRow.D_candidate) || 'Democrat',
    r: (nationalRow && nationalRow.R_candidate) || 'Republican',
  };

  const units = [];
  const rel2024 = new Map();
  const trend = new Map();
  const base = new Map();
  const sigma = new Map();
  const betaRaw = new Map();
  const ev = new Map();
  const totalVotes = new Map();

  for (const [unit, hist] of byUnit) {
    const current = hist.find(h => h.year === baseYear);
    if (!current || !(current.ev > 0)) continue;

    // --- trend: OLS slope of relative margin over the last N elections ---
    const trendPts = hist.slice(-trendWindow);
    const slopePerYear = leastSquaresSlope(trendPts.map(p => p.year), trendPts.map(p => p.rel));
    const perDecade = slopePerYear * 10;

    // --- volatility: sd of cycle-to-cycle changes in the lean ---
    const sigmaPts = hist.slice(-(sigmaWindow + 1));
    const deltas = [];
    for (let i = 1; i < sigmaPts.length; i++) deltas.push(sigmaPts[i].rel - sigmaPts[i - 1].rel);
    const sd = Math.max(sigmaFloor, stdev(deltas));

    // --- elasticity: how much of a national swing this unit absorbs ---
    const elPts = hist.slice(-elasticityWindow)
      .filter(p => p.presDelta != null && p.natDelta != null && Math.abs(p.natDelta) > 1e-6);
    const fitBeta = elPts.length >= 2
      ? slopeThroughOrigin(elPts.map(p => p.natDelta), elPts.map(p => p.presDelta))
      : 1;
    const rawBeta = 1 + betaShrink * (fitBeta - 1);

    units.push(unit);
    rel2024.set(unit, current.rel);
    trend.set(unit, perDecade);
    base.set(unit, current.rel + perDecade * CYCLE_FRACTION_OF_DECADE * trendWeight);
    sigma.set(unit, sd);
    betaRaw.set(unit, clamp(rawBeta, betaRange[0], betaRange[1]));
    ev.set(unit, current.ev);
    totalVotes.set(unit, current.totalVotes);
  }

  // --- shrink cycle volatility ----------------------------------------------
  // The raw per-state sd overstates forward volatility badly. It is measured over
  // an era containing genuine realignments (2008, 2016), so states that lurched
  // once — ME-AL sits at 6.1pt — get treated as though they lurch every cycle,
  // producing 10-17pt lean swings and a new political map every election.
  // Shrink each state toward the cross-state median and cap the result, keeping
  // the ordering (volatile states stay volatile) without the tail.
  const sigmaValues = Array.from(sigma.values()).sort((a, b) => a - b);
  const medianSigma = sigmaValues.length
    ? sigmaValues[Math.floor(sigmaValues.length / 2)]
    : sigmaFloor;
  for (const [unit, raw] of sigma) {
    const shrunk = medianSigma + sigmaShrink * (raw - medianSigma);
    sigma.set(unit, clamp(shrunk, sigmaFloor, sigmaCap));
  }

  // --- at-large derivation --------------------------------------------------
  // atLarge maps each -AL unit to its component districts with within-state
  // vote weights. simUnits is everything we actually draw randomness for.
  const atLarge = new Map();
  for (const [alUnit, parts] of Object.entries(AT_LARGE_COMPONENTS)) {
    const present = parts.filter(pt => totalVotes.has(pt));
    if (!units.includes(alUnit) || present.length !== parts.length) continue;
    const partSum = present.reduce((a, pt) => a + (totalVotes.get(pt) || 0), 0) || 1;
    atLarge.set(alUnit, present.map(pt => ({ unit: pt, weight: (totalVotes.get(pt) || 0) / partSum })));
  }
  const simUnits = units.filter(u => !atLarge.has(u));

  // Vote weights over simUnits only, so ME/NE voters are counted exactly once.
  const voteSum = simUnits.reduce((a, u) => a + (totalVotes.get(u) || 0), 0) || 1;
  const weights = new Map();
  for (const unit of simUnits) weights.set(unit, (totalVotes.get(unit) || 0) / voteSum);

  // Normalize elasticity so the vote-weighted mean is exactly 1: a national
  // swing of X must move the national margin by X, not by X * mean(beta).
  let betaMean = 0;
  for (const unit of simUnits) betaMean += betaRaw.get(unit) * weights.get(unit);
  const beta = new Map();
  for (const unit of simUnits) {
    beta.set(unit, betaMean > 1e-9 ? betaRaw.get(unit) / betaMean : 1);
  }

  // The relative margins should already be vote-centered; enforce it so the
  // trend nudge can't smuggle in a national tilt.
  let baseMean = 0;
  for (const unit of simUnits) baseMean += base.get(unit) * weights.get(unit);
  for (const unit of simUnits) base.set(unit, base.get(unit) - baseMean);

  const result = {
    units, simUnits, atLarge,
    base, rel2024, trend, sigma, beta, ev, totalVotes, weights,
    npvBase, candidates, baseYear,
    totalEv: Array.from(ev.values()).reduce((a, b) => a + b, 0),
  };

  // At-large base/beta are the vote-weighted aggregate of their districts, which
  // makes margin_AL = rel_AL + beta_AL * npv hold exactly.
  deriveAtLarge(base, result);
  deriveAtLarge(beta, result);
  return result;
}

/**
 * Fill in each at-large unit as the vote-weighted mean of its districts.
 * Mutates and returns `map`. Valid for any quantity that aggregates linearly by
 * votes — relative margins, absolute margins, and elasticity all do.
 */
export function deriveAtLarge(map, baseline) {
  for (const [alUnit, parts] of baseline.atLarge) {
    let acc = 0;
    for (const part of parts) acc += (map.get(part.unit) || 0) * part.weight;
    map.set(alUnit, acc);
  }
  return map;
}

/** Convenience loader that pulls the CSV through the shared cached DataLoader. */
export async function loadBaseline(opts = {}) {
  const loader = (typeof window !== 'undefined') ? window.DataLoader : null;
  if (!loader || typeof loader.loadPresidentialMargins !== 'function') {
    throw new Error('sim2028/baseline: window.DataLoader is required (load utils/dataLoader.js first)');
  }
  const rows = await loader.loadPresidentialMargins();
  return buildBaseline(rows, opts);
}

export default { buildBaseline, loadBaseline, leastSquaresSlope, slopeThroughOrigin, stdev };

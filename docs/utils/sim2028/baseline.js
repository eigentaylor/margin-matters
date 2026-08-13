'use strict';

/**
 * Derives the 2028 starting position for every unit from presidential_margins.csv.
 *
 * Produces four per-unit quantities the rest of the engine needs, plus
 * `rel2024`/`relPrior` for display (real 2024/2020 history, not model inputs):
 *   base   - prior 2028 relative margin (2024 lean, trendWeight nudge is 0 by default)
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
 * PLACEHOLDER 2028 candidates. The 2024 row's D_candidate/R_candidate are
 * Harris/Trump — accurate for where every number here is measured FROM, but a
 * strange thing to display as who's running in the simulated election itself.
 * Swap freely; nothing else derives from these two strings.
 */
const PLACEHOLDER_CANDIDATES = { d: 'Jon Ossoff', r: 'JD Vance' };

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
 * The intercept is meaningless here — if the nation doesn't move, a state
 * shouldn't systematically move either (that drift is the trend term, handled
 * separately) — but least-squares itself is not robust: a single anomalous
 * cycle can dominate a fit this small. See medianRatioThroughOrigin below,
 * used for the actual elasticity fit instead.
 */
export function slopeThroughOrigin(xs, ys) {
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += xs[i] * ys[i];
    den += xs[i] * xs[i];
  }
  return den > 1e-12 ? num / den : 1;
}

/**
 * Robust through-origin slope: the median of each point's own y/x ratio
 * (Theil-Sen restricted to pairings with the origin, rather than every pair
 * of points — the natural through-origin analogue).
 *
 * Favorite-son/home-state anomalies (Palin on the ticket for AK in 2008,
 * McCain for AZ in 2008, Romney for UT in 2012, ...) always cost TWO points
 * out of the ~6-cycle elasticity window: the anomalous cycle itself (that
 * state barely moves with, or moves opposite, a national wave) and the
 * reversion cycle right after (it swings back, again against the national
 * grain). slopeThroughOrigin's sum(xy)/sum(x^2) has no defense against that —
 * squared residuals give the worst points the most leverage. A median
 * tolerates close to half the sample being like this before it moves much.
 */
export function medianRatioThroughOrigin(xs, ys) {
  const ratios = [];
  for (let i = 0; i < xs.length; i++) {
    if (Math.abs(xs[i]) > 1e-9) ratios.push(ys[i] / xs[i]);
  }
  if (!ratios.length) return 1;
  ratios.sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  return ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
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
      presMargin: Number.isFinite(+r.pres_margin) ? +r.pres_margin : null,
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
 * @param {number} [opts.trendWindow=5]       elections used to fit the (now inert
 *        by default — see trendWeight) OLS trend slope
 * @param {number} [opts.sigmaWindow=3]       elections used for volatility, i.e.
 *        2 cycle-to-cycle deltas: 2016->2020 and 2020->2024. See trendWeight's
 *        note — this window was chosen the same way, by backtesting.
 * @param {number} [opts.elasticityWindow=6]  cycles used for the elasticity fit
 * @param {number} [opts.trendWeight=0]       how much of the fitted OLS trend to
 *        apply to the central 2028 lean. BACKTESTED AND FOUND HARMFUL: predicting
 *        each of 2016/2020/2024 from only the elections before it, "just use the
 *        prior election's lean" (trendWeight=0) beat every tested nonzero weight
 *        (0.3, 0.6, 1.0) on median AND mean error, in all three target years, and
 *        the trend's sign matched the actual direction of movement only 48-54% of
 *        the time — indistinguishable from a coin flip. Worst offenders were
 *        exactly the states a hand-drawn trend line looks most convincing for:
 *        WI/MI/PA/OH/ME-02 continuing their post-2016 lean-right line and NC/GA
 *        continuing left, all reversed course by 2024. Left at 0, not removed,
 *        so the effect is easy to re-enable and re-test if a future backtest
 *        (e.g. once 2028 is real data) tells a different story.
 * @param {number} [opts.betaShrink=0.5]      shrink elasticity toward 1. Six noisy
 *        cycles is still a small sample even with medianRatioThroughOrigin's
 *        robustness to favorite-son-style anomalies (AZ/McCain '08, AK/Palin
 *        '08, UT/Romney '12) — trust the estimate only halfway.
 */
export function buildBaseline(rows, opts = {}) {
  const {
    baseYear = 2024,
    trendWindow = 5,
    sigmaWindow = 3,
    elasticityWindow = 6,
    trendWeight = 0,
    betaShrink = 0.5,
    sigmaFloor = 0.012,
    sigmaCap = 0.06,
    sigmaShrink = 0.55,
    betaRange = [0.35, 1.65],
  } = opts;

  const byUnit = groupByUnit(rows);
  const nationalRow = rows.find(r => r.abbr === 'NATIONAL' && +r.year === baseYear);
  const npvBase = nationalRow ? +nationalRow.national_margin : 0;
  const candidates = { ...PLACEHOLDER_CANDIDATES };

  const units = [];
  const rel2024 = new Map();
  // The prior cycle's lean, for display next to rel2024 as real history — the
  // pair a pundit would actually look at. Not fed into `base` or `sigma`; those
  // are governed entirely by trendWeight/sigmaWindow above.
  const relPrior = new Map();
  // The raw (not nation-relative) margin for the same two years. "Lean" is an
  // abstraction — "PA is D+0.4 relative to the nation" doesn't say who WON PA,
  // since that depends on the national environment too. The raw margin is the
  // number people actually recognize ("Biden won PA by 1.2 in 2020").
  const presMargin2024 = new Map();
  const presMarginPrior = new Map();
  const trend = new Map();
  const base = new Map();
  const sigma = new Map();
  const betaRaw = new Map();
  const ev = new Map();
  const totalVotes = new Map();

  for (const [unit, hist] of byUnit) {
    const current = hist.find(h => h.year === baseYear);
    if (!current || !(current.ev > 0)) continue;
    const prior = hist.find(h => h.year === baseYear - 4);

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
      ? medianRatioThroughOrigin(elPts.map(p => p.natDelta), elPts.map(p => p.presDelta))
      : 1;
    const rawBeta = 1 + betaShrink * (fitBeta - 1);

    units.push(unit);
    rel2024.set(unit, current.rel);
    if (current.presMargin != null) presMargin2024.set(unit, current.presMargin);
    if (prior) {
      relPrior.set(unit, prior.rel);
      if (prior.presMargin != null) presMarginPrior.set(unit, prior.presMargin);
    }
    trend.set(unit, perDecade);
    base.set(unit, current.rel + perDecade * CYCLE_FRACTION_OF_DECADE * trendWeight);
    sigma.set(unit, sd);
    betaRaw.set(unit, clamp(rawBeta, betaRange[0], betaRange[1]));
    ev.set(unit, current.ev);
    totalVotes.set(unit, current.totalVotes);
  }

  // --- shrink cycle volatility ----------------------------------------------
  // sigmaWindow=3 deliberately measures only the 2016->2020->2024 era (2 deltas)
  // rather than a longer window blending in 2008/2016-style realignment cycles —
  // backtesting (see trendWeight above) showed 2020/2024 moved states roughly
  // 2.5x LESS than 2016 did (median |change| 2.3-2.9pt vs 4.5pt), and a window
  // wide enough to include 2008/2016 as "typical" was itself the reason a state
  // that lurched once, like ME-02 (17pt in 2016 alone), got treated as if it
  // lurches every cycle. But 2 deltas per state is a very small, noisy sample on
  // its own, so this still shrinks each state part-way toward the cross-state
  // median and caps the result — now protecting against sampling noise in a
  // correctly-scoped window, not compensating for a wrongly-scoped one.
  // The possibility of a 2016-style outlier cycle is handled separately, by
  // engine.js's per-cycle turbulence multiplier — it belongs on the whole
  // election at once (a realignment doesn't hit one state in isolation), not
  // baked into any single state's baseline sigma.
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
  const betaFitted = new Map();
  for (const unit of simUnits) {
    betaFitted.set(unit, betaMean > 1e-9 ? betaRaw.get(unit) / betaMean : 1);
  }

  // Uniform alternative: every unit absorbs a national swing 1:1. Lets the
  // "Elasticity" toggle A/B the fitted per-unit betas above against the null
  // hypothesis that they're not adding anything real — flip it off and see
  // whether results feel better or worse.
  const betaUniform = new Map();
  for (const unit of simUnits) betaUniform.set(unit, 1);

  // The relative margins should already be vote-centered; enforce it so the
  // trend nudge can't smuggle in a national tilt.
  let baseMean = 0;
  for (const unit of simUnits) baseMean += base.get(unit) * weights.get(unit);
  for (const unit of simUnits) base.set(unit, base.get(unit) - baseMean);

  const result = {
    units, simUnits, atLarge,
    base, rel2024, relPrior, presMargin2024, presMarginPrior, trend, sigma, ev, totalVotes, weights,
    // `beta` is the active map the rest of the engine reads; defaults to the
    // fitted values. sim2028.js repoints it to betaUniform when the
    // Elasticity toggle is off, ahead of each createSimulation() call.
    beta: betaFitted, betaFitted, betaUniform,
    npvBase, candidates, baseYear, priorYear: baseYear - 4,
    totalEv: Array.from(ev.values()).reduce((a, b) => a + b, 0),
  };

  // At-large base/beta are the vote-weighted aggregate of their districts, which
  // makes margin_AL = rel_AL + beta_AL * npv hold exactly.
  deriveAtLarge(base, result);
  deriveAtLarge(betaFitted, result);
  deriveAtLarge(betaUniform, result);
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

export default { buildBaseline, loadBaseline, leastSquaresSlope, slopeThroughOrigin, medianRatioThroughOrigin, stdev };

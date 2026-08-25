'use strict';

/**
 * Monte Carlo forecast over the polls at a given campaign step.
 *
 * Critically this only ever sees the OBSERVABLE polls, never the hidden truth —
 * exactly like a real forecaster. Remaining uncertainty shrinks as the campaign
 * progresses but never reaches zero, because the irreducible polling error is
 * what nobody can forecast away.
 *
 * Produces the EV histogram, win probabilities, per-state win probabilities, and
 * the tipping-point state.
 *
 * Written against typed arrays throughout: this is the hot path (thousands of
 * sims x ~56 units per campaign step), and Map lookups dominated the runtime.
 */

import { mulberry32 } from '../randomUtils.js';
import { createRegionalErrorModel } from './errorModel.js';
import { sharesThreeWay } from './electionNightBridge.js';

/**
 * Scales are multiples of the polling-error spec's sigmas, as in campaign.js, and
 * split across the same two axes: the forecaster is much less sure about the
 * national environment in June than about any state's lean relative to it.
 * floorScale is the election-day miss, which nobody can forecast away.
 *
 * floorScale=1.0 means the forecast never discounts below engine.js
 * PARAMS.poll's full nationalSigma/unitSigmas, even at Election Eve — matched
 * to the research doc's empirical "good year" figures (national ~2pt, state
 * ~2pt independent + regional layers, ~3.5pt total RMSE per Shirani-Mehr et
 * al.). This is what keeps close races reading as genuinely uncertain deep
 * into the campaign instead of resolving to false-confident 90%+ calls; only
 * a real landslide NPV is far enough from 50-50 to call confidently regardless.
 * The UI's "Confident forecasts" toggle swaps this back to 0.65 (engine.js's
 * LEGACY_CALIBRATION) for the original, narrower/more-decisive behavior.
 */
export const DEFAULT_FORECAST_PARAMS = {
  sims: 3000,
  rel: { startScale: 0.9, floorScale: 1.0 },
  npv: { startScale: 1.8, floorScale: 1.0 },
};

/** Total EV needed to win, given the full EV pool. */
export function evsToWin(totalEv) {
  return Math.floor(totalEv / 2) + 1;
}

/**
 * Uncertainty scale remaining at campaign progress p (0 = June, 1 = election eve).
 * Decays from startScale down to floorScale, which it never goes below.
 *
 * `axis` selects 'rel' or 'npv'; passing a {startScale, floorScale} object works too.
 */
export function remainingScale(progress, params = DEFAULT_FORECAST_PARAMS, axis = 'npv') {
  const p = Math.max(0, Math.min(1, progress));
  const a = (params && params[axis]) || params || DEFAULT_FORECAST_PARAMS[axis];
  const start = a.startScale != null ? a.startScale : DEFAULT_FORECAST_PARAMS[axis].startScale;
  const floor = a.floorScale != null ? a.floorScale : DEFAULT_FORECAST_PARAMS[axis].floorScale;
  return floor + (start - floor) * Math.pow(1 - p, 1.6);
}

/**
 * Run the Monte Carlo.
 *
 * @param {object} o
 * @param {Map<string,number>} o.pollRel  observed relative margins this step
 * @param {number}             o.pollNpv  observed national popular vote
 * @param {object}             o.baseline from baseline.js
 * @param {number}             o.progress 0..1 campaign progress
 * @param {number}             o.seed     seed for this forecast, kept separate from
 *        the campaign stream so re-forecasting can't perturb the election itself
 * @param {object}             [o.params]
 * @param {object}             [o.pollSpec] error-model spec describing the polling
 *        error the forecaster believes in (see errorModel.js DEFAULT_SPEC)
 * @param {Map<string,number>} [o.pollThird] observed third-party poll share per
 *        unit (see sim2028.js's pollShares()), when the third-party mechanic is
 *        on; omitted/null degenerates every sim back to a plain D-vs-R race,
 *        same as before this existed. Perturbed with its own draw off the same
 *        regional error model as the D-R rel axis (reusing that machinery
 *        rather than a separately-tuned O sigma, same simplification campaign.js's
 *        mirage bias already makes) - this is what lets a state's simulated
 *        winner actually be O, not just D or R with a third color painted over it.
 * @param {number}             [o.siphonLean=0.5] see electionNightBridge.js's
 *        sharesThreeWay - which major party a competitive third-party candidate
 *        draws relatively more from.
 */
export function runForecast({
  pollRel, pollNpv, baseline, progress, seed, params = {}, pollSpec = {}, pollThird = null, siphonLean = 0.5,
}) {
  const p = {
    ...DEFAULT_FORECAST_PARAMS,
    ...params,
    rel: { ...DEFAULT_FORECAST_PARAMS.rel, ...(params.rel || {}) },
    npv: { ...DEFAULT_FORECAST_PARAMS.npv, ...(params.npv || {}) },
  };
  const rng = mulberry32(seed >>> 0);
  const relScale = remainingScale(progress, p, 'rel');
  const npvScale = remainingScale(progress, p, 'npv');

  // The forecaster's own error model uses the same correlation structure as
  // reality — one assuming independent state errors would be wildly overconfident.
  const model = createRegionalErrorModel({
    units: baseline.simUnits,
    weights: baseline.weights,
    ...pollSpec,
  });

  // Layout: the first `nSim` slots are drawn units; at-large units occupy the
  // tail and are derived from their districts each sim rather than drawn.
  const simUnits = baseline.simUnits;
  const alUnits = Array.from(baseline.atLarge.keys());
  const units = simUnits.concat(alUnits);
  const nSim = simUnits.length;
  const n = units.length;
  const totalEv = baseline.totalEv;
  const needed = evsToWin(totalEv);

  const hasThird = !!pollThird;

  // Flatten everything the loop touches into typed arrays.
  const pollArr = new Float64Array(n);
  const betaArr = new Float64Array(n);
  const evArr = new Int32Array(n);
  const thirdArr = hasThird ? new Float64Array(n) : null;
  for (let i = 0; i < n; i++) {
    pollArr[i] = pollRel.get(units[i]) || 0;
    betaArr[i] = baseline.beta.get(units[i]) || 1;
    evArr[i] = baseline.ev.get(units[i]) || 0;
    if (hasThird) thirdArr[i] = pollThird.get(units[i]) || 0;
  }

  // Component indices/weights for each at-large unit.
  const indexOf = new Map(units.map((u, i) => [u, i]));
  const alParts = alUnits.map(al => baseline.atLarge.get(al).map(
    part => ({ idx: indexOf.get(part.unit), weight: part.weight })));

  const err = new Float64Array(nSim);
  const errT = hasThird ? new Float64Array(nSim) : null;
  const margins = new Float64Array(n);
  const thirdSim = hasThird ? new Float64Array(n) : null;
  const order = new Int32Array(n);
  const demWinCounts = new Int32Array(n);
  const tippingCounts = new Int32Array(n);
  const demEvSamples = new Int32Array(p.sims);
  const evCounts = new Map();

  let demWins = 0, repWins = 0, othWins = 0, noMajority = 0;

  for (let s = 0; s < p.sims; s++) {
    model.drawRelInto(rng, relScale, err);
    const npv = pollNpv + model.drawNpv(rng, npvScale);
    // Third-party share gets its own draw off the same regional error model,
    // scaled the same way the D-R rel axis is - a simplification (no
    // separately-tuned O sigma exists yet), but enough to let a competitive
    // third party's simulated share genuinely move sim to sim rather than
    // sitting frozen at today's poll reading.
    if (hasThird) model.drawRelInto(rng, relScale, errT);

    let demEv = 0, repEv = 0, othEv = 0;
    for (let i = 0; i < nSim; i++) {
      margins[i] = pollArr[i] + err[i] + betaArr[i] * npv;
      if (hasThird) thirdSim[i] = thirdArr[i] + errT[i];
    }
    // At-large margins (and, when on, third-party shares) are the vote-weighted
    // aggregate of their districts, so a statewide result can never contradict
    // the districts that compose it.
    for (let a = 0; a < alParts.length; a++) {
      let acc = 0, accT = 0;
      for (const part of alParts[a]) {
        acc += margins[part.idx] * part.weight;
        if (hasThird) accT += thirdSim[part.idx] * part.weight;
      }
      margins[nSim + a] = acc;
      if (hasThird) thirdSim[nSim + a] = accT;
    }
    for (let i = 0; i < n; i++) {
      order[i] = i;
      // A third-party win only counts as such when it actually leads both
      // major parties in THIS sim - same "who's really ahead" test buildRows()
      // uses on election night, so a forecast unit's simulated winner can
      // never disagree with what election night itself would call.
      if (hasThird) {
        const shares = sharesThreeWay(margins[i], thirdSim[i], siphonLean);
        if (shares.oShare > shares.dShare && shares.oShare > shares.rShare) {
          othEv += evArr[i];
          continue;
        }
      }
      if (margins[i] >= 0) { demEv += evArr[i]; demWinCounts[i]++; }
      else { repEv += evArr[i]; }
    }

    demEvSamples[s] = demEv;
    evCounts.set(demEv, (evCounts.get(demEv) || 0) + 1);

    // "No majority" replaces the old "exact tie": with only two parties on the
    // board, neither side reaching 270 was only ever possible at a literal
    // EV tie. Once a third-party candidate can actually win states outright,
    // it becomes a real, non-degenerate possibility that nobody clears a
    // majority - which is exactly what the 12th Amendment's contingent
    // election exists for, so this is worth its own bucket rather than
    // folding into "tie".
    if (demEv >= needed) demWins++;
    else if (repEv >= needed) repWins++;
    else if (othEv >= needed) othWins++;
    else noMajority++;

    // Tipping point: order states from the winner's best to worst and walk until
    // the running EV total crosses the threshold. That state delivered the majority.
    // Deliberately still the plain D-vs-R read regardless of third party (same
    // scope boundary as the electoral snake) - a third-party win isn't a
    // "tipping point" in the sense this chart tracks.
    const winnerIsDem = demEv >= repEv;
    order.sort(winnerIsDem
      ? (a, b) => margins[b] - margins[a]
      : (a, b) => margins[a] - margins[b]);
    let acc = 0;
    for (let k = 0; k < n; k++) {
      const idx = order[k];
      acc += evArr[idx];
      if (acc >= needed) { tippingCounts[idx]++; break; }
    }
  }

  const sims = p.sims;
  const stateProb = new Map();
  for (let i = 0; i < n; i++) stateProb.set(units[i], demWinCounts[i] / sims);

  let tippingPoint = null, tippingBest = -1;
  for (let i = 0; i < n; i++) {
    if (tippingCounts[i] > tippingBest) { tippingBest = tippingCounts[i]; tippingPoint = units[i]; }
  }

  const sortedEv = Array.from(demEvSamples).sort((a, b) => a - b);
  const quantile = q => sortedEv[Math.min(sims - 1, Math.max(0, Math.floor(q * sims)))];

  return {
    sims,
    relScale,
    npvScale,
    totalEv,
    needed,
    demWinProb: demWins / sims,
    repWinProb: repWins / sims,
    othWinProb: othWins / sims,
    noMajorityProb: noMajority / sims,
    evCounts,
    medianDemEv: quantile(0.5),
    evRange90: [quantile(0.05), quantile(0.95)],
    stateProb,
    tippingPoint,
    tippingProb: tippingBest > 0 ? tippingBest / sims : 0,
  };
}

/**
 * 90% interval of the national margin implied by the remaining uncertainty.
 * Drives the narrowing band on the trendline chart.
 */
export function npvBand(pollNpv, progress, sigmaNational, params = DEFAULT_FORECAST_PARAMS) {
  const sd = sigmaNational * remainingScale(progress, params, 'npv');
  return [pollNpv - 1.645 * sd, pollNpv + 1.645 * sd];
}

export default { runForecast, remainingScale, npvBand, evsToWin, DEFAULT_FORECAST_PARAMS };

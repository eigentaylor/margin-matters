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

/**
 * Scales are multiples of the polling-error spec's sigmas, as in campaign.js, and
 * split across the same two axes: the forecaster is much less sure about the
 * national environment in June than about any state's lean relative to it.
 * floorScale is the election-day miss, which nobody can forecast away.
 */
export const DEFAULT_FORECAST_PARAMS = {
  sims: 3000,
  rel: { startScale: 0.9, floorScale: 0.65 },
  npv: { startScale: 1.8, floorScale: 0.65 },
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
 */
export function runForecast({ pollRel, pollNpv, baseline, progress, seed, params = {}, pollSpec = {} }) {
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

  // Flatten everything the loop touches into typed arrays.
  const pollArr = new Float64Array(n);
  const betaArr = new Float64Array(n);
  const evArr = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    pollArr[i] = pollRel.get(units[i]) || 0;
    betaArr[i] = baseline.beta.get(units[i]) || 1;
    evArr[i] = baseline.ev.get(units[i]) || 0;
  }

  // Component indices/weights for each at-large unit.
  const indexOf = new Map(units.map((u, i) => [u, i]));
  const alParts = alUnits.map(al => baseline.atLarge.get(al).map(
    part => ({ idx: indexOf.get(part.unit), weight: part.weight })));

  const err = new Float64Array(nSim);
  const margins = new Float64Array(n);
  const order = new Int32Array(n);
  const demWinCounts = new Int32Array(n);
  const tippingCounts = new Int32Array(n);
  const demEvSamples = new Int32Array(p.sims);
  const evCounts = new Map();

  let demWins = 0, repWins = 0, ties = 0;

  for (let s = 0; s < p.sims; s++) {
    model.drawRelInto(rng, relScale, err);
    const npv = pollNpv + model.drawNpv(rng, npvScale);

    let demEv = 0;
    for (let i = 0; i < nSim; i++) {
      margins[i] = pollArr[i] + err[i] + betaArr[i] * npv;
    }
    // At-large margins are the vote-weighted aggregate of their districts, so a
    // statewide result can never contradict the districts that compose it.
    for (let a = 0; a < alParts.length; a++) {
      let acc = 0;
      for (const part of alParts[a]) acc += margins[part.idx] * part.weight;
      margins[nSim + a] = acc;
    }
    for (let i = 0; i < n; i++) {
      order[i] = i;
      if (margins[i] >= 0) { demEv += evArr[i]; demWinCounts[i]++; }
    }

    demEvSamples[s] = demEv;
    evCounts.set(demEv, (evCounts.get(demEv) || 0) + 1);

    const repEv = totalEv - demEv;
    if (demEv >= needed) demWins++;
    else if (repEv >= needed) repWins++;
    else ties++;

    // Tipping point: order states from the winner's best to worst and walk until
    // the running EV total crosses the threshold. That state delivered the majority.
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
    tieProb: ties / sims,
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

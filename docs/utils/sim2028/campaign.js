'use strict';

/**
 * Campaign polling trajectory: a genuine simplex-sampling model.
 *
 * Ground truth for a unit is a point on the (D, R, T) sub-simplex — via
 * `sharesThreeWay`, the same D/R/third-party carve-up election night itself
 * uses (electionNightBridge.js), so a poll's destination always agrees with
 * what election night eventually reveals. Each month's poll adds a fourth
 * axis, Undecided, whose share shrinks from `undecided.u0` (June) toward a
 * nonzero `undecided.uFloor` (Election Eve — a few voters never fully settle,
 * even on the eve of the election) — a literal path across the simplex from
 * "mostly undecided" to "the truth." These are sized to look like a real
 * poll's own undecided/other line (well under 20% in June, ~3% at the end),
 * not the wide swing a genuinely persuadable electorate implies.
 *
 * That "genuinely persuadable" quantity is real too, just DIFFERENT from the
 * literal undecided count — plenty of voters who give a pollster an answer in
 * June are still soft/gettable, not just the ones who say "not sure." So a
 * SECOND curve, `softness`, tracks that separately: it still starts high
 * (most of the race is unsettled in June) and decays the same shape as
 * before this split existed. `softness` is what weights the one-time,
 * regionally-correlated "mirage bias" nudge applied to the center of the
 * simplex before sampling — a poll can only be as wrong as the race is still
 * soft, which is a bigger number, for longer, than "how many people literally
 * say undecided."
 *
 * n=1000 simulated respondents are then actually sampled from the resulting
 * probability simplex (`randMultinomial`) every step. That sampling noise —
 * not a separate "wobble" term — is what keeps every step visibly bouncing,
 * including Election Eve.
 *
 * Two INDEPENDENT polls run every step, mirroring how `pollRel` (a unit's
 * lean relative to the nation) and `pollNpv` (the national mood) are drawn
 * and reported separately today, then recombined only at consumption time
 * via `pollRel[unit] + beta[unit]*pollNpv` (see forecast.js, sim2028.js):
 *
 *   - a NATIONAL poll (one simplex, one n=1000 sample) of the true national
 *     popular vote (+ national third-party strength).
 *   - a STATE poll (n=1000, independent per unit) of that unit's own truth,
 *     which already bakes in its relative lean (truth margin = rel + beta*npv,
 *     unchanged from today).
 *
 * `pollRel[unit]` is then DERIVED by inverting that same formula —
 * `obsMargin[unit] - beta[unit]*obsNpv` — so the identity every downstream
 * consumer (forecast.js, calibrate.mjs, electionRatings.js, election night)
 * already assumes keeps holding exactly, even though the randomness now comes
 * from real sampling instead of a Gaussian nudge. Sampling noise is correctly
 * independent state-to-state (different respondents); only the systematic
 * mirage bias is regionally correlated — a poll's METHODOLOGY can miss the
 * same way across similar states, its SAMPLE doesn't share respondents.
 */

import { deriveAtLarge } from './baseline.js';
import { sharesThreeWay } from './electionNightBridge.js';
import { randMultinomial } from '../randomUtils.js';

/** Canonical 6-step timeline. Other step counts interpolate against this. */
const CANONICAL_LABELS = ['June', 'July', 'August', 'September', 'October', 'Election Eve'];

/**
 * `undecided`: the literal Undecided share a poll would report — realistic
 * poll-sized (16% in June down to 3% at Election Eve), shown directly in the
 * D/R/T/U breakdown.
 * `softness`: how much of the race is still unsettled/persuadable — a
 * bigger, slower-decaying number than literal undecideds, since plenty of
 * "decided" respondents are still soft. Weights the mirage bias only; never
 * shown directly. (These are the original u0/uFloor/uPower values from
 * before undecided/softness were split into two curves.)
 * sampleSize is shared by every simplex poll drawn this campaign (state and
 * national alike); variable-by-state sample sizes are a deliberately
 * deferred v2 idea.
 */
export const DEFAULT_CAMPAIGN_PARAMS = {
  steps: 6,
  sampleSize: 1000,
  rel: {
    undecided: { u0: 0.16, uFloor: 0.03, uPower: 1.4 },
    softness: { u0: 0.5, uFloor: 0.06, uPower: 1.4 },
  },
  npv: {
    undecided: { u0: 0.16, uFloor: 0.03, uPower: 1.4 },
    softness: { u0: 0.5, uFloor: 0.06, uPower: 1.4 },
  },
};

/** Human labels for an N-step campaign, always ending on election eve. */
export function campaignLabels(steps) {
  if (steps === CANONICAL_LABELS.length) return CANONICAL_LABELS.slice();
  const out = [];
  for (let i = 0; i < steps; i++) {
    if (i === steps - 1) { out.push('Election Eve'); continue; }
    const idx = Math.round((i / Math.max(1, steps - 1)) * (CANONICAL_LABELS.length - 1));
    out.push(CANONICAL_LABELS[Math.min(idx, CANONICAL_LABELS.length - 2)]);
  }
  return out;
}

/** Generic decay from `u0` (June) toward `uFloor` (Election Eve) — shared
 *  shape for both the literal undecided-share curve and the softness curve. */
function decayShare(progress, spec) {
  const p = Math.max(0, Math.min(1, progress));
  return spec.uFloor + (spec.u0 - spec.uFloor) * Math.pow(1 - p, spec.uPower);
}

function weightedMean(map, units, weights) {
  let acc = 0;
  for (const u of units) acc += (map.get(u) || 0) * (weights.get(u) || 0);
  return acc;
}

/**
 * Sample one simplex poll (n respondents) of `shares` (a {dShare,rShare,oShare}
 * truth point). `u` is the literal Undecided share carved out for this poll;
 * `w` is the (larger, independent) softness weight applied to the one-time
 * per-axis mirage biases `bias` ({D,R,T?} — T omitted when third party is off).
 *
 * @returns {{dObs:number, rObs:number, tObs:number, uObs:number, obsMargin:number}}
 *   fractions of n (not raw counts); obsMargin is D-R among decided respondents.
 */
function pollOnce({ shares, u, w, bias, rng, n }) {
  const hasThird = bias.T != null;
  const decided = 1 - u;
  const centerD = decided * shares.dShare;
  const centerR = decided * shares.rShare;
  const centerT = hasThird ? decided * shares.oShare : 0;

  const xD = Math.log(centerD / u) + w * bias.D;
  const xR = Math.log(centerR / u) + w * bias.R;
  const logRatios = hasThird ? [xD, xR, Math.log(centerT / u) + w * bias.T] : [xD, xR];

  // Softmax back to a simplex; the Undecided axis is the implicit reference
  // (log-ratio 0), so it isn't in `logRatios` above.
  let z = 1;
  const exps = logRatios.map(x => { const e = Math.exp(x); z += e; return e; });
  const probs = exps.map(e => e / z);
  probs.push(1 / z); // Undecided, last

  const counts = randMultinomial(rng, n, probs);
  const dObs = counts[0] / n;
  const rObs = counts[1] / n;
  const tObs = hasThird ? counts[2] / n : 0;
  const uObs = counts[counts.length - 1] / n;
  const decidedTotal = dObs + rObs + tObs;
  const obsMargin = decidedTotal > 0 ? (dObs - rObs) / decidedTotal : 0;
  return { dObs, rObs, tObs, uObs, obsMargin };
}

/**
 * Generate the full campaign in one shot (deterministic given `rng`).
 *
 * @param {object} o
 * @param {Map<string,number>} o.truthRel   hidden true relative margins
 * @param {number}              o.truthNpv  hidden true national popular vote
 * @param {object}               o.errorModel provider from errorModel.js
 * @param {function}             o.rng       seeded PRNG
 * @param {object}               o.baseline  units/beta/weights/atLarge (baseline.js)
 * @param {Map<string,number>}  [o.truthThirdShare] per-unit third-party truth
 *        share (thirdParty.js), or null/undefined when third party is off —
 *        the poll then degenerates to a plain (D,R,Undecided) simplex.
 * @param {number}               [o.siphonLean=0.5] see electionNightBridge.js
 * @param {Map<string,{d:number,r:number}>} [o.majorPartyFloors] per-unit (plus
 *        a 'NATIONAL' entry) floor pair from thirdParty.js's
 *        computeMajorPartyFloors, so the poll simplex never shows a major
 *        party at literal zero either. null/undefined = no floor, today's
 *        behavior.
 * @param {object}               [o.params]  overrides for DEFAULT_CAMPAIGN_PARAMS
 * @returns {{snapshots: Array, terminalBiasRel: Map, terminalBiasNpv: number}}
 */
export function runCampaign({
  truthRel, truthNpv, errorModel, rng, baseline, truthThirdShare = null, siphonLean = 0.5,
  majorPartyFloors = null, params = {},
}) {
  const p = {
    ...DEFAULT_CAMPAIGN_PARAMS,
    ...params,
    rel: { ...DEFAULT_CAMPAIGN_PARAMS.rel, ...(params.rel || {}) },
    npv: { ...DEFAULT_CAMPAIGN_PARAMS.npv, ...(params.npv || {}) },
  };
  const labels = campaignLabels(p.steps);
  const hasThird = !!truthThirdShare;

  // --- ground truth as simplex points, computed once ------------------------
  const nationalThirdShare = hasThird
    ? weightedMean(truthThirdShare, baseline.simUnits, baseline.weights) : 0;
  const nationalFloors = majorPartyFloors ? majorPartyFloors.get('NATIONAL') : null;
  const nationalShares = sharesThreeWay(truthNpv, nationalThirdShare, siphonLean, nationalFloors);

  const unitShares = new Map();
  for (const unit of errorModel.units) {
    const beta = baseline.beta.get(unit) || 1;
    const truthMargin = (truthRel.get(unit) || 0) + beta * truthNpv;
    const oShare = hasThird ? (truthThirdShare.get(unit) || 0) : 0;
    const floors = majorPartyFloors ? majorPartyFloors.get(unit) : null;
    unitShares.set(unit, sharesThreeWay(truthMargin, oShare, siphonLean, floors));
  }

  // --- mirage bias: drawn ONCE per axis, regionally correlated (state axes) or
  // a plain scalar (national axis) — reuses errorModel.js as-is, one call per
  // axis, since it's already a generic correlated-draw utility, not
  // margin-specific.
  const biasNpv = { D: errorModel.drawNpv(rng, 1.0), R: errorModel.drawNpv(rng, 1.0) };
  const biasRel = { D: errorModel.drawRel(rng, 1.0), R: errorModel.drawRel(rng, 1.0) };
  if (hasThird) {
    biasNpv.T = errorModel.drawNpv(rng, 1.0);
    biasRel.T = errorModel.drawRel(rng, 1.0);
  }

  const snapshots = [];
  for (let t = 0; t < p.steps; t++) {
    const progress = p.steps > 1 ? t / (p.steps - 1) : 1;
    const uNpv = decayShare(progress, p.npv.undecided);
    const wNpv = decayShare(progress, p.npv.softness);
    const uRel = decayShare(progress, p.rel.undecided);
    const wRel = decayShare(progress, p.rel.softness);

    const nat = pollOnce({
      shares: nationalShares, u: uNpv, w: wNpv,
      bias: { D: biasNpv.D, R: biasNpv.R, T: hasThird ? biasNpv.T : undefined },
      rng, n: p.sampleSize,
    });
    const pollNpv = nat.obsMargin;

    const pollRel = new Map();
    const pollShares = new Map();
    for (const unit of errorModel.units) {
      const beta = baseline.beta.get(unit) || 1;
      const res = pollOnce({
        shares: unitShares.get(unit), u: uRel, w: wRel,
        bias: {
          D: biasRel.D.get(unit) || 0,
          R: biasRel.R.get(unit) || 0,
          T: hasThird ? (biasRel.T.get(unit) || 0) : undefined,
        },
        rng, n: p.sampleSize,
      });
      pollRel.set(unit, res.obsMargin - beta * pollNpv);
      pollShares.set(unit, { d: res.dObs, r: res.rObs, t: res.tObs, u: res.uObs });
    }
    deriveAtLarge(pollRel, baseline);

    // At-large units aren't sampled directly (see baseline.js) — their
    // percentages are the same vote-weighted mean of their districts that
    // deriveAtLarge uses for pollRel, so a statewide poll always agrees with
    // its own district polls.
    for (const [alUnit, parts] of baseline.atLarge) {
      let d = 0, r = 0, tt = 0, u = 0;
      for (const part of parts) {
        const s = pollShares.get(part.unit);
        if (!s) continue;
        d += s.d * part.weight; r += s.r * part.weight; tt += s.t * part.weight; u += s.u * part.weight;
      }
      pollShares.set(alUnit, { d, r, t: tt, u });
    }

    snapshots.push({
      index: t,
      label: labels[t],
      isFinal: t === p.steps - 1,
      pollRel,
      pollNpv,
      pollShares,
      pollSharesNpv: { d: nat.dObs, r: nat.rObs, t: nat.tObs, u: nat.uObs },
      /** Fraction of the campaign elapsed; drives how much uncertainty remains. */
      progress,
    });
  }

  return {
    snapshots,
    // Kept for API compatibility with existing sim.terminalBias* fields
    // (currently unread downstream); the D-axis bias is a representative
    // stand-in — R/T biases are computed the same way but not separately
    // exposed here.
    terminalBiasRel: biasRel.D,
    terminalBiasNpv: biasNpv.D,
    params: p,
    labels,
  };
}

export default { runCampaign, campaignLabels, DEFAULT_CAMPAIGN_PARAMS };

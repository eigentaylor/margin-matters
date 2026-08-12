'use strict';

/**
 * Campaign polling trajectory (brainstorm idea #3).
 *
 * Polls are the hidden truth plus an error that mean-reverts, AR(1)-style,
 * toward a TERMINAL BIAS drawn once at the start:
 *
 *   e_0 = b + w_0                                  (w_0 wide, correlated)
 *   e_t = b + phi * (e_{t-1} - b) + sigma_t * eta_t
 *   poll_t = truth + e_t
 *
 * As t -> N the noise term dies and e_t -> b, so on election night the polls are
 * off by exactly the *correlated* miss. That's what produces "AZ was polling R+1
 * and broke blue" with NC/GA plausibly moving alongside it, rather than every
 * state missing independently.
 *
 * Every error draw comes from the injected errorModel, so swapping the
 * correlation structure changes the campaign's texture without touching this file.
 */

import { deriveAtLarge } from './baseline.js';

/** Canonical 6-step timeline. Other step counts interpolate against this. */
const CANONICAL_LABELS = ['June', 'July', 'August', 'September', 'October', 'Election Eve'];

/**
 * Scales are multiples of the polling-error spec's sigmas (engine PARAMS.poll:
 * 2.0pt per state, 1.8pt national).
 *
 * The two axes are scaled SEPARATELY and very differently, because they behave
 * differently in a real campaign. What moves between June and November is mostly
 * the national environment — which candidate is ahead. A state's position
 * *relative* to the nation is far more stable and much better understood early:
 * nobody is genuinely unsure in June whether Florida is 12 points redder than
 * the country. Using one shared scale made June polls miss state leans by 12pt
 * and randomly promoted safe states into tossups.
 */
export const DEFAULT_CAMPAIGN_PARAMS = {
  steps: 6,
  phi: 0.60, // mean-reversion toward the terminal bias
  /** Relative-margin (state lean) error: modest and quick to settle. */
  rel: { initialScale: 1.0, noiseScale: 0.5, noiseDecay: 0.55, terminalScale: 1.0 },
  /** National popular vote error: large early, this is where the drama lives. */
  npv: { initialScale: 3.0, noiseScale: 1.5, noiseDecay: 0.55, terminalScale: 1.0 },
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

function addMaps(a, b) {
  const out = new Map();
  for (const [k, v] of a) out.set(k, v + (b.get(k) || 0));
  return out;
}

function blendTowardBias(prev, bias, phi, shock) {
  const out = new Map();
  for (const [k, v] of prev) {
    const bk = bias.get(k) || 0;
    out.set(k, bk + phi * (v - bk) + (shock.get(k) || 0));
  }
  return out;
}

/**
 * Generate the full campaign in one shot (deterministic given `rng`).
 *
 * @param {object} o
 * @param {Map<string,number>} o.truthRel  hidden true relative margins
 * @param {number}             o.truthNpv  hidden true national popular vote
 * @param {object}             o.errorModel provider from errorModel.js
 * @param {function}           o.rng       seeded PRNG
 * @param {object}             o.baseline  needed to re-derive at-large units
 * @param {object}             [o.params]  overrides for DEFAULT_CAMPAIGN_PARAMS
 * @returns {{snapshots: Array, terminalBiasRel: Map, terminalBiasNpv: number}}
 */
export function runCampaign({ truthRel, truthNpv, errorModel, rng, baseline, params = {} }) {
  const p = {
    ...DEFAULT_CAMPAIGN_PARAMS,
    ...params,
    rel: { ...DEFAULT_CAMPAIGN_PARAMS.rel, ...(params.rel || {}) },
    npv: { ...DEFAULT_CAMPAIGN_PARAMS.npv, ...(params.npv || {}) },
  };
  const labels = campaignLabels(p.steps);

  // The election-day miss. Drawn once — everything else converges onto it.
  const biasRel = errorModel.drawRel(rng, p.rel.terminalScale);
  const biasNpv = errorModel.drawNpv(rng, p.npv.terminalScale);

  // Opening polls: terminal bias plus a wide correlated wobble.
  let errRel = addMaps(biasRel, errorModel.drawRel(rng, p.rel.initialScale));
  let errNpv = biasNpv + errorModel.drawNpv(rng, p.npv.initialScale);

  const snapshots = [];
  for (let t = 0; t < p.steps; t++) {
    if (t > 0) {
      const relShock = p.rel.noiseScale * Math.pow(p.rel.noiseDecay, t);
      const npvShock = p.npv.noiseScale * Math.pow(p.npv.noiseDecay, t);
      errRel = blendTowardBias(errRel, biasRel, p.phi, errorModel.drawRel(rng, relShock));
      errNpv = biasNpv + p.phi * (errNpv - biasNpv) + errorModel.drawNpv(rng, npvShock);
    }

    // Poll only the simulated units, then re-derive at-large from the districts
    // so the statewide poll always agrees with its own district polls.
    const pollRel = new Map();
    for (const unit of errorModel.units) {
      pollRel.set(unit, (truthRel.get(unit) || 0) + (errRel.get(unit) || 0));
    }
    deriveAtLarge(pollRel, baseline);

    snapshots.push({
      index: t,
      label: labels[t],
      isFinal: t === p.steps - 1,
      pollRel,
      pollNpv: truthNpv + errNpv,
      /** Fraction of the campaign elapsed; drives how much uncertainty remains. */
      progress: p.steps > 1 ? t / (p.steps - 1) : 1,
    });
  }

  return { snapshots, terminalBiasRel: biasRel, terminalBiasNpv: biasNpv, params: p, labels };
}

export default { runCampaign, campaignLabels, DEFAULT_CAMPAIGN_PARAMS };

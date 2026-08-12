'use strict';

/**
 * Campaign polling trajectory (brainstorm idea #3).
 *
 * Each poll is truth plus two independent ingredients:
 *
 *   - a MIRAGE BIAS `bias[u]`, drawn once and regionally correlated (so WI/MI/PA
 *     miss together), whose influence is weighted by an "undecided share" u(p)
 *     that shrinks across the campaign. Early on, when u(p) is large, the poll
 *     can plausibly point the wrong way — a real, if close, state might read red
 *     in June and blue in November, not because anyone was sampled wrong, but
 *     because a large chunk of the electorate hadn't settled yet. That's the
 *     "sometimes but not always" mirage: for close states bias[u] is often
 *     comparable in size to the true margin, so it flips the apparent leader
 *     some of the time; for safe states it's dwarfed by the true margin and
 *     rarely does.
 *   - a fresh SAMPLING WOBBLE, drawn independently every step rather than
 *     decayed/carried over, representing "this month's poll is a new sample."
 *     This is what keeps every step visibly bouncing, including late in the
 *     campaign — a real poll never stops having sampling noise, even when the
 *     electorate has mostly made up its mind.
 *
 *   u(p)       = uFloor + (u0 - uFloor) * (1 - p)^uPower
 *   center_t   = truth + u(p_t) * bias
 *   poll_t     = center_t + sampleNoise_t                  (sampleNoise_t fresh each t)
 *
 * As p -> 1 (Election Eve), u(p) -> uFloor (small but nonzero — the poll can
 * still be "a little off" on the eve of the election) while sampleNoise_t never
 * shrinks, so the poll never fully converges to truth — exactly like reality.
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
 * The two axes use SEPARATE undecided curves and sample-wobble sizes, because
 * they behave differently in a real campaign. What moves between June and
 * November is mostly the national environment — which candidate is ahead. A
 * state's position *relative* to the nation is far more stable and much better
 * understood early: nobody is genuinely unsure in June whether Florida is 12
 * points redder than the country. Using one shared scale made June polls miss
 * state leans by 12pt and randomly promoted safe states into tossups.
 */
export const DEFAULT_CAMPAIGN_PARAMS = {
  steps: 6,
  /** Relative-margin (state lean) mirage + wobble: modest and quick to settle. */
  rel: { u0: 0.5, uFloor: 0.06, uPower: 1.4, sampleScale: 0.55 },
  /** National popular vote mirage + wobble: large early, this is where the drama lives. */
  npv: { u0: 0.5, uFloor: 0.06, uPower: 1.4, sampleScale: 0.6 },
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

/** Undecided-share weight on the mirage bias at campaign progress p (0=June, 1=Election Eve). */
function undecidedWeight(progress, spec) {
  const p = Math.max(0, Math.min(1, progress));
  return spec.uFloor + (spec.u0 - spec.uFloor) * Math.pow(1 - p, spec.uPower);
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

  // The mirage ingredient. Drawn once, regionally correlated; its influence
  // shrinks across the campaign as the undecided share does (undecidedWeight).
  const biasRel = errorModel.drawRel(rng, 1.0);
  const biasNpv = errorModel.drawNpv(rng, 1.0);

  const snapshots = [];
  for (let t = 0; t < p.steps; t++) {
    const progress = p.steps > 1 ? t / (p.steps - 1) : 1;
    const uRel = undecidedWeight(progress, p.rel);
    const uNpv = undecidedWeight(progress, p.npv);

    // Fresh sample every step — this is what keeps the poll visibly bouncing
    // all the way to Election Eve, instead of settling to a near-static number.
    const wobbleRel = errorModel.drawRel(rng, p.rel.sampleScale);
    const wobbleNpv = errorModel.drawNpv(rng, p.npv.sampleScale);

    // Poll only the simulated units, then re-derive at-large from the districts
    // so the statewide poll always agrees with its own district polls.
    const pollRel = new Map();
    for (const unit of errorModel.units) {
      const truth = truthRel.get(unit) || 0;
      const center = truth + uRel * (biasRel.get(unit) || 0);
      pollRel.set(unit, center + (wobbleRel.get(unit) || 0));
    }
    deriveAtLarge(pollRel, baseline);

    const centerNpv = truthNpv + uNpv * biasNpv;

    snapshots.push({
      index: t,
      label: labels[t],
      isFinal: t === p.steps - 1,
      pollRel,
      pollNpv: centerNpv + wobbleNpv,
      /** Fraction of the campaign elapsed; drives how much uncertainty remains. */
      progress,
    });
  }

  return { snapshots, terminalBiasRel: biasRel, terminalBiasNpv: biasNpv, params: p, labels };
}

export default { runCampaign, campaignLabels, DEFAULT_CAMPAIGN_PARAMS };

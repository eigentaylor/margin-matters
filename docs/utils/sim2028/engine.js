'use strict';

/**
 * Seeded orchestrator for the 2028 campaign simulator.
 *
 * Flow:
 *   baseline (2024 + trend)  ->  hidden truth  ->  campaign polls  ->  forecasts
 *                                     \-------------------------------> election night
 *
 * The engine is pure and headless: it takes a seed and returns a fully-resolved
 * simulation object. The page renders whatever step the user has advanced to.
 * Given the same seed and PARAMS you always get the same election.
 */

import { mulberry32, randn } from '../randomUtils.js';
import { loadBaseline, deriveAtLarge } from './baseline.js';
import { createRegionalErrorModel } from './errorModel.js';
import { runCampaign, DEFAULT_CAMPAIGN_PARAMS } from './campaign.js';
import { runForecast, DEFAULT_FORECAST_PARAMS } from './forecast.js';
import { computeNailbiterShift } from './nailbiter.js';
import { POLL_ERROR_SPEC } from './pollCalibration.js';
import { computeThirdPartyTruth, computeMajorPartyFloors, THIRD_PARTY_DEFAULTS } from './thirdParty.js';
import { buildRows } from './electionNightBridge.js';

/**
 * Every tunable in one place. Overridable per-run and via URL query params.
 *
 * Note the two separate error specs. `cycle` is how far a state's lean can drift
 * between 2024 and 2028 — a real, large movement, sized from each state's own
 * history. `poll` is how wrong the polls are about that lean — a much smaller and
 * more correlated quantity. Conflating them makes election-eve polls miss by 6pt.
 */
export const PARAMS = {
  /**
   * Drift of the true lean from the 2024 baseline. `scale` multiplies the
   * per-state volatility from baseline.js — which is itself measured from only
   * 2016->2020->2024 (backtested; see baseline.js's trendWeight/sigmaWindow
   * docs), so it already IS "a typical single-cycle move" in that state. `scale`
   * near 1.0 reproduces that directly rather than needing a fudge factor.
   *
   * `turbulenceSigma` is the important one. Real cycles are NOT interchangeable:
   * 2008 and 2016 each moved 19 states by more than 6 points, while 2020 moved 3
   * and 2024 moved 1. A model with a fixed scale produces the average of those
   * every single time, so every simulated election feels like a realignment.
   * Drawing one lognormal turbulence multiplier per cycle reproduces the real
   * mix of quiet years and upheavals. 0 disables it (constant turbulence).
   *
   * `turbulenceOverride`, when set (the UI exposes this, default 1.0 = typical),
   * pins that multiplier instead of drawing it — see createSimulation().
   */
  cycle: {
    regionShare: 0.70,
    scale: 0.95,
    turbulenceSigma: 0.50,
    turbulenceRange: [0.30, 2.30],
    turbulenceOverride: null,
  },
  /**
   * Polling error. unitSigmas is flat: polling misses aren't proportional to
   * volatility. `df` gives the error draws fat tails (Student's t) instead of
   * Gaussian — see errorModel.js. 6 sits mid-range of the doc-cited 3-10.
   *
   * nationalSigma/regionShare are calibrated to the research doc's empirical
   * targets (national margin error SD ~2-3pt; same-region correlation ~0.6-0.9,
   * i.e. share ~0.77-0.95): nationalSigma 0.025 (2.5pt), regionShare 0.87 (=>
   * corr 0.76). unitSigmas (0.020) already matched the doc's ~0.02 and is
   * unchanged. (forecast.js's DEFAULT_FORECAST_PARAMS.floorScale has its own
   * matching note — together these are what keep close races feeling genuinely
   * uncertain deep into the campaign instead of resolving to false-confident
   * 90%+ calls.) Sources: Shirani-Mehr et al. 2018 (JASA); AAPOR 2016/2020;
   * 538/Silver Bulletin and Economist methodology write-ups; Decision Desk HQ
   * (HDSR 2022).
   *
   * The UI's "Confident forecasts" toggle swaps these (and the floorScale
   * pair) for LEGACY_CALIBRATION below — the original, narrower assumptions —
   * for anyone who preferred the tighter, more decisive calls.
   *
   * `turbulenceSigma`/`turbulenceRange`/`turbulenceOverride` mirror `cycle`'s
   * fields above, but scale how ACCURATE the polls are this cycle rather than how
   * far the true lean drifts — see the pollTurbulence draw in createSimulation().
   * Calibrated so the multiplier's range roughly reproduces the observed spread
   * of state polling MAE across 2016 (~5.1pt) / 2020 (~5.1pt) / 2024 (~2.2-2.9pt):
   * a good year is roughly 0.6x a typical one, a bad year roughly 1.4x.
   */
  poll: {
    ...POLL_ERROR_SPEC,
    turbulenceSigma: 0.35, turbulenceRange: [0.55, 1.9], turbulenceOverride: null,
  },
  campaign: { ...DEFAULT_CAMPAIGN_PARAMS },
  forecast: { ...DEFAULT_FORECAST_PARAMS },
  /** Sd of the true national popular vote, for the random NPV modes. */
  npvSpread: 0.045,
  /**
   * Hard bound on any single unit's lean. A hard clamp, NOT a softclip: tanh
   * compresses well before its limit, so softclip(0.95) squashed DC's real
   * D+86 lean down to D+68 and registered it as a fictitious 18pt "shock".
   * Nothing here should reshape a legitimate value — only bound absurd ones.
   */
  leanCap: 0.95,
  // Restated explicitly (matches baseline.js's own defaults) so this object is
  // self-documenting: trendWeight=0 and sigmaWindow=3 are the backtested choices
  // described in baseline.js's docstring, not accidents of falling through.
  baseline: { trendWindow: 5, sigmaWindow: 3, elasticityWindow: 6, trendWeight: 0, betaShrink: 0.5 },
  /**
   * Optional third-party/independent candidate (see thirdParty.js). Only the
   * candidate's home state/strength and `siphonLean` are user-facing (the
   * existing "hometown strength" slider, plus a new siphon-lean slider); the
   * rest are fixed v1 constants, not exposed in the UI.
   */
  thirdParty: { ...THIRD_PARTY_DEFAULTS, siphonLean: 0.5 },
};

/**
 * The ORIGINAL (pre-research-doc) base constants, kept as an opt-in overlay
 * for the UI's "Confident forecasts" toggle — flipping it on swaps PARAMS.poll
 * and DEFAULT_FORECAST_PARAMS's floorScale back to these narrower, more
 * decisive-calling values, for anyone who wants the tighter feel back rather
 * than the doc-calibrated defaults above.
 *
 *   nationalSigma 0.025 -> 0.018
 *   regionShare   0.87  -> 0.75
 *   forecast floorScale 1.0 -> 0.65 on both axes
 */
export const LEGACY_CALIBRATION = {
  poll: { regionShare: 0.75, nationalSigma: 0.018 },
  forecast: {
    rel: { floorScale: 0.65 },
    npv: { floorScale: 0.65 },
  },
};

/** Soft clip, lifted from future.js:36. Keeps extreme draws finite without a hard edge. */
export function softclip(x, L) { return L * Math.tanh(x / L); }

/** Seed derived from today's date, matching future.js's computeTodaySeed convention. */
export function computeTodaySeed() {
  try {
    const d = new Date();
    return parseInt(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`, 10);
  } catch (e) {
    return 20280101;
  }
}

/** Modes for choosing the national popular vote the election lands on. */
export const NPV_MODES = {
  current2024: 'Use 2024 PV',
  realisticSurprise: 'Surprise me (realistic)',
  realisticD: 'Realistic D tilt',
  realisticR: 'Realistic R tilt',
  fixedD2: 'D+2',
  randomD: 'Random D tilt (wide)',
  randomR: 'Random R tilt (wide)',
  surprise: 'Surprise me (any outcome)',
  manual: 'Manual',
};

/**
 * Pick the TRUE national popular vote for this election.
 *
 * This is the exact value the election lands on — not a centre that later gets
 * perturbed. "Manual: D+3" must mean the Democrats really win the popular vote
 * by 3, and "Use 2024 PV" must really mean R+1.5; adding a cycle shock on top
 * made both settings advisory rather than binding.
 *
 * The random modes carry their own spread, so they need no extra noise. They're
 * drawn normally rather than uniformly because real national environments
 * cluster near even with occasional blowouts, instead of being equally likely
 * anywhere in a range. Polls still miss this value — that happens in campaign.js.
 */
/**
 * Bounds for the two 'realistic' modes, added alongside the wide/extreme ones
 * rather than replacing them. Both are half-normal-plus-floor, same shape as
 * randomD/randomR, just tamer: a small guaranteed margin, most mass fairly
 * close to it, and a long-but-rare tail out to the cap. Not backtested (there's
 * no data on 2028 yet, obviously) — just a tighter, explicitly-labeled band for
 * "assume this election looks like the current environment" instead of the wide
 * modes' "genuinely anything, including a 1964/1972/1936-scale landslide."
 * Medians land near D+1.75 / R+0.75; caps (rarely hit, ~2% of draws) are D+5 /
 * R+2, matching the user-specified "R+2 to D+5 at most" band.
 *
 * REALISTIC_SURPRISE is the same idea without forcing a winner: a normal draw
 * centered at D+1.5 (between the two tilts) whose middle 90% (5th-95th
 * percentile) works out to almost exactly [R+2.0, D+4.9], with a hard clip a
 * little beyond that for the rare tail.
 */
const REALISTIC_D = { floor: 0.004, spread: 0.020, cap: 0.05 };
const REALISTIC_R = { floor: 0.002, spread: 0.008, cap: 0.02 };
const REALISTIC_SURPRISE = { center: 0.015, sd: 0.021, min: -0.03, max: 0.06 };

export function chooseNpv(mode, rng, { npvBase = 0, manualValue = 0, spread = 0.045 } = {}) {
  switch (mode) {
    case 'randomD': return Math.min(0.30, Math.abs(randn(rng) * spread) + 0.005);
    case 'randomR': return -Math.min(0.30, Math.abs(randn(rng) * spread) + 0.005);
    case 'realisticD': return Math.min(REALISTIC_D.cap, Math.abs(randn(rng) * REALISTIC_D.spread) + REALISTIC_D.floor);
    case 'realisticR': return -Math.min(REALISTIC_R.cap, Math.abs(randn(rng) * REALISTIC_R.spread) + REALISTIC_R.floor);
    case 'realisticSurprise': {
      const v = REALISTIC_SURPRISE.center + randn(rng) * REALISTIC_SURPRISE.sd;
      return Math.max(REALISTIC_SURPRISE.min, Math.min(REALISTIC_SURPRISE.max, v));
    }
    case 'surprise': return Math.max(-0.30, Math.min(0.30, randn(rng) * spread));
    case 'fixedD2': return 0.02;
    case 'manual': return manualValue;
    case 'current2024':
    default: return npvBase;
  }
}

/**
 * Build a complete simulation.
 *
 * @param {object} o
 * @param {number} o.seed
 * @param {string} [o.npvMode='surprise']
 * @param {number} [o.manualNpv=0]
 * @param {object} [o.params]    deep-ish overrides for PARAMS
 * @param {object} [o.baseline]  pre-loaded baseline, to avoid re-reading the CSV
 * @param {boolean} [o.skipForecasts=false] skip the Monte Carlo entirely. Only for
 *        bulk calibration runs that care about the outcome, not the forecast.
 * @param {boolean|object} [o.thirdParty=false] optional third-party candidate —
 *        `false` disables it entirely (default; byte-identical to no third
 *        party existing at all), `true` enables it with default params and no
 *        home state, or `{candidate: {homeState, strength, name}, siphonLean,
 *        strengthMultiplier, regionBleedEnabled, params}` to configure it.
 *        `strengthMultiplier` (default 1.0) scales the whole mechanic's
 *        magnitude — see thirdParty.js's THIRD_PARTY_DEFAULTS doc comment.
 *        `strengthMode` ('random' default, or 'exact') controls whether the
 *        national baseline is a fresh random draw each run (then scaled by
 *        strengthMultiplier) or a fixed value set directly via
 *        `exactNationalShare` (a 0-1 fraction) — strengthMultiplier still
 *        scales the home-state bump either way. See thirdParty.js's
 *        THIRD_PARTY_DEFAULTS doc comment.
 *        Only ever affects the hidden truth/election-night reveal — never the
 *        campaign's polling snapshots or forecast.js's Monte Carlo, which
 *        stay strictly two-party. See thirdParty.js.
 */
export async function createSimulation({
  seed, npvMode = 'surprise', manualNpv = 0, params = {}, baseline = null, skipForecasts = false,
  nailbiter = false, thirdParty = false,
}) {
  const P = {
    ...PARAMS,
    ...params,
    cycle: { ...PARAMS.cycle, ...(params.cycle || {}) },
    poll: { ...PARAMS.poll, ...(params.poll || {}) },
    campaign: { ...PARAMS.campaign, ...(params.campaign || {}) },
    forecast: { ...PARAMS.forecast, ...(params.forecast || {}) },
    baseline: { ...PARAMS.baseline, ...(params.baseline || {}) },
    thirdParty: { ...PARAMS.thirdParty, ...(params.thirdParty || {}) },
  };

  const base = baseline || await loadBaseline(P.baseline);
  const rng = mulberry32(seed >>> 0);

  // Both models draw only over simUnits — ME-AL/NE-AL are derived from their
  // districts afterwards, never drawn independently.
  // Cycle drift: sized from each state's own historical volatility.
  // No nationalSigma here: only .drawRel is used on this model. The true
  // national popular vote is set directly by chooseNpv() below, not drawn.
  const cycleModel = createRegionalErrorModel({
    units: base.simUnits,
    weights: base.weights,
    unitSigmas: base.sigma,
    regionShare: P.cycle.regionShare,
  });

  // Polling error: flat across states, more correlated, much smaller. This is
  // also the spec the FORECASTER believes in (see forecast.js) — it stays the
  // unscaled "typical year" baseline even after pollTurbulence below, since a
  // real forecaster doesn't get to know in advance whether this cycle will poll
  // clean or foggy.
  const pollSpec = {
    unitSigmas: P.poll.unitSigmas,
    regionShare: P.poll.regionShare,
    nationalSigma: P.poll.nationalSigma,
    df: P.poll.df,
  };

  // --- hidden truth ---------------------------------------------------------
  // How turbulent is THIS cycle? One draw, applied to every state, so a calm year
  // is calm everywhere and a realigning year shakes the whole map. A user-supplied
  // turbulenceOverride skips the draw entirely and pins it — useful for
  // deliberately exploring "what would a calm/realigning cycle look like",
  // rather than waiting for the dice to produce one.
  const turbulence = (P.cycle.turbulenceOverride != null)
    ? P.cycle.turbulenceOverride
    : (P.cycle.turbulenceSigma > 0
      ? Math.max(P.cycle.turbulenceRange[0],
        Math.min(P.cycle.turbulenceRange[1], Math.exp(randn(rng) * P.cycle.turbulenceSigma)))
      : 1);
  const cycleScale = P.cycle.scale * turbulence;

  // How ACCURATE is polling this cycle? Same shape as turbulence above, but
  // scales the hidden poll-generation error rather than the true lean drift.
  // This is what lets one simulated election land as a clean, 2024-style call
  // and another as a foggy, 2020-style miss — the forecaster below never sees
  // this draw, only its consequences, exactly like a real forecaster wouldn't
  // know in advance which kind of polling year they're in.
  const pollTurbulence = (P.poll.turbulenceOverride != null)
    ? P.poll.turbulenceOverride
    : (P.poll.turbulenceSigma > 0
      ? Math.max(P.poll.turbulenceRange[0],
        Math.min(P.poll.turbulenceRange[1], Math.exp(randn(rng) * P.poll.turbulenceSigma)))
      : 1);

  // The actual (hidden) poll-generation process for THIS run — scaled by
  // pollTurbulence. campaign.js only ever sees this model, never the unscaled
  // pollSpec that the forecaster (forecast.js) uses.
  const pollModel = createRegionalErrorModel({
    units: base.simUnits,
    weights: base.weights,
    ...pollSpec,
    unitSigmas: pollSpec.unitSigmas * pollTurbulence,
    nationalSigma: pollSpec.nationalSigma * pollTurbulence,
  });

  const truthShock = cycleModel.drawRel(rng, cycleScale);
  const truthRel = new Map();
  for (const unit of base.simUnits) {
    const raw = (base.base.get(unit) || 0) + (truthShock.get(unit) || 0);
    truthRel.set(unit, Math.max(-P.leanCap, Math.min(P.leanCap, raw)));
  }
  deriveAtLarge(truthRel, base);

  // The chosen value IS the outcome. No shock is added here, so a manual or
  // 2024-matching popular vote lands exactly where the user asked.
  const truthNpv = chooseNpv(npvMode, rng, {
    npvBase: base.npvBase,
    manualValue: manualNpv,
    spread: P.npvSpread,
  });

  // Nailbiter mode: a second pass, now that npv is known, that nudges only the
  // units whose margin already landed close to zero — see nailbiter.js.
  if (nailbiter) {
    const shift = computeNailbiterShift({
      truthRel, beta: base.beta, npv: truthNpv,
      units: base.simUnits, weights: base.weights, sigma: base.sigma,
      seed, params: (nailbiter === true) ? {} : nailbiter,
    });
    for (const unit of base.simUnits) {
      truthRel.set(unit, (truthRel.get(unit) || 0) + (shift.get(unit) || 0));
    }
    deriveAtLarge(truthRel, base);
  }

  // --- third party (optional) ------------------------------------------------
  // Needs the FINALIZED truth lean (post-nailbiter), and never touches the
  // shared `rng` stream (see thirdParty.js) — so toggling it never shifts the
  // draw order of anything else, and it's a true no-op when disabled.
  let truthThirdShare = null, thirdPartyCandidate = null, siphonLean = null, thirdPartyStrength = null,
    thirdPartyStrengthMode = null, thirdPartyExactShare = null, majorPartyFloors = null;
  if (thirdParty) {
    const tp = (thirdParty === true) ? {} : thirdParty;
    siphonLean = tp.siphonLean ?? P.thirdParty.siphonLean;
    thirdPartyStrength = tp.strengthMultiplier ?? P.thirdParty.strengthMultiplier;
    thirdPartyStrengthMode = tp.strengthMode ?? P.thirdParty.strengthMode;
    thirdPartyExactShare = tp.exactNationalShare ?? P.thirdParty.exactNationalShare;
    thirdPartyCandidate = (tp.candidate && tp.candidate.name) || null;
    truthThirdShare = computeThirdPartyTruth({
      truthRel, truthNpv, beta: base.beta, baseline: base,
      candidate: tp.candidate || null, seed,
      regionBleedEnabled: !!tp.regionBleedEnabled,
      params: {
        ...P.thirdParty, strengthMultiplier: thirdPartyStrength, strengthMode: thirdPartyStrengthMode,
        exactNationalShare: thirdPartyExactShare, ...(tp.params || {}),
      },
    });
    // Computed once here (rather than inline in campaign.js/electionNightBridge.js)
    // so the exact same per-unit floor pair backs both the campaign's polling
    // simplex and election night's final vote synthesis - a state's D/R floor
    // can't drift between what a poll implied and what election night reveals.
    majorPartyFloors = computeMajorPartyFloors([...base.simUnits, 'NATIONAL'], seed);
  }

  // --- campaign -------------------------------------------------------------
  const campaign = runCampaign({
    truthRel, truthNpv, errorModel: pollModel, rng, params: P.campaign, baseline: base,
    truthThirdShare, siphonLean: siphonLean ?? 0.5, majorPartyFloors,
  });

  // --- forecast per step ----------------------------------------------------
  // Each step gets its own derived seed so the forecast stream is independent of
  // the campaign stream; re-running a forecast can't shift the election itself.
  const forecasts = skipForecasts ? [] : campaign.snapshots.map((snap, i) => {
    // The observed (poll-blind, never truth) third-party share per unit at
    // THIS step - runForecast only ever sees what a real forecaster would
    // have seen this month, same as pollRel/pollNpv above. null when third
    // party is off, so the Monte Carlo degenerates back to a plain D-vs-R
    // race exactly as before this existed.
    let pollThird = null;
    if (truthThirdShare) {
      pollThird = new Map();
      for (const unit of base.units) {
        const s = snap.pollShares.get(unit);
        pollThird.set(unit, s ? s.t : 0);
      }
    }
    return runForecast({
      pollRel: snap.pollRel,
      pollNpv: snap.pollNpv,
      baseline: base,
      progress: snap.progress,
      seed: (seed >>> 0) ^ (0x9E3779B9 * (i + 1)),
      params: P.forecast,
      pollSpec,
      pollThird,
      siphonLean: siphonLean ?? 0.5,
    });
  });

  return {
    seed,
    npvMode,
    params: P,
    baseline: base,
    cycleModel,
    pollModel,
    turbulence,
    cycleScale,
    pollTurbulence,
    truthRel,
    truthNpv,
    snapshots: campaign.snapshots,
    labels: campaign.labels,
    forecasts,
    terminalBiasNpv: campaign.terminalBiasNpv,
    terminalBiasRel: campaign.terminalBiasRel,
    truthThirdShare,
    thirdPartyCandidate,
    siphonLean,
    thirdPartyStrength,
    thirdPartyStrengthMode,
    thirdPartyExactShare,
    majorPartyFloors,
  };
}

/** Final absolute margins for the true result (what election night reveals). */
export function truthMargins(sim) {
  const out = new Map();
  for (const unit of sim.baseline.units) {
    const beta = sim.baseline.beta.get(unit) || 1;
    out.set(unit, (sim.truthRel.get(unit) || 0) + beta * sim.truthNpv);
  }
  return out;
}

/**
 * EV tally for the true result, D/R/O alike. Reuses buildRows() (the same
 * vote synthesis election night itself uses) so a third-party win is never
 * silently folded into D or R. With no third party in play, buildRows()
 * synthesizes oVotes=0 everywhere and this degenerates to a plain D/R tally.
 */
export function truthEv(sim) {
  const margins = truthMargins(sim);
  const { rows } = buildRows({
    finalRel: sim.truthRel, npv: sim.truthNpv, baseline: sim.baseline,
    thirdShare: sim.truthThirdShare || null, siphonLean: sim.siphonLean ?? 0.5,
    oCandidateName: sim.thirdPartyCandidate || 'Third party', majorPartyFloors: sim.majorPartyFloors || null,
  });
  let dem = 0, rep = 0, oth = 0;
  for (const row of rows) {
    if (row.unit === 'NATIONAL') continue;
    if (row.tVotes > row.dVotes && row.tVotes > row.rVotes) oth += row.ev;
    else if (row.dVotes >= row.rVotes) dem += row.ev;
    else rep += row.ev;
  }
  return { dem, rep, oth, total: sim.baseline.totalEv, margins };
}

export default { createSimulation, PARAMS, computeTodaySeed, chooseNpv, truthMargins, truthEv, NPV_MODES, softclip };

'use strict';

import { POLL_ERROR_SPEC } from './pollCalibration.js';

/**
 * Hands the simulated 2028 result to the existing election-night simulator
 * (brainstorm idea #8) without loading tester.js.
 *
 * election-night.js reads its data purely from window globals, and every
 * tester.js helper it calls is `typeof … === 'function'` guarded, so supplying
 * the six globals below is enough to drive it.
 *
 * One important detail: election-night.js derives each state's margin from RAW
 * VOTE COUNTS, not from `rm` (see election-night.js:822, which computes
 * (dVotes - rVotes) / twoPartyVotes). So the target margins are baked into
 * synthesized vote totals.
 *
 * Those totals are still re-scaled on the way through, though. election-night.js
 * calls window.getUnitFinalVoteTotals when it exists, and utils/unitInfo.js
 * installs it on import — which election-night.js imports itself, so it is ALWAYS
 * defined here. It shifts every state by `_curPv - getNatMargin(year)`, and
 * getNatMargin averages the `nm` field off the rows below. So `nm` and `_curPv`
 * must both equal the realized national margin; anything else re-runs the whole
 * election at a different popular vote.
 */

const YEAR = 2028;

/**
 * Turn a target margin into D/R vote counts against a given turnout.
 * Two-party only — third parties are dropped for simulated years, matching how
 * future.js treats future elections.
 */
export function synthesizeVotes(margin, totalVotes) {
  const total = Math.max(1, Math.round(totalVotes || 0));
  const m = Math.max(-0.999, Math.min(0.999, margin || 0));
  const dVotes = Math.round(total * (1 + m) / 2);
  return { dVotes, rVotes: total - dVotes, total };
}

/**
 * Build rows in the schema election-night.js expects (see tester.js:443-447).
 *
 * @param {object} o
 * @param {Map<string,number>} o.finalRel  final relative margins
 * @param {number}             o.npv       final national popular vote
 * @param {object}             o.baseline  from baseline.js
 * @param {number}             [o.turnoutScale=1] uniform turnout multiplier vs 2024
 */
export function buildRows({ finalRel, npv, baseline, turnoutScale = 1 }) {
  const rows = [];
  const votesByUnit = new Map();
  let natD = 0, natR = 0, natTotal = 0;

  // Districts and plain states first; at-large units are summed from their
  // districts afterwards so ME-AL/NE-AL can never disagree with their own parts.
  for (const unit of baseline.simUnits) {
    const rel = finalRel.get(unit) || 0;
    const beta = baseline.beta.get(unit) || 1;
    const margin = rel + beta * npv;
    const turnout = (baseline.totalVotes.get(unit) || 0) * turnoutScale;
    const votes = synthesizeVotes(margin, turnout);
    votesByUnit.set(unit, votes);

    // Only simUnits contribute to the national total; counting ME-AL as well as
    // ME-01/ME-02 would double-count every Maine voter.
    natD += votes.dVotes; natR += votes.rVotes; natTotal += votes.total;
  }

  for (const [alUnit, parts] of baseline.atLarge) {
    let dVotes = 0, rVotes = 0, total = 0;
    for (const part of parts) {
      const v = votesByUnit.get(part.unit);
      if (!v) continue;
      dVotes += v.dVotes; rVotes += v.rVotes; total += v.total;
    }
    votesByUnit.set(alUnit, { dVotes, rVotes, total });
  }

  // The national margin the synthesized votes actually produce. Rounding to whole
  // votes moves it a hair off the requested `npv`, and every row must quote this
  // same number: getNatMargin() averages `nm` across these rows and the result is
  // subtracted from _curPv, so any disagreement becomes a real shift applied to
  // every state.
  const realizedNpv = natTotal > 0 ? (natD - natR) / natTotal : 0;

  for (const unit of baseline.units) {
    const { dVotes, rVotes, total } = votesByUnit.get(unit) || { dVotes: 0, rVotes: 0, total: 1 };
    const margin = total > 0 ? (dVotes - rVotes) / total : 0;

    rows.push({
      year: YEAR,
      unit,
      // rm is the lean relative to the realized national margin, so downstream
      // `rm + pv` reconstructions stay consistent with the vote totals.
      rm: margin - realizedNpv,
      nm: realizedNpv,
      ev: baseline.ev.get(unit) || 0,
      tp: 0,
      thirdShare: 0,
      dVotes,
      rVotes,
      tVotes: 0,
      total,
      topThirdVotes: 0,
      dCandidate: baseline.candidates.d,
      rCandidate: baseline.candidates.r,
      thirdPartyResults: {},
      specialCaseNotes: '',
      color: margin >= 0 ? 'blue' : 'red',
      elasticity: baseline.beta.get(unit) || 1,
    });
  }

  rows.push({
    year: YEAR,
    unit: 'NATIONAL',
    rm: 0,
    nm: realizedNpv,
    ev: 0,
    tp: 0,
    thirdShare: 0,
    dVotes: natD,
    rVotes: natR,
    tVotes: 0,
    total: natTotal,
    topThirdVotes: 0,
    dCandidate: baseline.candidates.d,
    rCandidate: baseline.candidates.r,
    thirdPartyResults: {},
    specialCaseNotes: '',
    color: realizedNpv >= 0 ? 'blue' : 'red',
    elasticity: 1,
  });

  return { rows, realizedNpv };
}

/**
 * Install the globals election-night.js reads, then prepare the simulation.
 * Safe to call repeatedly — it resets any in-flight simulation first.
 *
 * @param {Map<string,number>} [pollMarginByUnit] the Election-Eve poll's
 *   implied absolute margin per unit (see sim2028.js's pollMargins()) — the
 *   actual "prior" a voter would have seen before results came in, distinct
 *   from `finalRel`/`npv` (the hidden truth the rows above are built from).
 *   When supplied, published as window._enPollPrior for election-night.js's
 *   live win-probability estimate to seed itself from instead of having to
 *   synthesize its own poll (which is what index.html/future.html, with no
 *   real 2028 polls, fall back to).
 */
export function installElectionNight({ finalRel, npv, baseline, turnoutScale = 1, pollMarginByUnit = null }) {
  const { rows, realizedNpv } = buildRows({ finalRel, npv, baseline, turnoutScale });

  window._enPollPrior = pollMarginByUnit
    ? { year: YEAR, marginByUnit: pollMarginByUnit, spec: POLL_ERROR_SPEC }
    : null;

  const byYear = (window._byYearMap instanceof Map) ? window._byYearMap : new Map();
  byYear.set(YEAR, rows);
  window._byYearMap = byYear;

  const evByUnit = (window._evByUnitMap instanceof Map) ? window._evByUnitMap : new Map();
  for (const row of rows) {
    if (row.ev > 0) evByUnit.set(`${YEAR}:${row.unit}`, row.ev);
  }
  window._evByUnitMap = evByUnit;

  const totalEvByYear = (window._totalEvByYear instanceof Map) ? window._totalEvByYear : new Map();
  totalEvByYear.set(YEAR, baseline.totalEv);
  window._totalEvByYear = totalEvByYear;

  window.getRowsForYear = year => byYear.get(year) || [];
  window.getEvFor = (year, unit) => evByUnit.get(`${year}:${unit}`) || 0;

  // _curPv is the national margin the map is being SHOWN at, not an offset.
  // Downstream (utils/unitInfo.js -> voteMath.computePvAdjustedBreakdown) shifts
  // every state by `_curPv - getNatMargin(year)`, and getNatMargin averages the
  // `nm` field off these very rows. Setting _curPv = 0 therefore asked for the
  // map at an EVEN national vote and silently re-ran the whole election there —
  // which flipped outcomes outright, not just the popular-vote readout. Setting
  // it to the realized national margin makes that shift exactly zero, so the
  // vote totals we synthesized are used as-is.
  window._curPv = realizedNpv;
  window._pvOverride = null;

  if (window.ElectionMap && window.ElectionMap.districtPaths) {
    window._districtPaths = window.ElectionMap.districtPaths;
  }

  const yearSlider = document.getElementById('yearSlider');
  if (yearSlider) yearSlider.value = String(YEAR);

  if (typeof window.resetElectionNightSimulation === 'function') {
    try { window.resetElectionNightSimulation(false); } catch (e) { /* not yet prepared */ }
  }
  if (typeof window.prepareElectionNightSimulation === 'function') {
    window.prepareElectionNightSimulation();
  }

  return { rows, realizedNpv };
}

export default { installElectionNight, buildRows, synthesizeVotes, YEAR };

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
 * Two-party only. Still used whenever no third-party share is supplied
 * (synthesizeVotesThreeWay below degenerates to this exact output at
 * thirdShare=0, so nothing needs both).
 */
export function synthesizeVotes(margin, totalVotes) {
  const total = Math.max(1, Math.round(totalVotes || 0));
  const m = Math.max(-0.999, Math.min(0.999, margin || 0));
  const dVotes = Math.round(total * (1 + m) / 2);
  return { dVotes, rVotes: total - dVotes, total };
}

/**
 * Splits a two-party margin into D/R/O vote SHARES (0..1, no rounding, no
 * turnout) from a third-party vote share and a siphon lean (0..1) saying how
 * much of that share comes out of D's pool vs R's pool — 0 = entirely from R
 * (spoils R), 1 = entirely from D (spoils D), 0.5 = symmetric (margin
 * unchanged, third party just makes a sub-50% plurality possible).
 *
 * At thirdShare=0 this reduces to {dShare:(1+m)/2, rShare:(1-m)/2, oShare:0}
 * exactly, term for term — the plain two-party split.
 *
 * `floors` ({d, r}, each 0..1) is how far a major party is protected from
 * being siphoned all the way to zero by an outsized third-party share
 * colliding with an already-lopsided margin — real, on-every-ballot major
 * parties never actually vanish (Alf Landon still got a sliver of South
 * Carolina's vote against FDR's 1936 landslide; Trump still cleared a few
 * points in DC in 2016). Omitted/null degenerates to {d:0, r:0} — no
 * protection at all, today's behavior — so every call site that doesn't
 * pass floors (the hot Monte-Carlo loop in forecast.js, in particular) is
 * unaffected. See thirdParty.js's computeMajorPartyFloors for where a real
 * (jittered, per-unit) pair of floors comes from.
 *
 * Pulled out of synthesizeVotesThreeWay as the pure share-level math so
 * campaign.js's poll-time simplex construction can reuse the exact same,
 * already-tuned D/R/T carve-up instead of re-deriving it.
 */
export function sharesThreeWay(twoPartyMargin, thirdShare, siphonLean, floors = null) {
  const m = Math.max(-0.999, Math.min(0.999, twoPartyMargin || 0));
  const oShare = Math.max(0, Math.min(0.999, thirdShare || 0));
  const s = Math.max(0, Math.min(1, siphonLean ?? 0.5));
  const dFloor = (floors && isFinite(floors.d)) ? Math.max(0, floors.d) : 0;
  const rFloor = (floors && isFinite(floors.r)) ? Math.max(0, floors.r) : 0;

  const dTwoParty = (1 + m) / 2; // what D would get with no third party at all
  const rTwoParty = (1 - m) / 2;
  let dLoss = Math.min(oShare * s, Math.max(0, dTwoParty - dFloor));
  let rLoss = Math.min(oShare * (1 - s), Math.max(0, rTwoParty - rFloor));

  // Pathological case: a large third-party share collided with an already-lopsided
  // margin and one side hit its floor before absorbing its full intended loss. Push
  // the overflow onto the other side if it has room; otherwise it comes back out of
  // the third-party share itself (oShareFinal below) rather than going below either
  // floor.
  let deficit = (oShare * s - dLoss) + (oShare * (1 - s) - rLoss);
  if (deficit > 1e-9) {
    if (dLoss < oShare * s) {
      const extra = Math.min(deficit, Math.max(0, rTwoParty - rLoss - rFloor));
      rLoss += extra; deficit -= extra;
    } else if (rLoss < oShare * (1 - s)) {
      const extra = Math.min(deficit, Math.max(0, dTwoParty - dLoss - dFloor));
      dLoss += extra; deficit -= extra;
    }
  }
  const oShareFinal = Math.max(0, oShare - deficit);
  const dShare = dTwoParty - dLoss;
  const rShare = 1 - dShare - oShareFinal;
  return { dShare, rShare, oShare: oShareFinal };
}

/**
 * Three-way version of synthesizeVotes: splits a unit's turnout into D/R/O
 * vote counts from its two-party margin, a third-party vote SHARE (0..1, the
 * fraction of all voters going third-party), and a siphon lean (0..1, see
 * sharesThreeWay).
 *
 * At thirdShare=0 this reproduces synthesizeVotes(margin, totalVotes) exactly,
 * term for term.
 */
export function synthesizeVotesThreeWay(twoPartyMargin, thirdShare, siphonLean, totalVotes, floors = null) {
  const total = Math.max(1, Math.round(totalVotes || 0));
  const { dShare, oShare } = sharesThreeWay(twoPartyMargin, thirdShare, siphonLean, floors);
  const dVotes = Math.round(total * dShare);
  const oVotes = Math.round(total * oShare);
  return { dVotes, rVotes: total - dVotes - oVotes, oVotes, total };
}

/**
 * Build rows in the schema election-night.js expects (see tester.js:443-447).
 *
 * @param {object} o
 * @param {Map<string,number>} o.finalRel  final relative margins
 * @param {number}             o.npv       final national popular vote
 * @param {object}             o.baseline  from baseline.js
 * @param {number}             [o.turnoutScale=1] uniform turnout multiplier vs 2024
 * @param {Map<string,number>} [o.thirdShare=null] per-unit third-party vote
 *        share (0..1), from engine.js's sim.truthThirdShare. Omitted/null
 *        reproduces today's two-party-only output exactly.
 * @param {number}              [o.siphonLean=0.5] which major party the third
 *        party siphons more from (0 = spoils R, 1 = spoils D)
 * @param {string|null}         [o.oCandidateName=null] third-party candidate's
 *        display name — becomes thirdPartyResults' object key, matching how
 *        election-night.js already reads a historical year's third-party winner
 * @param {Map<string,{d:number,r:number}>} [o.majorPartyFloors=null] per-unit
 *        floors (see sharesThreeWay) from engine.js's sim.majorPartyFloors.
 *        Omitted/null reproduces today's "can hit zero" output exactly.
 */
export function buildRows({
  finalRel, npv, baseline, turnoutScale = 1, thirdShare = null, siphonLean = 0.5, oCandidateName = null,
  majorPartyFloors = null,
}) {
  const rows = [];
  const votesByUnit = new Map();
  let natD = 0, natR = 0, natO = 0, natTotal = 0;

  // Districts and plain states first; at-large units are summed from their
  // districts afterwards so ME-AL/NE-AL can never disagree with their own parts.
  for (const unit of baseline.simUnits) {
    const rel = finalRel.get(unit) || 0;
    const beta = baseline.beta.get(unit) || 1;
    const margin = rel + beta * npv;
    const turnout = (baseline.totalVotes.get(unit) || 0) * turnoutScale;
    const oShareForUnit = thirdShare ? (thirdShare.get(unit) || 0) : 0;
    const floors = majorPartyFloors ? majorPartyFloors.get(unit) : null;
    const votes = synthesizeVotesThreeWay(margin, oShareForUnit, siphonLean, turnout, floors);
    votesByUnit.set(unit, votes);

    // Only simUnits contribute to the national total; counting ME-AL as well as
    // ME-01/ME-02 would double-count every Maine voter.
    natD += votes.dVotes; natR += votes.rVotes; natO += votes.oVotes; natTotal += votes.total;
  }

  for (const [alUnit, parts] of baseline.atLarge) {
    let dVotes = 0, rVotes = 0, oVotes = 0, total = 0;
    for (const part of parts) {
      const v = votesByUnit.get(part.unit);
      if (!v) continue;
      dVotes += v.dVotes; rVotes += v.rVotes; oVotes += v.oVotes; total += v.total;
    }
    votesByUnit.set(alUnit, { dVotes, rVotes, oVotes, total });
  }

  // The national margin the synthesized votes actually produce. Rounding to whole
  // votes moves it a hair off the requested `npv`, and every row must quote this
  // same number: getNatMargin() averages `nm` across these rows and the result is
  // subtracted from _curPv, so any disagreement becomes a real shift applied to
  // every state.
  const realizedNpv = natTotal > 0 ? (natD - natR) / natTotal : 0;

  for (const unit of baseline.units) {
    const { dVotes, rVotes, oVotes, total } = votesByUnit.get(unit) || { dVotes: 0, rVotes: 0, oVotes: 0, total: 1 };
    const margin = total > 0 ? (dVotes - rVotes) / total : 0;
    const hasThird = oCandidateName && oVotes > 0;

    rows.push({
      year: YEAR,
      unit,
      // rm is the lean relative to the realized national margin, so downstream
      // `rm + pv` reconstructions stay consistent with the vote totals.
      rm: margin - realizedNpv,
      nm: realizedNpv,
      ev: baseline.ev.get(unit) || 0,
      tp: hasThird ? 1 : 0,
      thirdShare: total > 0 ? oVotes / total : 0,
      dVotes,
      rVotes,
      tVotes: oVotes,
      total,
      topThirdVotes: oVotes, // only ever one third-party candidate in this sim
      dCandidate: baseline.candidates.d,
      rCandidate: baseline.candidates.r,
      thirdPartyResults: hasThird ? { [oCandidateName]: oVotes } : {},
      specialCaseNotes: '',
      color: margin >= 0 ? 'blue' : 'red',
      elasticity: baseline.beta.get(unit) || 1,
    });
  }

  const natHasThird = oCandidateName && natO > 0;
  rows.push({
    year: YEAR,
    unit: 'NATIONAL',
    rm: 0,
    nm: realizedNpv,
    ev: 0,
    tp: natHasThird ? 1 : 0,
    thirdShare: natTotal > 0 ? natO / natTotal : 0,
    dVotes: natD,
    rVotes: natR,
    tVotes: natO,
    total: natTotal,
    topThirdVotes: natO,
    dCandidate: baseline.candidates.d,
    rCandidate: baseline.candidates.r,
    thirdPartyResults: natHasThird ? { [oCandidateName]: natO } : {},
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
 * @param {number} [seed] this campaign run's seed (state.sim.seed) - published
 *   as window._enSeed so election-night.js can derive Aleck Lickman's false-beet
 *   wobble from something stable (the same run/seed always calls the same
 *   beet count) instead of a fresh draw every Start/Reset.
 * @param {object} [forecast] the campaign's own Election-Eve forecast (see
 *   sim2028.js's currentForecast(), a forecast.js runForecast() result) plus
 *   a `pollNpv` field (the Election-Eve poll's national margin) - published
 *   as window._enForecast for the opening raceOverview slide's stats row
 *   (win %/tie %/median EV/NPV) to read directly, rather than the live
 *   win-probability MC, which is deliberately hedged near 50-50 before any
 *   returns are actually in.
 * @param {Map<string,number>} [thirdShare] see buildRows — from
 *   sim.truthThirdShare when the third-party mechanic is enabled, else omitted
 * @param {number} [siphonLean=0.5] see buildRows
 * @param {string|null} [oCandidateName=null] see buildRows
 * @param {Map<string,{d:number,r:number}>} [majorPartyFloors=null] see buildRows —
 *   from sim.majorPartyFloors when the third-party mechanic is enabled, else omitted
 * @param {Map<string,{d:number,r:number,t:number,u:number}>} [pollSharesByUnit]
 *   the Election-Eve poll's own sampled D/R/T/Undecided shares per unit (see
 *   sim2028.js's pollShares()) — published alongside pollMarginByUnit on
 *   window._enPollPrior so the pre-election badge can classify a state
 *   straight off the same numbers the polling table shows, including a state
 *   where the third-party candidate was actually leading (or running a close
 *   second) as Tilt/Lean/Likely/Safe O.
 */
export function installElectionNight({
  finalRel, npv, baseline, turnoutScale = 1, pollMarginByUnit = null, seed = null, forecast = null,
  thirdShare = null, siphonLean = 0.5, oCandidateName = null, pollSharesByUnit = null, majorPartyFloors = null,
}) {
  const { rows, realizedNpv } = buildRows({
    finalRel, npv, baseline, turnoutScale, thirdShare, siphonLean, oCandidateName, majorPartyFloors,
  });

  window._enSeed = Number.isFinite(seed) ? seed : null;
  window._enForecast = forecast || null;
  // Ground-truth "is the third-party mechanic on for this run" signal - distinct
  // from whether O actually won any electoral votes (see election-night.js's
  // computeHasThirdParty()), so a player who turned the mechanic on still sees
  // their third-party candidate in the opening portrait and the running-tally
  // scoreboard even on a run where they don't crack a single state.
  window._enThirdPartyEnabled = !!thirdShare;

  window._enPollPrior = pollMarginByUnit
    ? { year: YEAR, marginByUnit: pollMarginByUnit, sharesByUnit: pollSharesByUnit, spec: POLL_ERROR_SPEC }
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
    try { window.resetElectionNightSimulation(false, true); } catch (e) { /* not yet prepared */ }
  }
  if (typeof window.prepareElectionNightSimulation === 'function') {
    window.prepareElectionNightSimulation();
  }

  return { rows, realizedNpv };
}

export default { installElectionNight, buildRows, synthesizeVotes, synthesizeVotesThreeWay, sharesThreeWay, YEAR };

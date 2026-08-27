'use strict';

/**
 * Page wiring for the 2028 campaign simulator prototype.
 *
 * All modelling lives in utils/sim2028/*. This file only maps engine output onto
 * the DOM: step pills, forecast numbers, charts, map colours, the state table,
 * and the handoff to election-night.js.
 */

import { createSimulation, computeTodaySeed, PARAMS, LEGACY_CALIBRATION } from './utils/sim2028/engine.js';
import { loadBaseline } from './utils/sim2028/baseline.js';
import { npvBand } from './utils/sim2028/forecast.js';
import { analyticTippingPoint } from './utils/sim2028/tippingPoint.js';
import { installElectionNight, buildRows, sharesThreeWay } from './utils/sim2028/electionNightBridge.js';
import { renderHistogram, renderTrend, renderSnake } from './sim2028Charts.js';
import { getStateName, ID_TO_ABBR } from './utils/constants.js';
import { lastNameFrom } from './utils/candidateNames.js';
import {
  DEFAULT_CANDIDATES, PRESET_CANDIDATES,
  loadCandidateChoice, saveCandidateChoice, applyCandidateChoice,
} from './utils/sim2028/candidatePicker.js';
import { searchCandidates, formatLabel as formatCandidateLabel } from './utils/sim2028/candidateSearch.js';
import { applyHomeStateAdvantage, DEFAULT_REALISM_TIER, PRESET_HOME_STATES } from './utils/sim2028/homeStateAdvantage.js';
import { TOSSUP_BAND, TILT_BAND, LEAN_BAND, LIKELY_BAND, TOSSUP_COLOR, RATINGS, ratingForShares } from './utils/electionRatings.js';

const state = {
  baseline: null,
  sim: null,
  step: 0,
  revealed: false,
  sortKey: 'margin',
  sortDir: 1, // 1 = ascending by |margin| (closest first)
  // ?debug=true reveals the hidden truth in tooltips, the table and a summary
  // panel. Off by default: knowing the answer removes the whole point.
  debug: new URLSearchParams(location.search).get('debug') === 'true',
  // What's currently glowing on the map — at most one source at a time, shared
  // between the trendline legend (isolate one state) and the EV-by-rating badges
  // (highlight a whole tier). {source:'trend', unit} | {source:'rating', key} | null.
  mapHighlight: null,
  // Which unit's tooltip is currently open, if any — lets refreshHoveredTip()
  // keep it live while the mouse just sits there (see that function).
  hoveredUnit: null,
  // Candidate picks — {mode:'default'|'preset'|'custom'|'historical', name, imageUrl,
  // homeState, strength} per party. Mostly a display concern (baseline.candidates label +
  // portrait override), but a preset name (fixed home state) or a custom/historical
  // homeState also feeds homeStateAdvantage.js's small lean bump -- scaled by strength,
  // applied fresh in startCampaign(). See candidatePicker.js and homeStateAdvantage.js.
  // `o` (third-party/independent) is custom/historical-search only — see
  // candidatePicker.js's PRESET_CANDIDATES.o (deliberately empty).
  candidates: { d: null, r: null, o: null },
  candidateSearchOpen: { d: false, r: false, o: false }, // UI-only: whether the search panel is expanded, independent of the current pick
  // Last custom candidate config per party, kept around even while a preset/search
  // pick is active so re-selecting "Custom..." restores it instead of starting blank.
  lastCustomCandidate: { d: null, r: null, o: null },
};

const TREND_PALETTE = ['#7aa2f7', '#e06c6c', '#7fc99a', '#e0b070', '#b48ee0', '#68c4d4', '#f0c96e', '#c990e0', '#79d1a8', '#e88ea0', '#8fb8e0', '#d0a05a'];

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- formatting
function fmtMargin(m) {
  if (!isFinite(m)) return '—';
  if (Math.abs(m) < 0.0005) return 'EVEN';
  return (m > 0 ? 'D+' : 'R+') + (Math.abs(m) * 100).toFixed(1);
}
/** Debug-panel only: an actual value instead of "EVEN" on a near-tie, 2 decimals for precision. */
function fmtMarginPrecise(m) {
  if (!isFinite(m)) return '—';
  return (m >= 0 ? 'D+' : 'R+') + (Math.abs(m) * 100).toFixed(2);
}
function fmtPct(p) { return (p * 100).toFixed(1) + '%'; }

/** Ranks decided D/R/(O) shares and returns the leader's key plus their lead
 *  over the closest rival, as a fraction of the decided vote. Null when
 *  there's no decided vote at all. With O's share always 0 (third party
 *  off), this always resolves to D or R - identical to the old plain
 *  D-vs-R margin. */
function leaderVsRunnerUp(dShare, rShare, oShare) {
  const decided = dShare + rShare + (oShare || 0);
  if (decided <= 0) return null;
  const ranked = [['d', dShare], ['r', rShare], ['o', oShare || 0]].sort((a, b) => b[1] - a[1]);
  return { key: ranked[0][0], lead: (ranked[0][1] - ranked[1][1]) / decided };
}

/** Formats a leaderVsRunnerUp() result as "<label>+X.X" (or "EVEN"/"—"). */
function fmtLeaderMargin(result, labels, { digits = 1, showEven = true } = {}) {
  if (!result) return '—';
  if (showEven && result.lead < 0.00005) return 'EVEN';
  return `${labels[result.key]}+${(result.lead * 100).toFixed(digits)}`;
}

/** D/R/(T)/Undecided poll shares, one category per line and each in its own
 *  party color — reads better in the table than a run-on "44% D · 47% R". */
function fmtSharesLines(s, hasThird) {
  if (!s) return '<div>—</div>';
  const rows = [[s.d, 'D', 's28-d'], [s.r, 'R', 's28-r']];
  if (hasThird) rows.push([s.t, 'T', 's28-t']);
  rows.push([s.u, 'U', 's28-u']);
  return rows.map(([v, label, cls]) => `<div class="${cls}">${fmtPct(v)} ${label}</div>`).join('');
}

/** Parse "D+3", "R+2.5", "EVEN", or a raw number into a margin fraction. */
function parsePvText(txt) {
  const s = String(txt || '').trim().toUpperCase();
  if (!s || s === 'EVEN' || s === '0') return 0;
  const m = s.match(/^([DR])\s*\+?\s*([0-9.]+)$/);
  if (m) {
    const v = parseFloat(m[2]) / 100;
    return m[1] === 'D' ? v : -v;
  }
  const raw = parseFloat(s);
  if (!isFinite(raw)) return 0;
  return Math.abs(raw) > 1 ? raw / 100 : raw;
}

/**
 * Blue/red ramp; saturates around a 15pt margin. Anything inside the toss-up
 * band renders neutral grey rather than a very pale blue/red, so a genuinely
 * undecided state doesn't read as leaning.
 */
function colorForMargin(m) {
  if (!isFinite(m)) return '#2f2f2f';
  if (Math.abs(m) < TOSSUP_BAND) return TOSSUP_COLOR;
  const t = Math.min(1, Math.abs(m) / 0.15);
  const lo = m >= 0 ? [190, 214, 245] : [245, 200, 200];
  const hi = m >= 0 ? [30, 70, 170] : [150, 20, 20];
  const c = lo.map((v, i) => Math.round(v + (hi[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ------------------------------------------------------------------ accessors
function currentSnapshot() { return state.sim ? state.sim.snapshots[state.step] : null; }
function currentForecast() { return state.sim ? state.sim.forecasts[state.step] : null; }

/** Absolute margin implied by a snapshot's polls, including elasticity. */
function pollMargins(snap) {
  const out = new Map();
  if (!snap || !state.baseline) return out;
  for (const unit of state.baseline.units) {
    const beta = state.baseline.beta.get(unit) || 1;
    out.set(unit, (snap.pollRel.get(unit) || 0) + beta * snap.pollNpv);
  }
  return out;
}

/** Whether this run's hidden truth includes a third-party candidate at all. */
function hasThirdParty() { return !!(state.sim && state.sim.truthThirdShare); }

/** A unit's D/R/(T)/Undecided poll shares (fractions of the sampled n), or null. */
function pollShares(snap, unit) {
  return snap && snap.pollShares ? (snap.pollShares.get(unit) || null) : null;
}

/** A unit's true D/R/O shares (fractions of the decided electorate, no
 *  Undecided axis) - the same three-way split campaign.js seeds polling
 *  from (see campaign.js's unitShares). */
function trueSharesForUnit(unit) {
  const sim = state.sim;
  const beta = state.baseline.beta.get(unit) || 1;
  const margin = (sim.truthRel.get(unit) || 0) + beta * sim.truthNpv;
  const oShare = sim.truthThirdShare ? (sim.truthThirdShare.get(unit) || 0) : 0;
  const floors = sim.majorPartyFloors ? sim.majorPartyFloors.get(unit) : null;
  return sharesThreeWay(margin, oShare, sim.siphonLean ?? 0.5, floors);
}

/**
 * A unit's rating (Tilt/Lean/Likely/Safe D/R/O, or Toss-up) directly from its
 * own sampled D/R/T/Undecided poll shares (the exact numbers shown in the
 * table/tooltip), renormalized to exclude Undecided so the established
 * 2/5/10/15pt bands - tuned around a decided-voter margin - still apply. This
 * is deliberately NOT built off pollMargins()'s smoothed margin: that margin
 * is defined as D's dominance over R specifically (see campaign.js's
 * obsMargin), which stays large even when a surging third-party candidate is
 * actually neck-and-neck with the leader - reconstructing shares from it would
 * report a state as comfortably D while its own poll shows D and T essentially
 * tied. Reading the shares directly instead means the tier can never disagree
 * with the percentages sitting right next to it. With third party off (t
 * always 0), this reduces to exactly ratingFor(pollMargins() margin) - same
 * decided-D minus decided-R gap, just computed from the shares instead of the
 * pre-derived scalar.
 */
function ratingForUnit(snap, unit) {
  const s = pollShares(snap, unit);
  if (!s) return ratingForShares({});
  const decided = s.d + s.r + s.t;
  if (decided <= 0) return ratingForShares({});
  return ratingForShares({ dShare: s.d / decided, rShare: s.r / decided, oShare: s.t / decided });
}

/**
 * Signed leader-vs-strongest-rival margin among a unit's decided D/R/(T)
 * shares (positive = D ahead, negative = R ahead), for the map's continuous
 * blue/red fill - the same "who's really challenging the leader" question
 * ratingForUnit answers, just signed instead of tiered. Returns null when
 * a third-party candidate is actually the leader (colorForMargin has no
 * third color for that; the caller falls back to the O tier's flat gold).
 * With third party off (t always 0), this is exactly dShare-rShare, so an
 * ordinary two-party game colors identically to before this existed.
 */
function twoWayColorMargin(snap, unit) {
  const s = pollShares(snap, unit);
  if (!s) return 0;
  const decided = s.d + s.r + s.t;
  if (decided <= 0) return 0;
  const dDec = s.d / decided, rDec = s.r / decided, tDec = s.t / decided;
  if (tDec > dDec && tDec > rDec) return null;
  return dDec >= rDec ? dDec - Math.max(rDec, tDec) : -(rDec - Math.max(dDec, tDec));
}

/**
 * The real EV tally, D/R/O alike, plus (when third party is on) its
 * best-performing states and how close each one came to winning. Built off
 * buildRows() — the exact same vote synthesis + at-large aggregation
 * election night itself uses — so this can never disagree with what
 * election night ends up showing, and there is exactly one place a
 * third-party win gets counted rather than two that could contradict each
 * other. With third party off, buildRows() synthesizes tVotes=0 everywhere,
 * so this degenerates to a plain D/R tally.
 *
 * Also surfaces buildRows()'s own `realizedNpv` — the actual D-R national
 * margin the synthesized votes come out to, which is NOT the same number as
 * sim.truthNpv whenever third party is on and siphonLean isn't exactly 0.5
 * (an asymmetric siphon shifts the realized margin by
 * nationalThirdShare*(1-2*siphonLean) off of the pre-siphon input - see
 * sharesThreeWay). The debug panel needs this one, not sim.truthNpv, to
 * actually show the truth.
 */
function computeTruthSummary(sim, baseline) {
  const { rows, realizedNpv } = buildRows({
    finalRel: sim.truthRel, npv: sim.truthNpv, baseline,
    thirdShare: sim.truthThirdShare || null, siphonLean: sim.siphonLean ?? 0.5,
    oCandidateName: sim.thirdPartyCandidate || 'Third party', majorPartyFloors: sim.majorPartyFloors || null,
  });
  let dem = 0, rep = 0, oth = 0;
  const top = [];
  let natShares = null;
  for (const row of rows) {
    if (row.unit === 'NATIONAL') {
      natShares = row.total > 0
        ? { d: row.dVotes / row.total, r: row.rVotes / row.total, o: row.tVotes / row.total }
        : null;
      continue;
    }
    const oWins = row.tVotes > row.dVotes && row.tVotes > row.rVotes;
    if (oWins) oth += row.ev;
    else if (row.dVotes >= row.rVotes) dem += row.ev;
    else rep += row.ev;
    if (sim.truthThirdShare) {
      const leaderVotes = Math.max(row.dVotes, row.rVotes);
      const gapPts = row.total > 0 ? ((leaderVotes - row.tVotes) / row.total) * 100 : 0;
      top.push({ unit: row.unit, share: row.thirdShare, gapPts, oWins });
    }
  }
  top.sort((a, b) => b.share - a.share);
  return { dem, rep, oth, top: top.slice(0, 6), realizedNpv, natShares };
}

/** Electoral votes grouped by rating tier, D-safest to R-safest (then O). */
function evByRating(snap, margins) {
  const totals = new Map(RATINGS.map(r => [r.key, 0]));
  for (const unit of state.baseline.units) {
    const r = ratingForUnit(snap, unit);
    totals.set(r.key, totals.get(r.key) + (state.baseline.ev.get(unit) || 0));
  }
  return totals;
}

/** 90% interval for a single unit's margin at the current step. */
function unitBand(unit, snap) {
  const f = currentForecast();
  if (!f || !snap) return null;
  const spec = state.sim.params.poll;
  const sd = spec.unitSigmas * f.relScale;
  const npvSd = spec.nationalSigma * f.npvScale;
  const beta = state.baseline.beta.get(unit) || 1;
  // The two axes are independent, so their variances add.
  const total = Math.sqrt(sd * sd + (beta * npvSd) * (beta * npvSd));
  const m = (snap.pollRel.get(unit) || 0) + beta * snap.pollNpv;
  return [m - 1.645 * total, m + 1.645 * total];
}

// -------------------------------------------------------------------- tooltip
/**
 * Election-night tooltip: live returns rather than polls. Reads the snapshot
 * election-night.js publishes on window each frame.
 */
function showReturnsTip(evt, unit) {
  const tip = $('mapTip');
  if (!tip) return;
  const snapshots = window._electionNightSnapshot;
  const s = snapshots ? snapshots.get(unit) : null;
  const name = unit.includes('-') ? unit : (getStateName(unit) || unit);

  // No snapshot yet — polls haven't closed, or the user hit the simulator's
  // Reset, which nulls window._electionNightSnapshot. Show an idle returns card
  // rather than falling back to poll tooltips: we are on the election-night
  // screen, so quietly reverting to pre-election polling reads as a bug.
  if (!s) {
    const snap = currentSnapshot();
    const shares = snap ? pollShares(snap, unit) : null;
    const rating = shares ? ratingForUnit(snap, unit) : null;
    const returnsLabels = {
      d: lastNameFrom(state.baseline.candidates.d) || 'D',
      r: lastNameFrom(state.baseline.candidates.r) || 'R',
      o: 'Other',
    };
    const pollLeader = shares ? leaderVsRunnerUp(shares.d, shares.r, shares.t) : null;
    const rows = [
      ['Electoral votes', state.baseline.ev.get(unit) || 0],
      ['Status', 'Not yet reporting'],
      ['Final poll', fmtLeaderMargin(pollLeader, returnsLabels)],
    ];
    if (state.debug && state.sim) {
      const ts = trueSharesForUnit(unit);
      const trueLeader = leaderVsRunnerUp(ts.dShare, ts.rShare, ts.oShare);
      rows.push(['TRUE final', fmtLeaderMargin(trueLeader, returnsLabels, { digits: 2, showEven: false })]);
    }
    tip.innerHTML = `<div class="tip-name">${name}`
      + (rating ? ` <span class="s28-rating" style="background:${rating.color};color:#fff">${rating.label}</span>` : '')
      + '</div>'
      + rows.map(([k, v]) => `<div class="tip-row"><span>${k}</span><span>${v}</span></div>`).join('');
    tip.style.display = 'block';
    moveTip(evt);
    return;
  }

  const leader = s.leader === 'D' ? 'Democrats' : s.leader === 'R' ? 'Republicans' : s.leader === 'O' ? 'Other' : null;
  const badge = s.called
    ? `<span class="s28-rating" style="background:${s.leader === 'D' ? '#1e46aa' : '#9d1b1b'};color:#fff">Called</span>`
    : '<span class="s28-rating" style="background:#3a3a3a;color:#ddd">Counting</span>';

  // Raw counted vote totals per candidate, with percentage of votes counted so
  // far — the actual numbers behind "Margin", matching what future.html's
  // tooltip shows via calculateUnitVoteTallies (not available on this page
  // without tester.js, so computed directly off the same snapshot fields).
  const dVotes = Math.max(0, s.dVotes || 0);
  const rVotes = Math.max(0, s.rVotes || 0);
  const oVotes = Math.max(0, s.oVotesTotal != null ? s.oVotesTotal : (s.oVotes || 0));
  const totalCounted = dVotes + rVotes + oVotes;
  const fmtVote = v => Math.round(v).toLocaleString('en-US');
  const fmtVotePct = v => totalCounted > 0 ? ` (${(v / totalCounted * 100).toFixed(1)}%)` : '';
  const dName = lastNameFrom(s.dCandidate) || 'Dem';
  const rName = lastNameFrom(s.rCandidate) || 'Rep';

  // Raw vote-count margin — a different number from the percentage-point
  // "Margin" row above it, and the one that actually answers "by how many
  // votes". Same convention as future.html's tooltip (leader name + vote gap).
  const tally = [['D', dVotes, dName], ['R', rVotes, rName], ['O', oVotes, 'Other']]
    .sort((a, b) => b[1] - a[1]);
  const voteMargin = Math.max(0, tally[0][1] - tally[1][1]);
  const voteMarginText = totalCounted > 0
    ? `${tally[0][2]}+${fmtVote(voteMargin)} vote${voteMargin === 1 ? '' : 's'}`
    : '—';
  // Star the leading candidate, matching formatUnitTooltip's convention.
  const star = party => tally[0][0] === party && totalCounted > 0 ? '*' : '';

  const returnsLabels = { d: dName, r: rName, o: 'Other' };
  const finalPollShares = pollShares(currentSnapshot(), unit);
  const finalPollLeader = finalPollShares ? leaderVsRunnerUp(finalPollShares.d, finalPollShares.r, finalPollShares.t) : null;
  const rows = [
    ['Electoral votes', s.ev],
    ['Reporting', `${((s.reporting || 0) * 100).toFixed(2)}%`],
    ['Margin', s.marginStr || fmtMargin(s.margin)],
    ['Final poll', fmtLeaderMargin(finalPollLeader, returnsLabels)],
    ['Vote margin', voteMarginText],
    ['Leader', leader || '—'],
  ];
  // Once called, a confidence percentage reads as hedging on a settled result —
  // future.html's tooltip drops it at that point too, showing only "Called".
  if (!s.called) rows.push(['Confidence', `${((s.confidence || 0) * 100).toFixed(0)}%`]);
  rows.push(
    [dName + star('D'), `${fmtVote(dVotes)}${fmtVotePct(dVotes)}`],
    [rName + star('R'), `${fmtVote(rVotes)}${fmtVotePct(rVotes)}`],
  );
  if (oVotes > 0) rows.push(['Other' + star('O'), `${fmtVote(oVotes)}${fmtVotePct(oVotes)}`]);
  if (totalCounted > 0) rows.push(['Total', `${fmtVote(totalCounted)} votes`]);
  rows.push(['Votes left', fmtVote(s.remainingVotes || 0)]);
  if (state.debug && state.sim) {
    const ts = trueSharesForUnit(unit);
    const trueLeader = leaderVsRunnerUp(ts.dShare, ts.rShare, ts.oShare);
    rows.push(['TRUE final', fmtLeaderMargin(trueLeader, returnsLabels, { digits: 2, showEven: false })]);
  }

  tip.innerHTML = `<div class="tip-name">${name} ${badge}</div>`
    + rows.map(([k, v]) => `<div class="tip-row"><span>${k}</span><span>${v}</span></div>`).join('');
  tip.style.display = 'block';
  moveTip(evt);
}

function showTip(evt, unit) {
  // Remembered so refreshHoveredTip() can re-render this tooltip's CONTENT on a
  // timer, without a new mouse event — see that function for why this matters.
  state.hoveredUnit = unit;
  // Once we're on election night the polls are history, so this switches for the
  // rest of the session — no falling back if a snapshot happens to be missing.
  if (state.revealed || window._electionNightActive) {
    showReturnsTip(evt, unit);
    return;
  }
  const tip = $('mapTip');
  if (!tip || !state.sim) return;
  const snap = currentSnapshot();
  const f = currentForecast();
  const margins = pollMargins(snap);
  const m = margins.get(unit);
  if (m == null) return;
  const rating = ratingForUnit(snap, unit);
  const band = unitBand(unit, snap);
  const prob = f ? f.stateProb.get(unit) : null;
  const name = unit.includes('-') ? unit : (getStateName(unit) || unit);
  const prev = state.step > 0 ? pollMargins(state.sim.snapshots[state.step - 1]).get(unit) : null;

  // "Lean" (margin relative to the nation) is an abstraction — it doesn't say who
  // actually WON the state, since that also depends on the national environment
  // that year. Pairing it with the raw margin gives both: the number that
  // generalizes across years, and the number people actually recognize.
  const historyRow = (label, leanMap, rawMap) => {
    const lean = leanMap.get(unit);
    const raw = rawMap.get(unit);
    // Fixed-width box around the lean value so "(raw:" lands at the same spot
    // on every row regardless of digit count — without changing what's shown.
    return [label, `<span class="s28-num">${fmtMargin(lean)}</span> lean${raw != null ? ` (raw: ${fmtMargin(raw)})` : ''}`];
  };
  const shares = pollShares(snap, unit);
  const thirdOn = hasThirdParty();
  const dName = lastNameFrom(state.baseline.candidates.d) || 'Dem';
  const rName = lastNameFrom(state.baseline.candidates.r) || 'Rep';
  const oName = lastNameFrom(state.sim.thirdPartyCandidate) || 'Third party';
  // fmtMargin(m) is always D-vs-R (see ratingForUnit's comment above) - fine for
  // the 2020/2024/90%-range/TRUE rows, which are that abstraction on purpose,
  // but wrong for "the current poll standing": a state where a third-party
  // candidate is actually the frontrunner or runner-up needs its margin
  // measured against whoever's really in second, not against R regardless.
  // Named by candidate (not the D/R/O letter formatRunnerUpLean uses elsewhere)
  // since this row sits right above the per-candidate rows that already do.
  const decided = shares ? shares.d + shares.r + shares.t : 0;
  let pollText = fmtMargin(m);
  if (decided > 0) {
    const ranked = [[dName, shares.d], [rName, shares.r], [oName, shares.t]].sort((a, b) => b[1] - a[1]);
    const lead = (ranked[0][1] - ranked[1][1]) / decided;
    pollText = Math.abs(lead) < 0.000005 ? 'EVEN' : `${ranked[0][0]}+${(Math.abs(lead) * 100).toFixed(1)}`;
  }
  const rows = [
    ['Electoral votes', state.baseline.ev.get(unit) || 0],
    historyRow('2020', state.baseline.relPrior, state.baseline.presMarginPrior),
    historyRow('2024', state.baseline.rel2024, state.baseline.presMargin2024),
    ['Poll', pollText],
  ];
  if (shares) {
    rows.push([dName, fmtPct(shares.d)]);
    rows.push([rName, fmtPct(shares.r)]);
    if (thirdOn) rows.push([oName, fmtPct(shares.t)]);
    rows.push(['Undecided', fmtPct(shares.u)]);
  }
  rows.push(
    ['90% range', band ? `${fmtMargin(band[0])} to ${fmtMargin(band[1])}` : '—'],
    ['D win prob', prob == null ? '—' : fmtPct(prob)],
  );
  if (prev != null) rows.push(['Since last step', `${m - prev >= 0 ? '+' : ''}${((m - prev) * 100).toFixed(1)}pt`]);
  if (state.debug) {
    const ts = trueSharesForUnit(unit);
    const trueLeader = leaderVsRunnerUp(ts.dShare, ts.rShare, ts.oShare);
    rows.push(['TRUE lean', fmtMarginPrecise(state.sim.truthRel.get(unit))]);
    rows.push(['TRUE margin', fmtLeaderMargin(trueLeader, { d: dName, r: rName, o: oName }, { digits: 2, showEven: false })]);
  }

  tip.innerHTML = `<div class="tip-name">${name}`
    + ` <span class="s28-rating" style="background:${rating.color};color:#fff">${rating.label}</span></div>`
    + rows.map(([k, v]) => `<div class="tip-row"><span>${k}</span><span>${v}</span></div>`).join('');
  tip.style.display = 'block';
  moveTip(evt);
}

function moveTip(evt) {
  // No event on a content-only refresh (see refreshHoveredTip) — leave the
  // tooltip where it already is rather than erroring on evt.clientX.
  if (!evt) return;
  const tip = $('mapTip');
  const wrap = $('map-wrap');
  if (!tip || !wrap || tip.style.display === 'none') return;
  const r = wrap.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const pad = 6;
  let x = evt.clientX - r.left + 14;
  let y = evt.clientY - r.top + 14;
  x = Math.max(pad, Math.min(r.width - t.width - pad, x));
  y = Math.max(pad, Math.min(r.height - t.height - pad, y));
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

function hideTip() {
  state.hoveredUnit = null;
  const tip = $('mapTip');
  if (tip) tip.style.display = 'none';
}

/**
 * Re-render the currently-open tooltip's content in place, without moving it.
 * election-night.js calls window.refreshActiveMapTip() on a timer (interval
 * boundaries and requestAnimationFrame after every call) whenever that global
 * exists — that convention is what future.html's tooltip system uses to stay
 * live while the mouse sits still, and it's absent here without tester.js. This
 * hooks the same call site rather than pulling in tester.js's tooltip stack,
 * which is written against concepts this simulator doesn't have (proportional
 * EV modes, flip scenarios, _curYear) and doesn't know about anything specific
 * to this page (ratings, raw-margin pairs, the debug truth values).
 */
function refreshHoveredTip() {
  if (!state.hoveredUnit) return;
  showTip(null, state.hoveredUnit);
}

// -------------------------------------------------------------------- glow
/**
 * The Set of unit codes currently glowing on the map, derived fresh from
 * state.mapHighlight each call so it always reflects the current step's
 * margins (a 'rating' selection like "Lean D" has different members at
 * different campaign steps). Returns null when nothing is selected.
 */
function highlightedUnitSet() {
  const h = state.mapHighlight;
  if (!h || !state.baseline) return null;
  if (h.source === 'trend' || h.source === 'snake') return new Set([h.unit]);
  if (h.source === 'rating') {
    const snap = currentSnapshot();
    const margins = pollMargins(snap);
    const set = new Set();
    for (const unit of state.baseline.units) {
      if (ratingForUnit(snap, unit).key === h.key) set.add(unit);
    }
    return set;
  }
  return null;
}

/** mode: null = clear (nothing selected), true = highlighted, false = dimmed. */
function applyGlow(el, mode) {
  if (!el) return;
  if (mode === null) {
    el.style.opacity = '';
    el.style.filter = '';
    el.style.stroke = '';
    el.style.strokeWidth = '';
    return;
  }
  if (mode) {
    const fill = el.getAttribute('fill') || el.style.fill || '#7aa2f7';
    el.style.opacity = '1';
    el.style.stroke = '#ffffff';
    el.style.strokeWidth = '2.4px';
    el.style.filter = `drop-shadow(0 0 6px ${fill})`;
  } else {
    el.style.opacity = '0.25';
    el.style.filter = '';
    el.style.stroke = '';
    el.style.strokeWidth = '';
  }
}

/**
 * Apply the current highlight set to every map element: full-size state
 * shapes, ME/NE district shapes, and the small-state sidebar boxes. ME-AL/NE-AL
 * have no shape of their own on the map besides the small box and the parent
 * state's base fill, so selecting them also glows the parent "state-ME"/
 * "state-NE" shape — that's the only visual surface their result has.
 */
function setMapGlow() {
  const set = highlightedUnitSet();
  document.querySelectorAll('#map path[id^="state-"]').forEach(el => {
    const abbr = el.id.slice(6);
    const on = set ? (set.has(abbr) || set.has(`${abbr}-AL`)) : null;
    applyGlow(el, set ? on : null);
  });
  document.querySelectorAll('#map path[id^="district-"]').forEach(el => {
    const unit = el.id.slice(9);
    applyGlow(el, set ? set.has(unit) : null);
  });
  document.querySelectorAll('#map g.small-box').forEach(g => {
    const unit = g.getAttribute('data-unit');
    applyGlow(g.querySelector('rect'), set ? set.has(unit) : null);
  });
}

// -------------------------------------------------------------------- renders
function renderStepPills() {
  const wrap = $('s28StepPills');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!state.sim) return;
  state.sim.labels.forEach((label, i) => {
    // Every step is already computed, so any of them can be revisited freely.
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 's28-step' + (i === state.step ? ' current' : (i < state.step ? ' done' : ''));
    pill.textContent = label;
    pill.title = `Jump to ${label}`;
    pill.addEventListener('click', () => { state.step = i; renderAll(); });
    wrap.appendChild(pill);
  });
}

/** Debug panel: the hidden truth, shown only under ?debug=true. */
function renderDebug() {
  const el = $('s28Debug');
  if (!el) return;
  if (!state.debug || !state.sim) { el.classList.add('s28-hidden'); return; }
  el.classList.remove('s28-hidden');

  const sim = state.sim;
  const margins = new Map();
  for (const unit of state.baseline.units) {
    margins.set(unit, (sim.truthRel.get(unit) || 0) + (state.baseline.beta.get(unit) || 1) * sim.truthNpv);
  }
  const truth = computeTruthSummary(sim, state.baseline);
  const snap = currentSnapshot();

  // The analytic tipping point: the state whose OWN margin crossing zero is what
  // pushes the winning coalition over 270, as a function of leans/elasticity/EV
  // alone (see tippingPoint.js). Deliberately NOT evaluated at any particular
  // NPV — that's the whole point of it being "independent of NPV."
  const tp = analyticTippingPoint({
    units: state.baseline.units, rel: sim.truthRel, beta: state.baseline.beta,
    ev: state.baseline.ev, totalEv: state.baseline.totalEv,
  });

  // Closest true races at the ACTUAL national environment — a different,
  // legitimately NPV-dependent question ("how close did each race really end up")
  // shown separately so it's never confused with the tipping point above.
  const closest = state.baseline.simUnits
    .filter(u => (state.baseline.ev.get(u) || 0) > 0)
    .sort((a, b) => Math.abs(margins.get(a)) - Math.abs(margins.get(b)))
    .slice(0, 8)
    .map(u => `${u} ${fmtMarginPrecise(margins.get(u))}`)
    .join(' · ');

  // How many states really moved this cycle, and how turbulent was it?
  let moved6 = 0;
  for (const u of state.baseline.simUnits) {
    if (Math.abs(sim.truthRel.get(u) - state.baseline.rel2024.get(u)) > 0.06) moved6++;
  }

  // Aleck Lickman's "13 beets" prediction - published onto window by
  // election-night.js's prepareSimulation() once it resolves (see
  // docs/utils/electionNight/lickman.js), not part of state.sim itself, so
  // this only has anything to show once election night has actually been
  // started at least once this page load.
  const lp = window._enLickmanPrediction;
  // isActual: this year has a real graded false-key count in
  // keys_with_npv.csv (ground truth, used directly - no fit/wobble
  // involved). Always false for sim2028's own fictional race, but the
  // fields/labels stay generic since lickman.js's estimateFalseBeets() is
  // shared with the historical pages too.
  const lickmanRow = lp
    ? (lp.isActual
      ? `<div class="s28-dbgrow"><span>Lickman: false beets</span><span>${lp.decided} / 13 (real graded count) &mdash; predicts ${lp.predictedWinnerParty}</span></div>`
      : `<div class="s28-dbgrow"><span>Lickman: NPV&rarr;false-beets fit</span><span>slope ${lp.slope.toFixed(4)}, intercept ${lp.intercept.toFixed(4)}, residual &sigma; ${lp.residualStd.toFixed(4)}</span></div>
    <div class="s28-dbgrow"><span>Lickman: predicted (raw) false beets</span><span>${lp.predicted.toFixed(2)} (&plusmn;${lp.band.toFixed(2)} band)</span></div>
    <div class="s28-dbgrow"><span>Lickman: decided false beets (seeded)</span><span>${lp.decided} / 13 &mdash; predicts ${lp.predictedWinnerParty}</span></div>`)
    : `<div class="s28-dbgrow"><span>Lickman</span><span>&mdash; (start election night to compute)</span></div>`;

  // Third party is otherwise invisible until (if ever) it wins a state -- always
  // show something here, even "off", so it's never ambiguous whether the
  // mechanic is running silently vs. just not doing anything this run.
  const thirdPartyRows = !sim.truthThirdShare
    ? `<div class="s28-dbgrow"><span>Third party</span><span>off</span></div>`
    : (() => {
      const thirdPartyStrengthDesc = sim.thirdPartyStrengthMode === 'exact'
        ? `exact @ ${(sim.thirdPartyExactShare * 100).toFixed(1)}% national, home-bump ${sim.thirdPartyStrength.toFixed(2)}&times;`
        : `random, strength ${sim.thirdPartyStrength.toFixed(2)}&times;`;
      return `<div class="s28-dbgrow"><span>Third party</span><span>${sim.thirdPartyCandidate || '(unnamed)'} &mdash; ${thirdPartyStrengthDesc}, siphon lean ${sim.siphonLean.toFixed(2)} (0=spoils R, 1=spoils D)</span></div>
    <div style="margin-top:6px;color:var(--muted)">Best third-party states: ${truth.top.map(r => `${r.unit} ${(r.share * 100).toFixed(1)}%${r.oWins ? ' — WON' : ` (trails leader by ${r.gapPts.toFixed(1)}pt)`}`).join(' · ')}</div>`;
    })();

  const trueLeader = (sim.truthThirdShare && truth.natShares)
    ? leaderVsRunnerUp(truth.natShares.d, truth.natShares.r, truth.natShares.o) : null;
  const trueNpvText = trueLeader
    ? `${fmtLeaderMargin(trueLeader, { d: 'D', r: 'R', o: 'O' }, { digits: 2, showEven: false })} (${fmtMarginPrecise(truth.realizedNpv)} two-party)`
    : fmtMarginPrecise(truth.realizedNpv);
  const pollLeader = sim.truthThirdShare
    ? leaderVsRunnerUp(snap.pollSharesNpv.d, snap.pollSharesNpv.r, snap.pollSharesNpv.t) : null;
  const pollNpvText = pollLeader
    ? `${fmtLeaderMargin(pollLeader, { d: 'D', r: 'R', o: 'O' }, { digits: 2, showEven: false })} (${fmtMarginPrecise(snap.pollNpv)} two-party)`
    : fmtMarginPrecise(snap.pollNpv);
  const npvSharesRow = (sim.truthThirdShare && truth.natShares)
    ? `<div class="s28-dbgrow"><span>NPV shares (true / poll)</span><span>True D ${fmtPct(truth.natShares.d)} &middot; R ${fmtPct(truth.natShares.r)} &middot; O ${fmtPct(truth.natShares.o)} &mdash; Poll D ${fmtPct(snap.pollSharesNpv.d)} &middot; R ${fmtPct(snap.pollSharesNpv.r)} &middot; O ${fmtPct(snap.pollSharesNpv.t)} &middot; U ${fmtPct(snap.pollSharesNpv.u)}</span></div>`
    : '';

  el.innerHTML = `<strong>DEBUG — the hidden truth</strong>
    <div class="s28-dbgrow"><span>True result</span><span>D ${truth.dem} &ndash; R ${truth.rep}${truth.oth > 0 ? ` &ndash; O ${truth.oth}` : ''}</span></div>
    <div class="s28-dbgrow"><span>True national popular vote</span><span>${trueNpvText}</span></div>
    <div class="s28-dbgrow"><span>Current poll says</span><span>${pollNpvText} (off by ${((snap.pollNpv - truth.realizedNpv) * 100).toFixed(2)}pt)</span></div>
    ${npvSharesRow}
    <div class="s28-dbgrow"><span>Cycle turbulence</span><span>${sim.turbulence.toFixed(2)}&times; &mdash; ${moved6} states moved &gt;6pt (real cycles: 1&ndash;19)</span></div>
    <div class="s28-dbgrow"><span>Polling accuracy this cycle</span><span>${sim.pollTurbulence.toFixed(2)}&times; typical &mdash; ${sim.pollTurbulence < 0.85 ? '2024-style, clean' : sim.pollTurbulence > 1.15 ? '2016/2020-style, foggy' : 'about average'}</span></div>
    <div class="s28-dbgrow"><span>Calibration</span><span>${sim.params.poll.nationalSigma === LEGACY_CALIBRATION.poll.nationalSigma ? 'confident (nationalSigma 1.8pt, regionShare 0.75, floor 0.65x)' : 'default (nationalSigma 2.5pt, regionShare 0.87, floor 1.0x)'}</span></div>
    <div class="s28-dbgrow"><span>Tipping point (true, NPV-independent)</span><span>${tp ? `${tp.unit} &mdash; flips EC at NPV ${fmtMarginPrecise(tp.npvThreshold)}` : '&mdash;'}</span></div>
    ${lickmanRow}
    ${thirdPartyRows}
    <div style="margin-top:6px;color:var(--muted)">Closest true races (at the actual environment): ${closest}</div>`;
}

function renderForecast() {
  const f = currentForecast();
  const setProb = (id, value, label) => {
    const el = $(id);
    if (el) el.innerHTML = `${value}<small>${label}</small>`;
  };
  const othTile = $('s28OthProb');
  if (othTile) othTile.hidden = !hasThirdParty();
  if (!f) {
    setProb('s28DemProb', '—', 'Democratic win');
    setProb('s28RepProb', '—', 'Republican win');
    setProb('s28OthProb', '—', 'Third-party win');
    setProb('s28TieProb', '—', 'No majority');
    setProb('s28NatPoll', '—', 'National poll');
    setProb('s28MedianEv', '—', 'Median EV / 90% range');
    setProb('s28Tipping', '—', 'Tipping point');
    return;
  }
  const snap = currentSnapshot();
  const natLabels = {
    d: lastNameFrom(state.baseline.candidates.d) || 'D',
    r: lastNameFrom(state.baseline.candidates.r) || 'R',
    o: lastNameFrom(state.sim.thirdPartyCandidate) || 'Third party',
  };
  const natLeader = leaderVsRunnerUp(snap.pollSharesNpv.d, snap.pollSharesNpv.r, snap.pollSharesNpv.t);
  setProb('s28NatPoll', fmtLeaderMargin(natLeader, natLabels), 'National poll');
  setProb('s28DemProb', fmtPct(f.demWinProb), 'Democratic win');
  setProb('s28RepProb', fmtPct(f.repWinProb), 'Republican win');
  if (hasThirdParty()) setProb('s28OthProb', fmtPct(f.othWinProb), 'Third-party win');
  // "No majority": nobody reaches 270 EV - with third party off this only
  // ever happens at a literal EV tie (hence the old "Exact tie" label), but
  // once a third-party candidate can win real states outright it's a genuine,
  // non-degenerate possibility that neither major party clears a majority
  // (the scenario the 12th Amendment's contingent election exists for), so
  // it earns the more general name and a Monte Carlo estimate of its own
  // (see forecast.js's noMajorityProb) rather than staying an edge case.
  setProb('s28TieProb', f.noMajorityProb > 0 ? (f.noMajorityProb * 100).toFixed(1) + '%' : '<1%', 'No majority');
  setProb('s28MedianEv', `${f.medianDemEv} D <span style="color:var(--muted);font-size:0.8em">(${f.evRange90[0]}–${f.evRange90[1]})</span>`, 'Median EV / 90% range');
  setProb('s28Tipping', `${f.tippingPoint || '—'} <span style="color:var(--muted);font-size:0.8em">${fmtPct(f.tippingProb)}</span>`, 'Tipping point');
  renderHistogram('#s28Histogram', f);
}

function renderNpvBox() {
  const setShare = (id, value, label) => {
    const el = $(id);
    if (el) el.innerHTML = `${value}<small>${label}</small>`;
  };
  const oTile = $('s28NpvO');
  if (oTile) oTile.hidden = !hasThirdParty();
  const snap = currentSnapshot();
  if (!snap) {
    setShare('s28NpvD', '—', 'Democratic');
    setShare('s28NpvR', '—', 'Republican');
    setShare('s28NpvO', '—', 'Third party');
    setShare('s28NpvU', '—', 'Undecided');
    return;
  }
  const s = snap.pollSharesNpv;
  setShare('s28NpvD', fmtPct(s.d), 'Democratic');
  setShare('s28NpvR', fmtPct(s.r), 'Republican');
  if (hasThirdParty()) setShare('s28NpvO', fmtPct(s.t), 'Third party');
  setShare('s28NpvU', fmtPct(s.u), 'Undecided');
}

const WITHIN5_CAP = 12; // legibility cap — a genuinely close national environment can put more than 12 states inside 5pts

// Perennial 2020s battlegrounds — always shown on the trend chart even in a
// cycle where they aren't currently among the closest/within-5 states.
const ALWAYS_KEY_RACES = ['AZ', 'GA', 'WI', 'NV', 'MI', 'PA', 'NC'];

function renderTrendChart() {
  if (!state.sim) return;
  const pick = $('s28TrendPick') ? $('s28TrendPick').value : 'within5';
  const upto = state.step + 1;
  const labels = state.sim.labels.slice(0, upto);
  const sigmaNational = state.sim.params.poll.nationalSigma;
  const note = $('s28TrendNote');
  const legendEl = $('s28TrendLegend');

  // Shared by every mode: white so it reads as "the reference line", not just
  // another state in the palette.
  const npvSeries = () => ({
    label: 'NPV',
    key: 'NPV',
    color: '#f2f2f2',
    values: state.sim.snapshots.slice(0, upto).map((s, i) => {
      const [lo, hi] = npvBand(s.pollNpv, s.progress, sigmaNational, state.sim.params.forecast);
      return { step: i, value: s.pollNpv, lo, hi };
    }),
  });

  let series;
  let multiState = false;

  if (pick === 'national') {
    series = [npvSeries()];
    if (note) {
      note.textContent = 'Shaded band is the 90% interval implied by the remaining polling uncertainty. '
        + 'It narrows as the campaign progresses but never closes — that residual is the polling error nobody can forecast away.';
    }
  } else {
    multiState = true;
    const margins = pollMargins(currentSnapshot());
    let units;
    if (pick === 'within5') {
      units = state.baseline.simUnits
        .filter(u => (state.baseline.ev.get(u) || 0) > 0 && Math.abs(margins.get(u)) <= 0.05)
        .sort((a, b) => Math.abs(margins.get(a)) - Math.abs(margins.get(b)));
      if (note) {
        note.textContent = units.length > WITHIN5_CAP
          ? `${units.length} states are within 5 points — showing the closest ${WITHIN5_CAP} for legibility, plus NPV.`
          : `${units.length} state${units.length === 1 ? '' : 's'} currently polling within 5 points, closest first, plus NPV.`;
      }
      units = units.slice(0, WITHIN5_CAP);
      // The perennial battlegrounds always get a line here, even in a cycle
      // where they aren't currently polling close.
      ALWAYS_KEY_RACES.forEach(u => {
        if (state.baseline.simUnits.includes(u) && !units.includes(u)) units.push(u);
      });
    } else {
      units = state.baseline.simUnits
        .filter(u => (state.baseline.ev.get(u) || 0) > 0)
        .sort((a, b) => Math.abs(margins.get(a)) - Math.abs(margins.get(b)))
        .slice(0, 6);
      ALWAYS_KEY_RACES.forEach(u => {
        if (state.baseline.simUnits.includes(u) && !units.includes(u)) units.push(u);
      });
      if (note) {
        note.textContent = units.length > 6
          ? 'The six closest states plus key battlegrounds not already among them, at the current step, plus NPV, as projected margins.'
          : 'The six closest states at the current step, plus NPV, as projected margins.';
      }
    }
    // NPV first, so it's the first legend entry and reads as the anchor the
    // state lines are moving relative to.
    series = [npvSeries(), ...units.map((unit, k) => ({
      label: unit,
      key: unit,
      color: TREND_PALETTE[k % TREND_PALETTE.length],
      values: state.sim.snapshots.slice(0, upto).map((s, i) => {
        const beta = state.baseline.beta.get(unit) || 1;
        return { step: i, value: (s.pollRel.get(unit) || 0) + beta * s.pollNpv };
      }),
    }))];
  }

  renderTrend('#s28Trend', series, labels);

  if (legendEl) {
    if (!multiState || !series.length) {
      legendEl.classList.add('s28-hidden');
      legendEl.innerHTML = '';
    } else {
      legendEl.classList.remove('s28-hidden');
      const activeUnit = state.mapHighlight && state.mapHighlight.source === 'trend' ? state.mapHighlight.unit : null;
      legendEl.innerHTML = series.map(s => {
        const active = s.key === activeUnit ? ' active' : '';
        return `<button type="button" class="tw-swatch${active}" data-unit="${s.key}">`
          + `<i style="background:${s.color}"></i>${s.label}</button>`;
      }).join('');
    }
  }

  applyTrendIsolate();
}

/** Dim every trend-chart line except the isolated one, mirroring pca.js's applyScoreSelection. */
function applyTrendIsolate() {
  const h = state.mapHighlight;
  const selected = h && h.source === 'trend' ? h.unit : null;
  const svg = document.querySelector('#s28Trend svg');
  if (!svg) return;
  svg.querySelectorAll('[data-unit]').forEach(el => {
    const mine = el.getAttribute('data-unit') === selected;
    if (selected == null) {
      el.style.opacity = '';
      el.style.filter = '';
    } else if (mine) {
      el.style.opacity = '1';
      const stroke = el.getAttribute('stroke') || el.getAttribute('fill');
      el.style.filter = el.classList.contains('s28-trend-line') ? `drop-shadow(0 0 5px ${stroke})` : '';
    } else {
      el.style.opacity = '0.12';
      el.style.filter = '';
    }
  });
}

function toggleTrendHighlight(unit) {
  const cur = state.mapHighlight;
  state.mapHighlight = (cur && cur.source === 'trend' && cur.unit === unit) ? null : { source: 'trend', unit };
  applyTrendIsolate();
  document.querySelectorAll('#s28TrendLegend .tw-swatch').forEach(btn => {
    btn.classList.toggle('active', state.mapHighlight && state.mapHighlight.unit === btn.dataset.unit);
  });
  setMapGlow();
}

function renderMap() {
  if (!window.ElectionMap || !state.baseline) return;
  // Once election night owns the map, it paints states as they are called —
  // repainting from polls here would fight it and undo called states.
  if (state.revealed || window._electionNightActive) return;
  const snap = currentSnapshot();
  const margins = pollMargins(snap);
  const abbrColors = new Map();
  const unitColors = new Map();
  for (const unit of state.baseline.units) {
    // The continuous blue/red fill is keyed off the leader's margin over the
    // STRONGEST rival (twoWayColorMargin), not the plain D-R gap - a state
    // where D is comfortably ahead of R but neck-and-neck with a surging
    // third-party candidate needs to fade toward toss-up grey too, even
    // though nothing about the D-R gap itself changed; a bare D-R margin
    // can't see that. With O actually leading, fall back to the tier's flat
    // gold (a gradient can't represent a third color). With third party off
    // (or negligible), twoWayColorMargin always equals the plain D-R margin,
    // so ordinary two-party games render byte-identically to before.
    const rating = ratingForUnit(snap, unit);
    const color = rating.party === 'O' ? rating.color : colorForMargin(twoWayColorMargin(snap, unit));
    if (unit.includes('-')) {
      unitColors.set(unit, color);
      if (unit.endsWith('-AL')) {
        const parent = unit.slice(0, 2);
        abbrColors.set(parent, { color });
        window.ElectionMap.setStateFill(parent, color);
      }
      window.ElectionMap.setDistrictFill(unit, color);
    } else {
      abbrColors.set(unit, { color });
      window.ElectionMap.setStateFill(unit, color);
    }
  }
  const evLookup = abbr => state.baseline.ev.get(abbr) || null;
  try {
    window.ElectionMap.refreshDecorations(2028, evLookup, abbrColors, unitColors);
  } catch (e) { /* decorations are cosmetic */ }

  // Split by rating rather than a strict binary tally: a "D 258 | R 280" summary
  // implies more certainty than a pile of Tilt-rated toss-ups actually supports.
  const total = state.baseline.totalEv;
  const totals = evByRating(snap, margins);
  let dem = 0, tossup = 0, rep = 0, oth = 0;
  for (const r of RATINGS) {
    const v = totals.get(r.key) || 0;
    if (r.key === 'tossup') tossup += v;
    else if (r.party === 'D') dem += v;
    else if (r.party === 'O') oth += v;
    else rep += v;
  }
  const demPct = dem / total * 100;
  const tossupPct = tossup / total * 100;
  const othPct = oth / total * 100;
  const setW = (id, pct) => { const el = $(id); if (el) el.style.width = `${pct}%`; };
  setW('evFillD', demPct);
  setW('evFillU', tossupPct);
  setW('evFillR', rep / total * 100);
  setW('evFillO', othPct);
  // evFillD anchors from the bar's left edge and evFillR from its right edge,
  // but evFillU/evFillO have no anchor of their own in the static markup —
  // only election-night.js's own code positions them, dynamically, once it takes
  // over. Left unset, the toss-up segment's WIDTH was correct but it rendered at
  // the wrong spot, leaving a plain dark gap (the bar's own background showing
  // through) between the D and R fills instead of an actual grey segment there.
  // evFillO is placed right after the toss-up segment, same idea.
  const uEl = $('evFillU');
  if (uEl) {
    uEl.style.left = `${demPct}%`;
    uEl.style.background = TOSSUP_COLOR;
  }
  const oEl = $('evFillO');
  if (oEl) {
    oEl.style.left = `${demPct + tossupPct}%`;
    oEl.style.background = '#C9A400';
  }
  const txt = $('evText');
  if (txt) txt.textContent = oth > 0
    ? `D ${dem} | Toss-up ${tossup} | O ${oth} | R ${rep}`
    : `D ${dem} | Toss-up ${tossup} | R ${rep}`;
  const need = $('evNeededToWin');
  if (need) need.textContent = `${Math.floor(total / 2) + 1} to win — projection from current polls`;
  renderEvClass(snap, margins);
  setMapGlow();
}

function renderEvClass(snap, margins) {
  const wrap = $('s28EvClass');
  if (!wrap) return;
  const note = $('s28EvClassNote');
  if (note) note.textContent = 'Electoral votes by rating, from the current polls. Click a rating to highlight it on the map.';
  const totals = evByRating(snap, margins);
  const activeKey = state.mapHighlight && state.mapHighlight.source === 'rating' ? state.mapHighlight.key : null;
  const thirdOn = hasThirdParty();
  wrap.innerHTML = RATINGS.slice().filter(r => thirdOn || r.party !== 'O').sort((a, b) => a.order - b.order).map(r => {
    const ev = totals.get(r.key) || 0;
    const dim = ev === 0 ? 'opacity:0.35;' : '';
    const active = r.key === activeKey ? ' active' : '';
    return `<button type="button" class="s28-evcell${active}" data-rating="${r.key}" style="${dim}border-color:${r.color}">`
      + `<span style="color:${r.color}">${r.label}</span><b>${ev}</b></button>`;
  }).join('');
}

function toggleRatingHighlight(key) {
  const cur = state.mapHighlight;
  state.mapHighlight = (cur && cur.source === 'rating' && cur.key === key) ? null : { source: 'rating', key };
  renderMap();       // rebuilds badges (active state) + reapplies map glow
  renderTrendChart(); // clears any stale trend-isolate dimming, since the two share one highlight slot
}

/**
 * Toggle a single-unit map glow from the snake chart. Deliberately its own
 * source (not 'trend'): applyTrendIsolate() only dims the trend chart for
 * source === 'trend', and a snake click can select a state the trend chart
 * isn't currently plotting at all — reusing 'trend' there would dim every
 * trend line to near-invisible with nothing to highlight.
 */
function toggleSnakeHighlight(unit) {
  const cur = state.mapHighlight;
  state.mapHighlight = (cur && cur.source === 'snake' && cur.unit === unit) ? null : { source: 'snake', unit };
  setMapGlow();
}

function renderSnakeChart() {
  const container = $('s28Snake');
  if (!container || !state.sim || !state.baseline) return;
  const margins = pollMargins(currentSnapshot());
  const rows = state.baseline.units
    .filter(u => (state.baseline.ev.get(u) || 0) > 0)
    .map(unit => {
      const m = margins.get(unit);
      return {
        unit,
        name: unit.includes('-') ? unit : (getStateName(unit) || unit),
        ev: state.baseline.ev.get(unit) || 0,
        margin: m,
        color: colorForMargin(m),
      };
    })
    .sort((a, b) => a.margin - b.margin);

  const result = renderSnake('#s28Snake', rows);

  const note = $('s28SnakeNote');
  if (note) {
    if (result && result.tippingUnit) {
      const t = rows.find(r => r.unit === result.tippingUnit);
      note.textContent = 'Ordered safest-Republican to safest-Democratic, wrapping row by row like a snake '
        + '(states straddling a row break are cut, not merged). Dashed line marks the '
        + `${result.needed}th electoral vote. Tipping point: ${t ? t.name : result.tippingUnit}`
        + `${t ? ` (${fmtMargin(t.margin)})` : ''}.`;
    } else {
      note.textContent = '';
    }
  }

  // Hovering either fragment of a split unit (or its connecting corner
  // block) highlights all of them together, so a state cut across two rows
  // still feels like one continuous piece rather than unrelated blocks.
  container.querySelectorAll('.s28-snake-seg').forEach(el => {
    const unit = el.getAttribute('data-unit');
    const siblings = () => container.querySelectorAll(`[data-unit="${unit}"]`);
    el.addEventListener('mouseenter', evt => {
      showTip(evt, unit);
      siblings().forEach(s => s.classList.add('s28-snake-hover'));
    });
    el.addEventListener('mousemove', evt => moveTip(evt));
    el.addEventListener('mouseleave', () => {
      hideTip();
      siblings().forEach(s => s.classList.remove('s28-snake-hover'));
    });
    el.addEventListener('click', () => toggleSnakeHighlight(unit));
  });
}

function renderTable() {
  const tbody = document.querySelector('#s28Table tbody');
  if (!tbody || !state.sim) return;
  const snap = currentSnapshot();
  const prev = state.step > 0 ? state.sim.snapshots[state.step - 1] : null;
  const f = currentForecast();
  const margins = pollMargins(snap);
  const prevMargins = prev ? pollMargins(prev) : null;
  const thirdOn = hasThirdParty();

  // Build rows first so sorting works on real values rather than formatted text.
  const rows = state.baseline.units
    .filter(u => (state.baseline.ev.get(u) || 0) > 0)
    .map(unit => {
      const m = margins.get(unit);
      const shares = pollShares(snap, unit);
      return {
        unit,
        name: unit.includes('-') ? unit : (getStateName(unit) || unit),
        ev: state.baseline.ev.get(unit) || 0,
        relPrior: state.baseline.relPrior.get(unit),
        presMarginPrior: state.baseline.presMarginPrior.get(unit),
        rel2024: state.baseline.rel2024.get(unit),
        presMargin2024: state.baseline.presMargin2024.get(unit),
        margin: m,
        shares,
        leader: shares ? leaderVsRunnerUp(shares.d, shares.r, shares.t) : null,
        band: unitBand(unit, snap),
        rating: ratingForUnit(snap, unit),
        change: prevMargins ? m - prevMargins.get(unit) : null,
        prob: f ? f.stateProb.get(unit) : null,
      };
    });

  const key = state.sortKey;
  const dir = state.sortDir;
  rows.sort((a, b) => {
    let av, bv;
    switch (key) {
      case 'name': return dir * a.name.localeCompare(b.name);
      case 'rating': av = a.rating.order; bv = b.rating.order; break;
      // "closest first" is the useful default, so margin sorts on the real
      // leader's lead over the real runner-up - not always D-vs-R, so a
      // lopsided third-party state doesn't masquerade as a razor-thin D/R race.
      case 'margin': av = a.leader ? a.leader.lead : Infinity; bv = b.leader ? b.leader.lead : Infinity; break;
      case 'change': av = a.change == null ? -Infinity : a.change; bv = b.change == null ? -Infinity : b.change; break;
      default: av = a[key]; bv = b[key];
    }
    if (av == null) av = -Infinity;
    if (bv == null) bv = -Infinity;
    return dir * (av - bv);
  });

  tbody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    const deltaTxt = r.change == null ? '—'
      : (Math.abs(r.change) < 0.0005 ? '—' : `${r.change > 0 ? '↰D' : '↱R'} ${(Math.abs(r.change) * 100).toFixed(1)}`);
    tr.innerHTML = `
      <td>${r.name}</td>
      <td>${r.ev}</td>
      <td style="color:var(--muted)">${fmtMargin(r.relPrior)}<br><span style="font-size:0.78em;opacity:0.7">raw ${fmtMargin(r.presMarginPrior)}</span></td>
      <td style="color:var(--muted)">${fmtMargin(r.rel2024)}<br><span style="font-size:0.78em;opacity:0.7">raw ${fmtMargin(r.presMargin2024)}</span></td>
      <td class="s28-shares">${fmtSharesLines(r.shares, thirdOn)}<span style="font-size:0.78em;opacity:0.7">${fmtLeaderMargin(r.leader, { d: 'D', r: 'R', o: 'O' })}</span></td>
      <td style="color:var(--muted)">${r.band ? `±${((r.band[1] - r.band[0]) / 2 * 100).toFixed(1)}` : '—'}</td>
      <td><span class="s28-rating" style="background:${r.rating.color};color:#fff">${r.rating.label}</span></td>
      <td style="color:var(--muted)">${deltaTxt}</td>
      <td>${r.prob == null ? '—' : fmtPct(r.prob)}</td>`;
    tbody.appendChild(tr);
  }

  document.querySelectorAll('#s28Table th[data-sort]').forEach(th => {
    th.classList.toggle('sort-asc', th.dataset.sort === key && dir === 1);
    th.classList.toggle('sort-desc', th.dataset.sort === key && dir === -1);
  });
}

function renderAll() {
  renderStepPills();
  renderDebug();
  renderForecast();
  renderNpvBox();
  renderTrendChart();
  renderSnakeChart();
  renderMap();
  renderTable();
  const note = $('s28StepNote');
  if (note && state.sim) {
    const last = state.step === state.sim.snapshots.length - 1;
    note.textContent = last
      ? 'Election eve — polls are as good as they will get. The remaining error is the correlated miss.'
      : `Step ${state.step + 1} of ${state.sim.snapshots.length}.`;
  }
  if (state.sim) {
    const last = state.sim.snapshots.length - 1;
    const atEnd = state.step >= last;
    const atStart = state.step <= 0;
    const setDisabled = (ids, v) => ids.forEach(id => { const el = $(id); if (el) el.disabled = v; });
    setDisabled(['s28Advance', 's28StickyAdvance'], atEnd);
    setDisabled(['s28RunAll', 's28StickyEve'], atEnd);
    setDisabled(['s28Back', 's28StickyBack'], atStart);
    setDisabled(['s28First', 's28StickyFirst'], atStart);

    const sticky = $('s28Sticky');
    if (sticky) {
      sticky.classList.toggle('s28-hidden', state.revealed);
      document.body.classList.toggle('s28-has-sticky', !state.revealed);
    }
    const stickyStep = $('s28StickyStep');
    if (stickyStep) {
      stickyStep.textContent = `${state.sim.labels[state.step]} · step ${state.step + 1} of ${last + 1}`;
    }
  }
}

// -------------------------------------------------------------- url sharing
/**
 * Setting-toggled controls only fire their handlers on user interaction, so a
 * value restored by the browser on reload (or set programmatically from the
 * URL below) can leave the manual-PV box hidden even though "Manual…" is the
 * selected option. Call this any time s28NpvMode's value may have changed
 * without a 'change' event, including once unconditionally on load.
 */
function syncManualNpvVisibility() {
  const npvMode = $('s28NpvMode');
  const wrap = $('s28ManualWrap');
  if (npvMode && wrap) wrap.classList.toggle('s28-hidden', npvMode.value !== 'manual');
}

/** Shows/hides the whole third-party candidate column based on the "Third party" checkbox. */
function syncThirdPartyVisibility() {
  const enabled = $('s28ThirdParty');
  const partyBox = document.querySelector('.s28-cand-party[data-party="o"]');
  if (partyBox) partyBox.classList.toggle('s28-hidden', !(enabled && enabled.checked));
}

/** Shows the "Exact national third-party share" field only when the strength
 * mode select is on "exact" — same pattern as syncManualNpvVisibility above. */
function syncExactThirdPartyShareVisibility() {
  const modeEl = $('s28ThirdPartyStrengthMode');
  const wrap = $('s28ExactThirdPartyShareWrap');
  if (modeEl && wrap) wrap.classList.toggle('s28-hidden', modeEl.value !== 'exact');
}

/** Reproducible setup as query params: seed, npv mode (+ manual value), turbulence,
 * pollTurbulence, nailbiter, elasticity, confident, candidate picks.
 * Campaign steps is deliberately left out — that control is hidden for now. */
function buildSettingsParams() {
  const params = new URLSearchParams();
  const seedInput = $('s28Seed');
  const npvMode = $('s28NpvMode');
  const manualNpv = $('s28ManualNpv');
  const turbInput = $('s28Turbulence');
  const pollTurbInput = $('s28PollTurbulence');
  const nailbiterEl = $('s28Nailbiter');
  const elasticityEl = $('s28Elasticity');
  const confidentEl = $('s28ConfidentForecasts');
  const regionBleedEl = $('s28RegionBleed');
  const thirdPartyEl = $('s28ThirdParty');
  const siphonLeanEl = $('s28SiphonLean');
  const thirdPartyStrengthEl = $('s28ThirdPartyStrength');
  const thirdPartyStrengthModeEl = $('s28ThirdPartyStrengthMode');
  const exactThirdPartyShareEl = $('s28ExactThirdPartyShare');
  if (seedInput && seedInput.value !== '') params.set('seed', seedInput.value);
  if (npvMode && npvMode.value) params.set('npv', npvMode.value);
  if (npvMode && npvMode.value === 'manual' && manualNpv) params.set('manualNpv', manualNpv.value);
  if (turbInput && turbInput.value !== '') params.set('turbulence', turbInput.value);
  if (pollTurbInput && pollTurbInput.value !== '') params.set('pollTurbulence', pollTurbInput.value);
  params.set('nailbiter', (nailbiterEl && nailbiterEl.checked) ? '1' : '0');
  params.set('elasticity', (!elasticityEl || elasticityEl.checked) ? '1' : '0');
  params.set('confident', (confidentEl && confidentEl.checked) ? '1' : '0');
  params.set('regionBleed', (regionBleedEl && regionBleedEl.checked) ? '1' : '0');
  params.set('thirdParty', (thirdPartyEl && thirdPartyEl.checked) ? '1' : '0');
  if (siphonLeanEl && siphonLeanEl.value !== '') params.set('siphonLean', siphonLeanEl.value);
  if (thirdPartyStrengthEl && thirdPartyStrengthEl.value !== '') params.set('thirdPartyStrength', thirdPartyStrengthEl.value);
  if (thirdPartyStrengthModeEl && thirdPartyStrengthModeEl.value) params.set('thirdPartyStrengthMode', thirdPartyStrengthModeEl.value);
  if (thirdPartyStrengthModeEl && thirdPartyStrengthModeEl.value === 'exact' && exactThirdPartyShareEl) {
    params.set('exactThirdPartyShare', exactThirdPartyShareEl.value);
  }
  const realismEl = $('s28HomeStateRealism');
  params.set('homeStateRealism', realismEl && realismEl.value ? realismEl.value : DEFAULT_REALISM_TIER);
  // Preset picks, typed custom names, and historical search picks round-trip
  // through a link; an uploaded custom image does not (a data: URL is far too
  // large for a query param, and has nowhere sensible to live but this
  // browser's localStorage). A historical pick's image is just a small static
  // path though, so it rides along after the name, `|`-delimited (candidate
  // names don't contain `|`) — otherwise a shared link would silently lose it.
  // A custom or historical pick's home state + strength ride along the same
  // way; a preset's fixed home state doesn't need to, but its strength does.
  ['d', 'r', 'o'].forEach(party => {
    const c = state.candidates[party];
    if (c && c.mode !== 'default' && c.name) {
      let suffix = c.name;
      if (c.mode === 'historical') {
        suffix = c.imageUrl ? `${c.name}|${c.imageUrl}` : c.name;
        if (c.homeState) suffix += `|${c.homeState}|${typeof c.strength === 'number' ? c.strength : 0.5}`;
      } else if (c.mode === 'custom' && c.homeState) {
        suffix = `${c.name}|${c.homeState}|${typeof c.strength === 'number' ? c.strength : 0.5}`;
      } else if (c.mode === 'preset' && typeof c.strength === 'number' && c.strength !== 1) {
        suffix = `${c.name}|${c.strength}`;
      }
      params.set(`${party}Cand`, `${c.mode}:${suffix}`);
    }
  });
  return params;
}

/**
 * Full URL for the current setup. `includeDebug` keeps `?debug=true` (when
 * active) appended after every setting param — the address bar wants it kept,
 * but a link handed to someone else should never carry it along.
 */
function buildShareUrl({ includeDebug }) {
  const params = buildSettingsParams();
  if (includeDebug && state.debug) params.set('debug', 'true');
  const url = new URL(location.href);
  url.search = params.toString();
  return url.toString();
}

/** Keep the address bar in sync with whatever setup is currently loaded. */
function syncAddressBar() {
  try { history.replaceState(null, '', buildShareUrl({ includeDebug: true })); } catch (e) { /* ignore */ }
}

/** Prefill the setup controls from URL params, so a shared link reproduces the same run. */
function applySettingsFromUrl() {
  const params = new URLSearchParams(location.search);
  const seedInput = $('s28Seed');
  const npvMode = $('s28NpvMode');
  const manualNpv = $('s28ManualNpv');
  const turbInput = $('s28Turbulence');
  const pollTurbInput = $('s28PollTurbulence');
  const nailbiterEl = $('s28Nailbiter');
  const elasticityEl = $('s28Elasticity');
  const confidentEl = $('s28ConfidentForecasts');
  const regionBleedEl = $('s28RegionBleed');
  const thirdPartyEl = $('s28ThirdParty');
  const siphonLeanEl = $('s28SiphonLean');
  const thirdPartyStrengthEl = $('s28ThirdPartyStrength');
  const thirdPartyStrengthModeEl = $('s28ThirdPartyStrengthMode');
  const exactThirdPartyShareEl = $('s28ExactThirdPartyShare');

  if (params.has('seed') && seedInput) {
    const v = parseInt(params.get('seed'), 10);
    if (Number.isFinite(v)) seedInput.value = String(v);
  }
  if (params.has('npv') && npvMode) {
    const v = params.get('npv');
    if ([...npvMode.options].some(o => o.value === v)) npvMode.value = v;
  }
  if (params.has('manualNpv') && manualNpv) manualNpv.value = params.get('manualNpv');
  if (params.has('turbulence') && turbInput) {
    const v = parseFloat(params.get('turbulence'));
    if (Number.isFinite(v)) turbInput.value = String(v);
  }
  if (params.has('pollTurbulence') && pollTurbInput) {
    const v = parseFloat(params.get('pollTurbulence'));
    if (Number.isFinite(v)) pollTurbInput.value = String(v);
  }
  if (params.has('nailbiter') && nailbiterEl) {
    const v = params.get('nailbiter').toLowerCase();
    nailbiterEl.checked = (v === '1' || v === 'true');
  }
  if (params.has('elasticity') && elasticityEl) {
    const v = params.get('elasticity').toLowerCase();
    elasticityEl.checked = (v === '1' || v === 'true');
  }
  if (params.has('confident') && confidentEl) {
    const v = params.get('confident').toLowerCase();
    confidentEl.checked = (v === '1' || v === 'true');
  }
  if (params.has('regionBleed') && regionBleedEl) {
    const v = params.get('regionBleed').toLowerCase();
    regionBleedEl.checked = (v === '1' || v === 'true');
  }
  if (params.has('thirdParty') && thirdPartyEl) {
    const v = params.get('thirdParty').toLowerCase();
    thirdPartyEl.checked = (v === '1' || v === 'true');
  }
  if (params.has('siphonLean') && siphonLeanEl) {
    const v = parseFloat(params.get('siphonLean'));
    if (Number.isFinite(v)) siphonLeanEl.value = String(Math.max(0, Math.min(1, v)));
  }
  if (params.has('thirdPartyStrength') && thirdPartyStrengthEl) {
    const v = parseFloat(params.get('thirdPartyStrength'));
    if (Number.isFinite(v)) thirdPartyStrengthEl.value = String(Math.max(0.2, Math.min(6, v)));
  }
  if (params.has('thirdPartyStrengthMode') && thirdPartyStrengthModeEl) {
    const v = params.get('thirdPartyStrengthMode');
    if ([...thirdPartyStrengthModeEl.options].some(o => o.value === v)) thirdPartyStrengthModeEl.value = v;
  }
  if (params.has('exactThirdPartyShare') && exactThirdPartyShareEl) {
    exactThirdPartyShareEl.value = params.get('exactThirdPartyShare');
  }
  const realismEl = $('s28HomeStateRealism');
  if (params.has('homeStateRealism') && realismEl) {
    const v = params.get('homeStateRealism');
    if ([...realismEl.options].some(o => o.value === v)) realismEl.value = v;
  }

  ['d', 'r', 'o'].forEach(party => {
    const raw = params.get(`${party}Cand`);
    if (!raw) return;
    const sep = raw.indexOf(':');
    if (sep < 1) return;
    const mode = raw.slice(0, sep);
    const name = raw.slice(sep + 1);
    if (!name) return;
    if (mode === 'preset') {
      const [candName, strengthRaw] = name.split('|');
      if (PRESET_CANDIDATES[party].some(p => p.name === candName)) {
        const strength = strengthRaw !== undefined ? parseFloat(strengthRaw) : NaN;
        state.candidates[party] = { mode: 'preset', name: candName, imageUrl: null, strength: Number.isFinite(strength) ? strength : null };
      }
    } else if (mode === 'historical') {
      const [candName, imageUrl, homeState, strengthRaw] = name.split('|');
      if (candName) {
        const strength = strengthRaw !== undefined ? parseFloat(strengthRaw) : NaN;
        state.candidates[party] = {
          mode: 'historical', name: candName, imageUrl: imageUrl || null,
          homeState: homeState || null,
          strength: Number.isFinite(strength) ? strength : (homeState ? 0.5 : null),
        };
      }
    } else if (mode === 'custom') {
      // An uploaded image never travels in the URL (see buildSettingsParams), so a
      // link for a different custom name has no image available on this browser.
      // But this page writes dCand/rCand into its OWN address bar on every "Start
      // campaign" (syncAddressBar), so a plain reload always takes this branch too
      // — if the name matches what's already saved locally, keep that image
      // instead of wiping it back to the fallback badge.
      const [candName, homeState, strengthRaw] = name.split('|');
      const strength = strengthRaw !== undefined ? parseFloat(strengthRaw) : NaN;
      const existing = state.candidates[party];
      const keepImage = (existing && existing.mode === 'custom' && existing.name === candName) ? existing.imageUrl : null;
      state.candidates[party] = {
        mode: 'custom', name: candName, imageUrl: keepImage,
        homeState: homeState || null,
        strength: Number.isFinite(strength) ? strength : (homeState ? 0.5 : null),
      };
    }
  });
}

/** Copy a shareable link (never includes ?debug) to the clipboard, with a legacy-copy fallback. */
async function shareCurrentSetup() {
  const btn = $('s28Share');
  const url = buildShareUrl({ includeDebug: false });
  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      copied = true;
    }
  } catch (e) { /* fall through to legacy copy */ }
  if (!copied) {
    try {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      copied = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { /* ignore */ }
  }
  if (btn) {
    btn.textContent = copied ? 'Copied!' : 'Copy failed';
    setTimeout(() => { btn.textContent = 'Share URL'; }, 1500);
  }
}

// --------------------------------------------------------------- candidates
/** "" (no home state) + every state/DC, alphabetical by name, for the custom home-state picker. */
const HOME_STATE_OPTIONS_HTML = '<option value="">None</option>' + Object.values(ID_TO_ABBR)
  .map(abbr => ({ abbr, name: getStateName(abbr) }))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(s => `<option value="${s.abbr}">${s.name}</option>`)
  .join('');

/** `sim2028.js`-only DOM id helper: `candId('s28CandHome', 'o')` -> `$('s28CandHomeO')`.
 *  Every per-party control follows this `<base><PARTY>` naming convention. */
const candId = (base, party) => $(`${base}${party.toUpperCase()}`);

/** (Re)builds one party's preset + "Custom…" swatches and shows/hides its custom fields. */
function renderCandidatePicker(party) {
  const container = candId('s28CandSwatches', party);
  if (!container) return;
  const choice = state.candidates[party] || { mode: 'default', name: DEFAULT_CANDIDATES[party], imageUrl: null };
  const presetButtons = PRESET_CANDIDATES[party].map(p => {
    const active = choice.mode !== 'custom' && choice.name === p.name ? ' active' : '';
    return `<button type="button" class="s28-cand-swatch${active}" data-party="${party}" data-name="${p.name}">`
      + `<img class="en-cp-mini-avatar" src="${p.img}" alt="" />${p.name}</button>`;
  }).join('');
  const searchActive = choice.mode === 'historical' ? ' active' : '';
  const searchPillInner = choice.mode === 'historical'
    ? `<img class="en-cp-mini-avatar" src="${choice.imageUrl || ''}" alt="" />${choice.name}`
    : `<span class="en-cp-mini-avatar-fallback">${party.toUpperCase()}</span>Search&hellip;`;
  const searchButton = `<button type="button" class="s28-cand-swatch${searchActive}" data-party="${party}" data-search="1">${searchPillInner}</button>`;

  const customActive = choice.mode === 'custom' ? ' active' : '';
  const customButton = `<button type="button" class="s28-cand-swatch${customActive}" data-party="${party}" data-custom="1">`
    + `<span class="en-cp-mini-avatar-fallback">${party.toUpperCase()}</span>Custom&hellip;</button>`;
  container.innerHTML = presetButtons + searchButton + customButton;

  const searchWrap = candId('s28CandSearch', party);
  if (searchWrap) searchWrap.classList.toggle('s28-hidden', !state.candidateSearchOpen[party]);

  const customWrap = candId('s28CandCustom', party);
  if (customWrap) customWrap.classList.toggle('s28-hidden', choice.mode !== 'custom');
  // Don't stomp the field the user is actively typing in.
  const nameInput = candId('s28CandName', party);
  if (nameInput && choice.mode === 'custom' && document.activeElement !== nameInput) {
    nameInput.value = choice.name;
  }

  // Custom and searched (historical) picks let the user set their own home state; a preset
  // candidate's home state is fixed (PRESET_HOME_STATES), so its dropdown just displays that
  // state, disabled, in the same spot -- only its strength is actually adjustable. The
  // third-party slot has no presets at all, so isPreset is always false for it.
  const picksOwnHomeState = choice.mode === 'custom' || choice.mode === 'historical';
  const isPreset = choice.mode === 'preset';
  const homeRow = candId('s28CandHomeRow', party);
  if (homeRow) homeRow.classList.toggle('s28-hidden', !(picksOwnHomeState || isPreset));
  const homeWrap = candId('s28CandHomeWrap', party);
  if (homeWrap) homeWrap.classList.toggle('s28-hidden', !(picksOwnHomeState || isPreset));
  const homeSelect = candId('s28CandHome', party);
  if (homeSelect) {
    if (!homeSelect.dataset.populated) {
      homeSelect.innerHTML = HOME_STATE_OPTIONS_HTML;
      homeSelect.dataset.populated = '1';
    }
    homeSelect.disabled = isPreset;
    if (picksOwnHomeState) homeSelect.value = choice.homeState || '';
    else if (isPreset) homeSelect.value = PRESET_HOME_STATES[choice.name] || '';
    else homeSelect.value = '';
  }
  const strengthWrap = candId('s28CandStrengthWrap', party);
  const showStrength = choice.mode === 'preset' || (picksOwnHomeState && choice.homeState);
  if (strengthWrap) strengthWrap.classList.toggle('s28-hidden', !showStrength);
  const strengthInput = candId('s28CandStrength', party);
  if (strengthInput && document.activeElement !== strengthInput) {
    const defaultStrength = choice.mode === 'preset' ? 1 : 0.5;
    strengthInput.value = typeof choice.strength === 'number' ? choice.strength : defaultStrength;
  }

  // The file input's own "No file chosen" label can't be set by JS (browsers
  // block it) and never reflects a drag-dropped or reload-restored image at
  // all, so this preview + clear button are the real indicator of whether a
  // custom portrait is set.
  const previewEl = candId('s28CandPreview', party);
  if (previewEl) {
    previewEl.innerHTML = choice.imageUrl
      ? `<img class="en-cp-mini-avatar" src="${choice.imageUrl}" alt="" />`
      : `<span class="en-cp-mini-avatar-fallback">${party.toUpperCase()}</span>`;
  }
  const clearBtn = candId('s28CandClearImg', party);
  if (clearBtn) clearBtn.classList.toggle('s28-hidden', !choice.imageUrl);
}

/** Persists + applies a new choice for one party (baseline label + portrait override), then refreshes its UI. */
function setCandidateChoice(party, choice) {
  state.candidates[party] = choice;
  if (choice.mode === 'custom') state.lastCustomCandidate[party] = choice;
  saveCandidateChoice(party, choice);
  if (state.baseline) applyCandidateChoice(state.baseline, party, choice);
  renderCandidatePicker(party);
}

function pickPresetCandidate(party, name) {
  const preset = PRESET_CANDIDATES[party].find(p => p.name === name);
  if (!preset) return;
  closeCandidateSearch(party);
  setCandidateChoice(party, { mode: 'preset', name: preset.name, imageUrl: null });
}

/** homeState/strength only mean anything in custom mode -- carried over on further custom
 * edits (name/image/etc.), dropped when switching in from preset/historical/default. */
function customHomeFields(existing) {
  const isCustom = existing && existing.mode === 'custom';
  return {
    homeState: isCustom ? (existing.homeState || null) : null,
    strength: isCustom && typeof existing.strength === 'number' ? existing.strength : 0.5,
  };
}

function pickCustomCandidate(party) {
  // Switching to a preset/search pick doesn't clear out the last custom setup --
  // restore it here so re-picking "Custom..." brings back whatever the user had,
  // rather than starting blank.
  const existing = state.candidates[party] && state.candidates[party].mode === 'custom'
    ? state.candidates[party]
    : state.lastCustomCandidate[party];
  const name = (existing && existing.name) || '';
  closeCandidateSearch(party);
  setCandidateChoice(party, { mode: 'custom', name, imageUrl: existing ? existing.imageUrl : null, ...customHomeFields(existing) });
}

/** Opens/closes the search panel without touching the current pick — browsing shouldn't discard it. */
function toggleCandidateSearch(party) {
  state.candidateSearchOpen[party] = !state.candidateSearchOpen[party];
  renderCandidatePicker(party);
  if (state.candidateSearchOpen[party]) {
    const input = candId('s28CandSearchInput', party);
    if (input) input.focus();
  }
}

function closeCandidateSearch(party) {
  state.candidateSearchOpen[party] = false;
}

// Last rendered result set per party, so a click on a result button (which only
// carries an index in its dataset) can be mapped back to its {name, year, img}.
const lastCandidateSearchResults = { d: [], r: [], o: [] };
const candidateSearchDebounce = { d: null, r: null, o: null };

async function runCandidateSearch(party, query) {
  const container = candId('s28CandSearchResults', party);
  if (!container) return;
  if (!query.trim()) {
    lastCandidateSearchResults[party] = [];
    container.innerHTML = '';
    return;
  }
  const results = await searchCandidates(query, 8);
  lastCandidateSearchResults[party] = results;
  container.innerHTML = results.length
    ? results.map((entry, idx) => `<button type="button" class="s28-cand-search-result" data-idx="${idx}">`
        + `<img class="en-cp-mini-avatar" src="${entry.img}" alt="" />${formatCandidateLabel(entry)}</button>`).join('')
    : '<div class="s28-cand-search-empty">No matches</div>';
}

function pickHistoricalCandidate(party, entry) {
  const input = candId('s28CandSearchInput', party);
  const results = candId('s28CandSearchResults', party);
  if (input) input.value = '';
  if (results) results.innerHTML = '';
  lastCandidateSearchResults[party] = [];
  closeCandidateSearch(party);
  setCandidateChoice(party, { mode: 'historical', name: entry.name, imageUrl: entry.img });
}

function updateCustomCandidateName(party, name) {
  const existing = state.candidates[party] || {};
  setCandidateChoice(party, { mode: 'custom', name, imageUrl: existing.imageUrl || null, ...customHomeFields(existing) });
}

/** Home state is only settable on custom and searched (historical) picks -- a preset's is fixed. */
function updateCandidateHomeState(party, homeState) {
  const existing = state.candidates[party];
  if (!existing || (existing.mode !== 'custom' && existing.mode !== 'historical')) return;
  setCandidateChoice(party, { ...existing, homeState: homeState || null });
}

/** Strength is adjustable on custom, searched (historical), and preset picks. */
function updateCandidateStrength(party, strength) {
  const existing = state.candidates[party];
  if (!existing || !['custom', 'historical', 'preset'].includes(existing.mode)) return;
  const parsed = Math.max(0, Math.min(1, parseFloat(strength)));
  setCandidateChoice(party, { ...existing, strength: Number.isFinite(parsed) ? parsed : 0.5 });
}

/** Live numeric readout for the siphon lean slider - the slider alone makes it
 *  hard to tell whether it's sitting at the default 0.5 or has drifted. */
function updateSiphonLeanLabel() {
  const el = $('s28SiphonLean');
  const out = $('s28SiphonLeanVal');
  if (!el || !out) return;
  const v = parseFloat(el.value);
  out.textContent = Number.isFinite(v) ? v.toFixed(2) : '—';
}

// Dragged files don't reliably carry a MIME type — Windows Explorer drags in
// particular can hand over file.type === '' for otherwise-ordinary images —
// so accept by extension too rather than silently dropping the file.
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;
function isImageFile(file) {
  if (!file) return false;
  return (!!file.type && file.type.startsWith('image/')) || IMAGE_EXT_RE.test(file.name || '');
}

function updateCustomCandidateImage(party, file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const existing = state.candidates[party] || {};
    setCandidateChoice(party, { mode: 'custom', name: existing.name || '', imageUrl: String(reader.result), ...customHomeFields(existing) });
  };
  reader.readAsDataURL(file);
}

/** Reads an image off the system clipboard (via the Paste image button) and applies it as the custom portrait. */
async function pasteCustomCandidateImage(party) {
  const btn = candId('s28CandPaste', party);
  const restore = () => { if (btn) btn.textContent = 'Paste image'; };
  try {
    if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('unsupported');
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (!type) continue;
      updateCustomCandidateImage(party, await item.getType(type));
      return;
    }
    throw new Error('no-image');
  } catch (e) {
    if (btn) {
      btn.textContent = 'No image on clipboard';
      setTimeout(restore, 1500);
    }
  }
}

function clearCustomCandidateImage(party) {
  const existing = state.candidates[party] || {};
  // A file input's value can only be reset to empty, never set to a filename
  // (see the preview comment in renderCandidatePicker) — but reset is allowed,
  // so a subsequent pick of the same file still fires a change event.
  const imgInput = candId('s28CandImg', party);
  if (imgInput) imgInput.value = '';
  setCandidateChoice(party, { mode: 'custom', name: existing.name || '', imageUrl: null, ...customHomeFields(existing) });
}

// ------------------------------------------------------------------- actions
async function startCampaign() {
  const seedInput = $('s28Seed');
  const seed = parseInt(seedInput && seedInput.value, 10);
  const npvMode = $('s28NpvMode') ? $('s28NpvMode').value : 'surprise';
  const steps = Math.max(2, Math.min(12, parseInt($('s28Steps').value, 10) || 6));
  const manualNpv = parsePvText($('s28ManualNpv') ? $('s28ManualNpv').value : '0');
  const turbInput = $('s28Turbulence');
  const turbulenceOverride = turbInput && Number.isFinite(parseFloat(turbInput.value))
    ? Math.max(0.1, Math.min(3, parseFloat(turbInput.value)))
    : 0.5;
  const pollTurbInput = $('s28PollTurbulence');
  const pollTurbulenceOverride = pollTurbInput && Number.isFinite(parseFloat(pollTurbInput.value))
    ? Math.max(0.3, Math.min(3, parseFloat(pollTurbInput.value)))
    : 1.0;
  const nailbiterEl = $('s28Nailbiter');
  const nailbiterOn = !!(nailbiterEl && nailbiterEl.checked);
  const elasticityEl = $('s28Elasticity');
  // Missing checkbox defaults on, same as every other boolean control here.
  const elasticityOn = !elasticityEl || elasticityEl.checked;
  const confidentEl = $('s28ConfidentForecasts');
  const confidentOn = !!(confidentEl && confidentEl.checked);
  // Repoint the shared baseline's `beta` at the fitted or uniform (all-1)
  // map before building the run — every downstream reader (engine.js,
  // forecast.js, electionNightBridge.js, this file's own tooltips/table)
  // just calls baseline.beta.get(unit), so this one swap covers all of them.
  if (state.baseline) state.baseline.beta = elasticityOn ? state.baseline.betaFitted : state.baseline.betaUniform;
  // Recompute the home-state lean bump fresh from baseline.baseOriginal every run —
  // same idempotent-recompute pattern as the elasticity repoint above, so switching
  // candidates or the realism tier and hitting Start again never accumulates a bonus.
  const realismEl = $('s28HomeStateRealism');
  const realismKey = realismEl ? realismEl.value : DEFAULT_REALISM_TIER;
  const regionBleedEl = $('s28RegionBleed');
  const regionBleedOn = !!(regionBleedEl && regionBleedEl.checked);
  if (state.baseline) applyHomeStateAdvantage(state.baseline, state.candidates, realismKey, regionBleedOn);
  const thirdPartyEl = $('s28ThirdParty');
  const thirdPartyOn = !!(thirdPartyEl && thirdPartyEl.checked);
  const siphonLeanEl = $('s28SiphonLean');
  const siphonLean = siphonLeanEl && Number.isFinite(parseFloat(siphonLeanEl.value))
    ? Math.max(0, Math.min(1, parseFloat(siphonLeanEl.value)))
    : 0.5;
  const thirdPartyStrengthEl = $('s28ThirdPartyStrength');
  const thirdPartyStrength = thirdPartyStrengthEl && Number.isFinite(parseFloat(thirdPartyStrengthEl.value))
    ? Math.max(0.2, Math.min(6, parseFloat(thirdPartyStrengthEl.value)))
    : 1.0;
  const thirdPartyStrengthModeEl = $('s28ThirdPartyStrengthMode');
  const thirdPartyStrengthMode = (thirdPartyStrengthModeEl && thirdPartyStrengthModeEl.value === 'exact')
    ? 'exact' : 'random';
  const exactThirdPartyShareEl = $('s28ExactThirdPartyShare');
  const exactThirdPartyShare = exactThirdPartyShareEl && Number.isFinite(parseFloat(exactThirdPartyShareEl.value))
    ? Math.max(0, Math.min(100, parseFloat(exactThirdPartyShareEl.value))) / 100
    : 0.02;

  const btn = $('s28Start');
  if (btn) { btn.disabled = true; btn.textContent = 'Simulating…'; }
  try {
    state.sim = await createSimulation({
      seed: Number.isFinite(seed) ? seed : computeTodaySeed(),
      npvMode,
      manualNpv,
      baseline: state.baseline,
      nailbiter: nailbiterOn,
      thirdParty: thirdPartyOn
        ? {
          candidate: state.candidates.o, siphonLean, strengthMultiplier: thirdPartyStrength,
          strengthMode: thirdPartyStrengthMode, exactNationalShare: exactThirdPartyShare,
          regionBleedEnabled: regionBleedOn,
        }
        : false,
      params: {
        campaign: { ...PARAMS.campaign, steps },
        cycle: { ...PARAMS.cycle, turbulenceOverride },
        poll: {
          ...PARAMS.poll,
          turbulenceOverride: pollTurbulenceOverride,
          ...(confidentOn ? LEGACY_CALIBRATION.poll : {}),
        },
        // Merged per-axis (not spread at the top level) so the legacy preset's
        // floorScale can't silently wipe out startScale — engine.js's own
        // params merge is shallow on `forecast`, so `rel`/`npv` need to be
        // fully rebuilt here rather than partially overridden.
        forecast: {
          rel: { ...PARAMS.forecast.rel, ...(confidentOn ? LEGACY_CALIBRATION.forecast.rel : {}) },
          npv: { ...PARAMS.forecast.npv, ...(confidentOn ? LEGACY_CALIBRATION.forecast.npv : {}) },
        },
      },
    });
    state.step = 0;
    state.revealed = false;
    state.mapHighlight = null;
    // Tear down any election night still in progress. It owns the map and holds
    // window._electionNightActive, which makes renderMap() bail out — without
    // this the restarted campaign would leave every state grey.
    if (typeof window.resetElectionNightSimulation === 'function') {
      try { window.resetElectionNightSimulation(false, true); } catch (e) { /* never ran */ }
    }
    $('s28NightCard').classList.add('s28-hidden');
    const pvTotals = $('pvTotals');
    if (pvTotals) pvTotals.classList.add('s28-hidden');
    const mapTitle = $('s28MapTitle');
    if (mapTitle) mapTitle.textContent = 'Map — current polling';
    renderAll();
    syncAddressBar();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Start campaign'; }
  }
}

/** Move to a specific step; every step is precomputed so navigation is free. */
function goToStep(i) {
  if (!state.sim) return;
  const last = state.sim.snapshots.length - 1;
  state.step = Math.max(0, Math.min(last, i));
  renderAll();
}

function goToElectionNight() {
  if (!state.sim) return;
  state.step = state.sim.snapshots.length - 1;
  // state.revealed itself is NOT set here - it flips (via the
  // onElectionNightActiveChange hook registered in init()) only once the
  // user actually presses Start over on the election night card, not the
  // instant they scroll down to it. Setting it eagerly here used to hide
  // the sticky campaign footer (and, before election-night.js's own fix,
  // swap out the page footer) before there was anything to watch,
  // breaking the ability to navigate back through the campaign without a
  // reload.
  // Clear any glow/isolate styling — election night repaints the map itself
  // and the polling-era highlight has nothing left to refer to.
  if (state.mapHighlight) { state.mapHighlight = null; setMapGlow(); }

  // The final ("Election Eve") poll snapshot — this is the actual prior a
  // voter would have seen, distinct from state.sim.truthRel/truthNpv (the
  // hidden truth the vote totals below are built from). Threading it
  // through lets election-night.js's live win-probability estimate start
  // from these real polls instead of having to synthesize its own.
  const finalPoll = currentSnapshot();
  const pollMarginByUnit = pollMargins(finalPoll);
  // The Election-Eve poll's own sampled D/R/T/Undecided shares per unit -
  // threaded through the same way pollMarginByUnit is, so election-night.js's
  // pre-election badge can classify a state straight off the same numbers
  // the polling table shows (including where a third-party candidate was
  // actually leading, or running a close second) instead of folding it into
  // whichever of D/R the smoothed margin happened to favor. t is 0 for every
  // unit when third party is off, so this is a no-op for every existing run.
  const pollSharesByUnit = new Map();
  for (const unit of state.baseline.units) {
    pollSharesByUnit.set(unit, pollShares(finalPoll, unit) || { d: 0, r: 0, t: 0, u: 0 });
  }
  // The campaign's own Election-Eve forecast (same object the forecast
  // panel renders from) - bridged so the opening raceOverview slide's win%/
  // tie%/median-EV/NPV stats can read this decisive, poll-driven estimate
  // directly instead of the live win-probability MC's deliberately hedged
  // early-count numbers.
  const finalForecast = currentForecast();

  installElectionNight({
    finalRel: state.sim.truthRel,
    npv: state.sim.truthNpv,
    baseline: state.baseline,
    pollMarginByUnit,
    pollSharesByUnit,
    seed: state.sim.seed,
    forecast: finalForecast ? { ...finalForecast, pollNpv: finalPoll.pollNpv, pollSharesNpv: finalPoll.pollSharesNpv } : null,
    thirdShare: state.sim.truthThirdShare,
    siphonLean: state.sim.siphonLean ?? 0.5,
    oCandidateName: state.sim.thirdPartyCandidate,
    majorPartyFloors: state.sim.majorPartyFloors || null,
  });

  // Controls belong directly under the map and above every polling panel, so
  // the map stays in view while you drive the returns.
  const nightCard = $('s28NightCard');
  const mapCard = $('s28MapCard');
  if (nightCard && mapCard && mapCard.nextElementSibling !== nightCard) {
    mapCard.after(nightCard);
  }
  nightCard.classList.remove('s28-hidden');
  const pvTotals = $('pvTotals');
  if (pvTotals) pvTotals.classList.remove('s28-hidden');
  const mapTitle = $('s28MapTitle');
  if (mapTitle) mapTitle.textContent = 'Map — election night returns';
  // renderMap() stops running once election night owns the map, so this caption
  // has to be corrected here or it keeps saying "projection from current polls".
  const need = $('evNeededToWin');
  if (need) need.textContent = `${Math.floor(state.baseline.totalEv / 2) + 1} to win — counted results`;
  const classNote = $('s28EvClassNote');
  if (classNote) classNote.textContent = 'Final pre-election ratings — compare against the calls as they land.';
  const note = $('s28NightNote');
  if (note) {
    // Deliberately does not name the winner or the EV count — election-night.js
    // reveals those state by state, which is the whole point of the handoff.
    note.textContent = `Final polls had the national popular vote at ${fmtMargin(finalPoll.pollNpv)}.`
      + ' Press Start above to watch the returns come in.';
  }
  renderAll();
  $('s28NightCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------------- init
async function init() {
  // See refreshHoveredTip's own comment: this is the exact hook election-night.js
  // already calls on a timer, normally provided by tester.js (not loaded here).
  window.refreshActiveMapTip = refreshHoveredTip;

  // election-night.js calls this the moment it actually goes active (Start
  // pressed) or fully resets (Reset pressed, or a fresh campaign tears down
  // a prior in-progress night) - not merely when goToElectionNight() hands
  // off data to it. Keeps the sticky campaign footer's visibility (and
  // renderAll()'s other election-night-aware bits) in lockstep with that
  // same moment instead of hiding it the instant the user scrolls down to
  // the election night card.
  window.onElectionNightActiveChange = (active) => {
    state.revealed = !!active;
    renderAll();
  };

  const seedInput = $('s28Seed');
  if (seedInput && !seedInput.value) seedInput.value = String(computeTodaySeed());

  state.candidates.d = loadCandidateChoice('d');
  state.candidates.r = loadCandidateChoice('r');
  state.candidates.o = loadCandidateChoice('o');
  if (state.candidates.d.mode === 'custom') state.lastCustomCandidate.d = state.candidates.d;
  if (state.candidates.r.mode === 'custom') state.lastCustomCandidate.r = state.candidates.r;
  if (state.candidates.o.mode === 'custom') state.lastCustomCandidate.o = state.candidates.o;

  // A shared link's params win over the today-seed default (and any locally
  // persisted candidate pick) above.
  applySettingsFromUrl();
  renderCandidatePicker('d');
  renderCandidatePicker('r');
  renderCandidatePicker('o');
  // Unconditional, same reason as syncManualNpvVisibility below: a URL-restored
  // checkbox state doesn't fire a 'change' event on its own.
  syncThirdPartyVisibility();
  // Unconditional: fixes the manual-PV box staying hidden on reload/shared-link
  // loads where s28NpvMode ends up "manual" without a 'change' event ever firing.
  syncManualNpvVisibility();
  // Same reasoning again: a URL-restored strength mode of "exact" needs the
  // percentage box visible even though no 'change' event ever fired for it.
  syncExactThirdPartyShareVisibility();

  const npvMode = $('s28NpvMode');
  if (npvMode) npvMode.addEventListener('change', syncManualNpvVisibility);
  const thirdPartyEl = $('s28ThirdParty');
  if (thirdPartyEl) thirdPartyEl.addEventListener('change', syncThirdPartyVisibility);
  const thirdPartyStrengthModeEl = $('s28ThirdPartyStrengthMode');
  if (thirdPartyStrengthModeEl) thirdPartyStrengthModeEl.addEventListener('change', syncExactThirdPartyShareVisibility);
  // Reflects the URL-restored (or default) value before any interaction, then
  // keeps itself in sync live - the slider alone doesn't make its position legible.
  updateSiphonLeanLabel();
  const siphonLeanSliderEl = $('s28SiphonLean');
  if (siphonLeanSliderEl) siphonLeanSliderEl.addEventListener('input', updateSiphonLeanLabel);
  // The in-card and sticky-footer controls drive the same actions.
  const on = (ids, fn) => [].concat(ids).forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('click', fn);
  });
  on('s28Start', startCampaign);
  on('s28Share', shareCurrentSetup);
  on(['s28First', 's28StickyFirst'], () => goToStep(0));
  on(['s28Back', 's28StickyBack'], () => goToStep(state.step - 1));
  on(['s28Advance', 's28StickyAdvance'], () => goToStep(state.step + 1));
  on(['s28RunAll', 's28StickyEve'], () => goToStep(Infinity));
  on(['s28ToNight', 's28StickyNight'], goToElectionNight);
  on('s28Reroll', () => {
    if (seedInput) seedInput.value = String(Math.floor(Math.random() * 1e9));
    startCampaign();
  });
  const pick = $('s28TrendPick');
  if (pick) pick.addEventListener('change', () => {
    // A trend-isolate selection is scoped to whatever list was showing; switching
    // which states are shown invalidates it rather than leaving every line dimmed.
    if (state.mapHighlight && state.mapHighlight.source === 'trend') state.mapHighlight = null;
    renderTrendChart();
    setMapGlow();
  });

  // Event delegation: both legends rebuild their innerHTML on every render, so
  // listeners live on the stable container instead of the buttons themselves.
  const trendLegend = $('s28TrendLegend');
  if (trendLegend) trendLegend.addEventListener('click', e => {
    const btn = e.target.closest('.tw-swatch');
    if (btn) toggleTrendHighlight(btn.dataset.unit);
  });
  const evClass = $('s28EvClass');
  if (evClass) evClass.addEventListener('click', e => {
    const btn = e.target.closest('.s28-evcell');
    if (btn) toggleRatingHighlight(btn.dataset.rating);
  });

  ['d', 'r', 'o'].forEach(party => {
    const swatches = candId('s28CandSwatches', party);
    if (swatches) swatches.addEventListener('click', e => {
      const btn = e.target.closest('.s28-cand-swatch');
      if (!btn) return;
      if (btn.dataset.custom) pickCustomCandidate(party);
      else if (btn.dataset.search) toggleCandidateSearch(party);
      else pickPresetCandidate(party, btn.dataset.name);
    });
    const searchInput = candId('s28CandSearchInput', party);
    if (searchInput) searchInput.addEventListener('input', () => {
      clearTimeout(candidateSearchDebounce[party]);
      candidateSearchDebounce[party] = setTimeout(() => runCandidateSearch(party, searchInput.value), 150);
    });
    const searchResults = candId('s28CandSearchResults', party);
    if (searchResults) searchResults.addEventListener('click', e => {
      const btn = e.target.closest('.s28-cand-search-result');
      if (!btn) return;
      const entry = lastCandidateSearchResults[party][Number(btn.dataset.idx)];
      if (entry) pickHistoricalCandidate(party, entry);
    });
    const nameInput = candId('s28CandName', party);
    if (nameInput) nameInput.addEventListener('input', () => updateCustomCandidateName(party, nameInput.value));
    const homeSelect = candId('s28CandHome', party);
    if (homeSelect) homeSelect.addEventListener('change', () => updateCandidateHomeState(party, homeSelect.value));
    const strengthInput = candId('s28CandStrength', party);
    if (strengthInput) strengthInput.addEventListener('input', () => updateCandidateStrength(party, strengthInput.value));
    const imgInput = candId('s28CandImg', party);
    if (imgInput) imgInput.addEventListener('change', () => updateCustomCandidateImage(party, imgInput.files && imgInput.files[0]));
    const clearBtn = candId('s28CandClearImg', party);
    if (clearBtn) clearBtn.addEventListener('click', () => clearCustomCandidateImage(party));
    const pasteBtn = candId('s28CandPaste', party);
    if (pasteBtn) pasteBtn.addEventListener('click', () => pasteCustomCandidateImage(party));

    // Drag a portrait onto either party's whole box, in preset OR custom mode —
    // updateCustomCandidateImage() switches that party to custom on its own.
    const partyBox = document.querySelector(`.s28-cand-party[data-party="${party}"]`);
    if (partyBox) {
      const isFileDrag = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
      ['dragenter', 'dragover'].forEach(evt => partyBox.addEventListener(evt, e => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        partyBox.classList.add('s28-drag-over');
      }));
      ['dragleave', 'dragend'].forEach(evt => partyBox.addEventListener(evt, e => {
        if (evt === 'dragleave' && partyBox.contains(e.relatedTarget)) return;
        partyBox.classList.remove('s28-drag-over');
      }));
      partyBox.addEventListener('drop', e => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        partyBox.classList.remove('s28-drag-over');
        const file = [...(e.dataTransfer.files || [])].find(isImageFile);
        if (file) updateCustomCandidateImage(party, file);
      });
      // Ctrl+V while focus is anywhere in this box (e.g. the name field) —
      // the Paste image button covers the case where nothing here has focus.
      partyBox.addEventListener('paste', e => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        const item = [...items].find(it => it.kind === 'file' && it.type.startsWith('image/'));
        const file = item && item.getAsFile();
        if (file) {
          e.preventDefault();
          updateCustomCandidateImage(party, file);
        }
      });
    }
  });

  document.querySelectorAll('#s28Table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = -state.sortDir;
      } else {
        state.sortKey = key;
        // Names read best A-Z; every numeric column is most useful biggest-first,
        // except margin, which sorts by closeness and so wants smallest-first.
        state.sortDir = (key === 'name' || key === 'margin') ? 1 : -1;
      }
      renderTable();
    });
  });
  window.addEventListener('resize', () => {
    if (state.sim) { renderForecast(); renderTrendChart(); renderSnakeChart(); }
  });

  try {
    const hover = {
      mouseenter: (evt, unit) => showTip(evt, unit),
      mousemove: evt => moveTip(evt),
      mouseleave: () => hideTip(),
    };
    await window.ElectionMap.build({
      svgSelector: '#map',
      topoUrl: 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json',
      districtGeoUrl: 'me_ne_districts.geojson',
      stateHandlers: hover,
      districtHandlers: hover,
    });
    window._districtPaths = window.ElectionMap.districtPaths;

    // election-night.js repaints the small-state boxes as states are called, but
    // only through this global — which normally comes from tester.js. Without it
    // the boxes would freeze on their pre-election polling colours while the rest
    // of the map filled in.
    window.renderSmallStateBoxes = (year, abbrColors, unitColors) => {
      try {
        window.ElectionMap.updateStateLabels(year, abbr => state.baseline?.ev.get(abbr) ?? null);
        window.ElectionMap.renderSmallStateBoxes(year, abbrColors, unitColors);
      } catch (e) { /* cosmetic */ }
    };
  } catch (e) {
    console.warn('[sim2028] map build failed', e);
  }

  state.baseline = await loadBaseline(PARAMS.baseline);
  applyCandidateChoice(state.baseline, 'd', state.candidates.d);
  applyCandidateChoice(state.baseline, 'r', state.candidates.r);
  applyCandidateChoice(state.baseline, 'o', state.candidates.o);
  await startCampaign();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

'use strict';

/**
 * Page wiring for the 2028 campaign simulator prototype.
 *
 * All modelling lives in utils/sim2028/*. This file only maps engine output onto
 * the DOM: step pills, forecast numbers, charts, map colours, the state table,
 * and the handoff to election-night.js.
 */

import { createSimulation, computeTodaySeed, PARAMS } from './utils/sim2028/engine.js';
import { loadBaseline } from './utils/sim2028/baseline.js';
import { npvBand } from './utils/sim2028/forecast.js';
import { analyticTippingPoint } from './utils/sim2028/tippingPoint.js';
import { installElectionNight } from './utils/sim2028/electionNightBridge.js';
import { renderHistogram, renderTrend } from './sim2028Charts.js';
import { getStateName } from './utils/constants.js';
import { lastNameFrom } from './utils/candidateNames.js';

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
};

const TREND_PALETTE = ['#7aa2f7', '#e06c6c', '#7fc99a', '#e0b070', '#b48ee0', '#68c4d4', '#f0c96e', '#c990e0', '#79d1a8', '#e88ea0', '#8fb8e0', '#d0a05a'];

const $ = id => document.getElementById(id);

/**
 * Rating tiers by projected margin, in the usual forecaster ladder.
 * `order` runs D-safest to R-safest so the EV breakdown reads left to right.
 *
 * Thresholds are the conventional 2 / 5 / 10 / 15 point bands. An earlier
 * ±1pt toss-up band was so narrow that almost nothing ever landed in it.
 */
const TOSSUP_BAND = 0.02;
const TILT_BAND = 0.05;
const LEAN_BAND = 0.10;
const LIKELY_BAND = 0.15;

/** Neutral grey for toss-ups, matching the convention in paths2028.js. */
export const TOSSUP_COLOR = '#888888';

const RATINGS = [
  { key: 'safeD', label: 'Safe D', party: 'D', color: '#1e46aa', order: 0 },
  { key: 'likelyD', label: 'Likely D', party: 'D', color: '#3f6fd0', order: 1 },
  { key: 'leanD', label: 'Lean D', party: 'D', color: '#6f9ae8', order: 2 },
  { key: 'tiltD', label: 'Tilt D', party: 'D', color: '#a8c4f0', order: 3 },
  { key: 'tossup', label: 'Toss-up', party: null, color: TOSSUP_COLOR, order: 4 },
  { key: 'tiltR', label: 'Tilt R', party: 'R', color: '#efb0b0', order: 5 },
  { key: 'leanR', label: 'Lean R', party: 'R', color: '#dd7f7f', order: 6 },
  { key: 'likelyR', label: 'Likely R', party: 'R', color: '#c04a4a', order: 7 },
  { key: 'safeR', label: 'Safe R', party: 'R', color: '#9d1b1b', order: 8 },
];

/** Rating for a projected margin (fraction, positive = D). */
function ratingFor(margin) {
  const m = margin || 0;
  const a = Math.abs(m);
  if (a < TOSSUP_BAND) return RATINGS.find(r => r.key === 'tossup');
  const party = m > 0 ? 'D' : 'R';
  const tier = a >= LIKELY_BAND ? 'safe' : a >= LEAN_BAND ? 'likely' : a >= TILT_BAND ? 'lean' : 'tilt';
  return RATINGS.find(r => r.key === `${tier}${party}`);
}

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
function fmtPct(p) { return (p * 100).toFixed(0) + '%'; }

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

function evTally(margins) {
  let dem = 0, rep = 0;
  for (const unit of state.baseline.units) {
    const ev = state.baseline.ev.get(unit) || 0;
    if ((margins.get(unit) || 0) >= 0) dem += ev; else rep += ev;
  }
  return { dem, rep };
}

/** Electoral votes grouped by rating tier, D-safest to R-safest. */
function evByRating(margins) {
  const totals = new Map(RATINGS.map(r => [r.key, 0]));
  for (const unit of state.baseline.units) {
    const r = ratingFor(margins.get(unit));
    totals.set(r.key, totals.get(r.key) + (state.baseline.ev.get(unit) || 0));
  }
  return totals;
}

/** 80% interval for a single unit's margin at the current step. */
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
  return [m - 1.2816 * total, m + 1.2816 * total];
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
    const margins = snap ? pollMargins(snap) : null;
    const m = margins ? margins.get(unit) : null;
    const rating = m == null ? null : ratingFor(m);
    const rows = [
      ['Electoral votes', state.baseline.ev.get(unit) || 0],
      ['Status', 'Not yet reporting'],
      ['Final poll', m == null ? '—' : fmtMargin(m)],
    ];
    if (state.debug && state.sim) {
      const beta = state.baseline.beta.get(unit) || 1;
      rows.push(['TRUE final', fmtMarginPrecise((state.sim.truthRel.get(unit) || 0) + beta * state.sim.truthNpv)]);
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

  const rows = [
    ['Electoral votes', s.ev],
    ['Reporting', `${((s.reporting || 0) * 100).toFixed(0)}%`],
    ['Margin', s.marginStr || fmtMargin(s.margin)],
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
    const beta = state.baseline.beta.get(unit) || 1;
    const trueMargin = (state.sim.truthRel.get(unit) || 0) + beta * state.sim.truthNpv;
    rows.push(['TRUE final', fmtMarginPrecise(trueMargin)]);
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
  const rating = ratingFor(m);
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
  const rows = [
    ['Electoral votes', state.baseline.ev.get(unit) || 0],
    historyRow('2020', state.baseline.relPrior, state.baseline.presMarginPrior),
    historyRow('2024', state.baseline.rel2024, state.baseline.presMargin2024),
    ['Poll margin', fmtMargin(m)],
    ['80% range', band ? `${fmtMargin(band[0])} to ${fmtMargin(band[1])}` : '—'],
    ['D win prob', prob == null ? '—' : fmtPct(prob)],
  ];
  if (prev != null) rows.push(['Since last step', `${m - prev >= 0 ? '+' : ''}${((m - prev) * 100).toFixed(1)}pt`]);
  if (state.debug) {
    const beta = state.baseline.beta.get(unit) || 1;
    rows.push(['TRUE lean', fmtMarginPrecise(state.sim.truthRel.get(unit))]);
    rows.push(['TRUE margin', fmtMarginPrecise((state.sim.truthRel.get(unit) || 0) + beta * state.sim.truthNpv)]);
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
  if (h.source === 'trend') return new Set([h.unit]);
  if (h.source === 'rating') {
    const margins = pollMargins(currentSnapshot());
    const set = new Set();
    for (const unit of state.baseline.units) {
      if (ratingFor(margins.get(unit)).key === h.key) set.add(unit);
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
  const { dem, rep } = evTally(margins);
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

  el.innerHTML = `<strong>DEBUG — the hidden truth</strong>
    <div class="s28-dbgrow"><span>True result</span><span>D ${dem} &ndash; R ${rep}</span></div>
    <div class="s28-dbgrow"><span>True national popular vote</span><span>${fmtMarginPrecise(sim.truthNpv)}</span></div>
    <div class="s28-dbgrow"><span>Current poll says</span><span>${fmtMarginPrecise(snap.pollNpv)} (off by ${((snap.pollNpv - sim.truthNpv) * 100).toFixed(2)}pt)</span></div>
    <div class="s28-dbgrow"><span>Cycle turbulence</span><span>${sim.turbulence.toFixed(2)}&times; &mdash; ${moved6} states moved &gt;6pt (real cycles: 1&ndash;19)</span></div>
    <div class="s28-dbgrow"><span>Tipping point (true, NPV-independent)</span><span>${tp ? `${tp.unit} &mdash; flips EC at NPV ${fmtMarginPrecise(tp.npvThreshold)}` : '&mdash;'}</span></div>
    <div style="margin-top:6px;color:var(--muted)">Closest true races (at the actual environment): ${closest}</div>`;
}

function renderForecast() {
  const f = currentForecast();
  const setProb = (id, value, label) => {
    const el = $(id);
    if (el) el.innerHTML = `${value}<small>${label}</small>`;
  };
  if (!f) {
    setProb('s28DemProb', '—', 'Democratic win');
    setProb('s28RepProb', '—', 'Republican win');
    setProb('s28TieProb', '—', 'Exact tie');
    setProb('s28NatPoll', '—', 'National poll');
    setProb('s28MedianEv', '—', 'Median EV / 80% range');
    setProb('s28Tipping', '—', 'Tipping point');
    return;
  }
  const snap = currentSnapshot();
  setProb('s28NatPoll', fmtMargin(snap.pollNpv), 'National poll');
  setProb('s28DemProb', fmtPct(f.demWinProb), 'Democratic win');
  setProb('s28RepProb', fmtPct(f.repWinProb), 'Republican win');
  setProb('s28TieProb', f.tieProb > 0 ? (f.tieProb * 100).toFixed(1) + '%' : '<1%', 'Exact tie');
  setProb('s28MedianEv', `${f.medianDemEv} D <span style="color:var(--muted);font-size:0.8em">(${f.evRange80[0]}–${f.evRange80[1]})</span>`, 'Median EV / 80% range');
  setProb('s28Tipping', `${f.tippingPoint || '—'} <span style="color:var(--muted);font-size:0.8em">${fmtPct(f.tippingProb)}</span>`, 'Tipping point');
  renderHistogram('#s28Histogram', f);
}

const WITHIN5_CAP = 12; // legibility cap — a genuinely close national environment can put more than 12 states inside 5pts

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
      note.textContent = 'Shaded band is the 80% interval implied by the remaining polling uncertainty. '
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
    } else {
      units = state.baseline.simUnits
        .filter(u => (state.baseline.ev.get(u) || 0) > 0)
        .sort((a, b) => Math.abs(margins.get(a)) - Math.abs(margins.get(b)))
        .slice(0, 6);
      if (note) note.textContent = 'The six closest states at the current step, plus NPV, as projected margins.';
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
  const margins = pollMargins(currentSnapshot());
  const abbrColors = new Map();
  const unitColors = new Map();
  for (const unit of state.baseline.units) {
    const color = colorForMargin(margins.get(unit));
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
  const totals = evByRating(margins);
  let dem = 0, tossup = 0, rep = 0;
  for (const r of RATINGS) {
    const v = totals.get(r.key) || 0;
    if (r.key === 'tossup') tossup += v;
    else if (r.party === 'D') dem += v;
    else rep += v;
  }
  const demPct = dem / total * 100;
  const setW = (id, pct) => { const el = $(id); if (el) el.style.width = `${pct}%`; };
  setW('evFillD', demPct);
  setW('evFillU', tossup / total * 100);
  setW('evFillR', rep / total * 100);
  setW('evFillO', 0);
  // evFillD anchors from the bar's left edge and evFillR from its right edge,
  // but evFillU (and evFillO) have no anchor of their own in the static markup —
  // only election-night.js's own code positions them, dynamically, once it takes
  // over. Left unset, the toss-up segment's WIDTH was correct but it rendered at
  // the wrong spot, leaving a plain dark gap (the bar's own background showing
  // through) between the D and R fills instead of an actual grey segment there.
  const uEl = $('evFillU');
  if (uEl) {
    uEl.style.left = `${demPct}%`;
    uEl.style.background = TOSSUP_COLOR;
  }
  const txt = $('evText');
  if (txt) txt.textContent = `D ${dem} | Toss-up ${tossup} | R ${rep}`;
  const need = $('evNeededToWin');
  if (need) need.textContent = `${Math.floor(total / 2) + 1} to win — projection from current polls`;
  renderEvClass(margins);
  setMapGlow();
}

function renderEvClass(margins) {
  const wrap = $('s28EvClass');
  if (!wrap) return;
  const note = $('s28EvClassNote');
  if (note) note.textContent = 'Electoral votes by rating, from the current polls. Click a rating to highlight it on the map.';
  const totals = evByRating(margins);
  const activeKey = state.mapHighlight && state.mapHighlight.source === 'rating' ? state.mapHighlight.key : null;
  wrap.innerHTML = RATINGS.slice().sort((a, b) => a.order - b.order).map(r => {
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

function renderTable() {
  const tbody = document.querySelector('#s28Table tbody');
  if (!tbody || !state.sim) return;
  const snap = currentSnapshot();
  const prev = state.step > 0 ? state.sim.snapshots[state.step - 1] : null;
  const f = currentForecast();
  const margins = pollMargins(snap);
  const prevMargins = prev ? pollMargins(prev) : null;

  // Build rows first so sorting works on real values rather than formatted text.
  const rows = state.baseline.units
    .filter(u => (state.baseline.ev.get(u) || 0) > 0)
    .map(unit => {
      const m = margins.get(unit);
      return {
        unit,
        name: unit.includes('-') ? unit : (getStateName(unit) || unit),
        ev: state.baseline.ev.get(unit) || 0,
        relPrior: state.baseline.relPrior.get(unit),
        presMarginPrior: state.baseline.presMarginPrior.get(unit),
        rel2024: state.baseline.rel2024.get(unit),
        presMargin2024: state.baseline.presMargin2024.get(unit),
        margin: m,
        rating: ratingFor(m),
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
      // "closest first" is the useful default, so margin sorts on magnitude.
      case 'margin': av = Math.abs(a.margin); bv = Math.abs(b.margin); break;
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
    const cls = r.margin >= 0 ? 's28-d' : 's28-r';
    const deltaTxt = r.change == null ? '—'
      : (Math.abs(r.change) < 0.0005 ? '—' : `${r.change > 0 ? '↰D' : '↱R'} ${(Math.abs(r.change) * 100).toFixed(1)}`);
    tr.innerHTML = `
      <td>${r.name}</td>
      <td>${r.ev}</td>
      <td style="color:var(--muted)">${fmtMargin(r.relPrior)}<br><span style="font-size:0.78em;opacity:0.7">raw ${fmtMargin(r.presMarginPrior)}</span></td>
      <td style="color:var(--muted)">${fmtMargin(r.rel2024)}<br><span style="font-size:0.78em;opacity:0.7">raw ${fmtMargin(r.presMargin2024)}</span></td>
      <td class="${cls}">${fmtMargin(r.margin)}</td>
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
  renderTrendChart();
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

  const btn = $('s28Start');
  if (btn) { btn.disabled = true; btn.textContent = 'Simulating…'; }
  try {
    state.sim = await createSimulation({
      seed: Number.isFinite(seed) ? seed : computeTodaySeed(),
      npvMode,
      manualNpv,
      baseline: state.baseline,
      params: {
        campaign: { ...PARAMS.campaign, steps },
        cycle: { ...PARAMS.cycle, turbulenceOverride },
      },
    });
    state.step = 0;
    state.revealed = false;
    state.mapHighlight = null;
    // Tear down any election night still in progress. It owns the map and holds
    // window._electionNightActive, which makes renderMap() bail out — without
    // this the restarted campaign would leave every state grey.
    if (typeof window.resetElectionNightSimulation === 'function') {
      try { window.resetElectionNightSimulation(false); } catch (e) { /* never ran */ }
    }
    $('s28NightCard').classList.add('s28-hidden');
    const pvTotals = $('pvTotals');
    if (pvTotals) pvTotals.classList.add('s28-hidden');
    const mapTitle = $('s28MapTitle');
    if (mapTitle) mapTitle.textContent = 'Map — current polling';
    const panel = $('enLogPanel');
    if (panel) panel.style.display = 'none';
    renderAll();
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
  state.revealed = true;
  // Clear any glow/isolate styling — election night repaints the map itself
  // and the polling-era highlight has nothing left to refer to.
  if (state.mapHighlight) { state.mapHighlight = null; setMapGlow(); }

  installElectionNight({
    finalRel: state.sim.truthRel,
    npv: state.sim.truthNpv,
    baseline: state.baseline,
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
    const finalPoll = currentSnapshot();
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

  const seedInput = $('s28Seed');
  if (seedInput && !seedInput.value) seedInput.value = String(computeTodaySeed());

  const npvMode = $('s28NpvMode');
  if (npvMode) {
    npvMode.addEventListener('change', () => {
      $('s28ManualWrap').classList.toggle('s28-hidden', npvMode.value !== 'manual');
    });
  }
  // The in-card and sticky-footer controls drive the same actions.
  const on = (ids, fn) => [].concat(ids).forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('click', fn);
  });
  on('s28Start', startCampaign);
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
    if (state.sim) { renderForecast(); renderTrendChart(); }
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
  await startCampaign();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

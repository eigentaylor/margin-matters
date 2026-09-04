'use strict';
import { loadPresidentialMargins } from './utils/dataLoader.js';
import { safeMarginToColor } from './utils/colorUtils.js';
import { loadStats, recordAttempt, resetStats, pickWeightedYear, wilsonInterval } from './utils/yearQuizStats.js';

// CSV's precomputed 'color' column uses these three exact values.
const FLAT_COLORS = { deepskyblue: '#4169E1', red: '#B22222', yellow: '#C9A400' };
const PARTY_OF = { deepskyblue: 'D', red: 'R', yellow: 'O' };
const STEP = 4;

// The CSV never has a plain ME/NE row: it's always recorded as an "-AL"
// (at-large) row, plus — from each state's congressional-district electoral-
// vote split onward (Maine 1972+, Nebraska 1992+ in practice, though this
// goes by the rows actually present for a year rather than hardcoding those
// thresholds) — per-district rows (ME-01/02, NE-01/02/03) alongside it. Once
// split, each piece keeps its own electoral votes and can go to a different
// party (a split state's map is genuinely part red, part blue), so rather
// than blending them into one color we render each piece separately: the
// state shape gets the at-large row's color as a base fill, and the district
// overlay is painted on top with each district's own color for whichever
// years it's actually split — matching how the rest of the site (e.g.
// docs/sim2028.js) renders ME/NE.
const SPLIT_STATE_DISTRICTS = { ME: ['ME-01', 'ME-02'], NE: ['NE-01', 'NE-02', 'NE-03'] };
const SPLIT_STATE_RELATED_RE = /^(ME|NE)(-AL|-0\d)$/;

// Looks up this year's at-large row and (if this state split its electors by
// district that year) its district rows, for one of ME/NE. Never mutates rows.
function getSplitStateUnits(rows, abbr) {
  const atLarge = rows.find(r => r.abbr === `${abbr}-AL`) || null;
  const districtAbbrs = SPLIT_STATE_DISTRICTS[abbr];
  const districts = districtAbbrs.map(d => rows.find(r => r.abbr === d)).filter(Boolean);
  const isSplit = districts.length === districtAbbrs.length;
  return { atLarge, districts: isSplit ? districts : [] };
}

function totalSplitStateEv(rows, abbr) {
  const { atLarge, districts } = getSplitStateUnits(rows, abbr);
  let ev = atLarge ? (+atLarge.electoral_votes || 0) : 0;
  for (const d of districts) ev += +d.electoral_votes || 0;
  return ev;
}

// The district overlay's boundary lines (and their halo) are drawn once at
// build time for every year, since the geometry itself doesn't change —
// clearing a district's fill back to transparent isn't enough to hide that
// it's split for a year it wasn't, the outline cutting through the state is
// still visible on its own. Toggle each district's (and its halo's) display
// directly so a non-split year shows a single unbroken state shape, exactly
// like index.html only draws the ME/NE split for the years it actually happened.
function setDistrictVisible(unit, visible) {
  d3.select(`#district-${unit}`).style('display', visible ? null : 'none');
  d3.select(`#halo-${unit}`).style('display', visible ? null : 'none');
}

const state = {
  byYear: new Map(),
  years: [],
  minYear: null,
  maxYear: null,
  currentYear: null,
  lastYear: null,
  guessed: false,
  score: { correct: 0, total: 0 },
  toggles: { shade: false, abbr: false, ev: false, evbar: false, mc: false, learning: false },
  stats: {},
};

function $(id) { return document.getElementById(id); }

function rowColor(row) {
  const isThird = row.color === 'yellow';
  if (state.toggles.shade) return safeMarginToColor(+row.pres_margin, isThird);
  return FLAT_COLORS[row.color] || '#2f2f2f';
}

function pickRandomYear() {
  return pickWeightedYear(state.years, state.stats, {
    learning: state.toggles.learning,
    lastYear: state.lastYear,
  });
}

function renderMap(year) {
  const rows = state.byYear.get(year) || [];
  const present = new Set();
  const districtsShown = new Set();

  for (const row of rows) {
    if (SPLIT_STATE_RELATED_RE.test(row.abbr)) continue; // ME/NE handled below
    window.ElectionMap.setStateFill(row.abbr, rowColor(row));
    present.add(row.abbr);
  }
  for (const abbr of Object.keys(SPLIT_STATE_DISTRICTS)) {
    const { atLarge, districts } = getSplitStateUnits(rows, abbr);
    if (atLarge) {
      window.ElectionMap.setStateFill(abbr, rowColor(atLarge));
      present.add(abbr);
    }
    const isSplitYear = districts.length > 0;
    for (const districtAbbr of SPLIT_STATE_DISTRICTS[abbr]) {
      setDistrictVisible(districtAbbr, isSplitYear);
    }
    if (isSplitYear) {
      for (const d of districts) {
        window.ElectionMap.setDistrictFill(d.abbr, rowColor(d));
        districtsShown.add(d.abbr);
      }
    }
  }

  for (const abbr of window.ElectionMap.statePaths.keys()) {
    if (!present.has(abbr)) window.ElectionMap.setStateFill(abbr, '#2f2f2f');
  }
  // Belt-and-suspenders: also clear fill on any district left un-shown this
  // round (harmless once hidden, but keeps state consistent either way).
  for (const districtAbbrs of Object.values(SPLIT_STATE_DISTRICTS)) {
    for (const unit of districtAbbrs) {
      if (!districtsShown.has(unit)) window.ElectionMap.setDistrictFill(unit, 'transparent');
    }
  }

  renderLabels(year);
  renderEvBar(year);
}

function renderLabels(year) {
  const layer = d3.select('svg#map g.state-labels');
  if (!state.toggles.abbr) {
    if (!layer.empty()) layer.style('display', 'none');
    return;
  }
  const rows = state.byYear.get(year) || [];
  const byAbbr = new Map(rows.map(r => [r.abbr, r]));
  const evLookup = state.toggles.ev
    ? (abbr) => {
      if (SPLIT_STATE_DISTRICTS[abbr]) return totalSplitStateEv(rows, abbr) || null;
      const r = byAbbr.get(abbr);
      return r ? +r.electoral_votes : null;
    }
    : () => null;
  window.ElectionMap.updateStateLabels(year, evLookup);
  d3.select('svg#map g.state-labels').style('display', null);
}

function renderEvBar(year) {
  const wrap = $('yqEvBarWrap');
  if (!state.toggles.evbar) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  const rows = state.byYear.get(year) || [];
  let dEV = 0, rEV = 0, oEV = 0, totalEV = 0;
  const tally = (row) => {
    const ev = +row.electoral_votes || 0;
    totalEV += ev;
    const party = PARTY_OF[row.color];
    if (party === 'D') dEV += ev;
    else if (party === 'R') rEV += ev;
    else oEV += ev;
  };
  for (const row of rows) {
    if (SPLIT_STATE_RELATED_RE.test(row.abbr)) continue; // ME/NE tallied below, piece by piece
    tally(row);
  }
  for (const abbr of Object.keys(SPLIT_STATE_DISTRICTS)) {
    // Each district can go a different party than the state's at-large
    // result, so each piece is tallied separately rather than as one lump
    // sum under a single winner — e.g. a split Maine's 4 EVs might really be
    // 3D+1R, not all 4 going to whichever party led the statewide vote.
    const { atLarge, districts } = getSplitStateUnits(rows, abbr);
    if (atLarge) tally(atLarge);
    for (const d of districts) tally(d);
  }
  const dPct = totalEV ? (dEV / totalEV) * 100 : 0;
  const rPct = totalEV ? (rEV / totalEV) * 100 : 0;
  const oPct = totalEV ? (oEV / totalEV) * 100 : 0;
  $('evFillD').style.width = `${dPct}%`;
  $('evFillO').style.left = `${dPct}%`;
  $('evFillO').style.width = `${oPct}%`;
  $('evFillR').style.width = `${rPct}%`;
  $('evFillU').style.width = '0%';
  const oPart = oEV ? ` | O ${oEV}` : '';
  $('evText').textContent = `D ${dEV} | R ${rEV}${oPart}  (total ${totalEV} EV)`;
}

// Rebuilt from scratch each call rather than diffed — at most 41 bars, and
// this only runs after a guess or on load, so there's no perf reason to do
// an enter/update/exit dance. Bar height is the Wilson-adjusted accuracy
// estimate (not the raw correct/total ratio), so a single lucky/unlucky
// guess doesn't render as a confident 0%/100%; the whisker is the interval
// itself, and bar opacity fades as that interval widens, so a year you've
// only guessed once or twice visibly reads as "not sure yet" rather than
// looking as trustworthy as a year you've guessed twenty times.
function renderStatsHistogram() {
  const svg = d3.select('#yqHistChart');
  svg.selectAll('*').remove();
  if (!state.years.length) return;

  const viewBox = svg.node().viewBox.baseVal;
  const width = viewBox.width || 900;
  const height = viewBox.height || 220;
  const margin = { top: 10, right: 10, bottom: 28, left: 30 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const x = d3.scaleBand().domain(state.years).range([0, innerW]).padding(0.15);
  const y = d3.scaleLinear().domain([0, 100]).range([innerH, 0]);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const axisG = g.append('g')
    .attr('class', 'yq-hist-axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickValues(state.years.filter((_, i) => i % 2 === 0)));
  axisG.selectAll('text').attr('class', 'yq-hist-tick-label');

  g.append('g')
    .attr('class', 'yq-hist-axis')
    .call(d3.axisLeft(y).ticks(4).tickFormat(d => `${d}%`));

  for (const yr of state.years) {
    const entry = state.stats[yr];
    const n = entry ? entry.total : 0;
    const cx = x(yr) + x.bandwidth() / 2;

    if (!n) {
      g.append('rect')
        .attr('class', 'yq-hist-bar-none')
        .attr('x', x(yr))
        .attr('width', x.bandwidth())
        .attr('y', y(4))
        .attr('height', innerH - y(4))
        .append('title')
        .text(`${yr}: not attempted yet`);
      continue;
    }

    const { center, low, high } = wilsonInterval(entry.correct, entry.total);
    const barCls = center >= 0.5 ? 'yq-hist-bar-pos' : 'yq-hist-bar-neg';
    const opacity = Math.max(0.35, 1 - Math.min(1, high - low));
    const barY = y(center * 100);

    const bar = g.append('rect')
      .attr('class', barCls)
      .attr('x', x(yr))
      .attr('width', x.bandwidth())
      .attr('y', barY)
      .attr('height', Math.max(0, innerH - barY))
      .style('opacity', opacity);
    bar.append('title')
      .text(`${yr}: ${entry.correct}/${entry.total} correct (${Math.round(center * 100)}% est., ${Math.round(low * 100)}–${Math.round(high * 100)}%)`);

    g.append('line')
      .attr('class', 'yq-hist-whisker')
      .attr('x1', cx).attr('x2', cx)
      .attr('y1', y(low * 100)).attr('y2', y(high * 100))
      .style('opacity', opacity);
    g.append('line')
      .attr('class', 'yq-hist-whisker')
      .attr('x1', cx - 3).attr('x2', cx + 3)
      .attr('y1', y(low * 100)).attr('y2', y(low * 100))
      .style('opacity', opacity);
    g.append('line')
      .attr('class', 'yq-hist-whisker')
      .attr('x1', cx - 3).attr('x2', cx + 3)
      .attr('y1', y(high * 100)).attr('y2', y(high * 100))
      .style('opacity', opacity);
  }
}

function resetStatsHandler() {
  if (!window.confirm('Reset all year quiz stats?')) return;
  state.stats = resetStats();
  renderStatsHistogram();
}

function snapYear(raw) {
  if (String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  let snapped = Math.round((n - state.minYear) / STEP) * STEP + state.minYear;
  snapped = Math.max(state.minYear, Math.min(state.maxYear, snapped));
  return snapped;
}

function pickDistractors(answer) {
  const pool = state.years.filter(y => y !== answer);
  // Not fully random on purpose: a mix of near and far distractors keeps the
  // choice meaningful. The exact bucketing/recency weighting is a deliberate
  // tuning knob to revisit later, not a gap to fix now.
  const buckets = [
    pool.filter(y => Math.abs(y - answer) <= 8),
    pool.filter(y => Math.abs(y - answer) <= 20),
    pool,
  ];
  const chosen = new Set();
  for (const bucket of buckets) {
    const avail = bucket.filter(y => !chosen.has(y));
    if (avail.length) chosen.add(avail[Math.floor(Math.random() * avail.length)]);
  }
  let guard = 0;
  while (chosen.size < 3 && pool.length && guard++ < 100) {
    chosen.add(pool[Math.floor(Math.random() * pool.length)]);
  }
  const options = [answer, ...chosen];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

function renderMcButtons(answer) {
  const wrap = $('yqMcWrap');
  wrap.innerHTML = '';
  for (const y of pickDistractors(answer)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn yq-mc-btn';
    btn.textContent = String(y);
    btn.addEventListener('click', () => { if (!state.guessed) grade(y); });
    wrap.appendChild(btn);
  }
}

function grade(guess) {
  if (state.guessed) return;
  state.guessed = true;
  state.score.total++;
  const correct = guess === state.currentYear;
  if (correct) state.score.correct++;
  state.stats = recordAttempt(state.currentYear, correct);
  renderStatsHistogram();
  const diff = Math.abs(guess - state.currentYear);
  const cycles = Math.round(diff / STEP);
  const result = $('yqResult');
  result.hidden = false;
  result.className = `yq-result ${correct ? 'yq-correct' : 'yq-wrong'}`;
  result.textContent = correct
    ? `Correct! It was ${state.currentYear}.`
    : `Not quite — it was ${state.currentYear}. You were ${cycles} election${cycles === 1 ? '' : 's'} (${diff} years) off.`;
  const infoRow = (state.byYear.get(state.currentYear) || []).find(r => r.D_candidate);
  if (infoRow) {
    const detail = document.createElement('div');
    detail.className = 'yq-result-detail';
    detail.textContent = `${infoRow.D_candidate} (D) vs. ${infoRow.R_candidate} (R) — national popular vote: ${infoRow.national_margin_str}`;
    result.appendChild(detail);
  }
  $('yqScore').textContent = `Score: ${state.score.correct}/${state.score.total}`;
  document.querySelectorAll('.yq-mc-btn').forEach(b => { b.disabled = true; });
}

function submitFreeGuess() {
  if (state.guessed) return;
  const input = $('yqYearInput');
  const raw = input.value;
  const snapped = snapYear(raw);
  if (snapped == null) return;
  const note = $('yqSnapNote');
  if (String(snapped) !== String(raw).trim()) {
    note.textContent = `→ rounded to ${snapped}`;
    note.hidden = false;
  } else {
    note.hidden = true;
  }
  input.value = snapped;
  grade(snapped);
}

function stepInput(delta) {
  const input = $('yqYearInput');
  let n = Number(input.value);
  if (!Number.isFinite(n)) n = state.minYear;
  n = Math.max(state.minYear, Math.min(state.maxYear, n + delta));
  input.value = n;
}

function updateModeUI() {
  $('yqFreeGuess').style.display = state.toggles.mc ? 'none' : '';
  $('yqSnapNote').hidden = true;
  $('yqMcWrap').style.display = state.toggles.mc ? '' : 'none';
}

function newRound() {
  state.lastYear = state.currentYear;
  state.currentYear = pickRandomYear();
  state.guessed = false;
  $('yqResult').hidden = true;
  $('yqSnapNote').hidden = true;
  $('yqYearInput').value = '';
  renderMap(state.currentYear);
  updateModeUI();
  if (state.toggles.mc) renderMcButtons(state.currentYear);
}

function wireToggle(id, key, onChange) {
  $(id).addEventListener('change', (e) => {
    state.toggles[key] = e.target.checked;
    onChange();
  });
}

function wireControls() {
  wireToggle('yqToggleShade', 'shade', () => renderMap(state.currentYear));
  wireToggle('yqToggleAbbr', 'abbr', () => renderLabels(state.currentYear));
  wireToggle('yqToggleEv', 'ev', () => renderLabels(state.currentYear));
  wireToggle('yqToggleEvBar', 'evbar', () => renderEvBar(state.currentYear));
  wireToggle('yqToggleMc', 'mc', () => {
    updateModeUI();
    if (state.toggles.mc) {
      renderMcButtons(state.currentYear);
      if (state.guessed) document.querySelectorAll('.yq-mc-btn').forEach(b => { b.disabled = true; });
    }
  });
  // Learning mode only changes the weighting used by the *next* pickRandomYear()
  // call, so there's nothing to re-render immediately when it's toggled.
  wireToggle('yqToggleLearning', 'learning', () => {});
  $('yqResetStats').addEventListener('click', resetStatsHandler);

  $('yqStepDown').addEventListener('click', () => stepInput(-STEP));
  $('yqStepUp').addEventListener('click', () => stepInput(STEP));
  $('yqGuessBtn').addEventListener('click', submitFreeGuess);
  $('yqYearInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); stepInput(STEP); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); stepInput(-STEP); }
    else if (e.key === 'Enter') { e.preventDefault(); if (state.guessed) newRound(); else submitFreeGuess(); }
  });
  $('yqNewMap').addEventListener('click', newRound);

  // "N" jumps to a new map from anywhere on the page, so a round can be
  // skipped or restarted without reaching for the mouse. Guarded to text
  // inputs only (the year field is type=number, so "n" can't be typed into
  // it anyway) so it doesn't fire while actually typing something else.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'n' && e.key !== 'N') return;
    const t = e.target;
    if (t && t.tagName === 'INPUT' && t.type !== 'number' && t.type !== 'checkbox') return;
    e.preventDefault();
    newRound();
  });
}

async function init() {
  const rawRows = await loadPresidentialMargins();
  for (const row of rawRows) {
    const year = +row.year;
    if (!state.byYear.has(year)) state.byYear.set(year, []);
    state.byYear.get(year).push(row);
  }
  state.years = Array.from(state.byYear.keys()).sort((a, b) => a - b);
  state.minYear = state.years[0];
  state.maxYear = state.years[state.years.length - 1];

  const input = $('yqYearInput');
  input.min = state.minYear;
  input.max = state.maxYear;
  $('yqYearRange').textContent = `${state.minYear}–${state.maxYear}`;

  state.stats = loadStats();
  renderStatsHistogram();

  await window.ElectionMap.build({
    svgSelector: '#map',
    topoUrl: 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json',
    districtGeoUrl: 'me_ne_districts.geojson',
  });

  wireControls();
  newRound();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

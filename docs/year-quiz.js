'use strict';
import { loadPresidentialMargins } from './utils/dataLoader.js';
import { safeMarginToColor } from './utils/colorUtils.js';

// CSV's precomputed 'color' column uses these three exact values.
const FLAT_COLORS = { deepskyblue: '#4169E1', red: '#B22222', yellow: '#C9A400' };
const PARTY_OF = { deepskyblue: 'D', red: 'R', yellow: 'O' };
const STEP = 4;

const state = {
  byYear: new Map(),
  years: [],
  minYear: null,
  maxYear: null,
  currentYear: null,
  lastYear: null,
  guessed: false,
  score: { correct: 0, total: 0 },
  toggles: { shade: false, abbr: false, ev: false, evbar: false, mc: false },
};

function $(id) { return document.getElementById(id); }

function rowColor(row) {
  const isThird = row.color === 'yellow';
  if (state.toggles.shade) return safeMarginToColor(+row.pres_margin, isThird);
  return FLAT_COLORS[row.color] || '#2f2f2f';
}

function pickRandomYear() {
  if (state.years.length <= 1) return state.years[0];
  let y;
  do { y = state.years[Math.floor(Math.random() * state.years.length)]; }
  while (y === state.lastYear);
  return y;
}

function renderMap(year) {
  const rows = state.byYear.get(year) || [];
  const present = new Set();
  for (const row of rows) {
    window.ElectionMap.setStateFill(row.abbr, rowColor(row));
    present.add(row.abbr);
  }
  for (const abbr of window.ElectionMap.statePaths.keys()) {
    if (!present.has(abbr)) window.ElectionMap.setStateFill(abbr, '#2f2f2f');
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
    ? (abbr) => { const r = byAbbr.get(abbr); return r ? +r.electoral_votes : null; }
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
  for (const row of rows) {
    const ev = +row.electoral_votes || 0;
    totalEV += ev;
    const party = PARTY_OF[row.color];
    if (party === 'D') dEV += ev;
    else if (party === 'R') rEV += ev;
    else oEV += ev;
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
  const diff = Math.abs(guess - state.currentYear);
  const cycles = Math.round(diff / STEP);
  const result = $('yqResult');
  result.hidden = false;
  result.className = `yq-result ${correct ? 'yq-correct' : 'yq-wrong'}`;
  result.textContent = correct
    ? `Correct! It was ${state.currentYear}.`
    : `Not quite — it was ${state.currentYear}. You were ${cycles} election${cycles === 1 ? '' : 's'} (${diff} years) off.`;
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

  $('yqStepDown').addEventListener('click', () => stepInput(-STEP));
  $('yqStepUp').addEventListener('click', () => stepInput(STEP));
  $('yqGuessBtn').addEventListener('click', submitFreeGuess);
  $('yqYearInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); stepInput(STEP); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); stepInput(-STEP); }
    else if (e.key === 'Enter') { e.preventDefault(); submitFreeGuess(); }
  });
  $('yqNewMap').addEventListener('click', newRound);
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

  await window.ElectionMap.build({ svgSelector: '#map', topoUrl: 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json' });
  window.ElectionMap.setDistrictsVisible(false);

  wireControls();
  newRound();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

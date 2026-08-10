'use strict';

import { blendColors, safeMarginToColor } from './utils/colorUtils.js';

// ---- Unit display helpers (mirrors the convention in docs/trending-states.js) ----

const ABBR_TO_STATE = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DC: 'District of Columbia', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', 'ME-AL': 'Maine', 'ME-01': "Maine's 1st Congressional District", 'ME-02': "Maine's 2nd Congressional District",
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', 'NE-AL': 'Nebraska', 'NE-01': "Nebraska's 1st Congressional District",
  'NE-02': "Nebraska's 2nd Congressional District", 'NE-03': "Nebraska's 3rd Congressional District",
  NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

function displayAbbr(abbr) {
  if (abbr === 'ME-AL') return 'ME';
  if (abbr === 'NE-AL') return 'NE';
  return abbr;
}

function unitFullName(abbr) {
  return ABBR_TO_STATE[abbr] || abbr;
}

function mapFillKey(abbr) {
  if (abbr === 'ME-AL') return 'ME';
  if (abbr === 'NE-AL') return 'NE';
  return abbr;
}

function unitLink(abbr) {
  if (abbr === 'ME-AL') return 'state/ME.html';
  if (abbr === 'NE-AL') return 'state/NE.html';
  if (window.PcaEngine.DISTRICT_UNITS.includes(abbr)) return 'unit/' + abbr + '.html';
  return 'state/' + abbr + '.html';
}

function fmtMargin(v) {
  if (v == null || isNaN(v)) return '—';
  if (Math.abs(v) < 0.0005) return 'EVEN';
  const sign = v > 0 ? 'D' : 'R';
  return sign + '+' + Math.abs(v * 100).toFixed(1);
}

function isRelativeMetric(m) {
  return m === 'relative_margin' || m === 'two_party_relative_margin';
}

// Neutral (non-partisan) diverging scale for loadings/residuals, deliberately
// distinct from the site's blue/red vote-margin scale — a loading's sign is
// an arbitrary artifact of the SVD, not a party lean.
function divergingColor(v, maxAbs) {
  const t = maxAbs > 0 ? Math.max(-1, Math.min(1, v / maxAbs)) : 0;
  if (t >= 0) return blendColors('#2a2a2a', '#d9822b', t);
  return blendColors('#2a2a2a', '#2a9d8f', -t);
}

const SCORE_COLORS = ['#4C72B0', '#DD8452', '#55A868', '#C44E52', '#8172B2', '#937860', '#DA8BC3', '#8C8C8C', '#CCB974', '#64B5CD'];

// ---- Data loading ----

function loadRows() {
  const loader = (window.DataLoader && typeof window.DataLoader.loadPresidentialMargins === 'function')
    ? window.DataLoader
    : null;
  if (loader) return loader.loadPresidentialMargins();
  console.warn('[PcaExplorer] DataLoader not found; falling back to direct CSV load.');
  return d3.csv('./presidential_margins.csv', d3.autoType);
}

function buildNpvLookup(rows) {
  const m = new Map();
  for (const r of rows) {
    if (r.abbr === 'NATIONAL' && r.national_margin != null) m.set(+r.year, +r.national_margin);
  }
  return m;
}

function buildEvLookup(rows) {
  const m = new Map(); // unit -> Map(year -> ev)
  for (const r of rows) {
    if (!r.abbr || r.abbr === 'NATIONAL') continue;
    if (r.electoral_votes == null || r.electoral_votes === '') continue;
    if (!m.has(r.abbr)) m.set(r.abbr, new Map());
    m.get(r.abbr).set(+r.year, +r.electoral_votes);
  }
  return m;
}

function getEv(unit, year) {
  const m = evLookupMap.get(unit);
  if (!m) return null;
  return m.has(year) ? m.get(year) : null;
}

// ---- State ----

let allRows = [];
let availableYears = [];
let npvByYear = new Map();
let evLookupMap = new Map();

let metric = 'pres_margin';
let yearStart = 1964;
let yearEnd = 2024;
let splitDistricts = false;
let varimaxOn = false;
let componentCount = 10;
let loadingsComponentIdx = 0;
let assumedNpv = 0;
let errorYear = 2024;
let errorK = 3;
let npvSelectedComponent = 0;

let pcaResult = null; // raw/unrotated PCA result for the current matrix
let active = null;    // possibly-rotated, componentCount-truncated view in use
let unitIndex = new Map();

let sliderK = 0;
let sliderValues = [];

let mapMode = 'loadings';
let mapBuilt = false;
let currentTooltipFn = () => '';
let selectedScoreComponent = null;

// ---- Controls: population ----

function populateYearSelects() {
  const startSel = document.getElementById('pca-year-start');
  const endSel = document.getElementById('pca-year-end');
  startSel.innerHTML = '';
  endSel.innerHTML = '';
  availableYears.forEach(y => {
    const o1 = document.createElement('option'); o1.value = String(y); o1.textContent = String(y); startSel.appendChild(o1);
    const o2 = document.createElement('option'); o2.value = String(y); o2.textContent = String(y); endSel.appendChild(o2);
  });
  yearStart = availableYears.includes(1964) ? 1964 : availableYears[0];
  yearEnd = availableYears.includes(2024) ? 2024 : availableYears[availableYears.length - 1];
  startSel.value = String(yearStart);
  endSel.value = String(yearEnd);
}

function updateSplitDistrictsAvailability() {
  const support = window.PcaEngine.districtSplitAvailable(yearStart);
  const checkbox = document.getElementById('pca-split-districts');
  const label = document.getElementById('pca-split-districts-label');
  const available = support.ME || support.NE;
  checkbox.disabled = !available;
  label.title = available ? '' : 'District splits need a range starting at 1972 (Maine) or 1992 (Nebraska).';
  label.style.opacity = available ? '1' : '0.5';
  if (!available && checkbox.checked) {
    checkbox.checked = false;
    splitDistricts = false;
  }
}

function updateAssumedNpvVisibility() {
  document.getElementById('pca-assumed-npv-label').style.display = isRelativeMetric(metric) ? '' : 'none';
}

function populateComponentCountOptions() {
  const sel = document.getElementById('pca-component-count');
  sel.innerHTML = '';
  const maxK = pcaResult ? pcaResult.k : 0;
  for (let k = 2; k <= maxK; k++) {
    const opt = document.createElement('option'); opt.value = String(k); opt.textContent = String(k); sel.appendChild(opt);
  }
  componentCount = Math.min(componentCount || 10, maxK);
  if (componentCount < 2) componentCount = Math.min(2, maxK);
  sel.value = String(componentCount);
}

function populateLoadingsComponentOptions() {
  const sel = document.getElementById('pca-loadings-component');
  const prev = loadingsComponentIdx;
  sel.innerHTML = '';
  for (let i = 0; i < active.k; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `PC${i + 1}${varimaxOn ? ' (rot)' : ''}`;
    sel.appendChild(opt);
  }
  loadingsComponentIdx = Math.min(prev || 0, active.k - 1);
  sel.value = String(loadingsComponentIdx);
}

function populateJumpYearOptions() {
  const sel = document.getElementById('pca-jump-year');
  sel.innerHTML = '';
  pcaResult.years.forEach(y => {
    const opt = document.createElement('option'); opt.value = String(y); opt.textContent = String(y); sel.appendChild(opt);
  });
  sel.value = String(pcaResult.years[pcaResult.years.length - 1]);
}

function populateErrorYearOptions() {
  const sel = document.getElementById('pca-error-year');
  sel.innerHTML = '';
  pcaResult.years.forEach(y => {
    const opt = document.createElement('option'); opt.value = String(y); opt.textContent = String(y); sel.appendChild(opt);
  });
  errorYear = pcaResult.years[pcaResult.years.length - 1];
  sel.value = String(errorYear);
}

function populateErrorKOptions() {
  const sel = document.getElementById('pca-error-k');
  sel.innerHTML = '';
  for (let k = 1; k <= active.k; k++) {
    const opt = document.createElement('option'); opt.value = String(k); opt.textContent = String(k); sel.appendChild(opt);
  }
  errorK = Math.min(errorK || 3, active.k);
  sel.value = String(errorK);
}

function updateUnitSummary() {
  const el = document.getElementById('pca-unit-summary');
  const y = pcaResult.years;
  el.textContent = `${pcaResult.units.length} units × ${y.length} elections (${y[0]}–${y[y.length - 1]}), ${pcaResult.k} components available.`;
}

// ---- PCA orchestration ----

function computeActive() {
  const K = Math.min(componentCount, pcaResult.k);
  const rawLoadings = pcaResult.loadings.map(row => row.slice(0, K));
  const rawComponents = pcaResult.components.map(row => row.slice(0, K));
  const rawScores = pcaResult.scores.map(row => row.slice(0, K));
  if (varimaxOn && K >= 2) {
    const { rotated, R } = window.PcaEngine.varimax(rawLoadings);
    active = {
      loadings: rotated,
      components: window.PcaEngine.matMul(rawComponents, R),
      scores: window.PcaEngine.matMul(rawScores, R),
      k: K,
    };
  } else {
    active = { loadings: rawLoadings, components: rawComponents, scores: rawScores, k: K };
  }
}

function fullRecompute() {
  const built = window.PcaEngine.buildMatrix(allRows, { metric, yearStart, yearEnd, splitDistricts });
  if (!built.units.length || built.years.length < 2) {
    pcaResult = null;
    active = null;
    document.getElementById('pca-unit-summary').textContent = 'Not enough overlapping data for this range/metric — try a wider year range.';
    ['pca-scree', 'pca-map', 'pca-scores-chart', 'pca-npv-scatter', 'pca-loadings-bar'].forEach(id => d3.select('#' + id).selectAll('*').remove());
    return;
  }
  const { Xstd, mean, std } = window.PcaEngine.standardize(built.X);
  const pca = window.PcaEngine.runPca(Xstd);
  pcaResult = Object.assign({}, built, { mean, std }, pca);
  unitIndex = new Map(pcaResult.units.map((u, i) => [u, i]));

  populateComponentCountOptions();
  computeActive();
  populateLoadingsComponentOptions();
  populateJumpYearOptions();
  populateErrorYearOptions();
  populateErrorKOptions();
  initSliders();
  renderAll();
}

function onComponentSettingsChanged() {
  if (!pcaResult) return;
  computeActive();
  populateLoadingsComponentOptions();
  populateErrorKOptions();
  initSliders();
  renderAll();
}

function renderAll() {
  if (!pcaResult) return;
  updateUnitSummary();
  renderScree();
  renderScoresChart();
  renderNpvPanel();
  renderCurrentMode();
}

// ---- Scree plot ----

function renderScree() {
  const svg = d3.select('#pca-scree');
  svg.selectAll('*').remove();
  const evr = pcaResult.explainedVarianceRatio.slice(0, Math.min(pcaResult.k, 30));
  const W = 700, H = 320, margin = { top: 24, right: 20, bottom: 40, left: 44 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand().domain(evr.map((_, i) => i + 1)).range([0, innerW]).padding(0.2);
  const y = d3.scaleLinear().domain([0, 1]).range([innerH, 0]);
  let cum = 0;
  const cumVals = evr.map(v => (cum += v));

  g.selectAll('rect.scree-bar').data(evr).join('rect')
    .attr('class', 'scree-bar')
    .attr('x', (_, i) => x(i + 1))
    .attr('y', v => y(v))
    .attr('width', x.bandwidth())
    .attr('height', v => innerH - y(v))
    .attr('fill', '#4C72B0');

  const line = d3.line().x((_, i) => x(i + 1) + x.bandwidth() / 2).y(v => y(v)).curve(d3.curveMonotoneX);
  g.append('path').datum(cumVals).attr('d', line).attr('fill', 'none').attr('stroke', '#55A868').attr('stroke-width', 2);
  g.selectAll('circle.cum-pt').data(cumVals).join('circle')
    .attr('class', 'cum-pt')
    .attr('cx', (_, i) => x(i + 1) + x.bandwidth() / 2)
    .attr('cy', v => y(v))
    .attr('r', 3).attr('fill', '#55A868');

  g.append('g').attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickFormat(d => 'PC' + d).tickValues(x.domain().filter((_, i) => i % Math.ceil(evr.length / 15 || 1) === 0)))
    .selectAll('text').attr('font-size', 9);
  g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.0%'))).selectAll('text').attr('font-size', 10);

  g.append('text').attr('x', innerW - 4).attr('y', 12).attr('text-anchor', 'end').attr('fill', '#4C72B0').attr('font-size', 11).text('Individual');
  g.append('text').attr('x', innerW - 4).attr('y', 26).attr('text-anchor', 'end').attr('fill', '#55A868').attr('font-size', 11).text('Cumulative');
}

// ---- Scores-over-time chart ----

function renderScoresChart() {
  const svg = d3.select('#pca-scores-chart');
  svg.selectAll('*').remove();
  const nShow = Math.min(5, active.k);
  const years = pcaResult.years;
  const W = 900, H = 380, margin = { top: 20, right: 20, bottom: 34, left: 46 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain(d3.extent(years)).range([0, innerW]);
  let allVals = [];
  for (let i = 0; i < nShow; i++) for (const row of active.scores) allVals.push(row[i]);
  const yMax = Math.max(1, d3.max(allVals, Math.abs) * 1.1);
  const y = d3.scaleLinear().domain([-yMax, yMax]).range([innerH, 0]);

  g.append('line').attr('x1', 0).attr('x2', innerW).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', '#333');
  const xAxisG = g.append('g').attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickFormat(d3.format('d')).tickValues(years));
  const xAxisText = xAxisG.selectAll('text').attr('font-size', 10);
  if (years.length > 14) {
    xAxisText.attr('transform', 'rotate(-45)').style('text-anchor', 'end');
  }
  g.append('g').call(d3.axisLeft(y).ticks(5)).selectAll('text').attr('font-size', 10);

  for (let i = 0; i < nShow; i++) {
    const series = years.map((yr, idx) => ({ year: yr, v: active.scores[idx][i] }));
    const line = d3.line().x(d => x(d.year)).y(d => y(d.v)).curve(d3.curveMonotoneX);
    const color = SCORE_COLORS[i % SCORE_COLORS.length];
    g.append('path').datum(series).attr('data-pc', i).attr('d', line).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2);
    g.selectAll(`circle.pt-${i}`).data(series).join('circle')
      .attr('class', `pt-${i}`).attr('data-pc', i)
      .attr('cx', d => x(d.year)).attr('cy', d => y(d.v)).attr('r', 2.5).attr('fill', color);
  }

  if (selectedScoreComponent != null && selectedScoreComponent >= nShow) selectedScoreComponent = null;

  const legend = document.getElementById('pca-scores-legend');
  legend.innerHTML = '';
  for (let i = 0; i < nShow; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tw-swatch' + (selectedScoreComponent === i ? ' active' : '');
    btn.innerHTML = `<i style="background:${SCORE_COLORS[i % SCORE_COLORS.length]}"></i>PC${i + 1}${varimaxOn ? ' (rotated)' : ''}`;
    btn.addEventListener('click', () => {
      selectedScoreComponent = selectedScoreComponent === i ? null : i;
      applyScoreSelection();
    });
    legend.appendChild(btn);
  }

  applyScoreSelection();
}

function applyScoreSelection() {
  const svg = d3.select('#pca-scores-chart');
  const selected = selectedScoreComponent;
  svg.selectAll('path[data-pc]').each(function () {
    const pc = +this.getAttribute('data-pc');
    const el = d3.select(this);
    if (selected == null) {
      el.attr('stroke-width', 2).attr('stroke-opacity', 1).style('filter', null);
    } else if (pc === selected) {
      el.attr('stroke-width', 3.5).attr('stroke-opacity', 1)
        .style('filter', `drop-shadow(0 0 6px ${el.attr('stroke')})`);
    } else {
      el.attr('stroke-width', 2).attr('stroke-opacity', 0.15).style('filter', null);
    }
  });
  svg.selectAll('circle[data-pc]').each(function () {
    const pc = +this.getAttribute('data-pc');
    const el = d3.select(this);
    el.attr('fill-opacity', selected == null || pc === selected ? 1 : 0.15);
  });
  document.querySelectorAll('#pca-scores-legend .tw-swatch').forEach((btn, i) => {
    btn.classList.toggle('active', selected === i);
  });
}

// ---- Map: shared color-application plumbing ----

function applyMapColors(getColor) {
  const presentUnits = new Set(pcaResult.units);
  const abbrColors = new Map();
  const unitColors = new Map();

  const districtsActive = window.PcaEngine.DISTRICT_UNITS.some(u => presentUnits.has(u));
  window.ElectionMap.setDistrictsVisible(districtsActive);

  window.PcaEngine.BASE_UNITS.forEach(abbr => {
    const key = mapFillKey(abbr);
    const color = presentUnits.has(abbr) ? getColor(abbr) : null;
    const finalColor = color || '#2f2f2f';
    window.ElectionMap.setStateFill(key, finalColor);
    abbrColors.set(key, finalColor);
    if (abbr === 'ME-AL' || abbr === 'NE-AL') unitColors.set(abbr, finalColor);
  });
  window.PcaEngine.DISTRICT_UNITS.forEach(unit => {
    const color = presentUnits.has(unit) ? getColor(unit) : null;
    window.ElectionMap.setDistrictFill(unit, color || 'transparent');
  });

  const evLookupFn = (unitOrAbbr) => {
    let key = unitOrAbbr;
    if (unitOrAbbr === 'ME') key = 'ME-AL';
    if (unitOrAbbr === 'NE') key = 'NE-AL';
    return getEv(presentUnits.has(key) ? key : unitOrAbbr, yearEnd);
  };
  window.ElectionMap.refreshDecorations(yearEnd, evLookupFn, abbrColors, unitColors);
}

function renderMapLegend(mode, info) {
  const el = document.getElementById('pca-map-legend');
  if (mode === 'loadings') {
    el.innerHTML = '<span>Low (−)</span>' +
      '<span class="bar" style="background:linear-gradient(90deg,#2a9d8f,#2a2a2a,#d9822b)"></span>' +
      '<span>High (+)</span>' +
      `<span style="margin-left:8px">PC${info.compIdx + 1} loading, max |${info.maxAbs.toFixed(2)}|</span>`;
  } else if (mode === 'reconstruction') {
    el.innerHTML = '<span>Safe R</span>' +
      '<span class="bar" style="background:linear-gradient(90deg,#8B0000,#F08080,#87CEFA,#00008B)"></span>' +
      '<span>Safe D</span>';
  } else if (mode === 'error') {
    el.innerHTML = '<span>Over-called R</span>' +
      '<span class="bar" style="background:linear-gradient(90deg,#2a9d8f,#2a2a2a,#d9822b)"></span>' +
      '<span>Over-called D</span>' +
      `<span style="margin-left:8px">max |residual| ${(info.maxAbs * 100).toFixed(1)} pts</span>`;
  }
}

function renderCurrentMode() {
  if (!pcaResult) return;
  if (mapMode === 'loadings') renderLoadingsMode();
  else if (mapMode === 'reconstruction') renderReconstructionMode();
  else if (mapMode === 'error') renderErrorMode();
}

// ---- Map mode: loadings ----

function renderLoadingsMode() {
  const compIdx = loadingsComponentIdx;
  const vals = pcaResult.units.map((u, i) => active.loadings[i][compIdx]);
  const maxAbs = Math.max(1e-9, d3.max(vals, Math.abs));

  applyMapColors(unit => {
    const idx = unitIndex.get(unit);
    if (idx == null) return null;
    return divergingColor(active.loadings[idx][compIdx], maxAbs);
  });

  currentTooltipFn = (unit) => {
    const idx = unitIndex.get(unit);
    if (idx == null) return `<strong>${unitFullName(unit)}</strong><br>No data for this range.`;
    return `<strong>${unitFullName(unit)}</strong><br>PC${compIdx + 1} loading: ${active.loadings[idx][compIdx].toFixed(3)}`;
  };

  renderMapLegend('loadings', { maxAbs, compIdx });
  renderLoadingsBarChart(compIdx, maxAbs);
}

function renderLoadingsBarChart(compIdx, maxAbs) {
  const svg = d3.select('#pca-loadings-bar');
  svg.selectAll('*').remove();

  const entries = pcaResult.units
    .map((u, i) => ({ unit: u, v: active.loadings[i][compIdx] }))
    .sort((a, b) => b.v - a.v);

  const rowH = 14;
  const W = 700, margin = { top: 6, right: 12, bottom: 6, left: 46 };
  const innerW = W - margin.left - margin.right;
  const innerH = entries.length * rowH;
  const H = innerH + margin.top + margin.bottom;
  svg.attr('viewBox', `0 0 ${W} ${H}`);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const y = d3.scaleBand().domain(entries.map(e => e.unit)).range([0, innerH]).padding(0.15);
  const x = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([0, innerW]);

  g.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', innerH).attr('stroke', '#333');

  const rows = g.selectAll('g.loadings-bar-row').data(entries).join('g')
    .attr('class', 'loadings-bar-row')
    .style('cursor', 'pointer')
    .on('mouseenter', (evt, d) => {
      const tooltip = document.getElementById('pca-tooltip');
      tooltip.style.display = 'block';
      tooltip.innerHTML = `<strong>${unitFullName(d.unit)}</strong><br>PC${compIdx + 1} loading: ${d.v.toFixed(3)}`;
      positionMapTip(evt);
    })
    .on('mousemove', (evt) => positionMapTip(evt))
    .on('mouseleave', () => hideMapTip())
    .on('click', (evt, d) => { window.open(unitLink(d.unit), '_blank'); });

  rows.append('rect')
    .attr('y', d => y(d.unit))
    .attr('height', y.bandwidth())
    .attr('x', d => Math.min(x(0), x(d.v)))
    .attr('width', d => Math.abs(x(d.v) - x(0)))
    .attr('fill', d => divergingColor(d.v, maxAbs));

  rows.append('text')
    .attr('x', -6)
    .attr('y', d => y(d.unit) + y.bandwidth() / 2)
    .attr('dy', '0.32em')
    .attr('text-anchor', 'end')
    .attr('font-size', 9)
    .attr('fill', 'var(--muted)')
    .text(d => displayAbbr(d.unit));
}

// ---- Map mode: interactive reconstruction ----

function computeReconstructedVector() {
  return window.PcaEngine.reconstruct(sliderValues, active.components, pcaResult.mean, pcaResult.std, sliderValues.length);
}

function renderReconstructionMode() {
  const raw = computeReconstructedVector();
  const relative = isRelativeMetric(metric);
  const npvAdj = relative ? (assumedNpv / 100) : 0;
  const effective = raw.map(v => v + npvAdj);

  applyMapColors(unit => {
    const idx = unitIndex.get(unit);
    if (idx == null) return null;
    return safeMarginToColor(effective[idx]);
  });

  currentTooltipFn = (unit) => {
    const idx = unitIndex.get(unit);
    if (idx == null) return `<strong>${unitFullName(unit)}</strong><br>No data for this range.`;
    return `<strong>${unitFullName(unit)}</strong><br>Reconstructed: ${fmtMargin(effective[idx])}` +
      (relative ? '<br><span class="pca-hint">Relative to your assumed national margin</span>' : '');
  };

  renderMapLegend('reconstruction');
  renderReconstructionEvBar(effective);
}

function renderReconstructionEvBar(effective) {
  let demEV = 0, repEV = 0, totalEV = 0;
  pcaResult.units.forEach((u, i) => {
    const ev = getEv(u, yearEnd) || 0;
    totalEV += ev;
    if (effective[i] >= 0) demEV += ev; else repEV += ev;
  });
  const demPct = totalEV ? (demEV / totalEV * 100) : 0;
  const repPct = totalEV ? (repEV / totalEV * 100) : 0;
  document.getElementById('pca-recon-ev-fill-d').style.width = demPct + '%';
  document.getElementById('pca-recon-ev-fill-r').style.width = repPct + '%';
  document.getElementById('pca-recon-ev-text').textContent = `D ${demEV} – R ${repEV}`;

  const toWin = Math.floor(totalEV / 2) + 1;
  const note = document.getElementById('pca-recon-ev-note');
  const prefix = totalEV < 500 ? `(${totalEV} EVs tallied for the current unit set) ` : '';
  if (demEV >= toWin) note.textContent = `${prefix}Democrats clear ${toWin} to win`;
  else if (repEV >= toWin) note.textContent = `${prefix}Republicans clear ${toWin} to win`;
  else note.textContent = `${prefix}${toWin} needed to win — no majority in this scenario`;
}

// ---- Map mode: historical error ----

function renderErrorMode() {
  const yearIdx = pcaResult.years.indexOf(errorYear);
  if (yearIdx < 0) return;
  const scoresForYear = active.scores[yearIdx];
  const reconstructed = window.PcaEngine.reconstruct(scoresForYear, active.components, pcaResult.mean, pcaResult.std, errorK);
  const actual = pcaResult.units.map((u, i) => pcaResult.X[yearIdx][i]);
  const residual = reconstructed.map((v, i) => v - actual[i]);
  const maxAbs = Math.max(1e-9, d3.max(residual, Math.abs));

  applyMapColors(unit => {
    const idx = unitIndex.get(unit);
    if (idx == null) return null;
    return divergingColor(residual[idx], maxAbs);
  });

  currentTooltipFn = (unit) => {
    const idx = unitIndex.get(unit);
    if (idx == null) return `<strong>${unitFullName(unit)}</strong><br>No data for this range.`;
    const flip = actual[idx] !== 0 && Math.sign(reconstructed[idx]) !== Math.sign(actual[idx]);
    return `<strong>${unitFullName(unit)}</strong><br>Actual: ${fmtMargin(actual[idx])}<br>` +
      `Reconstructed (k=${errorK}): ${fmtMargin(reconstructed[idx])}<br>Residual: ${fmtMargin(residual[idx])}` +
      (flip ? '<br><strong>Would be called for the other party</strong>' : '');
  };

  renderMapLegend('error', { maxAbs });
  renderFlipList(reconstructed, actual);
}

function renderFlipList(reconstructed, actual) {
  const el = document.getElementById('pca-flip-list');
  const flips = [];
  pcaResult.units.forEach((u, i) => {
    if (actual[i] === 0) return;
    if (Math.sign(reconstructed[i]) !== Math.sign(actual[i])) {
      flips.push({ unit: u, actual: actual[i], reconstructed: reconstructed[i] });
    }
  });
  if (!flips.length) {
    el.innerHTML = '<div>No units would have been called differently with this many components.</div>';
    return;
  }
  flips.sort((a, b) => Math.abs(b.reconstructed - b.actual) - Math.abs(a.reconstructed - a.actual));
  el.innerHTML = `<div>${flips.length} unit${flips.length === 1 ? '' : 's'} would have been called for the other party:</div>` +
    flips.map(f => `<div class="flip-row">${displayAbbr(f.unit)}: actual ${fmtMargin(f.actual)}, reconstructed ${fmtMargin(f.reconstructed)}</div>`).join('');
}

// ---- Sliders (reconstruction card) ----

function initSliders() {
  sliderK = Math.min(5, active.k);
  const lastYearIdx = pcaResult.years.length - 1;
  sliderValues = active.scores[lastYearIdx] ? active.scores[lastYearIdx].slice(0, sliderK) : new Array(sliderK).fill(0);
  renderSliderInputs();
}

function renderSliderInputs() {
  const grid = document.getElementById('pca-slider-grid');
  grid.innerHTML = '';
  for (let i = 0; i < sliderK; i++) {
    const col = active.scores.map(row => row[i]);
    const lo = Math.min(...col), hi = Math.max(...col);
    const pad = Math.max(0.2, (hi - lo) * 0.2);
    const min = lo - pad, max = hi + pad;
    const step = (max - min) / 200 || 0.01;

    const row = document.createElement('div');
    row.className = 'pca-slider-row';
    const label = document.createElement('label');
    label.textContent = `PC${i + 1}${varimaxOn ? ' (rot)' : ''}`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(sliderValues[i]);
    input.dataset.idx = String(i);
    const value = document.createElement('span');
    value.className = 'pca-slider-value';
    value.textContent = sliderValues[i].toFixed(2);

    input.addEventListener('input', () => {
      sliderValues[i] = parseFloat(input.value);
      value.textContent = sliderValues[i].toFixed(2);
      if (mapMode === 'reconstruction') renderReconstructionMode();
    });

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(value);
    grid.appendChild(row);
  }
}

// ---- NPV correlation panel ----

function renderNpvPanel() {
  const el = document.getElementById('pca-npv-rank');
  el.innerHTML = '';
  const fits = [];
  for (let i = 0; i < active.k; i++) {
    const xs = active.scores.map(row => row[i]);
    const ys = pcaResult.years.map(y => npvByYear.get(y) ?? 0);
    fits.push({ idx: i, r2: window.PcaEngine.olsFit(xs, ys).r2 });
  }
  fits.sort((a, b) => b.r2 - a.r2);
  const maxR2 = Math.max(1e-9, ...fits.map(f => f.r2));

  fits.forEach(f => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pca-npv-row' + (f.idx === npvSelectedComponent ? ' active' : '');
    btn.innerHTML = `<span>PC${f.idx + 1}</span>` +
      `<span class="pca-npv-bar-wrap"><span class="pca-npv-bar" style="width:${(f.r2 / maxR2 * 100).toFixed(0)}%"></span></span>` +
      `<span class="pca-npv-r2">R²=${f.r2.toFixed(2)}</span>`;
    btn.addEventListener('click', () => { npvSelectedComponent = f.idx; renderNpvPanel(); });
    el.appendChild(btn);
  });

  renderNpvScatter();
}

function renderNpvScatter() {
  const svg = d3.select('#pca-npv-scatter');
  svg.selectAll('*').remove();
  if (npvSelectedComponent >= active.k) npvSelectedComponent = 0;
  const i = npvSelectedComponent;
  const xs = active.scores.map(row => row[i]);
  const ys = pcaResult.years.map(y => (npvByYear.get(y) ?? 0) * 100);

  const W = 600, H = 420, margin = { top: 20, right: 20, bottom: 44, left: 54 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const xExtent = d3.extent(xs);
  const yExtent = d3.extent(ys);
  const xPad = (xExtent[1] - xExtent[0]) * 0.1 || 1;
  const yPad = (yExtent[1] - yExtent[0]) * 0.1 || 1;
  const x = d3.scaleLinear().domain([xExtent[0] - xPad, xExtent[1] + xPad]).range([0, innerW]);
  const y = d3.scaleLinear().domain([yExtent[0] - yPad, yExtent[1] + yPad]).range([innerH, 0]);

  g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x).ticks(6)).selectAll('text').attr('font-size', 10);
  g.append('g').call(d3.axisLeft(y).ticks(6)).selectAll('text').attr('font-size', 10);
  g.append('text').attr('x', innerW / 2).attr('y', innerH + 36).attr('text-anchor', 'middle').attr('fill', 'var(--muted)').attr('font-size', 11).text(`PC${i + 1} score`);
  g.append('text').attr('transform', 'rotate(-90)').attr('x', -innerH / 2).attr('y', -40).attr('text-anchor', 'middle').attr('fill', 'var(--muted)').attr('font-size', 11).text('National margin (pts)');

  const fitNpvOnScore = window.PcaEngine.olsFit(xs, ys);
  const fitScoreOnNpv = window.PcaEngine.olsFit(ys, xs);

  const lineX = d3.extent(xs);
  g.append('line')
    .attr('x1', x(lineX[0])).attr('x2', x(lineX[1]))
    .attr('y1', y(fitNpvOnScore.slope * lineX[0] + fitNpvOnScore.intercept))
    .attr('y2', y(fitNpvOnScore.slope * lineX[1] + fitNpvOnScore.intercept))
    .attr('stroke', '#4C72B0').attr('stroke-width', 2);

  if (fitScoreOnNpv.slope !== 0) {
    g.append('line')
      .attr('x1', x(lineX[0])).attr('x2', x(lineX[1]))
      .attr('y1', y((lineX[0] - fitScoreOnNpv.intercept) / fitScoreOnNpv.slope))
      .attr('y2', y((lineX[1] - fitScoreOnNpv.intercept) / fitScoreOnNpv.slope))
      .attr('stroke', '#DD8452').attr('stroke-width', 2).attr('stroke-dasharray', '4,3');
  }

  g.selectAll('circle.npv-pt').data(pcaResult.years).join('circle')
    .attr('class', 'npv-pt')
    .attr('cx', (_, idx) => x(xs[idx]))
    .attr('cy', (_, idx) => y(ys[idx]))
    .attr('r', 4).attr('fill', '#8aa7ba').attr('stroke', '#0b0b0b').attr('stroke-width', 1)
    .append('title').text(d => String(d));

  const eqEl = document.getElementById('pca-npv-equations');
  eqEl.innerHTML = `R² = ${fitNpvOnScore.r2.toFixed(3)}<br>` +
    `<span style="color:#4C72B0">NPV ≈ ${fitNpvOnScore.slope.toFixed(2)} · PC${i + 1} + ${fitNpvOnScore.intercept.toFixed(2)} pts</span><br>` +
    `<span style="color:#DD8452">PC${i + 1} ≈ ${fitScoreOnNpv.slope.toFixed(4)} · NPV + ${fitScoreOnNpv.intercept.toFixed(2)}</span>`;
}

// ---- Map mode toggle ----

function setMapMode(mode) {
  mapMode = mode;
  document.querySelectorAll('#pca-map-toggle button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('pca-pane-loadings').classList.toggle('active', mode === 'loadings');
  document.getElementById('pca-pane-reconstruction').classList.toggle('active', mode === 'reconstruction');
  document.getElementById('pca-pane-error').classList.toggle('active', mode === 'error');
  document.getElementById('pca-pane-reconstruction-ev').classList.toggle('active', mode === 'reconstruction');
  document.getElementById('pca-pane-error-flip').classList.toggle('active', mode === 'error');
  renderCurrentMode();
}

// ---- Map build + tooltip ----

function showMapUnitTip(evt, abbrOrUnit) {
  const tooltip = document.getElementById('pca-tooltip');
  let key = abbrOrUnit;
  if (abbrOrUnit === 'ME') key = 'ME-AL';
  if (abbrOrUnit === 'NE') key = 'NE-AL';
  // The ME/NE district overlay always covers those two states' entire visible
  // area regardless of the "split districts" toggle. When a specific district
  // isn't part of the current matrix (split mode off), fall back to its parent
  // state's at-large data instead of reporting "no data" for the district.
  if (window.PcaEngine.DISTRICT_UNITS.includes(key) && (!pcaResult || !unitIndex.has(key))) {
    key = key.startsWith('ME-') ? 'ME-AL' : 'NE-AL';
  }
  tooltip.style.display = 'block';
  tooltip.innerHTML = currentTooltipFn(key);
  positionMapTip(evt);
}

function positionMapTip(evt) {
  const tooltip = document.getElementById('pca-tooltip');
  tooltip.style.position = 'fixed';
  tooltip.style.left = (evt.clientX + 14) + 'px';
  tooltip.style.top = (evt.clientY + 14) + 'px';
}

function hideMapTip() {
  document.getElementById('pca-tooltip').style.display = 'none';
}

async function ensureMap() {
  if (mapBuilt) return;
  await window.ElectionMap.build({
    svgSelector: '#pca-map',
    topoUrl: 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json',
    districtGeoUrl: 'me_ne_districts.geojson',
    stateHandlers: {
      mouseenter: (evt, abbr) => showMapUnitTip(evt, abbr),
      mousemove: (evt) => positionMapTip(evt),
      mouseleave: () => hideMapTip(),
      click: (evt, abbr) => { window.open(unitLink(abbr === 'ME' ? 'ME-AL' : (abbr === 'NE' ? 'NE-AL' : abbr)), '_blank'); },
    },
    districtHandlers: {
      mouseenter: (evt, unit) => showMapUnitTip(evt, unit),
      mousemove: (evt) => positionMapTip(evt),
      mouseleave: () => hideMapTip(),
      click: (evt, unit) => { window.open(unitLink(unit), '_blank'); },
    },
  });
  mapBuilt = true;
}

// ---- Wiring ----

function initControls() {
  document.getElementById('pca-metric').addEventListener('change', (e) => {
    metric = e.target.value;
    updateAssumedNpvVisibility();
    fullRecompute();
  });

  document.getElementById('pca-year-start').addEventListener('change', (e) => {
    yearStart = +e.target.value;
    if (yearEnd <= yearStart) {
      yearEnd = availableYears.find(y => y > yearStart) || yearStart;
      document.getElementById('pca-year-end').value = String(yearEnd);
    }
    updateSplitDistrictsAvailability();
    fullRecompute();
  });

  document.getElementById('pca-year-end').addEventListener('change', (e) => {
    yearEnd = +e.target.value;
    if (yearEnd <= yearStart) {
      const earlier = availableYears.filter(y => y < yearEnd);
      yearStart = earlier.length ? earlier[earlier.length - 1] : yearEnd;
      document.getElementById('pca-year-start').value = String(yearStart);
      updateSplitDistrictsAvailability();
    }
    fullRecompute();
  });

  document.getElementById('pca-component-count').addEventListener('change', (e) => {
    componentCount = +e.target.value;
    onComponentSettingsChanged();
  });

  document.getElementById('pca-split-districts').addEventListener('change', (e) => {
    splitDistricts = e.target.checked;
    fullRecompute();
  });

  document.getElementById('pca-varimax').addEventListener('change', (e) => {
    varimaxOn = e.target.checked;
    onComponentSettingsChanged();
  });

  document.getElementById('pca-loadings-component').addEventListener('change', (e) => {
    loadingsComponentIdx = +e.target.value;
    if (mapMode === 'loadings') renderLoadingsMode();
  });

  document.getElementById('pca-jump-year').addEventListener('change', (e) => {
    const y = +e.target.value;
    const idx = pcaResult.years.indexOf(y);
    if (idx < 0) return;
    sliderValues = active.scores[idx].slice(0, sliderK);
    renderSliderInputs();
    if (mapMode === 'reconstruction') renderReconstructionMode();
  });

  document.getElementById('pca-assumed-npv').addEventListener('input', (e) => {
    assumedNpv = parseFloat(e.target.value) || 0;
    if (mapMode === 'reconstruction') renderReconstructionMode();
  });

  document.getElementById('pca-error-year').addEventListener('change', (e) => {
    errorYear = +e.target.value;
    if (mapMode === 'error') renderErrorMode();
  });

  document.getElementById('pca-error-k').addEventListener('change', (e) => {
    errorK = +e.target.value;
    if (mapMode === 'error') renderErrorMode();
  });

  document.querySelectorAll('#pca-map-toggle button').forEach(btn => {
    btn.addEventListener('click', () => setMapMode(btn.dataset.mode));
  });
}

// ---- Init ----

async function init() {
  initControls();
  const [rows] = await Promise.all([loadRows(), ensureMap()]);
  allRows = rows;
  availableYears = Array.from(new Set(rows.filter(r => r.abbr !== 'NATIONAL').map(r => +r.year))).sort((a, b) => a - b);
  npvByYear = buildNpvLookup(rows);
  evLookupMap = buildEvLookup(rows);

  populateYearSelects();
  updateSplitDistrictsAvailability();
  updateAssumedNpvVisibility();
  fullRecompute();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

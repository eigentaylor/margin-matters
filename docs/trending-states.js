'use strict';

// State/district trend rankings for the "Trending States" page.
// Mirrors the STATE_FILTER convention used in ranker.html, plus the
// CATEGORY_ORDER/THRESHOLDS/COLORS taxonomy from params.py (kept in sync by hand).

const STATE_FILTER = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME-AL', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE-AL', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT',
  'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'ME-01', 'ME-02', 'NE-01', 'NE-02', 'NE-03',
]);

const DISTRICT_UNITS = new Set(['ME-01', 'ME-02', 'NE-01', 'NE-02', 'NE-03']);

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

const CATEGORY_ORDER = ['lockedR', 'safeR', 'leanR', 'tiltR', 'swing', 'tiltD', 'leanD', 'safeD', 'lockedD'];

const CATEGORY_THRESHOLDS = {
  lockedR: -0.2, safeR: -0.1, leanR: -0.08, tiltR: -0.05,
  swing: 0.05,
  tiltD: 0.08, leanD: 0.1, safeD: 0.2, lockedD: Infinity,
};

const CATEGORY_COLORS = {
  lockedR: '#8B0000', safeR: '#B22222', leanR: '#CD5C5C', tiltR: '#F08080',
  swing: '#C3B1E1',
  tiltD: '#87CEFA', leanD: '#6495ED', safeD: '#4169E1', lockedD: '#00008B',
};

const CATEGORY_LABELS = {
  lockedR: 'Locked R', safeR: 'Safe R', leanR: 'Lean R', tiltR: 'Tilt R',
  swing: 'Swing',
  tiltD: 'Tilt D', leanD: 'Lean D', safeD: 'Safe D', lockedD: 'Locked D',
};

function categorizeRelativeMargin(v) {
  for (const cat of CATEGORY_ORDER) {
    if (v <= CATEGORY_THRESHOLDS[cat]) return cat;
  }
  return 'lockedD';
}

// Points of |relative margin| that mark the edge of the "swing" bucket.
const SWING_THRESHOLD_PTS = CATEGORY_THRESHOLDS.swing * 100;

const CURRENT_YEAR = new Date().getFullYear();
const PRESIDENTIAL_ELECTION_ANCHOR = 2024;

// Rounds a projected year up to the next presidential election year (never
// down), so an ETA reads as "by the 2040 election" rather than a mid-cycle year.
function nextElectionYearAtOrAfter(year) {
  const steps = Math.ceil((year - PRESIDENTIAL_ELECTION_ANCHOR) / 4);
  return PRESIDENTIAL_ELECTION_ANCHOR + steps * 4;
}

// Naive linear extrapolation of the competitiveness trend: how long, at the
// current rate, until a state crosses the swing-state line (in either
// direction). This is illustrative, not a real forecast — trends this far out
// rarely stay linear — so it's presented as a rough "at this rate" estimate.
function computeSwingEta(latestRelativeMargin, competitivenessPerDecade) {
  const m0 = Math.abs(latestRelativeMargin) * 100;
  const ratePtsPerDecade = competitivenessPerDecade * 100;
  const isSwingNow = m0 <= SWING_THRESHOLD_PTS;

  if (!isSwingNow && ratePtsPerDecade < 0) {
    const decades = (m0 - SWING_THRESHOLD_PTS) / -ratePtsPerDecade;
    return { kind: 'arriving', years: decades * 10 };
  }
  if (isSwingNow && ratePtsPerDecade > 0) {
    const decades = (SWING_THRESHOLD_PTS - m0) / ratePtsPerDecade;
    return { kind: 'leaving', years: decades * 10 };
  }
  if (isSwingNow) return { kind: 'staying', years: null };
  return { kind: 'none', years: null };
}

function swingEtaLabel(eta) {
  if (!eta) return null;
  if (eta.kind === 'staying') return 'Already a swing state';
  if (eta.kind === 'none') return null;
  const yrs = Math.round(eta.years);
  if (yrs > 100) {
    return eta.kind === 'arriving'
      ? "At this rate, won't be a swing state anytime this century"
      : 'At this rate, will stay a swing state for the rest of the century';
  }
  const electionYear = nextElectionYearAtOrAfter(CURRENT_YEAR + eta.years);
  if (eta.kind === 'arriving') return `Swing state ETA: ~${yrs} yr${yrs === 1 ? '' : 's'} at this rate (by ~${electionYear})`;
  return `Still a tossup for ~${yrs} more yr${yrs === 1 ? '' : 's'} at this rate (until ~${electionYear})`;
}

function swingEtaCompactLabel(eta) {
  if (!eta || eta.years == null) return '—';
  const yrs = Math.round(eta.years);
  if (yrs > 100) return '100+ yrs';
  const electionYear = nextElectionYearAtOrAfter(CURRENT_YEAR + eta.years);
  return `~${yrs} yr${yrs === 1 ? '' : 's'} (${electionYear})`;
}

const WINDOW_OPTIONS = [3, 4, 5, 6, 7, 8];
const DEFAULT_WINDOW = 5;

// ---- Unit display helpers ----

function displayAbbr(abbr) {
  if (abbr === 'ME-AL') return 'ME';
  if (abbr === 'NE-AL') return 'NE';
  return abbr;
}

function unitLink(abbr) {
  if (abbr === 'ME-AL') return 'state/ME.html';
  if (abbr === 'NE-AL') return 'state/NE.html';
  if (DISTRICT_UNITS.has(abbr)) return 'unit/' + abbr + '.html';
  return 'state/' + abbr + '.html';
}

function unitFullName(abbr) {
  return ABBR_TO_STATE[abbr] || abbr;
}

function mapFillKey(abbr) {
  if (abbr === 'ME-AL') return 'ME';
  if (abbr === 'NE-AL') return 'NE';
  return abbr;
}

// ---- Regression math ----

function leastSquaresSlope(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]; sumY += ys[i]; sumXY += xs[i] * ys[i]; sumXX += xs[i] * xs[i];
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

// ---- Data loading & grouping ----

function loadRows() {
  const loader = (window.DataLoader && typeof window.DataLoader.loadPresidentialMargins === 'function')
    ? window.DataLoader
    : null;
  if (loader) return loader.loadPresidentialMargins();
  console.warn('[TrendingStates] DataLoader not found; falling back to direct CSV load.');
  return d3.csv('./presidential_margins.csv', d3.autoType);
}

function groupByUnit(rows) {
  const byUnit = new Map();
  for (const r of rows) {
    const abbr = r.abbr;
    if (!abbr || !STATE_FILTER.has(abbr)) continue;
    const year = +r.year;
    const relMargin = r.relative_margin;
    if (!Number.isFinite(year) || relMargin == null || isNaN(relMargin)) continue;
    if (!byUnit.has(abbr)) byUnit.set(abbr, []);
    byUnit.get(abbr).push({
      year,
      relativeMargin: +relMargin,
      electoralVotes: r.electoral_votes != null ? +r.electoral_votes : null,
    });
  }
  for (const arr of byUnit.values()) arr.sort((a, b) => a.year - b.year);
  return byUnit;
}

// ---- Trend computation ----

function computeUnitTrend(history, windowSize) {
  if (!history || history.length < 3) return null;
  const windowed = history.slice(-windowSize);
  if (windowed.length < 3) return null;

  const years = windowed.map(d => d.year);
  const rel = windowed.map(d => d.relativeMargin);
  const absRel = windowed.map(d => Math.abs(d.relativeMargin));

  const directionSlope = leastSquaresSlope(years, rel);
  const competitivenessSlope = leastSquaresSlope(years, absRel);
  const latest = windowed[windowed.length - 1];
  const competitivenessPerDecade = competitivenessSlope * 10;

  return {
    windowed,
    directionPerDecade: directionSlope * 10,
    competitivenessPerDecade,
    latestRelativeMargin: latest.relativeMargin,
    latestYear: latest.year,
    electoralVotes: latest.electoralVotes,
    category: categorizeRelativeMargin(latest.relativeMargin),
    swingEta: computeSwingEta(latest.relativeMargin, competitivenessPerDecade),
  };
}

function buildAllTrends(byUnit, windowSize) {
  const out = new Map();
  for (const [abbr, history] of byUnit.entries()) {
    const trend = computeUnitTrend(history, windowSize);
    if (trend) out.set(abbr, trend);
  }
  return out;
}

// ---- Formatting ----

function fmtMagnitudePerDecade(v) {
  return Math.abs(v * 100).toFixed(1) + ' pts/decade';
}

function directionLabel(directionPerDecade) {
  const word = directionPerDecade > 0 ? 'toward D' : (directionPerDecade < 0 ? 'toward R' : 'flat');
  return fmtMagnitudePerDecade(directionPerDecade) + ' ' + word;
}

function competitivenessLabel(competitivenessPerDecade) {
  const word = competitivenessPerDecade < 0 ? 'narrower/decade' : (competitivenessPerDecade > 0 ? 'wider/decade' : 'no change');
  return fmtMagnitudePerDecade(competitivenessPerDecade) + ' ' + word;
}

function fmtMargin(v) {
  if (v == null || isNaN(v)) return '—';
  if (v === 0) return 'EVEN';
  const sign = v > 0 ? 'D' : 'R';
  return sign + '+' + Math.abs(v * 100).toFixed(1);
}

function tooltipBodyHtml(abbr, t) {
  const etaLine = swingEtaLabel(t.swingEta);
  return `<strong>${unitFullName(abbr)}</strong><br>` +
    `Current lean: ${fmtMargin(t.latestRelativeMargin)} (relative to nat'l)<br>` +
    `Direction: ${directionLabel(t.directionPerDecade)}<br>` +
    `Competitiveness: ${competitivenessLabel(t.competitivenessPerDecade)}` +
    (etaLine ? `<br>${etaLine}` : '');
}

// ---- Sparkline ----

function renderSparkline(svgSel, series) {
  const w = 70, h = 26, pad = 3;
  const years = series.map(d => d.year);
  const vals = series.map(d => d.relativeMargin);
  const x = d3.scaleLinear().domain(d3.extent(years)).range([pad, w - pad]);
  const yMax = Math.max(0.02, d3.max(vals, Math.abs));
  const y = d3.scaleLinear().domain([-yMax, yMax]).range([h - pad, pad]);

  svgSel.attr('viewBox', `0 0 ${w} ${h}`).attr('width', w).attr('height', h);
  svgSel.append('line')
    .attr('x1', pad).attr('x2', w - pad).attr('y1', y(0)).attr('y2', y(0))
    .attr('stroke', '#444').attr('stroke-width', 1).attr('stroke-dasharray', '2,2');

  const line = d3.line().x(d => x(d.year)).y(d => y(d.relativeMargin)).curve(d3.curveMonotoneX);
  svgSel.append('path').datum(series).attr('d', line)
    .attr('fill', 'none').attr('stroke', '#8aa7ba').attr('stroke-width', 1.6);

  const last = series[series.length - 1];
  svgSel.append('circle').attr('cx', x(last.year)).attr('cy', y(last.relativeMargin))
    .attr('r', 2.4).attr('fill', '#fff');
}

// ---- Ranked lists ----

function renderRankList(containerId, entries, valueLabelFn) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (!entries.length) {
    container.innerHTML = '<div class="tw-empty">No units meet this criteria for the selected window.</div>';
    return;
  }
  entries.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'tw-rank-row';
    row.style.borderLeftColor = CATEGORY_COLORS[entry.trend.category];

    const num = document.createElement('div');
    num.className = 'tw-rank-num';
    num.textContent = '#' + (i + 1);
    row.appendChild(num);

    const abbrLink = document.createElement('a');
    abbrLink.className = 'tw-rank-abbr';
    abbrLink.href = unitLink(entry.abbr);
    abbrLink.target = '_blank';
    abbrLink.rel = 'noopener noreferrer';
    abbrLink.textContent = displayAbbr(entry.abbr);
    row.appendChild(abbrLink);

    const sparkWrap = document.createElement('div');
    sparkWrap.className = 'tw-rank-spark';
    renderSparkline(d3.select(sparkWrap).append('svg'), entry.trend.windowed);
    row.appendChild(sparkWrap);

    const value = document.createElement('div');
    value.className = 'tw-rank-value';
    value.textContent = valueLabelFn(entry.trend);
    row.appendChild(value);

    container.appendChild(row);
  });
}

function topByCategory(trends, { sortKey, requirePositive, limit = 8 }) {
  const entries = Array.from(trends.entries())
    .map(([abbr, t]) => ({ abbr, trend: t }))
    .filter(e => requirePositive ? sortKey(e.trend) > 0 : sortKey(e.trend) < 0);
  entries.sort((a, b) => Math.abs(sortKey(b.trend)) - Math.abs(sortKey(a.trend)));
  return entries.slice(0, limit);
}

function topByEta(trends, kind, limit = 8) {
  const entries = Array.from(trends.entries())
    .map(([abbr, t]) => ({ abbr, trend: t }))
    .filter(e => e.trend.swingEta && e.trend.swingEta.kind === kind);
  entries.sort((a, b) => a.trend.swingEta.years - b.trend.swingEta.years);
  return entries.slice(0, limit);
}

function renderCategories(trends) {
  const trendingD = topByCategory(trends, { sortKey: t => t.directionPerDecade, requirePositive: true });
  const trendingR = topByCategory(trends, { sortKey: t => t.directionPerDecade, requirePositive: false });
  const emerging = topByCategory(trends, { sortKey: t => -t.competitivenessPerDecade, requirePositive: true });
  const solidifying = topByCategory(trends, { sortKey: t => -t.competitivenessPerDecade, requirePositive: false });
  const upcomingSwing = topByEta(trends, 'arriving');
  const fadingBattleground = topByEta(trends, 'leaving');

  renderRankList('list-trending-d', trendingD, t => directionLabel(t.directionPerDecade));
  renderRankList('list-trending-r', trendingR, t => directionLabel(t.directionPerDecade));
  renderRankList('list-emerging', emerging, t => competitivenessLabel(t.competitivenessPerDecade));
  renderRankList('list-solidifying', solidifying, t => competitivenessLabel(t.competitivenessPerDecade));
  renderRankList('list-upcoming-swing', upcomingSwing, t => swingEtaCompactLabel(t.swingEta));
  renderRankList('list-fading-battleground', fadingBattleground, t => swingEtaCompactLabel(t.swingEta));
}

// ---- Scatter plot ----

function renderScatterLegend() {
  const el = document.getElementById('scatter-legend');
  el.innerHTML = '';
  CATEGORY_ORDER.forEach(cat => {
    const span = document.createElement('span');
    span.className = 'tw-swatch';
    span.innerHTML = `<i style="background:${CATEGORY_COLORS[cat]}"></i>${CATEGORY_LABELS[cat]}`;
    el.appendChild(span);
  });
}

function renderScatter(trends) {
  const svg = d3.select('#scatter');
  svg.selectAll('*').remove();

  const W = 900, H = 620, margin = { top: 30, right: 30, bottom: 50, left: 30 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;

  const entries = Array.from(trends.entries()).map(([abbr, t]) => ({ abbr, t }));
  if (!entries.length) return;

  // Work in points/decade (not raw fraction) for readable axis scales, and use a
  // symlog scale: a handful of outlier states (e.g. Utah, West Virginia) would
  // otherwise stretch a linear axis so wide that the other ~50 states collapse
  // into an unreadable cluster at the center.
  entries.forEach(d => {
    d.xPts = d.t.directionPerDecade * 100;
    d.yPts = -d.t.competitivenessPerDecade * 100;
  });

  const xMax = Math.max(8, d3.max(entries, d => Math.abs(d.xPts)) * 1.08);
  const yMax = Math.max(8, d3.max(entries, d => Math.abs(d.yPts)) * 1.08);

  const x = d3.scaleSymlog().constant(2).domain([-xMax, xMax]).range([0, innerW]);
  const y = d3.scaleSymlog().constant(2).domain([-yMax, yMax]).range([innerH, 0]);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  g.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', innerH)
    .attr('stroke', '#333').attr('stroke-width', 1);
  g.append('line').attr('x1', 0).attr('x2', innerW).attr('y1', y(0)).attr('y2', y(0))
    .attr('stroke', '#333').attr('stroke-width', 1);

  g.append('text').attr('x', innerW).attr('y', y(0) + 22).attr('text-anchor', 'end')
    .attr('fill', '#6495ED').attr('font-size', 12).text('Trending Democratic →');
  g.append('text').attr('x', 0).attr('y', y(0) + 22).attr('text-anchor', 'start')
    .attr('fill', '#CD5C5C').attr('font-size', 12).text('← Trending Republican');
  g.append('text').attr('x', x(0) + 8).attr('y', 14).attr('text-anchor', 'start')
    .attr('fill', '#C3B1E1').attr('font-size', 12).text('↑ Emerging Battleground');
  g.append('text').attr('x', x(0) + 8).attr('y', innerH - 6).attr('text-anchor', 'start')
    .attr('fill', '#999').attr('font-size', 12).text('↓ Solidifying');

  const evRadius = d3.scaleSqrt().domain([1, 55]).range([5, 20]);
  const tooltip = document.getElementById('tw-tooltip');

  const nodes = g.selectAll('g.tw-dot').data(entries, d => d.abbr).join('g')
    .attr('class', 'tw-dot')
    .attr('transform', d => `translate(${x(d.xPts)},${y(d.yPts)})`)
    .style('cursor', 'pointer')
    .on('click', (evt, d) => window.open(unitLink(d.abbr), '_blank'))
    .on('mousemove', (evt, d) => {
      tooltip.style.display = 'block';
      tooltip.style.left = (evt.clientX + 14) + 'px';
      tooltip.style.top = (evt.clientY + 14) + 'px';
      tooltip.innerHTML = tooltipBodyHtml(d.abbr, d.t);
    })
    .on('mouseleave', () => { tooltip.style.display = 'none'; });

  nodes.append('circle')
    .attr('r', d => evRadius(d.t.electoralVotes || 3))
    .attr('fill', d => CATEGORY_COLORS[d.t.category])
    .attr('stroke', '#0b0b0b').attr('stroke-width', 1.2)
    .attr('fill-opacity', 0.88);

  nodes.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '0.32em')
    .attr('font-size', 9)
    .attr('font-weight', 700)
    .attr('fill', '#fff')
    .attr('paint-order', 'stroke')
    .attr('stroke', 'rgba(0,0,0,0.7)')
    .attr('stroke-width', 2)
    .text(d => displayAbbr(d.abbr));
}

// ---- Map ----

let mapBuilt = false;
let mapMode = 'direction';
let currentTrends = null;

function directionTrendToColor(perDecade) {
  const v = perDecade;
  if (v <= -6) return '#8B0000';
  if (v <= -3) return '#B22222';
  if (v <= -1) return '#CD5C5C';
  if (v < 0) return '#F08080';
  if (v === 0) return '#8aa7ba';
  if (v < 1) return '#87CEFA';
  if (v < 3) return '#6495ED';
  if (v < 6) return '#4169E1';
  return '#00008B';
}

function competitivenessTrendToColor(perDecade) {
  const v = perDecade;
  if (v <= -4) return '#C3B1E1';
  if (v <= -2) return '#a98fd1';
  if (v <= -0.5) return '#8f74bd';
  if (v < 0.5) return '#5b5b6b';
  if (v < 2) return '#4a4a52';
  if (v < 4) return '#383840';
  return '#252529';
}

// "Hotmap" of upcoming swing states: soon-arriving battlegrounds glow hot
// (red -> orange -> yellow), soon-departing battlegrounds glow cool blue,
// and everything else with no near-term swing-state event fades to gray.
function swingEtaToColor(eta) {
  if (!eta || eta.kind === 'none') return '#2a2a2a';
  if (eta.kind === 'staying') return '#C3B1E1';
  const years = eta.years;
  if (eta.kind === 'arriving') {
    if (years <= 10) return '#ff3b30';
    if (years <= 20) return '#ff9500';
    if (years <= 40) return '#e0b800';
    if (years <= 80) return '#6b7280';
    return '#3a3a3a';
  }
  // leaving
  if (years <= 10) return '#3b82f6';
  if (years <= 20) return '#60a5fa';
  if (years <= 40) return '#93c5fd';
  if (years <= 80) return '#6b7280';
  return '#3a3a3a';
}

function showMapUnitTip(evt, abbrOrUnit) {
  const tooltip = document.getElementById('mapTip');
  let key = abbrOrUnit;
  if (abbrOrUnit === 'ME') key = 'ME-AL';
  if (abbrOrUnit === 'NE') key = 'NE-AL';
  const t = currentTrends && currentTrends.get(key);
  tooltip.style.display = 'block';
  if (t) {
    tooltip.innerHTML = tooltipBodyHtml(key, t);
  } else {
    tooltip.innerHTML = `<strong>${abbrOrUnit}</strong><br>No data for this window.`;
  }
  positionMapTip(evt);
}

function positionMapTip(evt) {
  const tooltip = document.getElementById('mapTip');
  tooltip.style.position = 'fixed';
  tooltip.style.left = (evt.clientX + 14) + 'px';
  tooltip.style.top = (evt.clientY + 14) + 'px';
}

function hideMapTip() {
  document.getElementById('mapTip').style.display = 'none';
}

async function ensureMap() {
  if (mapBuilt) return;
  await window.ElectionMap.build({
    svgSelector: '#map',
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

function renderMapLegend(mode) {
  const el = document.getElementById('map-legend');
  if (mode === 'swing-eta') {
    el.innerHTML = '<span>Becoming a swing state soon</span>' +
      '<span class="bar" style="background:linear-gradient(90deg,#ff3b30,#ff9500,#e0b800,#2a2a2a,#93c5fd,#3b82f6)"></span>' +
      '<span>Leaving swing status soon</span>';
  } else if (mode === 'competitiveness') {
    el.innerHTML = '<span>Narrowing fastest</span>' +
      '<span class="bar" style="background:linear-gradient(90deg,#C3B1E1,#5b5b6b,#252529)"></span>' +
      '<span>Widening fastest</span>';
  } else {
    el.innerHTML = '<span>Trending Republican</span>' +
      '<span class="bar" style="background:linear-gradient(90deg,#8B0000,#F08080,#8aa7ba,#87CEFA,#00008B)"></span>' +
      '<span>Trending Democratic</span>';
  }
}

function applyMapColors(trends, mode) {
  let colorFn;
  if (mode === 'swing-eta') {
    colorFn = (t) => swingEtaToColor(t.swingEta);
  } else if (mode === 'competitiveness') {
    // directionPerDecade/competitivenessPerDecade are fractions (e.g. 0.03 = 3 pts/decade);
    // the color thresholds are written in points/decade, so convert here.
    colorFn = (t) => competitivenessTrendToColor(t.competitivenessPerDecade * 100);
  } else {
    colorFn = (t) => directionTrendToColor(t.directionPerDecade * 100);
  }

  for (const [abbr, t] of trends.entries()) {
    const color = colorFn(t);
    if (DISTRICT_UNITS.has(abbr)) {
      window.ElectionMap.setDistrictFill(abbr, color);
    } else {
      window.ElectionMap.setStateFill(mapFillKey(abbr), color);
    }
  }
  renderMapLegend(mode);
}

// ---- Wiring ----

let byUnitData = null;
let selectedWindow = DEFAULT_WINDOW;

function recomputeAndRender() {
  const trends = buildAllTrends(byUnitData, selectedWindow);
  currentTrends = trends;

  renderScatter(trends);
  renderScatterLegend();
  renderCategories(trends);
  applyMapColors(trends, mapMode);

  const windowedYears = Array.from(byUnitData.values())
    .flatMap(h => h.slice(-selectedWindow).map(d => d.year));
  const label = document.getElementById('window-range-label');
  if (label && windowedYears.length) {
    label.textContent = `Covers ${Math.min(...windowedYears)}–${Math.max(...windowedYears)}`;
  }
}

function initControls() {
  const select = document.getElementById('window-select');
  WINDOW_OPTIONS.forEach(n => {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = `Last ${n} elections`;
    if (n === DEFAULT_WINDOW) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => {
    selectedWindow = parseInt(select.value, 10);
    recomputeAndRender();
  });

  const toggle = document.getElementById('map-toggle');
  toggle.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      toggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mapMode = btn.dataset.mode;
      if (currentTrends) applyMapColors(currentTrends, mapMode);
    });
  });
}

async function init() {
  initControls();
  const [rows] = await Promise.all([loadRows(), ensureMap()]);
  byUnitData = groupByUnit(rows);
  recomputeAndRender();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

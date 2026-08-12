'use strict';

/**
 * Charts for the 2028 simulator prototype: the EV outcome histogram and the
 * polling trendlines with their narrowing uncertainty band.
 *
 * Plain d3 into inline SVG, sized to the container. Kept separate from
 * sim2028.js so the page wiring stays readable.
 */

const DEM = '#4169E1';
const REP = '#B22222';
const MUTED = '#8a8a8a';
const GRID = '#2a2a2a';

function fmtMargin(m) {
  if (!isFinite(m)) return '—';
  if (Math.abs(m) < 0.0005) return 'EVEN';
  return (m > 0 ? 'D+' : 'R+') + (Math.abs(m) * 100).toFixed(1);
}

/** Clear a container and return a fresh, responsive SVG of the given aspect. */
function freshSvg(container, height) {
  const el = typeof container === 'string' ? document.querySelector(container) : container;
  if (!el) return null;
  el.innerHTML = '';
  const width = Math.max(320, el.clientWidth || 640);
  const svg = d3.select(el).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('height', height);
  return { svg, width, height };
}

/**
 * EV outcome histogram. Bars left of 270 are red, right are blue, so the
 * majority threshold reads as the dividing line rather than an annotation.
 */
export function renderHistogram(container, forecast, opts = {}) {
  const made = freshSvg(container, opts.height || 220);
  if (!made || !forecast) return;
  const { svg, width, height } = made;
  const margin = { top: 12, right: 12, bottom: 34, left: 40 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const binSize = opts.binSize || 10;
  const totalEv = forecast.totalEv;
  const needed = forecast.needed;

  // Bin the raw EV counts.
  const bins = new Map();
  for (const [ev, count] of forecast.evCounts) {
    const b = Math.floor(ev / binSize) * binSize;
    bins.set(b, (bins.get(b) || 0) + count);
  }
  const data = Array.from(bins, ([ev, count]) => ({ ev, count })).sort((a, b) => a.ev - b.ev);
  if (!data.length) return;

  const x = d3.scaleLinear().domain([0, totalEv]).range([0, w]);
  const y = d3.scaleLinear().domain([0, d3.max(data, d => d.count)]).nice().range([h, 0]);

  g.append('g')
    .attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).tickValues([0, 135, 270, 405, totalEv]).tickFormat(d3.format('d')))
    .call(sel => sel.selectAll('text').attr('fill', MUTED))
    .call(sel => sel.selectAll('line,path').attr('stroke', GRID));

  g.append('g')
    .call(d3.axisLeft(y).ticks(4).tickFormat(d => (d / forecast.sims * 100).toFixed(0) + '%'))
    .call(sel => sel.selectAll('text').attr('fill', MUTED))
    .call(sel => sel.selectAll('line,path').attr('stroke', GRID));

  const barW = Math.max(1, x(binSize) - x(0) - 1);
  g.selectAll('rect.bar').data(data).join('rect')
    .attr('class', 'bar')
    .attr('x', d => x(d.ev))
    .attr('y', d => y(d.count))
    .attr('width', barW)
    .attr('height', d => h - y(d.count))
    .attr('fill', d => (d.ev + binSize > needed ? DEM : REP))
    .attr('opacity', 0.85);

  // 270 line.
  g.append('line')
    .attr('x1', x(needed)).attr('x2', x(needed))
    .attr('y1', -4).attr('y2', h)
    .attr('stroke', '#fff').attr('stroke-width', 1.5).attr('stroke-dasharray', '4 3');
  g.append('text')
    .attr('x', x(needed) + 5).attr('y', 8)
    .attr('fill', '#fff').attr('font-size', 11)
    .text(`${needed} to win`);

  svg.append('text')
    .attr('x', width / 2).attr('y', height - 4)
    .attr('text-anchor', 'middle').attr('fill', MUTED).attr('font-size', 11)
    .text('Democratic electoral votes');
}

/**
 * Trendlines across campaign steps, with an 80% band that narrows as the
 * campaign progresses — the visual point being that uncertainty shrinks but
 * never vanishes.
 *
 * @param {Array} series [{label, values:[{step, value, lo, hi}], color}]
 */
export function renderTrend(container, series, stepLabels, opts = {}) {
  const made = freshSvg(container, opts.height || 260);
  if (!made || !series || !series.length) return;
  const { svg, width, height } = made;
  const margin = { top: 14, right: 96, bottom: 30, left: 52 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const nSteps = stepLabels.length;
  const x = d3.scalePoint().domain(d3.range(nSteps)).range([0, w]);

  const all = [];
  for (const s of series) {
    for (const v of s.values) {
      all.push(v.value);
      if (v.lo != null) all.push(v.lo);
      if (v.hi != null) all.push(v.hi);
    }
  }
  const extent = d3.extent(all);
  const pad = Math.max(0.01, (extent[1] - extent[0]) * 0.12);
  const y = d3.scaleLinear().domain([extent[0] - pad, extent[1] + pad]).range([h, 0]);

  // zero line = tied
  g.append('line')
    .attr('x1', 0).attr('x2', w)
    .attr('y1', y(0)).attr('y2', y(0))
    .attr('stroke', MUTED).attr('stroke-width', 1).attr('stroke-dasharray', '3 3');

  g.append('g')
    .attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).tickFormat(i => stepLabels[i]))
    .call(sel => sel.selectAll('text').attr('fill', MUTED).attr('font-size', 10))
    .call(sel => sel.selectAll('line,path').attr('stroke', GRID));

  g.append('g')
    .call(d3.axisLeft(y).ticks(5).tickFormat(fmtMargin))
    .call(sel => sel.selectAll('text').attr('fill', MUTED).attr('font-size', 10))
    .call(sel => sel.selectAll('line,path').attr('stroke', GRID));

  const line = d3.line().x(d => x(d.step)).y(d => y(d.value)).curve(d3.curveMonotoneX);
  const area = d3.area().x(d => x(d.step)).y0(d => y(d.lo)).y1(d => y(d.hi)).curve(d3.curveMonotoneX);

  for (const s of series) {
    if (s.values.some(v => v.lo != null)) {
      g.append('path')
        .datum(s.values.filter(v => v.lo != null))
        .attr('fill', s.color).attr('opacity', 0.16)
        .attr('d', area);
    }
    g.append('path')
      .datum(s.values)
      .attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 2)
      .attr('d', line);
    g.selectAll(null).data(s.values).join('circle')
      .attr('cx', d => x(d.step)).attr('cy', d => y(d.value)).attr('r', 2.5)
      .attr('fill', s.color);

    const last = s.values[s.values.length - 1];
    g.append('text')
      .attr('x', x(last.step) + 6).attr('y', y(last.value) + 3)
      .attr('fill', s.color).attr('font-size', 11)
      .text(`${s.label} ${fmtMargin(last.value)}`);
  }
}

export default { renderHistogram, renderTrend };

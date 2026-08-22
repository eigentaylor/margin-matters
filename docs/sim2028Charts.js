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
 * Trendlines across campaign steps, with a 90% band that narrows as the
 * campaign progresses — the visual point being that uncertainty shrinks but
 * never vanishes.
 *
 * @param {Array} series [{label, key, values:[{step, value, lo, hi}], color}]
 *        `key` (falls back to `label`) tags every drawn element for that series
 *        with data-unit="<key>", so external code can select/dim/glow a single
 *        series after the fact — see sim2028.js's trend-legend isolate feature.
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
    const key = s.key || s.label;
    if (s.values.some(v => v.lo != null)) {
      g.append('path')
        .datum(s.values.filter(v => v.lo != null))
        .attr('data-unit', key).attr('class', 's28-trend-band')
        .attr('fill', s.color).attr('opacity', 0.16)
        .attr('d', area);
    }
    g.append('path')
      .datum(s.values)
      .attr('data-unit', key).attr('class', 's28-trend-line')
      .attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 2)
      .attr('d', line);
    g.selectAll(null).data(s.values).join('circle')
      .attr('data-unit', key).attr('class', 's28-trend-dot')
      .attr('cx', d => x(d.step)).attr('cy', d => y(d.value)).attr('r', 2.5)
      .attr('fill', s.color);

    const last = s.values[s.values.length - 1];
    g.append('text')
      .attr('data-unit', key).attr('class', 's28-trend-label')
      .attr('x', x(last.step) + 6).attr('y', y(last.value) + 3)
      .attr('fill', s.color).attr('font-size', 11)
      .text(`${s.label} ${fmtMargin(last.value)}`);
  }
}

/**
 * Electoral "snake": a single continuous ribbon of states ordered by margin
 * (safest-Republican to safest-Democratic), cut into equal-width rows and
 * wrapped boustrophedon-style (alternating direction each row) so it reads
 * top-to-bottom like a snake instead of one very wide strip. Because the cut
 * points are fixed positions rather than state boundaries, a state whose
 * span crosses a row break is rendered as two rects sharing one data-unit,
 * joined by a same-color corner block as thick as the ribbon itself.
 *
 * Tiny 1-2 EV units (ME/NE congressional districts, the ME-AL/NE-AL
 * at-large pairs) are laid out at a padded minimum width (`opts.minEv`) so
 * they have room to hold an abbreviation — a rendering-only inflation; the
 * real EV total and the 270 threshold's position are computed from true EV.
 *
 * @param {Array} rows [{unit, name, ev, margin, color}], pre-sorted ascending
 *        by margin (safest-R first)
 * @returns {{tippingUnit:string, needed:number, totalEv:number}|null}
 */
export function renderSnake(container, rows, opts = {}) {
  if (!rows || !rows.length) return null;
  const totalEv = rows.reduce((a, r) => a + r.ev, 0);
  if (!totalEv) return null;

  const minLayoutEv = opts.minEv || 5;
  const layoutEv = r => Math.max(r.ev, minLayoutEv);
  const layoutTotal = rows.reduce((a, r) => a + layoutEv(r), 0);

  const numRows = opts.rows || Math.max(1, Math.round(layoutTotal / 90));
  const rowCapacity = layoutTotal / numRows;
  const rowHeight = opts.rowHeight || 34;
  const rowGap = opts.rowGap || 8;
  const margin = { top: 4, right: 4, bottom: 4, left: 4 };
  const height = margin.top + margin.bottom + numRows * rowHeight + (numRows - 1) * rowGap;

  const made = freshSvg(container, height);
  if (!made) return null;
  const { svg, width } = made;
  const w = width - margin.left - margin.right;
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const needed = Math.floor(totalEv / 2) + 1;
  const boundaryTrueEv = totalEv - needed;

  const rowX = (r, local) => {
    const scale = d3.scaleLinear().domain([0, rowCapacity]).range(r % 2 === 0 ? [0, w] : [w, 0]);
    return scale(local);
  };
  const rowY = r => r * (rowHeight + rowGap);

  // Slice each unit's LAYOUT span against every row's layout range, emitting
  // one fragment per nonzero overlap (almost always one, occasionally two).
  // The 270 threshold is tracked separately in true-EV space, then mapped
  // proportionally into whichever unit's (possibly padded) layout span it
  // falls inside, so padding a tiny district never moves the real threshold.
  let cursorLayout = 0, cursorTrue = 0;
  let tippingUnit = null, boundaryLayoutPos = null;
  const segs = [];
  for (const row of rows) {
    const lev = layoutEv(row);
    const layoutStart = cursorLayout, layoutEnd = cursorLayout + lev;
    const trueStart = cursorTrue, trueEnd = cursorTrue + row.ev;
    if (tippingUnit == null && boundaryTrueEv < trueEnd) {
      tippingUnit = row.unit;
      const frac = row.ev > 0 ? (boundaryTrueEv - trueStart) / row.ev : 0;
      boundaryLayoutPos = layoutStart + frac * lev;
    }
    for (let r = 0; r < numRows; r++) {
      const rowStart = r * rowCapacity;
      const rowEnd = r === numRows - 1 ? layoutTotal : (r + 1) * rowCapacity;
      const oStart = Math.max(layoutStart, rowStart);
      const oEnd = Math.min(layoutEnd, rowEnd);
      if (oEnd > oStart) {
        segs.push({
          unit: row.unit, color: row.color,
          r, localStart: oStart - rowStart, localEnd: oEnd - rowStart,
        });
      }
    }
    cursorLayout = layoutEnd;
    cursorTrue = trueEnd;
  }
  if (boundaryLayoutPos == null) boundaryLayoutPos = layoutTotal; // shouldn't happen, but keep the line on-chart

  // Group a split state's fragments so it's labeled once (on its widest
  // fragment) and joined across the row gap it straddles, instead of
  // reading as two unrelated blocks.
  const byUnit = new Map();
  for (const s of segs) {
    if (!byUnit.has(s.unit)) byUnit.set(s.unit, []);
    byUnit.get(s.unit).push(s);
  }
  const connectors = [];
  for (const frags of byUnit.values()) {
    let best = frags[0];
    for (const f of frags) {
      if ((f.localEnd - f.localStart) > (best.localEnd - best.localStart)) best = f;
    }
    best.labelHere = true;
    if (frags.length > 1) {
      frags.sort((a, b) => a.r - b.r);
      for (let i = 0; i < frags.length - 1; i++) {
        const a = frags[i], b = frags[i + 1];
        if (b.r !== a.r + 1) continue; // rows should always be consecutive; guard anyway
        // Same edge both fragments share, by construction of the alternating
        // row scales above. Width matches rowHeight (the ribbon's own
        // thickness) rather than a thin decorative strip, so the corner reads
        // as a continuous, equally-thick turn instead of a disconnected notch.
        const x = a.r % 2 === 0 ? w - rowHeight : 0;
        connectors.push({ unit: a.unit, color: a.color, x, y: rowY(a.r) + rowHeight, height: rowGap });
      }
    }
  }

  // Connectors drawn first so segment strokes still read on top of them.
  // Extended half a pixel into each row so no antialiasing seam shows at the
  // join, and tagged data-unit so hover on either fragment can also light up
  // the joint, reinforcing that the pieces are one state.
  g.selectAll('rect.s28-snake-connector').data(connectors).join('rect')
    .attr('class', 's28-snake-connector')
    .attr('data-unit', d => d.unit)
    .attr('x', d => d.x).attr('y', d => d.y - 0.5)
    .attr('width', rowHeight).attr('height', d => d.height + 1)
    .attr('fill', d => d.color)
    .style('pointer-events', 'none');

  const segG = g.selectAll('g.s28-snake-frag').data(segs).join('g').attr('class', 's28-snake-frag');
  segG.each(function (d) {
    const x1 = rowX(d.r, d.localStart), x2 = rowX(d.r, d.localEnd);
    const x = Math.min(x1, x2), segW = Math.max(0, Math.abs(x2 - x1));
    const y = rowY(d.r);
    const cell = d3.select(this);
    cell.append('rect')
      .attr('data-unit', d.unit).attr('class', 's28-snake-seg')
      .attr('x', x).attr('y', y).attr('width', segW).attr('height', rowHeight)
      .attr('fill', d.color)
      .attr('stroke', '#111').attr('stroke-width', 1.25);
    if (d.labelHere && segW >= 20) {
      cell.append('text')
        .attr('x', x + segW / 2).attr('y', y + rowHeight / 2 + 4)
        .attr('text-anchor', 'middle').attr('font-size', 11).attr('font-weight', 600)
        .attr('fill', '#fff').attr('stroke', '#000').attr('stroke-width', 3)
        .attr('paint-order', 'stroke').style('pointer-events', 'none')
        .text(d.unit);
    }
  });

  // 270 threshold line, drawn in whichever row the boundary position falls.
  const bRow = Math.min(numRows - 1, Math.floor(boundaryLayoutPos / rowCapacity));
  const bLocal = boundaryLayoutPos - bRow * rowCapacity;
  const bx = rowX(bRow, bLocal);
  const by = rowY(bRow);
  g.append('line')
    .attr('x1', bx).attr('x2', bx)
    .attr('y1', by - 2).attr('y2', by + rowHeight + 2)
    .attr('stroke', '#fff').attr('stroke-width', 1.5).attr('stroke-dasharray', '4 3');

  return { tippingUnit, needed, totalEv };
}

export default { renderHistogram, renderTrend, renderSnake };

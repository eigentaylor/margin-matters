/*
Interactive Explorer for state-trends
- Loads docs/presidential_margins.csv (already published for the site)
- Lets user choose state + measure family and renders an animated chart
- Keeps to plain D3 for portability (no bundler)
*/

(function(){
  const csvPath = './presidential_margins.csv';
  const el = {
    state: document.getElementById('stateSel'),
    // replace measure dropdown with metric + flags
    metric: document.getElementById('metricSel'),
    chart: document.getElementById('chartSel'),
    rel: document.getElementById('relativeChk'),
    delta: document.getElementById('deltaChk'),
    twoP: document.getElementById('twoPartyChk'),
    nat: document.getElementById('natOverlay'),
    points: document.getElementById('pointsToggle'),
    notes: document.getElementById('notes'),
    root: document.getElementById('chart'),
    tip: document.getElementById('tooltip')
  };

  // Ranker-like flags model: build column names dynamically from metric+flags
  // available columns base:
  // - margin: pres_margin | national_margin
  // - relative: relative_margin
  // - delta: pres_margin_delta | national_margin_delta
  // - twoParty: two_party_margin | two_party_national_margin
  // - thirdParty: third_party_share | third_party_national_share
  // - thirdParty relative: third_party_relative_share
  const METRIC = {
    MARGIN: 'margin',
    THIRD: 'thirdParty'
  };

  // Colors consistent with existing images
  const color = {
    state: '#4ade80', // outline/line
    stateFillPos: 'deepskyblue',
    stateFillNeg: 'red',
    stateSpecial: 'yellow',
  nat: '#f472b6',
  natFillPos: '#80d4ff', // lighter blue for national positive
  natFillNeg: '#ff8b8b', // lighter red for national negative
    axis: '#888'
  };

  const SPECIAL_1968 = new Set(['GA','AL','LA','MS','AR']);

  const margin = {top: 24, right: 24, bottom: 40, left: 56};
  let width = 1100, height = 520;

  const svg = d3.select(el.root)
    .append('svg')
    .attr('width', '100%')
    .attr('height', height)
    .style('display','block');

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const xAxisG = g.append('g').attr('class','x-axis');
  const yAxisG = g.append('g').attr('class','y-axis');
  const zeroLineG = g.append('g').attr('class','zero');
  const seriesG = g.append('g');
  const natG = g.append('g');

  const x = d3.scaleBand().padding(0.2);
  const xLine = d3.scalePoint();
  const y = d3.scaleLinear();

  const line = d3.line()
    .x(d => xLine(d.year))
    .y(d => y(d.value))
    .curve(d3.curveMonotoneX);

  const tip = d3.select(el.tip);

  function leanFmt(v){
    if (v == null || isNaN(v)) return '';
    const sign = v > 0 ? 'D' : v < 0 ? 'R' : '';
    const pct = Math.abs(v*100).toFixed(1) + '%';
    return sign ? `${sign}+${pct}` : `EVEN`;
  }
  function percentFmt(v){
    if (v == null || isNaN(v)) return '';
    return (v*100).toFixed(1)+ '%';
  }
  function percentFmtSigned(v){
    if (v == null || isNaN(v)) return '';
    const s = v>0?'+':''; return s + (v*100).toFixed(1)+ '%';
  }

  function fmtForCurrent(metric, rel, delta, twoP){
    if (metric === METRIC.THIRD) return rel ? percentFmtSigned : percentFmt;
    return leanFmt;
  }

  function buildMeasure(meta){
    const {metric, rel, delta, twoP} = meta;
    // Determine kind and column names
    const isThird = metric === METRIC.THIRD;
    const kindDefault = (delta || rel) ? 'bar' : (isThird ? 'line' : 'line');
    const kind = (el.chart.value === 'auto') ? kindDefault : el.chart.value;

    // Columns (state and nat where applicable)
    let yCol = null, yNatCol = null, desc = '';

    if (isThird) {
      if (delta) {
        // No explicit third-party deltas in CSV; approximate via year-over-year diff? For now, fall back to normal share
        yCol = rel ? 'third_party_relative_share' : 'third_party_share';
        yNatCol = rel ? null : 'third_party_national_share';
        desc = rel ? 'State third-party share minus national.' : 'Third-party share (no delta column in CSV).';
      } else if (rel) {
        yCol = 'third_party_relative_share';
        yNatCol = null;
        desc = 'State third-party share minus national.';
      } else {
        yCol = 'third_party_share';
        yNatCol = 'third_party_national_share';
        desc = 'Share of all votes for third-party candidates.';
      }
    } else {
      // Margin family
      const base = twoP ? 'two_party_margin' : 'pres_margin';
      const baseNat = twoP ? 'two_party_national_margin' : 'national_margin';
      if (delta && !rel) {
        yCol = base + '_delta';
        yNatCol = baseNat + '_delta';
        desc = 'Cycle-over-cycle change (0 for first year).';
      } else if (rel && !delta) {
        yCol = twoP ? 'two_party_relative_margin' : 'relative_margin';
        yNatCol = null;
        desc = 'State minus national.';
      } else if (rel && delta) {
        yCol = twoP ? 'two_party_relative_margin_delta' : 'relative_margin_delta';
        yNatCol = null;
        desc = 'Cycle-over-cycle change in state minus national.';
      } else {
        yCol = base;
        yNatCol = baseNat;
        desc = twoP ? 'Two-party margin (excludes third-party votes).' : 'Dem minus Rep vote share.';
      }
    }

    return { kind, yCol, yNatCol, desc };
  }

  function initControls(states){
    const stateOpts = ['NATIONAL', ...states.filter(s=>s!=='NATIONAL').sort()];
    el.state.innerHTML = stateOpts.map(s=>`<option value="${s}">${s}</option>`).join('');

    // Defaults
    el.state.value = 'AK';
    el.metric.value = METRIC.MARGIN;
    el.nat.checked = true;

    // Load from URL if present
    readFromUrl();

    [el.state, el.metric, el.chart, el.rel, el.delta, el.twoP, el.nat, el.points].forEach(inp =>
      inp.addEventListener('change', ()=>{ writeToUrl(); render(); }));

    window.addEventListener('resize', resize);
  }

  function getStateParams(){
    return {
      state: el.state.value,
      metric: el.metric.value,
      chart: el.chart.value,
      rel: el.rel.checked,
      delta: el.delta.checked,
      twoP: el.twoP.checked,
      nat: el.nat.checked,
      points: el.points.checked,
    };
  }

  function writeToUrl(){
    const p = getStateParams();
    const q = new URLSearchParams();
    q.set('s', p.state);
    q.set('m', p.metric);
    if (p.chart !== 'auto') q.set('c', p.chart);
    if (p.rel) q.set('rel', '1');
    if (p.delta) q.set('d', '1');
    if (p.twoP) q.set('tp', '1');
    if (p.nat) q.set('nat', '1');
    if (p.points) q.set('pts', '1');
    const url = `${location.pathname}?${q.toString()}`;
    history.replaceState(null, '', url);
  }

  function readFromUrl(){
    const q = new URLSearchParams(location.search);
    if (q.get('s')) el.state.value = q.get('s');
    if (q.get('m')) el.metric.value = q.get('m');
    if (q.get('c')) el.chart.value = q.get('c');
    el.rel.checked = q.has('rel');
    el.delta.checked = q.has('d');
    el.twoP.checked = q.has('tp');
    el.nat.checked = q.has('nat');
    el.points.checked = q.has('pts') ? true : el.points.checked;
  }

  function resize(){
    const rect = el.root.getBoundingClientRect();
    width = rect.width || 1100;
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    x.range([0, innerW]);
    xLine.range([0, innerW]);
    y.range([innerH, 0]);
    render();
  }

  function pickChartKind(kindDefault){
    return (el.chart.value === 'auto') ? kindDefault : el.chart.value;
  }

  function withNotes(desc){
    el.notes.textContent = desc + (el.nat.checked ? ' (Nat overlay if available).' : '');
  }

  function colorForBar(d, stateAbbr, meta, rowLookup){
    // Special 1968 yellow for Wallace states in 1968
    if (d.year === 1968 && SPECIAL_1968.has(stateAbbr)) return color.stateSpecial;
    // For relative (non-delta) we color by winner (pres_margin sign), not relative sign
    if (!meta.delta && meta.rel && meta.metric === METRIC.MARGIN) {
      const row = rowLookup.get(d.year);
      const sgn = row && typeof row.pres_margin === 'number' ? row.pres_margin : d.value; // fallback
      return sgn >= 0 ? color.stateFillPos : color.stateFillNeg;
    }
    // Otherwise color by value sign
    return d.value >= 0 ? color.stateFillPos : color.stateFillNeg;
  }

  function render(){
    if (!window.__data) return;
    const all = window.__data;
    const p = getStateParams();
    const meta = { metric: p.metric, rel: p.rel, delta: p.delta, twoP: p.twoP };
    const { kind: kindDefault, yCol, yNatCol, desc } = buildMeasure(meta);
    const kind = pickChartKind(kindDefault);
    const fmt = fmtForCurrent(p.metric, p.rel, p.delta, p.twoP);
    withNotes(desc);

    // Prepare rows
    const rows = all.filter(r => r.abbr === p.state);
    const natRows = all.filter(r => r.abbr === 'NATIONAL');
    const parseNum = v => v===''||v==null? null: +v;
    const data = rows.map(r => ({year:+r.year, value: parseNum(r[yCol])})).filter(d=>d.value!=null);
    const nat = (p.nat && yNatCol) ? natRows.map(r => ({year:+r.year, value: parseNum(r[yNatCol])})).filter(d=>d.value!=null) : [];

    // Lookup by year for color rules
    const rowLookup = new Map(rows.map(r => [+r.year, r]));

    // Sort by year
    data.sort((a,b)=>a.year-b.year);
    nat.sort((a,b)=>a.year-b.year);

    // Update scales
    const years = data.map(d=>d.year);
    const innerW = (el.root.getBoundingClientRect().width||1100) - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

  x.domain(years).range([0, innerW]);
  // Align point/tick scale so ticks land at the center of each band
  const band = x.bandwidth();
  const tickStart = years.length ? (x(years[0]) + band / 2) : 0;
  const tickEnd = years.length ? (x(years[years.length - 1]) + band / 2) : innerW;
  xLine.domain(years).range([tickStart, tickEnd]);

    const yMin = d3.min(data, d=>d.value);
    const yMax = d3.max(data, d=>d.value);
    let pad = (yMax - yMin) || 0.1;
    pad *= 0.15;
    y.domain([yMin - pad, yMax + pad]).nice().range([innerH, 0]);

    // Axes
    const xA = d3.axisBottom(xLine).tickValues(years).tickFormat(d3.format('d'));
    const yA = d3.axisLeft(y).ticks(8).tickFormat(fmt);

    xAxisG.attr('transform', `translate(0,${innerH})`).call(xA);
    yAxisG.call(yA);

    // 0-line dashed
    zeroLineG.selectAll('*').remove();
    zeroLineG.append('line')
      .attr('x1', 0).attr('x2', innerW)
      .attr('y1', y(0)).attr('y2', y(0))
      .attr('stroke', color.axis)
      .attr('stroke-dasharray', '5 5')
      .attr('stroke-width', 1);

    seriesG.selectAll('*').remove();
    natG.selectAll('*').remove();

    if (kind === 'line') {
      // State line
      seriesG.append('path')
        .datum(data)
        .attr('fill','none')
        .attr('stroke', color.state)
        .attr('stroke-width', 2)
        .attr('d', line);

      if (el.points.checked) {
        seriesG.selectAll('circle.state')
          .data(data)
          .join('circle')
          .attr('class','state')
          .attr('r', 4)
          .attr('cx', d=>xLine(d.year))
          .attr('cy', d=>y(d.value))
          .attr('fill', d => (d.year===1968 && SPECIAL_1968.has(p.state)) ? color.stateSpecial : (d.value >= 0 ? color.stateFillPos : color.stateFillNeg))
          .on('mouseenter', (evt,d)=>showTip(evt, `${d.year}: ${fmt(d.value)}`))
          .on('mouseleave', hideTip);
      }

      // National overlay
      if (p.nat && yNatCol && nat.length){
        natG.append('path')
          .datum(nat)
          .attr('fill','none')
          .attr('stroke', color.nat)
          .attr('stroke-dasharray', '5 5')
          .attr('stroke-width', 2)
          .attr('d', line);

        if (el.points.checked) {
          natG.selectAll('circle.nat')
            .data(nat)
            .join('circle')
            .attr('class','nat')
            .attr('r', 3.5)
            .attr('cx', d=>xLine(d.year))
            .attr('cy', d=>y(d.value))
            .attr('fill', d => meta.delta ? (d.value >= 0 ? color.natFillPos : color.natFillNeg) : color.nat)
            .on('mouseenter', (evt,d)=>showTip(evt, `Nat ${d.year}: ${fmt(d.value)}`))
            .on('mouseleave', hideTip);
        }
      }
    } else {
      // Bar chart
      // Compute widths and positions using the band so bars align precisely
      const bandWidth = x.bandwidth();
      const gap = 4; // gap between state and nat bars when both present
      const stateW = Math.max(6, Math.min(28, bandWidth * 0.6));
      const natW = Math.max(6, Math.min(20, bandWidth * 0.35));

  // If nat not present, center the state bar in the band. If nat present,
  // center the state bar and draw a narrower national bar on top that
  // slightly overlaps the state bar (nat drawn last so it appears above).
  const centerStateX = d => x(d.year) + (bandWidth - stateW) / 2;
  const centerNatX = d => x(d.year) + (bandWidth - natW) / 2;
  // overlap shift moves the nat bar toward the state bar center so they overlap
  // Small fixed overlap to match prior subtle overlap behaviour
  const overlapShift = -10;
  const stateX = d => !(p.nat && yNatCol && nat.length) ? centerStateX(d) : centerStateX(d);
  const natX = d => centerNatX(d) - overlapShift;

      seriesG.selectAll('rect.state')
        .data(data)
        .join('rect')
        .attr('class','state')
        .attr('x', d=> stateX(d))
        .attr('width', stateW)
        .attr('y', d=>Math.min(y(0), y(d.value)))
        .attr('height', d=>Math.abs(y(d.value) - y(0)))
        .attr('fill', d=> colorForBar(d, p.state, meta, rowLookup))
        .on('mouseenter', (evt,d)=>showTip(evt, `${d.year}: ${fmt(d.value)}`))
        .on('mouseleave', hideTip);

      if (p.nat && yNatCol && nat.length){
        natG.selectAll('rect.nat')
          .data(nat)
          .join('rect')
          .attr('class','nat')
          .attr('x', d=> natX(d))
          .attr('width', natW)
          .attr('y', d=>Math.min(y(0), y(d.value)))
          .attr('height', d=>Math.abs(y(d.value) - y(0)))
          .attr('fill', d=> {
            // For national delta bars, color by sign but in lighter nat shades
            if (meta.delta) return d.value >= 0 ? color.natFillPos : color.natFillNeg;
            return color.nat;
          })
          .attr('opacity', 0.9)
          .on('mouseenter', (evt,d)=>showTip(evt, `Nat ${d.year}: ${fmt(d.value)}`))
          .on('mouseleave', hideTip);
      }
    }
  }

  function showTip(evt, html){
    tip.style('opacity', 1).style('transform','translateY(0)')
       .html(html)
       .style('left', (evt.clientX + 12) + 'px')
       .style('top', (evt.clientY + 12) + 'px');
  }
  function hideTip(){
    tip.style('opacity', 0).style('transform','translateY(-6px)');
  }

  // Load data
  d3.csv(csvPath, d3.autoType).then(rows => {
    window.__data = rows;
    const states = Array.from(new Set(rows.map(r=>r.abbr)));
    initControls(states);
    resize();
    render();
  }).catch(err => {
    el.notes.textContent = 'Failed to load CSV: ' + err;
    console.error(err);
  });
})();

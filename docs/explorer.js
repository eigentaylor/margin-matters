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
  preset3: document.getElementById('preset3'),
  preset4: document.getElementById('preset4'),
    nat: document.getElementById('natOverlay'),
    points: document.getElementById('pointsToggle'),
    notes: document.getElementById('notes'),
    root: document.getElementById('chart'),
    tip: document.getElementById('tooltip'),
    addStateBtn: document.getElementById('addStateBtn'),
    stateChips: document.getElementById('stateChips'),
    preset1: document.getElementById('preset1'),
    preset2: document.getElementById('preset2'),
    startYear: document.getElementById('startYear'),
    endYear: document.getElementById('endYear')
  };

  // User-selected states for multi-compare. Starts with the select's value.
  let selectedStates = [];

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
  const legendG = svg.append('g').attr('class','legend-svg').attr('transform', `translate(${margin.left},8)`);
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

  function leanFmt(v, rel, delta){
    if (v == null || isNaN(v)) return '';
    const sign = v > 0 ? 'D' : v < 0 ? 'R' : '';
    const pct = Math.abs(v*100).toFixed(1) + '%';
    if (sign) return `${sign}+${pct}`;
    // when relative mode is on, show NAT for exact zero, otherwise EVEN
    if (rel && delta) return 'NAT Δ';
    return rel ? 'NAT' : 'EVEN';
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
    // return a wrapper that calls leanFmt with rel context
    return v => leanFmt(v, rel, delta);
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
        desc = 'Change in margins (0 for first year).';
      } else if (rel && !delta) {
        yCol = twoP ? 'two_party_relative_margin' : 'relative_margin';
        yNatCol = null;
        desc = 'State minus national.';
      } else if (rel && delta) {
        yCol = twoP ? 'two_party_relative_margin_delta' : 'relative_margin_delta';
        yNatCol = null;
        desc = 'Change in state margin minus change in national margin.';
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

    // Start/end year defaults derived from data extents (filled later when data loaded)
    el.addStateBtn.addEventListener('click', ()=>{ addState(el.state.value); });
    el.preset1.addEventListener('click', ()=>{ setPreset(['WI','MI','PA']); });
    el.preset2.addEventListener('click', ()=>{ setPreset(['AZ','NV','NC','GA','WI','MI','PA']); });
    if (el.preset3) {
      el.preset3.addEventListener('click', () => {
        // Maine: aggregate + congressional districts
        setPreset(['ME-AL', 'ME-01', 'ME-02']);
      });
    }
    if (el.preset4) {
      el.preset4.addEventListener('click', () => {
        // Nebraska: aggregate + congressional districts
        setPreset(['NE-AL', 'NE-01', 'NE-02', 'NE-03']);
      });
    }
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.addEventListener('click', resetAll);

    // year change handlers
    el.startYear.addEventListener('change', ()=>{ writeToUrl(); render(); });
    el.endYear.addEventListener('change', ()=>{ writeToUrl(); render(); });
  }

  function resetAll(){
    // Clear multi-state selections and reset controls to sensible defaults
    selectedStates = [];
    renderStateChips();
    el.state.value = 'AK';
    el.metric.value = METRIC.MARGIN;
    el.chart.value = 'auto';
    el.rel.checked = false;
    el.delta.checked = false;
    el.twoP.checked = false;
    el.nat.checked = true;
    el.points.checked = true;
    el.startYear.value = '';
    el.endYear.value = '';
    writeToUrl();
    render();
  }

  function setPreset(list){
    selectedStates = Array.from(new Set(list));
    renderStateChips();
    // force line plot for multi-state
    if (selectedStates.length > 1) el.chart.value = 'line';
    writeToUrl(); render();
  }

  function addState(s){
    if (!s) return;
    if (!selectedStates.includes(s)) selectedStates.push(s);
    renderStateChips();
    if (selectedStates.length > 1) el.chart.value = 'line';
    writeToUrl(); render();
  }

  function removeState(s){
    selectedStates = selectedStates.filter(x=>x!==s);
    renderStateChips();
    writeToUrl(); render();
  }

  function renderStateChips(){
    el.stateChips.innerHTML = '';
    selectedStates.forEach(s =>{
      const chip = document.createElement('div');
      chip.style.display = 'inline-flex';
      chip.style.padding = '6px 8px';
      chip.style.background = '#111';
      chip.style.border = '1px solid #2a2a2a';
      chip.style.borderRadius = '999px';
      chip.style.color = 'var(--muted)';
      chip.style.gap = '8px';
      chip.innerHTML = `${s} <button data-abbr="${s}" style="margin-left:8px">✕</button>`;
      chip.querySelector('button').addEventListener('click', ()=> removeState(s));
      el.stateChips.appendChild(chip);
    });
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
    if (selectedStates.length) q.set('multi', selectedStates.join(','));
    if (p.chart !== 'auto') q.set('c', p.chart);
    if (p.rel) q.set('rel', '1');
    if (p.delta) q.set('d', '1');
    if (p.twoP) q.set('tp', '1');
    if (p.nat) q.set('nat', '1');
    if (p.points) q.set('pts', '1');
    if (el.startYear.value) q.set('start', el.startYear.value);
    if (el.endYear.value) q.set('end', el.endYear.value);
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
    if (q.get('multi')){
      selectedStates = q.get('multi').split(',').filter(Boolean);
      renderStateChips();
      if (selectedStates.length > 1) el.chart.value = 'line';
    }
    if (q.get('start')) el.startYear.value = q.get('start');
    if (q.get('end')) el.endYear.value = q.get('end');
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
    el.notes.textContent = desc + (el.nat.checked && !el.rel.checked ? ' (Nat overlay if available).' : '');
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
    // If user selected multiple states, plot them in a compare mode
    const statesToPlot = selectedStates.length ? selectedStates : [p.state];
    const rows = all.filter(r => r.abbr === statesToPlot[0]);
    const natRows = all.filter(r => r.abbr === 'NATIONAL');
    const parseNum = v => v===''||v==null? null: +v;
    const data = rows.map(r => ({year:+r.year, value: parseNum(r[yCol])})).filter(d=>d.value!=null);
    const nat = (p.nat && yNatCol) ? natRows.map(r => ({year:+r.year, value: parseNum(r[yNatCol])})).filter(d=>d.value!=null) : [];

    // Lookup by year for color rules
    const rowLookup = new Map(rows.map(r => [+r.year, r]));

    // Sort by year
    data.sort((a,b)=>a.year-b.year);
    nat.sort((a,b)=>a.year-b.year);

    // Year range handling - compute start/end bounds before filtering
    const minYear = d3.min(all, d=>+d.year);
    const maxYear = d3.max(all, d=>+d.year);
    let start = el.startYear.value ? +el.startYear.value : minYear;
    let end = el.endYear.value ? +el.endYear.value : maxYear;
    // If delta is enabled, omit the first available year (advance one 4-year cycle)
    if (p.delta) start = Math.max(start, minYear + 4);

    // Build per-state filtered data for multi-state mode
    let dataByState = {};
    statesToPlot.forEach(s => {
      const rowsS = all.filter(r => r.abbr === s);
      const dS = rowsS.map(r => ({year:+r.year, value: parseNum(r[yCol])})).filter(d=>d.value!=null && d.year >= start && d.year <= end);
      dS.sort((a,b)=>a.year-b.year);
      dataByState[s] = dS;
    });
    const years = Array.from(new Set([].concat(...Object.values(dataByState).map(arr => arr.map(d=>d.year))))).sort((a,b)=>a-b);
    const innerW = (el.root.getBoundingClientRect().width||1100) - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

  x.domain(years).range([0, innerW]);
  // Align point/tick scale so ticks land at the center of each band
  const band = x.bandwidth();
  const tickStart = years.length ? (x(years[0]) + band / 2) : 0;
  const tickEnd = years.length ? (x(years[years.length - 1]) + band / 2) : innerW;
  xLine.domain(years).range([tickStart, tickEnd]);

  // compute filtered series for single and multi-state rendering
  const dataFiltered = data.filter(d => d.year >= start && d.year <= end);
  const natFiltered = nat.filter(d => d.year >= start && d.year <= end);

  // Determine y domain from all visible series: all states being compared and national overlay
  let visibleValues = [];
  // include per-state values
  Object.values(dataByState).forEach(arr => arr.forEach(d => visibleValues.push(d.value)));
  // include national values if present
  if (p.nat && yNatCol) natFiltered.forEach(d => visibleValues.push(d.value));
  // fallback if nothing visible (avoid undefined domain)
  if (!visibleValues.length) {
    visibleValues = dataFiltered.length ? dataFiltered.map(d=>d.value) : (natFiltered.length ? natFiltered.map(d=>d.value) : [0]);
  }
  const yMin = d3.min(visibleValues);
  const yMax = d3.max(visibleValues);
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

    // If multiple states, force line plot and draw each state's line with its own color
    if (statesToPlot.length > 1) {
      const palette = d3.schemeTableau10;
      // render legend for multiple states
      legendG.selectAll('*').remove();
      const legendItems = statesToPlot.slice();
      if (p.nat && yNatCol) legendItems.push('NATIONAL');
      const itemW = 120;
      legendG.attr('transform', `translate(${margin.left},8)`);
      legendG.selectAll('g.leg').data(legendItems).join('g').attr('class','leg').each(function(d,i){
        const gx = d3.select(this);
        gx.attr('transform', `translate(${i*itemW},0)`);
        gx.selectAll('*').remove();
        gx.append('rect').attr('width',14).attr('height',10).attr('rx',2).attr('fill', d === 'NATIONAL' ? color.nat : d3.schemeTableau10[i % d3.schemeTableau10.length]);
        gx.append('text').attr('x',18).attr('y',9).attr('fill', color.axis).attr('font-size',11).text(d);
      });
      statesToPlot.forEach((s, idx) => {
        const sd = dataByState[s];
        // per-state lookup to determine winners for coloring points
        const rowsS = all.filter(r => r.abbr === s);
        const rowLookupS = new Map(rowsS.map(r => [+r.year, r]));
        // draw line
        seriesG.append('path')
          .datum(sd)
          .attr('fill','none')
          .attr('stroke', palette[idx % palette.length])
          .attr('stroke-width', 2)
          .attr('d', line);

        if (el.points.checked) {
          seriesG.selectAll(`circle.state-${s}`)
            .data(sd)
            .join('circle')
            .attr('class',`state-${s}`)
            .attr('r', 3.5)
            .attr('cx', d=>xLine(d.year))
            .attr('cy', d=>y(d.value))
            // color points by winner/special rule rather than the palette
            .attr('fill', d => colorForBar(d, s, meta, rowLookupS))
            .on('mouseenter', (evt,d)=>showTip(evt, `${s} ${d.year}: ${fmt(d.value)}`))
            .on('mouseleave', hideTip);
        }
      });

  // draw national if requested (single nat series overlay)
  if (p.nat && yNatCol && natFiltered.length) {
        natG.append('path')
          .datum(natFiltered)
          .attr('fill','none')
          .attr('stroke', color.nat)
          .attr('stroke-dasharray', '5 5')
          .attr('stroke-width', 2)
          .attr('d', line);
      }

      return; // multi-state done
    }

    if (kind === 'line') {
      // render legend for single-state line mode (state + maybe national)
      legendG.selectAll('*').remove();
      const items = [p.state];
      if (p.nat && yNatCol) items.push('NATIONAL');
      legendG.selectAll('g.leg').data(items).join('g').attr('class','leg').each(function(d,i){
        const gx = d3.select(this);
        gx.attr('transform', `translate(${i*140},0)`);
        gx.selectAll('*').remove();
        const fill = d === 'NATIONAL' ? color.nat : color.state;
        gx.append('rect').attr('width',14).attr('height',10).attr('rx',2).attr('fill', fill);
        gx.append('text').attr('x',18).attr('y',9).attr('fill', color.axis).attr('font-size',11).text(d);
      });
      // State line
      seriesG.append('path')
        .datum(dataFiltered)
        .attr('fill','none')
        .attr('stroke', color.state)
        .attr('stroke-width', 2)
        .attr('d', line);

        if (el.points.checked) {
        seriesG.selectAll('circle.state')
          .data(dataFiltered)
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
      if (p.nat && yNatCol && natFiltered.length){
        natG.append('path')
          .datum(natFiltered)
          .attr('fill','none')
          .attr('stroke', color.nat)
          .attr('stroke-dasharray', '5 5')
          .attr('stroke-width', 2)
          .attr('d', line);

          if (el.points.checked) {
          natG.selectAll('circle.nat')
            .data(natFiltered)
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
    const overlapShift = 3; // subtle overlap shift for national bar overlay
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

      if (p.nat && yNatCol && natFiltered.length){
        natG.selectAll('rect.nat')
          .data(natFiltered)
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

(function(global){
  const color = {
    state: '#4ade80',
    stateFillPos: 'deepskyblue',
    stateFillNeg: 'red',
    nat: '#f472b6',
    axis: '#888'
  };

  function create(rootEl){
    const margin = {top: 24, right: 24, bottom: 36, left: 56};
    const H = 520;
    const svg = d3.select(rootEl).append('svg').attr('width','100%').attr('height', H);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const x = d3.scalePoint();
    const y = d3.scaleLinear();
    const xAxisG = g.append('g').attr('class','x-axis');
    const yAxisG = g.append('g').attr('class','y-axis');
    const seriesG = g.append('g');
    const zeroG = g.append('g');
    const line = d3.line().x(d=>x(d.year)).y(d=>y(d.value)).curve(d3.curveMonotoneX);

    function fmt(v, rel, delta){
      if (v == null || isNaN(v)) return '';
      const sign = v > 0 ? 'D' : v < 0 ? 'R' : '';
      const pct = Math.abs(v*100).toFixed(1) + '%';
      if (sign) return `${sign}+${pct}`;
      return rel ? 'NAT' : 'EVEN';
    }

    function update(props){
      const { data, state, metric, chart, rel, delta, twoP, yearStart, yearEnd, notesEl } = props;
      if (!data) return;
      const rows = data.filter(r=>r.abbr===state);
      const natRows = data.filter(r=>r.abbr==='NATIONAL');
      const minYear = d3.min(data, d=>+d.year);
      const maxYear = d3.max(data, d=>+d.year);
      const start = yearStart!=null? yearStart : minYear;
      const end = yearEnd!=null? yearEnd : maxYear;

      // columns
      const isThird = metric === 'thirdParty';
      let yCol = null, yNatCol = null, desc = '';
      if (isThird) {
        yCol = rel ? 'third_party_relative_share' : 'third_party_share';
        yNatCol = rel ? null : 'third_party_national_share';
        desc = rel ? 'State third-party share minus national.' : 'Third-party share.';
      } else {
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
          yCol = base; yNatCol = baseNat; desc = twoP ? 'Two-party margin.' : 'Dem minus Rep vote share.';
        }
      }
      if (notesEl) notesEl.textContent = desc;

      const w = rootEl.getBoundingClientRect().width || 1100;
      const innerW = w - margin.left - margin.right;
      const innerH = H - margin.top - margin.bottom;
      x.range([0, innerW]);
      y.range([innerH, 0]);

      const parseNum = v => v===''||v==null? null: +v;
      const dataS = rows.map(r=>({year:+r.year, value: parseNum(r[yCol])})).filter(d=>d.value!=null && d.year>=start && d.year<=end);
      const dataN = yNatCol ? natRows.map(r=>({year:+r.year, value: parseNum(r[yNatCol])})).filter(d=>d.value!=null && d.year>=start && d.year<=end) : [];
      dataS.sort((a,b)=>a.year-b.year);
      dataN.sort((a,b)=>a.year-b.year);
      const years = Array.from(new Set([...dataS.map(d=>d.year), ...dataN.map(d=>d.year)])).sort((a,b)=>a-b);
      x.domain(years);
      const values = [...dataS.map(d=>d.value), ...dataN.map(d=>d.value)];
      const yMin = d3.min(values);
      const yMax = d3.max(values);
      let pad = (yMax - yMin) || 0.1; pad *= 0.15;
      y.domain([yMin - pad, yMax + pad]).nice();

      const xA = d3.axisBottom(x).tickValues(years).tickFormat(d3.format('d'));
      const yA = d3.axisLeft(y).ticks(8).tickFormat(v=>fmt(v, rel, delta));
      xAxisG.attr('transform', `translate(0,${innerH})`).call(xA);
      yAxisG.call(yA);

      zeroG.selectAll('*').remove();
      zeroG.append('line').attr('x1',0).attr('x2',innerW).attr('y1',y(0)).attr('y2',y(0)).attr('stroke',color.axis).attr('stroke-dasharray','5 5');
      seriesG.selectAll('*').remove();

      const kind = chart==='auto' ? (isThird? 'line':'line') : chart;
      if (kind==='line'){
        seriesG.append('path').datum(dataS).attr('fill','none').attr('stroke', color.state).attr('stroke-width',2).attr('d', line);
        if (dataN.length) seriesG.append('path').datum(dataN).attr('fill','none').attr('stroke', color.nat).attr('stroke-dasharray','5 5').attr('stroke-width',2).attr('d', line);
      } else {
        const band = innerW / Math.max(1, years.length);
        const stateW = Math.max(6, Math.min(28, band * 0.6));
        seriesG.selectAll('rect.state').data(dataS).join('rect')
          .attr('class','state')
          .attr('x', d=> (x(d.year) - stateW/2))
          .attr('width', stateW)
          .attr('y', d=> Math.min(y(0), y(d.value)))
          .attr('height', d=> Math.abs(y(d.value) - y(0)))
          .attr('fill', d=> d.value>=0? color.stateFillPos : color.stateFillNeg);
      }
    }

    return { update };
  }

  global.TrendsChart = { create };
})(window);

(function(global){
  const color = {
    state: '#4ade80',
    stateFillPos: 'deepskyblue',
    stateFillNeg: 'red',
    nat: '#f472b6',
    axis: '#888'
  };

  const LABEL_GAP_PX = 28;
  const MAX_LABEL_COUNT = 40;

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
    const pointsG = g.append('g').attr('class','points-group');
    const line = d3.line().x(d=>x(d.year)).y(d=>y(d.value)).curve(d3.curveMonotoneX);
    
    // Create tooltip
    const tooltip = d3.select(rootEl)
      .append('div')
      .style('position', 'absolute')
      .style('background', 'rgba(0,0,0,0.9)')
      .style('color', '#fff')
      .style('padding', '8px 12px')
      .style('border-radius', '6px')
      .style('font-size', '13px')
      .style('pointer-events', 'none')
      .style('opacity', 0)
      .style('z-index', 1000)
      .style('white-space', 'nowrap');

    function fmt(v, rel, delta){
      if (v == null || isNaN(v)) return '';
      const sign = v > 0 ? 'D' : v < 0 ? 'R' : '';
      const pct = Math.abs(v*100).toFixed(1) + '%';
      if (sign) return `${sign}+${pct}`;
      return rel ? 'NAT' : 'EVEN';
    }

    function winnerColor(value, fallbackColor){
      if (fallbackColor) return fallbackColor;
      if (value == null || isNaN(value)) return color.stateFillNeg;
      return value >= 0 ? color.stateFillPos : color.stateFillNeg;
    }

    function hasLabelRoom(data, index){
      if (!data.length || data.length > MAX_LABEL_COUNT) return false;
      const xPos = x(data[index].year);
      const left = index > 0 ? Math.abs(xPos - x(data[index - 1].year)) : Infinity;
      const right = index < data.length - 1 ? Math.abs(x(data[index + 1].year) - xPos) : Infinity;
      return Math.min(left, right) >= LABEL_GAP_PX;
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
      let yCol = null, yNatCol = null, desc = '', strCol = '';
      if (isThird) {
        yCol = rel ? 'third_party_relative_share' : 'third_party_share';
        yNatCol = rel ? null : 'third_party_national_share';
        desc = rel ? 'State third-party share minus national.' : 'Third-party share.';
        strCol = 'third_party_share_str';
      } else {
        const base = twoP ? 'two_party_margin' : 'pres_margin';
        const baseNat = twoP ? 'two_party_national_margin' : 'national_margin';
        if (delta && !rel) {
          yCol = base + '_delta';
          yNatCol = baseNat + '_delta';
          desc = 'Change in margins from prior election.';
          strCol = base + '_delta_str';
        } else if (rel && !delta) {
          yCol = twoP ? 'two_party_relative_margin' : 'relative_margin';
          yNatCol = null;
          desc = 'State minus national.';
          strCol = twoP ? 'two_party_relative_margin_str' : 'relative_margin_str';
        } else if (rel && delta) {
          yCol = twoP ? 'two_party_relative_margin_delta' : 'relative_margin_delta';
          yNatCol = null;
          desc = 'Change in state margin minus change in national margin.';
          strCol = twoP ? 'two_party_relative_margin_delta_str' : 'relative_margin_delta_str';
        } else {
          yCol = base; yNatCol = baseNat; desc = twoP ? 'Two-party margin.' : 'Dem minus Rep vote share.';
          strCol = twoP ? 'two_party_margin_str' : 'pres_margin_str';
        }
      }
      if (notesEl) notesEl.textContent = desc;

      const w = rootEl.getBoundingClientRect().width || 1100;
      const innerW = w - margin.left - margin.right;
      const innerH = H - margin.top - margin.bottom;
      x.range([0, innerW]);
      y.range([innerH, 0]);

      const parseNum = v => v===''||v==null? null: +v;
      // Enhanced data structure with str and color fields
      const dataS = rows.map(r=>({
        year:+r.year, 
        value: parseNum(r[yCol]),
        str: r[strCol] || fmt(parseNum(r[yCol]), rel, delta),
        color: r.color || null,
        baseMargin: parseNum(r.pres_margin)
      })).filter(d=>d.value!=null && d.year>=start && d.year<=end);
      const dataN = yNatCol ? natRows.map(r=>({
        year:+r.year,
        value: parseNum(r[yNatCol]),
        str: fmt(parseNum(r[yNatCol]), rel, delta),
        baseMargin: parseNum(r.pres_margin),
        color: winnerColor(parseNum(r.pres_margin), r.color)
      })).filter(d=>d.value!=null && d.year>=start && d.year<=end) : [];
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
      pointsG.selectAll('*').remove();

      const kind = chart==='auto' ? (isThird? 'line':'line') : chart;
      if (kind==='line'){
        seriesG.append('path').datum(dataS).attr('fill','none').attr('stroke', color.state).attr('stroke-width',2).attr('d', line);
        if (dataN.length) seriesG.append('path').datum(dataN).attr('fill','none').attr('stroke', color.nat).attr('stroke-dasharray','5 5').attr('stroke-width',2).attr('d', line);
        
        // Add interactive points for state data (always show them like Trend Viewer)
        pointsG.selectAll('circle.data-point')
          .data(dataS, d => d.year)
          .join(
            enter => enter.append('circle').attr('class', 'data-point'),
            update => update,
            exit => exit.remove()
          )
          .attr('class', 'data-point')
          .attr('cx', d => x(d.year))
          .attr('cy', d => y(d.value))
          .attr('r', 5)
          .attr('fill', d => {
            // Use color from CSV if available, otherwise use default based on value
            if (d.color) return d.color;
            return d.value >= 0 ? color.stateFillPos : color.stateFillNeg;
          })
          .attr('stroke', '#fff')
          .attr('stroke-width', 2)
          .style('cursor', 'pointer')
          .on('mouseover', function(event, d) {
            d3.select(this)
              .transition()
              .duration(150)
              .attr('r', 7)
              .attr('stroke-width', 2.5);
            tooltip
              .style('opacity', 1)
              .html(`<strong>${d.year}</strong><br/>${d.str}`);
          })
          .on('mousemove', function(event) {
            const [mx, my] = d3.pointer(event, rootEl);
            tooltip
              .style('left', (mx + 15) + 'px')
              .style('top', (my - 10) + 'px');
          })
          .on('mouseout', function() {
            d3.select(this)
              .transition()
              .duration(150)
              .attr('r', 5)
              .attr('stroke-width', 2);
            tooltip.style('opacity', 0);
          })
          .on('click', function(event, d) {
            // Copy value to clipboard
            navigator.clipboard?.writeText(`${d.year}: ${d.str}`);
          });
        
        // Add labels above points (if sufficient space)
        const labelsData = dataS.filter((_, idx) => hasLabelRoom(dataS, idx));
        pointsG.selectAll('text.data-label')
          .data(labelsData, d => d.year)
          .join(
            enter => enter.append('text').attr('class', 'data-label'),
            update => update,
            exit => exit.remove()
          )
          .attr('class', 'data-label')
          .attr('x', d => x(d.year))
          .attr('y', d => y(d.value) - 12)
          .attr('text-anchor', 'middle')
          .attr('font-size', '11px')
          .attr('fill', '#ccc')
          .attr('pointer-events', 'none')
          .text(d => d.str);
        
        // Add interactive points for national data (colored by PV winner)
        if (dataN.length) {
          pointsG.selectAll('circle.nat-point')
            .data(dataN, d => d.year)
            .join(
              enter => enter.append('circle').attr('class', 'nat-point'),
              update => update,
              exit => exit.remove()
            )
            .attr('class', 'nat-point')
            .attr('cx', d => x(d.year))
            .attr('cy', d => y(d.value))
            .attr('r', 4)
            .attr('fill', d => winnerColor(d.baseMargin, d.color))
            .attr('stroke', '#fff')
            .attr('stroke-width', 1.5)
            .style('cursor', 'pointer')
            .on('mouseover', function(event, d) {
              d3.select(this)
                .transition()
                .duration(150)
                .attr('r', 6)
                .attr('stroke-width', 2);
              tooltip
                .style('opacity', 1)
                .html(`<strong>${d.year} (National)</strong><br/>${fmt(d.value, rel, delta)}`);
            })
            .on('mousemove', function(event) {
              const [mx, my] = d3.pointer(event, rootEl);
              tooltip
                .style('left', (mx + 15) + 'px')
                .style('top', (my - 10) + 'px');
            })
            .on('mouseout', function() {
              d3.select(this)
                .transition()
                .duration(150)
                .attr('r', 4)
                .attr('stroke-width', 1.5);
              tooltip.style('opacity', 0);
            });
        }
      } else {
        const band = innerW / Math.max(1, years.length);
        const stateW = Math.max(6, Math.min(28, band * 0.6));
        seriesG.selectAll('rect.state').data(dataS).join('rect')
          .attr('class','state')
          .attr('x', d=> (x(d.year) - stateW/2))
          .attr('width', stateW)
          .attr('y', d=> Math.min(y(0), y(d.value)))
          .attr('height', d=> Math.abs(y(d.value) - y(0)))
          .attr('fill', d=> {
            if (d.color) return d.color;
            return d.value>=0? color.stateFillPos : color.stateFillNeg;
          })
          .style('cursor', 'pointer')
          .on('mouseover', function(event, d) {
            d3.select(this).style('opacity', 0.8);
            tooltip
              .style('opacity', 1)
              .html(`<strong>${d.year}</strong><br/>${d.str}`);
          })
          .on('mousemove', function(event) {
            const [mx, my] = d3.pointer(event, rootEl);
            tooltip
              .style('left', (mx + 15) + 'px')
              .style('top', (my - 10) + 'px');
          })
          .on('mouseout', function() {
            d3.select(this).style('opacity', 1);
            tooltip.style('opacity', 0);
          })
          .on('click', function(event, d) {
            navigator.clipboard?.writeText(`${d.year}: ${d.str}`);
          });
      }
    }

    return { update };
  }

  global.TrendsChart = { create };
})(window);

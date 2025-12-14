/**
 * 13 Keys to the White House Analysis
 * Interactive visualizations and analysis of Lichtman's prediction system
 */

(function () {
  'use strict';

  // Key names in order
  const KEY_NAMES = [
    'Mandate',
    'Contest',
    'Incumbent',
    'No 3rd party',
    'ST economy',
    'LT economy',
    'Policy change',
    'No unrest',
    'No scandal',
    'No Military failure',
    'Military Success',
    'Incumbent rizz',
    'No challenger rizz'
  ];

  // Short names for correlation matrix
  const KEY_SHORT_NAMES = [
    'Mand',
    'Cont',
    'Inc',
    '3rd',
    'STec',
    'LTec',
    'Pol',
    'Unr',
    'Scan',
    'MilF',
    'MilS',
    'IncC',
    'ChaC'
  ];

  // State
  let allData = [];
  let uniqueElections = [];
  let sortColumn = 'year';
  let sortDirection = 'desc';

  // DOM elements
  const elements = {
    resultsTableBody: document.getElementById('resultsTableBody'),
    keysTableHeader: document.getElementById('keysTableHeader'),
    keysTableBody: document.getElementById('keysTableBody'),
    yearFilter: document.getElementById('yearFilter'),
    correlationTableHeader: document.getElementById('correlationTableHeader'),
    correlationTableBody: document.getElementById('correlationTableBody'),
    topCorrelations: document.getElementById('topCorrelations'),
    correlationValue: document.getElementById('correlationValue'),
    r2Value: document.getElementById('r2Value'),
    pvAccuracy: document.getElementById('pvAccuracy'),
    ecAccuracy: document.getElementById('ecAccuracy'),
    histogramKeyCount: document.getElementById('histogramKeyCount'),
    tooltip: document.getElementById('tooltip')
  };

  // Chart dimensions
  const chartMargin = { top: 40, right: 40, bottom: 60, left: 80 };
  const chartWidth = 800;
  const chartHeight = 450;
  const innerWidth = chartWidth - chartMargin.left - chartMargin.right;
  const innerHeight = chartHeight - chartMargin.top - chartMargin.bottom;

  // Colors
  const colors = {
    accent: '#66b3ff',
    yellow: '#f59e0b',
    red: '#ef4444',
    green: '#10b981',
    muted: '#a5a5a5',
    dem: '#4169E1',
    rep: '#B22222'
  };

  /**
   * Parse CSV data
   */
  function parseCSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',');
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const row = {};
      headers.forEach((h, idx) => {
        const val = values[idx]?.trim() || '';
        // Parse booleans
        if (val === 'True') row[h] = true;
        else if (val === 'False') row[h] = false;
        // Parse numbers
        else if (!isNaN(parseFloat(val)) && isFinite(val)) row[h] = parseFloat(val);
        else row[h] = val;
      });
      data.push(row);
    }
    return data;
  }

  /**
   * Get unique elections (deduplicate by year, keeping incumbent party perspective)
   */
  function getUniqueElections(data) {
    const seen = new Map();
    data.forEach(row => {
      // Keep only one row per year - prefer incumbent party perspective
      const year = row.year;
      if (!seen.has(year)) {
        seen.set(year, row);
      }
    });
    return Array.from(seen.values()).sort((a, b) => b.year - a.year);
  }

  /**
   * Calculate linear regression
   */
  function linearRegression(data) {
    const n = data.length;
    if (n === 0) return { slope: 0, intercept: 0, r: 0, r2: 0 };

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

    data.forEach(d => {
      sumX += d.x;
      sumY += d.y;
      sumXY += d.x * d.y;
      sumX2 += d.x * d.x;
      sumY2 += d.y * d.y;
    });

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Pearson correlation coefficient
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    const r = denominator === 0 ? 0 : numerator / denominator;
    const r2 = r * r;

    return { slope, intercept, r, r2 };
  }

  /**
   * Calculate standard deviation of residuals
   */
  function calculateResidualStd(data, slope, intercept) {
    if (data.length === 0) return 0;
    const residuals = data.map(d => d.y - (slope * d.x + intercept));
    const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
    const variance = residuals.reduce((a, r) => a + (r - mean) ** 2, 0) / residuals.length;
    return Math.sqrt(variance);
  }

  /**
   * Calculate key-to-key correlation matrix
   */
  function calculateKeyCorrelations(data) {
    const n = KEY_NAMES.length;
    const matrix = Array(n).fill(null).map(() => Array(n).fill(0));

    // Convert keys to numeric arrays
    const keyArrays = KEY_NAMES.map(key =>
      data.map(row => row[key] === true ? 1 : 0)
    );

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          matrix[i][j] = 1;
        } else {
          // Pearson correlation
          const x = keyArrays[i];
          const y = keyArrays[j];
          const m = x.length;

          const meanX = x.reduce((a, b) => a + b, 0) / m;
          const meanY = y.reduce((a, b) => a + b, 0) / m;

          let num = 0, denX = 0, denY = 0;
          for (let k = 0; k < m; k++) {
            const dx = x[k] - meanX;
            const dy = y[k] - meanY;
            num += dx * dy;
            denX += dx * dx;
            denY += dy * dy;
          }

          const den = Math.sqrt(denX * denY);
          matrix[i][j] = den === 0 ? 0 : num / den;
        }
      }
    }

    return matrix;
  }

  /**
   * Format NPV as percentage string
   */
  function formatNPV(value) {
    if (value == null || isNaN(value)) return '—';
    const pct = Math.abs(value * 100).toFixed(2);
    if (value > 0) return `+${pct}%`;
    if (value < 0) return `−${pct}%`;
    return 'EVEN';
  }

  /**
   * Update summary statistics
   */
  function updateStats() {
    // Prepare data for regression
    const regressionData = uniqueElections
      .filter(d => typeof d.false_keys === 'number' && typeof d.npv_incumbent_relative === 'number')
      .map(d => ({
        x: d.false_keys,
        y: d.npv_incumbent_relative,
        year: d.year
      }));

    const { slope, intercept, r, r2 } = linearRegression(regressionData);

    // Update correlation
    elements.correlationValue.textContent = r.toFixed(3);
    elements.correlationValue.style.color = r < 0 ? colors.red : colors.green;

    // Update R²
    elements.r2Value.textContent = r2.toFixed(3);

    // Calculate accuracy
    let pvCorrect = 0, pvTotal = 0;
    let ecCorrect = 0, ecTotal = 0;

    uniqueElections.forEach(row => {
      const prediction = row.false_keys < 6 ? row.incumbent_party : row.challenger_party;
      const incumbentParty = row.incumbent_party;

      // PV accuracy
      if (row.pv_winner) {
        pvTotal++;
        const pvWinnerParty = row.pv_winner;
        const incumbentWonPV = row.incumbent_won_pv === true || row.incumbent_won_pv === 'True';
        const keysPredictsIncumbent = row.false_keys < 6;

        if (keysPredictsIncumbent === incumbentWonPV) {
          pvCorrect++;
        }
      }

      // EC accuracy
      if (row.ec_winner) {
        ecTotal++;
        const incumbentWonEC = row.incumbent_won_ec === true || row.incumbent_won_ec === 'True';
        const keysPredictsIncumbent = row.false_keys < 6;

        if (keysPredictsIncumbent === incumbentWonEC) {
          ecCorrect++;
        }
      }
    });

    elements.pvAccuracy.textContent = pvTotal > 0 ? `${((pvCorrect / pvTotal) * 100).toFixed(1)}%` : '—';
    elements.pvAccuracy.innerHTML += `<br><span style="font-size:0.7em;color:var(--muted)">${pvCorrect}/${pvTotal}</span>`;

    elements.ecAccuracy.textContent = ecTotal > 0 ? `${((ecCorrect / ecTotal) * 100).toFixed(1)}%` : '—';
    elements.ecAccuracy.innerHTML += `<br><span style="font-size:0.7em;color:var(--muted)">${ecCorrect}/${ecTotal}</span>`;

    return { slope, intercept, r, r2, regressionData };
  }

  /**
   * Render the results table
   */
  function renderResultsTable() {
    const sorted = [...uniqueElections].sort((a, b) => {
      let aVal = a[sortColumn];
      let bVal = b[sortColumn];

      // Handle special columns
      if (sortColumn === 'npv_incumbent_relative_pct') {
        aVal = a.npv_incumbent_relative || 0;
        bVal = b.npv_incumbent_relative || 0;
      }

      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    elements.resultsTableBody.innerHTML = sorted.map(row => {
      const falseKeys = row.false_keys;
      const prediction = falseKeys < 6 ? row.incumbent_party : row.challenger_party;
      const incumbentWonPV = row.incumbent_won_pv === true || row.incumbent_won_pv === 'True';
      const incumbentWonEC = row.incumbent_won_ec === true || row.incumbent_won_ec === 'True';
      const keysPredictsIncumbent = falseKeys < 6;

      const pvCorrect = keysPredictsIncumbent === incumbentWonPV;
      const ecCorrect = keysPredictsIncumbent === incumbentWonEC;

      return `
        <tr>
          <td>${row.year}</td>
          <td style="color:${row.incumbent_party === 'D' ? colors.dem : colors.rep}">${row.incumbent_party}</td>
          <td>${row.incumbent_nominee || '—'}</td>
          <td>${row.challenger_nominee || '—'}</td>
          <td style="font-weight:bold;color:${falseKeys >= 6 ? colors.red : colors.green}">${falseKeys}</td>
          <td style="color:${row.npv_incumbent_relative > 0 ? colors.green : colors.red}">${formatNPV(row.npv_incumbent_relative)}</td>
          <td style="color:${row.pv_winner === 'D' ? colors.dem : colors.rep}">${row.pv_winner || '—'}</td>
          <td style="color:${row.ec_winner === 'D' ? colors.dem : colors.rep}">${row.ec_winner || '—'}</td>
          <td style="color:${prediction === 'D' ? colors.dem : colors.rep}">${prediction} (${keysPredictsIncumbent ? 'Inc' : 'Cha'})</td>
          <td class="${pvCorrect ? 'prediction-correct' : 'prediction-incorrect'}">${pvCorrect ? '✓' : '✗'}</td>
          <td class="${ecCorrect ? 'prediction-correct' : 'prediction-incorrect'}">${ecCorrect ? '✓' : '✗'}</td>
        </tr>
      `;
    }).join('');
  }

  /**
   * Render the individual keys table
   */
  function renderKeysTable(filterYear = 'all') {
    // Header
    let headerHTML = '<th>Year</th><th>Inc. Party</th>';
    KEY_NAMES.forEach(name => {
      headerHTML += `<th title="${name}">${name}</th>`;
    });
    headerHTML += '<th># False</th>';
    elements.keysTableHeader.innerHTML = headerHTML;

    // Filter data
    let filtered = uniqueElections;
    if (filterYear !== 'all') {
      filtered = uniqueElections.filter(row => row.year === parseInt(filterYear));
    }

    // Body
    elements.keysTableBody.innerHTML = filtered.map(row => {
      let rowHTML = `<td>${row.year}</td>`;
      rowHTML += `<td style="color:${row.incumbent_party === 'D' ? colors.dem : colors.rep}">${row.incumbent_party}</td>`;

      KEY_NAMES.forEach(key => {
        const val = row[key];
        const isTrue = val === true || val === 'True';
        rowHTML += `<td class="${isTrue ? 'key-true' : 'key-false'}">${isTrue ? 'T' : 'F'}</td>`;
      });

      const falseKeys = row.false_keys;
      rowHTML += `<td style="font-weight:bold;color:${falseKeys >= 6 ? colors.red : colors.green}">${falseKeys}</td>`;

      return `<tr>${rowHTML}</tr>`;
    }).join('');
  }

  /**
   * Render correlation matrix
   */
  function renderCorrelationMatrix() {
    const matrix = calculateKeyCorrelations(uniqueElections);

    // Header
    let headerHTML = '<tr><th></th>';
    KEY_SHORT_NAMES.forEach(name => {
      headerHTML += `<th>${name}</th>`;
    });
    headerHTML += '</tr>';
    elements.correlationTableHeader.innerHTML = headerHTML;

    // Body
    let bodyHTML = '';
    for (let i = 0; i < KEY_SHORT_NAMES.length; i++) {
      let rowHTML = `<th>${KEY_SHORT_NAMES[i]}</th>`;
      for (let j = 0; j < KEY_SHORT_NAMES.length; j++) {
        const corr = matrix[i][j];
        const absCorr = Math.abs(corr);

        // Color based on correlation
        let bg, fg;
        if (i === j) {
          bg = 'rgba(255,255,255,0.1)';
          fg = colors.muted;
        } else if (corr > 0.3) {
          const intensity = Math.min(1, absCorr);
          bg = `rgba(16, 185, 129, ${intensity * 0.6})`;
          fg = '#fff';
        } else if (corr < -0.3) {
          const intensity = Math.min(1, absCorr);
          bg = `rgba(239, 68, 68, ${intensity * 0.6})`;
          fg = '#fff';
        } else {
          bg = 'transparent';
          fg = colors.muted;
        }

        rowHTML += `<td class="corr-cell" style="background:${bg};color:${fg}" 
                        title="${KEY_NAMES[i]} ↔ ${KEY_NAMES[j]}: ${corr.toFixed(3)}">${corr.toFixed(2)}</td>`;
      }
      bodyHTML += `<tr>${rowHTML}</tr>`;
    }
    elements.correlationTableBody.innerHTML = bodyHTML;

    // Find top correlations
    const pairs = [];
    for (let i = 0; i < KEY_NAMES.length; i++) {
      for (let j = i + 1; j < KEY_NAMES.length; j++) {
        pairs.push({
          key1: KEY_NAMES[i],
          key2: KEY_NAMES[j],
          corr: matrix[i][j]
        });
      }
    }

    pairs.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));

    const topPositive = pairs.filter(p => p.corr > 0).slice(0, 3);
    const topNegative = pairs.filter(p => p.corr < 0).slice(0, 3);

    let correlationsHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">';

    correlationsHTML += '<div><strong style="color:var(--green)">Most Positively Correlated:</strong><ul style="margin:8px 0;padding-left:20px;">';
    topPositive.forEach(p => {
      correlationsHTML += `<li>${p.key1} ↔ ${p.key2}: <strong>${p.corr.toFixed(3)}</strong></li>`;
    });
    correlationsHTML += '</ul></div>';

    correlationsHTML += '<div><strong style="color:var(--red)">Most Negatively Correlated:</strong><ul style="margin:8px 0;padding-left:20px;">';
    topNegative.forEach(p => {
      correlationsHTML += `<li>${p.key1} ↔ ${p.key2}: <strong>${p.corr.toFixed(3)}</strong></li>`;
    });
    correlationsHTML += '</ul></div>';

    correlationsHTML += '</div>';
    elements.topCorrelations.innerHTML = correlationsHTML;
  }

  /**
   * Create scatter plot
   */
  function createScatterPlot(regressionData, slope, intercept, r) {
    const container = document.getElementById('scatterChart');
    container.innerHTML = '';

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${chartWidth} ${chartHeight}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg.append('g')
      .attr('transform', `translate(${chartMargin.left},${chartMargin.top})`);

    // Scales
    const xScale = d3.scaleLinear()
      .domain([0, 10])
      .range([0, innerWidth]);

    const yExtent = d3.extent(regressionData, d => d.y);
    const yPadding = (yExtent[1] - yExtent[0]) * 0.15;
    const yScale = d3.scaleLinear()
      .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
      .range([innerHeight, 0]);

    // Standard deviation bands
    const std = calculateResidualStd(regressionData, slope, intercept);

    // 2σ band
    g.append('path')
      .datum([[0, 2], [10, 2]])
      .attr('fill', 'rgba(255,255,255,0.08)')
      .attr('d', d3.area()
        .x(d => xScale(d[0]))
        .y0(d => yScale(slope * d[0] + intercept - 2 * std))
        .y1(d => yScale(slope * d[0] + intercept + 2 * std))
        .curve(d3.curveLinear)([[0, 0], [10, 0]])
      );

    // 1σ band
    g.append('path')
      .datum([[0, 1], [10, 1]])
      .attr('fill', 'rgba(255,255,255,0.12)')
      .attr('d', d3.area()
        .x(d => xScale(d[0]))
        .y0(d => yScale(slope * d[0] + intercept - std))
        .y1(d => yScale(slope * d[0] + intercept + std))
        .curve(d3.curveLinear)([[0, 0], [10, 0]])
      );

    // Grid lines
    g.append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(xScale.ticks(10))
      .join('line')
      .attr('x1', d => xScale(d))
      .attr('x2', d => xScale(d))
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', 'rgba(255,255,255,0.1)');

    g.append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(yScale.ticks(8))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', 'rgba(255,255,255,0.1)');

    // Zero line
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', yScale(0))
      .attr('y2', yScale(0))
      .attr('stroke', 'rgba(255,255,255,0.4)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4');

    // 6-key threshold
    g.append('line')
      .attr('x1', xScale(5.5))
      .attr('x2', xScale(5.5))
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', colors.red)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6,4');

    g.append('text')
      .attr('x', xScale(5.5) + 8)
      .attr('y', 20)
      .attr('fill', colors.red)
      .attr('font-size', '12px')
      .text('6-key threshold');

    // Line of best fit
    g.append('line')
      .attr('x1', xScale(0))
      .attr('y1', yScale(intercept))
      .attr('x2', xScale(10))
      .attr('y2', yScale(slope * 10 + intercept))
      .attr('stroke', colors.yellow)
      .attr('stroke-width', 2);

    // Data points
    g.selectAll('circle')
      .data(regressionData)
      .join('circle')
      .attr('cx', d => xScale(d.x))
      .attr('cy', d => yScale(d.y))
      .attr('r', 6)
      .attr('fill', d => (d.year === 2016 || d.year === 2024) ? colors.red : colors.accent)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .attr('cursor', 'pointer')
      .on('mouseover', (event, d) => {
        const election = uniqueElections.find(e => e.year === d.year);
        let extraNote = '';
        if (d.year === 2016) {
          extraNote = '<br><em>Note: The keys predicted the incumbent party would lose but Clinton won the popular vote.</em>';
        } else if (d.year === 2024) {
          extraNote = '<br><em>Note: The keys predicted the incumbent party would win but Trump won the popular vote.</em>';
        }
        showTooltip(event, `
          <strong>${d.year}</strong><br>
          False Keys: ${d.x}<br>
          NPV (Inc. Rel.): ${formatNPV(d.y)}<br>
          ${election ? `${election.incumbent_nominee} vs ${election.challenger_nominee}` : ''}
          ${extraNote}
        `);
      })
      .on('mouseout', hideTooltip);

    // Add labels for each point
    g.selectAll('text.label')
      .data(regressionData)
      .join('text')
      .attr('class', 'label')
      .attr('x', d => xScale(d.x) + 8)
      .attr('y', d => yScale(d.y) + 4)
      .attr('fill', colors.muted)
      .attr('font-size', '10px')
      .text(d => d.year);

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(10))
      .selectAll('text')
      .attr('fill', colors.muted);

    g.append('g')
      .call(d3.axisLeft(yScale).tickFormat(d => (d * 100).toFixed(0) + '%'))
      .selectAll('text')
      .attr('fill', colors.muted);

    // Axis labels
    svg.append('text')
      .attr('x', chartWidth / 2)
      .attr('y', chartHeight - 10)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.muted)
      .attr('font-size', '14px')
      .text('Number of False Keys');

    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -chartHeight / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.muted)
      .attr('font-size', '14px')
      .text('Incumbent-Relative NPV');

    // Equation and R value
    svg.append('text')
      .attr('x', chartWidth - chartMargin.right - 10)
      .attr('y', chartMargin.top + 20)
      .attr('text-anchor', 'end')
      .attr('fill', colors.yellow)
      .attr('font-size', '12px')
      .text(`y = ${slope.toFixed(4)}x + ${intercept.toFixed(4)}`);

    svg.append('text')
      .attr('x', chartWidth - chartMargin.right - 10)
      .attr('y', chartMargin.top + 38)
      .attr('text-anchor', 'end')
      .attr('fill', colors.yellow)
      .attr('font-size', '12px')
      .text(`r = ${r.toFixed(3)}`);
  }

  /**
   * Create residuals plot
   */
  function createResidualsPlot(regressionData, slope, intercept) {
    const container = document.getElementById('residualsChart');
    container.innerHTML = '';

    const residuals = regressionData.map(d => ({
      year: d.year,
      x: d.x,
      residual: d.y - (slope * d.x + intercept),
      actual: d.y,
      predicted: slope * d.x + intercept
    }));

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${chartWidth} ${chartHeight}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg.append('g')
      .attr('transform', `translate(${chartMargin.left},${chartMargin.top})`);

    // Scales
    const xScale = d3.scaleBand()
      .domain(residuals.sort((a, b) => a.year - b.year).map(d => d.year))
      .range([0, innerWidth])
      .padding(0.2);

    const yExtent = d3.extent(residuals, d => d.residual);
    const yMax = Math.max(Math.abs(yExtent[0]), Math.abs(yExtent[1])) * 1.1;
    const yScale = d3.scaleLinear()
      .domain([-yMax, yMax])
      .range([innerHeight, 0]);

    // Zero line
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', yScale(0))
      .attr('y2', yScale(0))
      .attr('stroke', 'rgba(255,255,255,0.5)')
      .attr('stroke-width', 1);

    // Bars
    g.selectAll('rect')
      .data(residuals)
      .join('rect')
      .attr('x', d => xScale(d.year))
      .attr('y', d => d.residual > 0 ? yScale(d.residual) : yScale(0))
      .attr('width', xScale.bandwidth())
      .attr('height', d => Math.abs(yScale(d.residual) - yScale(0)))
      .attr('fill', d => d.residual > 0 ? colors.green : colors.red)
      .attr('opacity', 0.7)
      .attr('cursor', 'pointer')
      .on('mouseover', (event, d) => {
        showTooltip(event, `
          <strong>${d.year}</strong><br>
          Residual: ${formatNPV(d.residual)}<br>
          Actual: ${formatNPV(d.actual)}<br>
          Predicted: ${formatNPV(d.predicted)}
        `);
      })
      .on('mouseout', hideTooltip);

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).tickValues(xScale.domain().filter((d, i) => i % 4 === 0)))
      .selectAll('text')
      .attr('fill', colors.muted)
      .attr('transform', 'rotate(-45)')
      .attr('text-anchor', 'end');

    g.append('g')
      .call(d3.axisLeft(yScale).tickFormat(d => (d * 100).toFixed(0) + '%'))
      .selectAll('text')
      .attr('fill', colors.muted);

    // Axis labels
    svg.append('text')
      .attr('x', chartWidth / 2)
      .attr('y', chartHeight - 5)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.muted)
      .attr('font-size', '14px')
      .text('Election Year');

    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -chartHeight / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.muted)
      .attr('font-size', '14px')
      .text('Residual (Actual − Predicted)');
  }

  /**
   * Create box plot
   */
  function createBoxPlot(regressionData) {
    const container = document.getElementById('boxplotChart');
    container.innerHTML = '';

    // Group data by false key count
    const grouped = d3.group(regressionData, d => d.x);
    const boxData = [];

    for (let i = 0; i <= 9; i++) {
      const values = (grouped.get(i) || []).map(d => d.y).sort(d3.ascending);
      if (values.length === 0) continue;

      const q1 = d3.quantile(values, 0.25);
      const median = d3.quantile(values, 0.5);
      const q3 = d3.quantile(values, 0.75);
      const iqr = q3 - q1;
      const min = Math.max(d3.min(values), q1 - 1.5 * iqr);
      const max = Math.min(d3.max(values), q3 + 1.5 * iqr);
      const outliers = values.filter(v => v < min || v > max);

      boxData.push({ key: i, q1, median, q3, min, max, outliers, values });
    }

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${chartWidth} ${chartHeight}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg.append('g')
      .attr('transform', `translate(${chartMargin.left},${chartMargin.top})`);

    // Scales
    const xScale = d3.scaleBand()
      .domain(boxData.map(d => d.key))
      .range([0, innerWidth])
      .padding(0.3);

    const allValues = regressionData.map(d => d.y);
    const yExtent = d3.extent(allValues);
    const yPadding = (yExtent[1] - yExtent[0]) * 0.1;
    const yScale = d3.scaleLinear()
      .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
      .range([innerHeight, 0]);

    // Zero line
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', yScale(0))
      .attr('y2', yScale(0))
      .attr('stroke', 'rgba(255,255,255,0.4)')
      .attr('stroke-dasharray', '4,4');

    // Draw boxes
    const boxWidth = xScale.bandwidth();

    boxData.forEach(d => {
      const x = xScale(d.key);
      const centerX = x + boxWidth / 2;

      // Whiskers
      g.append('line')
        .attr('x1', centerX)
        .attr('x2', centerX)
        .attr('y1', yScale(d.min))
        .attr('y2', yScale(d.q1))
        .attr('stroke', colors.muted);

      g.append('line')
        .attr('x1', centerX)
        .attr('x2', centerX)
        .attr('y1', yScale(d.q3))
        .attr('y2', yScale(d.max))
        .attr('stroke', colors.muted);

      // Whisker caps
      g.append('line')
        .attr('x1', x + boxWidth * 0.25)
        .attr('x2', x + boxWidth * 0.75)
        .attr('y1', yScale(d.min))
        .attr('y2', yScale(d.min))
        .attr('stroke', colors.muted);

      g.append('line')
        .attr('x1', x + boxWidth * 0.25)
        .attr('x2', x + boxWidth * 0.75)
        .attr('y1', yScale(d.max))
        .attr('y2', yScale(d.max))
        .attr('stroke', colors.muted);

      // Box
      g.append('rect')
        .attr('x', x)
        .attr('y', yScale(d.q3))
        .attr('width', boxWidth)
        .attr('height', yScale(d.q1) - yScale(d.q3))
        .attr('fill', d.key < 6 ? colors.green : colors.red)
        .attr('fill-opacity', 0.4)
        .attr('stroke', d.key < 6 ? colors.green : colors.red);

      // Median line
      g.append('line')
        .attr('x1', x)
        .attr('x2', x + boxWidth)
        .attr('y1', yScale(d.median))
        .attr('y2', yScale(d.median))
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);

      // Outliers
      d.outliers.forEach(o => {
        g.append('circle')
          .attr('cx', centerX)
          .attr('cy', yScale(o))
          .attr('r', 4)
          .attr('fill', 'none')
          .attr('stroke', colors.accent);
      });

      // Count label
      g.append('text')
        .attr('x', centerX)
        .attr('y', innerHeight + 35)
        .attr('text-anchor', 'middle')
        .attr('fill', colors.muted)
        .attr('font-size', '10px')
        .text(`n=${d.values.length}`);
    });

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale))
      .selectAll('text')
      .attr('fill', colors.muted);

    g.append('g')
      .call(d3.axisLeft(yScale).tickFormat(d => (d * 100).toFixed(0) + '%'))
      .selectAll('text')
      .attr('fill', colors.muted);

    // Axis labels
    svg.append('text')
      .attr('x', chartWidth / 2)
      .attr('y', chartHeight - 5)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.muted)
      .attr('font-size', '14px')
      .text('Number of False Keys');

    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -chartHeight / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.muted)
      .attr('font-size', '14px')
      .text('Incumbent-Relative NPV');
  }

  /**
   * Create histogram
   */
  function createHistogram(regressionData, filterKey = 'all') {
    const container = document.getElementById('histogramChart');
    container.innerHTML = '';

    let filtered = regressionData;
    if (filterKey !== 'all') {
      filtered = regressionData.filter(d => d.x === parseInt(filterKey));
    }

    if (filtered.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:var(--muted)">No data for selected filter.</p>';
      return;
    }

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${chartWidth} ${chartHeight}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg.append('g')
      .attr('transform', `translate(${chartMargin.left},${chartMargin.top})`);

    // Create histogram bins
    const values = filtered.map(d => d.y);
    const xExtent = d3.extent(values);
    const xPadding = (xExtent[1] - xExtent[0]) * 0.1 || 0.05;

    const xScale = d3.scaleLinear()
      .domain([xExtent[0] - xPadding, xExtent[1] + xPadding])
      .range([0, innerWidth]);

    const histogram = d3.histogram()
      .value(d => d)
      .domain(xScale.domain())
      .thresholds(xScale.ticks(15));

    const bins = histogram(values);

    const yScale = d3.scaleLinear()
      .domain([0, d3.max(bins, d => d.length)])
      .range([innerHeight, 0]);

    // Zero line
    if (xScale.domain()[0] < 0 && xScale.domain()[1] > 0) {
      g.append('line')
        .attr('x1', xScale(0))
        .attr('x2', xScale(0))
        .attr('y1', 0)
        .attr('y2', innerHeight)
        .attr('stroke', 'rgba(255,255,255,0.5)')
        .attr('stroke-dasharray', '4,4');
    }

    // Bars
    g.selectAll('rect')
      .data(bins)
      .join('rect')
      .attr('x', d => xScale(d.x0) + 1)
      .attr('y', d => yScale(d.length))
      .attr('width', d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 2))
      .attr('height', d => innerHeight - yScale(d.length))
      .attr('fill', d => {
        const midpoint = (d.x0 + d.x1) / 2;
        return midpoint > 0 ? colors.green : colors.red;
      })
      .attr('opacity', 0.7)
      .on('mouseover', (event, d) => {
        const years = filtered.filter(f => f.y >= d.x0 && f.y < d.x1).map(f => f.year);
        showTooltip(event, `
          <strong>Range: ${formatNPV(d.x0)} to ${formatNPV(d.x1)}</strong><br>
          Count: ${d.length}<br>
          Years: ${years.join(', ')}
        `);
      })
      .on('mouseout', hideTooltip);

    // Mean line
    const mean = d3.mean(values);
    g.append('line')
      .attr('x1', xScale(mean))
      .attr('x2', xScale(mean))
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', colors.yellow)
      .attr('stroke-width', 2);

    g.append('text')
      .attr('x', xScale(mean) + 5)
      .attr('y', 15)
      .attr('fill', colors.yellow)
      .attr('font-size', '11px')
      .text(`Mean: ${formatNPV(mean)}`);

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).tickFormat(d => (d * 100).toFixed(0) + '%'))
      .selectAll('text')
      .attr('fill', colors.muted);

    g.append('g')
      .call(d3.axisLeft(yScale).ticks(5))
      .selectAll('text')
      .attr('fill', colors.muted);

    // Axis labels
    svg.append('text')
      .attr('x', chartWidth / 2)
      .attr('y', chartHeight - 10)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.muted)
      .attr('font-size', '14px')
      .text('Incumbent-Relative NPV');

    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -chartHeight / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.muted)
      .attr('font-size', '14px')
      .text('Count');
  }

  /**
   * Show tooltip
   */
  function showTooltip(event, html) {
    elements.tooltip.innerHTML = html;
    elements.tooltip.style.display = 'block';
    elements.tooltip.style.left = (event.clientX + 15) + 'px';
    elements.tooltip.style.top = (event.clientY + 15) + 'px';
  }

  /**
   * Hide tooltip
   */
  function hideTooltip() {
    elements.tooltip.style.display = 'none';
  }

  /**
   * Initialize
   */
  async function init() {
    try {
      // Load data
      const response = await fetch('./keys_with_npv.csv');
      const text = await response.text();
      allData = parseCSV(text);
      uniqueElections = getUniqueElections(allData);

      // Populate year filter
      const years = uniqueElections.map(d => d.year).sort((a, b) => b - a);
      years.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        elements.yearFilter.appendChild(option);
      });

      // Populate histogram key count
      const keyCounts = [...new Set(uniqueElections.map(d => d.false_keys))].sort((a, b) => a - b);
      keyCounts.forEach(count => {
        const option = document.createElement('option');
        option.value = count;
        option.textContent = `${count} false keys`;
        elements.histogramKeyCount.appendChild(option);
      });

      // Calculate stats and get regression data
      const { slope, intercept, r, regressionData } = updateStats();

      // Render tables
      renderResultsTable();
      renderKeysTable();
      renderCorrelationMatrix();

      // Create charts
      createScatterPlot(regressionData, slope, intercept, r);
      createResidualsPlot(regressionData, slope, intercept);
      createBoxPlot(regressionData);
      createHistogram(regressionData);

      // Event listeners
      setupEventListeners(regressionData, slope, intercept, r);

    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  /**
   * Setup event listeners
   */
  function setupEventListeners(regressionData, slope, intercept, r) {
    // Table sorting
    document.querySelectorAll('#resultsTable th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (sortColumn === col) {
          sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          sortColumn = col;
          sortDirection = 'asc';
        }

        // Update header classes
        document.querySelectorAll('#resultsTable th.sortable').forEach(h => {
          h.classList.remove('sorted-asc', 'sorted-desc');
        });
        th.classList.add(sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');

        renderResultsTable();
      });
    });

    // Year filter
    elements.yearFilter.addEventListener('change', (e) => {
      renderKeysTable(e.target.value);
    });

    // Chart tabs
    document.querySelectorAll('.chart-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.chart-panel').forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        document.getElementById(tab.dataset.panel + 'Panel').classList.add('active');
      });
    });

    // Histogram key count filter
    elements.histogramKeyCount.addEventListener('change', (e) => {
      createHistogram(regressionData, e.target.value);
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

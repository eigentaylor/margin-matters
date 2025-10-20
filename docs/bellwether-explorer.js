// Bellwether & Close States Explorer
// This module provides interactive visualizations for exploring bellwether and close states
//
// Features:
// - View bellwether states (states with relative margin close to national margin)
// - View close states (states with small raw presidential margins)
// - Adjustable thresholds via sliders with smooth animations
// - Three visualization modes:
//   1. Bar Graph: Shows count of bellwether/close states over all election years
//   2. Histogram: Shows distribution of margins for selected year with hover tooltips
//   3. Table: Sortable table with detailed state information
// - For bellwether states in specific years (not 2024), shows:
//   - Whether the state is still a bellwether in 2024
//   - The change in relative margin from selected year to 2024
// - For close states, shows the vote difference
// - All visualizations animate smoothly when settings change

'use strict';

// Global state
const state = {
  data: [],
  year: 'all',
  category: 'bellwether',
  bellwetherThreshold: 0.05,
  closeThreshold: 0.01,
  displayType: 'bar',
  sortColumn: null,
  sortDirection: 'asc',
  outcomeType: 'ec',
  streakThreshold: 3,
  maxAllowedMisses: 1,
  onlyCurrentStreak: false,
  outcomeSortColumn: 'longest',
  outcomeSortDirection: 'desc'
};

// list of available years (populated on init)
state.years = [];
state.nationalByYear = new Map();
state.latestYear = null;

const EC_MISMATCH_YEARS = new Set([1876, 1888, 2000, 2016]);

// Load and parse CSV data
async function loadData() {
  try {
    const response = await fetch('./presidential_margins.csv');
    const text = await response.text();
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',');

    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length === headers.length) {
        const row = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx];
        });
        data.push(row);
      }
    }

    return data;
  } catch (error) {
    console.error('Error loading data:', error);
    throw error;
  }
}

// Parse CSV line handling quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// Filter data based on current state
function filterData() {
  const { data, year, category, bellwetherThreshold, closeThreshold } = state;

  let filtered = data;

  // Filter out NATIONAL aggregate rows and congressional districts (keep -AL at-large)
  filtered = filtered.filter(row => {
    if (row.abbr === 'NATIONAL') return false;
    return true;
  });

  // Filter by year if not "all"
  if (year !== 'all') {
    filtered = filtered.filter(row => row.year === year);
  }

  // Filter by category
  if (category === 'bellwether') {
    filtered = filtered.filter(row => {
      const relMargin = parseFloat(row.relative_margin);
      return !isNaN(relMargin) && Math.abs(relMargin) < bellwetherThreshold;
    });
  } else {
    filtered = filtered.filter(row => {
      const presMargin = parseFloat(row.pres_margin);
      return !isNaN(presMargin) && Math.abs(presMargin) < closeThreshold;
    });
  }

  return filtered;
}

// Get count of states by year
function getCountsByYear() {
  const { data, category, bellwetherThreshold, closeThreshold } = state;
  const years = [...new Set(data.map(row => row.year))].sort();

  const counts = years.map(year => {
    let yearData = data.filter(row => row.year === year);
    // Filter out NATIONAL rows only (include districts)
    yearData = yearData.filter(row => row.abbr !== 'NATIONAL');

    let count;

    if (category === 'bellwether') {
      count = yearData.filter(row => {
        const relMargin = parseFloat(row.relative_margin);
        return !isNaN(relMargin) && Math.abs(relMargin) < bellwetherThreshold;
      }).length;
    } else {
      count = yearData.filter(row => {
        const presMargin = parseFloat(row.pres_margin);
        return !isNaN(presMargin) && Math.abs(presMargin) < closeThreshold;
      }).length;
    }

    return { year, count };
  });

  return counts;
}

// Format margin string
function formatMargin(value) {
  if (Math.abs(value) < 0.000005) return 'EVEN';
  const pct = (Math.abs(value) * 100).toFixed(1);
  return value > 0 ? `D+${pct}` : `R+${pct}`;
}

// Format votes with commas
function formatVotes(value) {
  return Math.abs(value).toLocaleString();
}

function marginSign(value) {
  if (isNaN(value)) return null;
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : -1;
}

// Update visualization based on display type
function updateVisualization() {
  const { displayType } = state;

  // Hide all containers
  document.getElementById('barChartContainer').style.display = 'none';
  document.getElementById('histogramContainer').style.display = 'none';
  document.getElementById('tableContainer').style.display = 'none';
  const outcomeContainer = document.getElementById('outcomeTableContainer');
  if (outcomeContainer) outcomeContainer.style.display = 'none';
  document.getElementById('loadingMsg').style.display = 'none';

  // Hide year control when viewing bar chart (bar shows counts across years)
  const yc = document.getElementById('yearControl');
  if (yc) yc.style.display = (displayType === 'bar' || displayType === 'outcome') ? 'none' : 'flex';

  toggleControlsForDisplay();

  // Show appropriate container
  if (displayType === 'bar') {
    document.getElementById('barChartContainer').style.display = 'block';
    renderBarChart();
  } else if (displayType === 'histogram') {
    document.getElementById('histogramContainer').style.display = 'block';
    renderHistogram();
  } else if (displayType === 'table') {
    document.getElementById('tableContainer').style.display = 'block';
    renderTable();
  } else if (displayType === 'outcome') {
    refreshOutcomeControls();
    if (outcomeContainer) outcomeContainer.style.display = 'block';
    renderOutcomeTable();
  } else {
    document.getElementById('tableContainer').style.display = 'block';
    renderTable();
  }
  // If the user selected the detailed table, the detailPanel is redundant — hide it
  const detailPanel = document.getElementById('detailPanel');
  if (detailPanel) {
    detailPanel.style.display = (displayType === 'table' || displayType === 'outcome') ? 'none' : detailPanel.style.display;
  }
  // Hide/disable the All Years checkbox (and its label text) when in table view
  const allChk = document.getElementById('allYearsCheckbox');
  if (allChk) {
    const parentLabel = allChk.closest('label') || allChk.parentElement;
    if (displayType === 'table' || displayType === 'outcome') {
      if (parentLabel) parentLabel.style.display = 'none';
      allChk.disabled = true;
    } else {
      if (parentLabel) parentLabel.style.display = '';
      allChk.disabled = false;
    }
  }
  updateTitle();
}

function toggleControlsForDisplay() {
  const isOutcome = state.displayType === 'outcome';
  const catRow = document.getElementById('categoryRow');
  if (catRow) catRow.style.display = isOutcome ? 'none' : 'flex';

  const outcomeControls = document.getElementById('outcomeControls');
  if (outcomeControls) outcomeControls.style.display = isOutcome ? 'block' : 'none';

  const bellControls = document.getElementById('bellwetherControls');
  const closeControls = document.getElementById('closeControls');

  if (isOutcome) {
    if (bellControls) bellControls.style.display = 'none';
    if (closeControls) closeControls.style.display = 'none';
    return;
  }

  if (state.category === 'bellwether') {
    if (bellControls) bellControls.style.display = 'block';
    if (closeControls) closeControls.style.display = 'none';
  } else {
    if (bellControls) bellControls.style.display = 'none';
    if (closeControls) closeControls.style.display = 'block';
  }
}

// Update title based on current settings
function updateTitle() {
  const { year, category, displayType } = state;
  const categoryLabel = category === 'bellwether' ? 'Bellwether States' : 'Close States';
  const yearLabel = year === 'all' ? 'All Years' : year;

  let title = '';
  const thresholdLabel = category === 'bellwether'
    ? `${(state.bellwetherThreshold * 100).toFixed(1)}% threshold`
    : `${(state.closeThreshold * 100).toFixed(1)}% threshold`;

  if (displayType === 'bar') {
    title = `${categoryLabel}: Count by Year — ${thresholdLabel}`;
  } else if (displayType === 'histogram') {
    title = `${categoryLabel}: Margin Distribution (${yearLabel}) — ${thresholdLabel}`;
  } else if (displayType === 'table') {
    title = `${categoryLabel}: Detailed List (${yearLabel}) — ${thresholdLabel}`;
  } else if (displayType === 'outcome') {
    const outcomeLabel = state.outcomeType === 'pv' ? 'Popular Vote' : 'Electoral College';
    const streakLabel = state.streakThreshold === 1
      ? '1 election minimum'
      : `${state.streakThreshold} election minimum`;
    title = `Outcome Streaks (${outcomeLabel}) — ${streakLabel}`;
  } else {
    title = `${categoryLabel}: Detailed List (${yearLabel}) — ${thresholdLabel}`;
  }

  document.getElementById('vizTitle').textContent = title;
}

// Render bar chart showing count over years
function renderBarChart() {
  const counts = getCountsByYear();

  const margin = { top: 20, right: 30, bottom: 60, left: 50 };
  const svg = d3.select('#barChart');
  const containerWidth = svg.node().parentNode.clientWidth;
  const width = containerWidth - margin.left - margin.right;
  const height = 400 - margin.top - margin.bottom;

  svg.selectAll('*').remove();

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // remove any old bar tooltips and create a single tooltip for the bar chart
  d3.selectAll('.bar-tooltip').remove();
  const tooltip = d3.select('body').append('div')
    .attr('class', 'tooltip bar-tooltip')
    .style('position', 'absolute')
    .style('background', 'var(--card)')
    .style('border', '1px solid var(--border)')
    .style('border-radius', '8px')
    .style('padding', '8px')
    .style('pointer-events', 'none')
    .style('opacity', 0)
    .style('z-index', 1000);

  // Create scales
  const x = d3.scaleBand()
    .domain(counts.map(d => d.year))
    .range([0, width])
    .padding(0.2);

  const y = d3.scaleLinear()
    .domain([0, d3.max(counts, d => d.count)])
    .nice()
    .range([height, 0]);

  // Add axes
  g.append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x).tickValues(
      x.domain().filter((d, i) => i % 4 === 0) // Show every 4th year
    ))
    .selectAll('text')
    .attr('transform', 'rotate(-45)')
    .style('text-anchor', 'end')
    .style('fill', 'var(--fg)');

  g.append('g')
    .attr('class', 'axis')
    .call(d3.axisLeft(y))
    .selectAll('text')
    .style('fill', 'var(--fg)');

  // Style axis lines
  g.selectAll('.axis path, .axis line')
    .style('stroke', 'var(--border)');

  // Add bars with animation
  g.selectAll('.bar')
    .data(counts)
    .join('rect')
    .attr('class', 'bar')
    .attr('x', d => x(d.year))
    .attr('width', x.bandwidth())
    .attr('y', height)
    .attr('height', 0)
    .attr('fill', state.category === 'bellwether' ? '#66b3ff' : '#ff6b6b')
    .style('opacity', 0.8)
    .on('mouseover', function (event, d) {
      d3.select(this).style('opacity', 1);

      // Tooltip: show year and list of matching states + pres_margin_str
      const year = d.year;
      const rowsForYear = state.data.filter(r => r.year === year && r.abbr !== 'NATIONAL');
      let matches = [];
      if (state.category === 'bellwether') {
        matches = rowsForYear.filter(r => {
          const rel = parseFloat(r.relative_margin);
          return !isNaN(rel) && Math.abs(rel) < state.bellwetherThreshold;
        }).map(r => ({ abbr: r.abbr, margin: r.relative_margin_str || (r.relative_margin !== undefined ? formatMargin(parseFloat(r.relative_margin)) : '') }));
      } else {
        matches = rowsForYear.filter(r => {
          const m = parseFloat(r.pres_margin);
          return !isNaN(m) && Math.abs(m) < state.closeThreshold;
        }).map(r => ({ abbr: r.abbr, margin: r.pres_margin_str || (r.pres_margin !== undefined ? formatMargin(parseFloat(r.pres_margin)) : '') }));
      }

      const listHtml = matches.length === 0 ? '<div style="color:var(--muted)">No matching states</div>' : matches.slice(0, 30).map(m => `${m.abbr}: ${m.margin}`).join('<br>');

      tooltip.style('opacity', 1)
        .html(`<strong>${year}</strong><br>Count: ${d.count}<br>${listHtml}${matches.length > 30 ? '<br>...' : ''}`)
        .style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY - 10) + 'px');
    })
    .on('mouseout', function () {
      d3.select(this).style('opacity', 0.8);
      tooltip.style('opacity', 0);
    })
    // click opens detail panel for that year
    .on('click', function (event, d) {
      const year = d.year;
      const rowsForYear = state.data.filter(r => r.year === year && r.abbr !== 'NATIONAL');
      // For the selected category, filter
      let matches = [];
      if (state.category === 'bellwether') {
        matches = rowsForYear.filter(r => {
          const rel = parseFloat(r.relative_margin);
          return !isNaN(rel) && Math.abs(rel) < state.bellwetherThreshold;
        });
      } else {
        matches = rowsForYear.filter(r => {
          const m = parseFloat(r.pres_margin);
          return !isNaN(m) && Math.abs(m) < state.closeThreshold;
        });
      }
      showDetailPanel(`${state.category === 'bellwether' ? 'Bellwether' : 'Close'} states — ${year}`, matches);
    })
    .transition()
    .duration(800)
    .attr('y', d => y(d.count))
    .attr('height', d => height - y(d.count));

  // Add count labels
  g.selectAll('.label')
    .data(counts)
    .join('text')
    .attr('class', 'label')
    .attr('x', d => x(d.year) + x.bandwidth() / 2)
    .attr('y', height)
    .attr('text-anchor', 'middle')
    .style('fill', 'var(--fg)')
    .style('font-size', '10px')
    .style('opacity', 0)
    .text(d => d.count)
    .transition()
    .duration(800)
    .attr('y', d => y(d.count) - 5)
    .style('opacity', 1);
}

// Render histogram showing margin distribution
function renderHistogram() {
  const filtered = filterData();
  const { category, year } = state;

  const margin = { top: 20, right: 30, bottom: 60, left: 50 };
  const svg = d3.select('#histogram');
  const containerWidth = svg.node().parentNode.clientWidth;
  const width = containerWidth - margin.left - margin.right;
  const height = 400 - margin.top - margin.bottom;

  svg.selectAll('*').remove();

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Get margin values based on category
  const marginKey = category === 'bellwether' ? 'relative_margin' : 'pres_margin';
  const values = filtered
    .map(row => parseFloat(row[marginKey]))
    .filter(v => !isNaN(v));

  if (values.length === 0) {
    g.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .style('fill', 'var(--muted)')
      .text('No data for selected criteria');
    return;
  }

  // Create bins
  const threshold = category === 'bellwether' ? state.bellwetherThreshold : state.closeThreshold;
  const histogram = d3.bin()
    .domain([-threshold, threshold])
    .thresholds(20);
  const bins = histogram(values);

  // Create scales
  const x = d3.scaleLinear()
    .domain([-threshold, threshold])
    .range([0, width]);

  const y = d3.scaleLinear()
    .domain([0, d3.max(bins, d => d.length)])
    .nice()
    .range([height, 0]);

  // Add axes
  const xAxis = g.append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x).ticks(10).tickFormat(d => {
      if (Math.abs(d) < 0.000005) return category === 'bellwether' ? 'NAT. MARGIN' : 'EVEN';
      return formatMargin(d);
    }))
    .selectAll('text')
    .style('fill', 'var(--fg)');

  g.append('g')
    .attr('class', 'axis')
    .call(d3.axisLeft(y))
    .selectAll('text')
    .style('fill', 'var(--fg)');

  // Style axis lines
  g.selectAll('.axis path, .axis line')
    .style('stroke', 'var(--border)');

  // Add center line
  g.append('line')
    .attr('x1', x(0))
    .attr('x2', x(0))
    .attr('y1', 0)
    .attr('y2', height)
    .style('stroke', 'var(--accent)')
    .style('stroke-width', 2)
    .style('stroke-dasharray', '5,5');

  // Create tooltip
  const tooltip = d3.select('body').append('div')
    .attr('class', 'tooltip')
    .style('position', 'absolute')
    .style('background', 'var(--card)')
    .style('border', '1px solid var(--border)')
    .style('border-radius', '8px')
    .style('padding', '8px')
    .style('pointer-events', 'none')
    .style('opacity', 0)
    .style('z-index', 1000);

  // Add bars with animation
  g.selectAll('.bar')
    .data(bins)
    .join('rect')
    .attr('class', 'bar')
    .attr('x', d => x(d.x0))
    .attr('width', d => Math.max(0, x(d.x1) - x(d.x0) - 1))
    .attr('y', height)
    .attr('height', 0)
    .attr('fill', d => {
      if (d.x0 < 0 && d.x1 > 0) return 'var(--accent)';
      return d.x0 >= 0 ? '#4169E1' : '#B22222';
    })
    .style('opacity', 0.7)
    .on('mouseover', function (event, d) {
      d3.select(this).style('opacity', 1);

      // Get states in this bin
      const statesInBin = filtered.filter(row => {
        const val = parseFloat(row[marginKey]);
        return val >= d.x0 && val < d.x1;
      });

      const tooltipText = statesInBin
        .slice(0, 10)
        .map(row => {
          const val = parseFloat(row[marginKey]);
          const marginStr = category === 'bellwether'
            ? row.relative_margin_str
            : row.pres_margin_str;
          return `${row.abbr}: ${marginStr}`;
        })
        .join('<br>');

      tooltip
        .style('opacity', 1)
        .html(`Count: ${d.length}<br>${tooltipText}${statesInBin.length > 10 ? '<br>...' : ''}`)
        .style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY - 10) + 'px');
    })
    .on('mouseout', function () {
      d3.select(this).style('opacity', 0.7);
      tooltip.style('opacity', 0);
    })
    .on('click', function (event, d) {
      // find states in this bin, then open detail panel
      const statesInBin = filtered.filter(row => {
        const val = parseFloat(row[marginKey]);
        return val >= d.x0 && val < d.x1;
      });
      showDetailPanel(`${state.category === 'bellwether' ? 'Bellwether' : 'Close'} states — ${state.year === 'all' ? 'All Years' : state.year}`, statesInBin);
    })
    .transition()
    .duration(800)
    .attr('y', d => y(d.length))
    .attr('height', d => height - y(d.length));
}

// Show detail panel with a list of rows (each row should include abbr, year, pres_margin, relative_margin)
function showDetailPanel(title, rows) {
  const panel = document.getElementById('detailPanel');
  const titleEl = document.getElementById('detailTitle');
  const body = document.getElementById('detailBody');
  const closeBtn = document.getElementById('detailClose');

  titleEl.textContent = title;
  // prepare header with sortable columns
  body.innerHTML = '';
  const thead = document.querySelector('#detailTable thead');
  if (thead) {
    // build header row with clickable ths
    thead.innerHTML = '';
    const headerRow = document.createElement('tr');
    const headers = [
      { key: 'abbr', label: 'State' },
      { key: 'year', label: 'Year' },
      { key: 'pres_margin', label: 'Pres. Margin' },
      { key: 'relative_margin', label: 'Rel. Margin' }
    ];

    // sort state for panel
    let sortKey = null;
    let sortDir = 'asc';

    function renderBody() {
      body.innerHTML = '';
      if (!rows || rows.length === 0) {
        body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted)">No matching rows</td></tr>';
        return;
      }

      // make a copy and sort it
      const sorted = [...rows].sort((a, b) => {
        if (!sortKey) return 0;
        let aVal = a[sortKey];
        let bVal = b[sortKey];
        // numeric keys
        if (sortKey === 'pres_margin' || sortKey === 'relative_margin' || sortKey === 'year') {
          aVal = parseFloat(aVal);
          bVal = parseFloat(bVal);
          if (isNaN(aVal)) aVal = 0;
          if (isNaN(bVal)) bVal = 0;
        } else {
          // string compare
          aVal = (aVal || '').toString();
          bVal = (bVal || '').toString();
        }
        if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });

      sorted.forEach(r => {
        const tr = document.createElement('tr');
        const tdState = document.createElement('td'); tdState.textContent = r.abbr || '';
        const tdYear = document.createElement('td'); tdYear.textContent = r.year || '';
        const tdPres = document.createElement('td'); tdPres.textContent = r.pres_margin_str || (r.pres_margin !== undefined ? formatMargin(parseFloat(r.pres_margin)) : '');
        const tdRel = document.createElement('td'); tdRel.textContent = r.relative_margin_str || (r.relative_margin !== undefined ? formatMargin(parseFloat(r.relative_margin)) : '');
        tr.appendChild(tdState); tr.appendChild(tdYear); tr.appendChild(tdPres); tr.appendChild(tdRel);
        body.appendChild(tr);
      });
    }

    headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h.label;
      th.style.cursor = 'pointer';
      th.dataset.key = h.key;
      th.addEventListener('click', () => {
        if (sortKey === h.key) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortKey = h.key;
          sortDir = 'asc';
        }
        // update header arrows
        Array.from(thead.querySelectorAll('th')).forEach(t => { t.textContent = headers.find(hh => hh.key === t.dataset.key).label; });
        th.textContent = h.label + (sortDir === 'asc' ? ' ▲' : ' ▼');
        renderBody();
      });
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    // initial render
    renderBody();
  }

  panel.style.display = 'block';
  closeBtn.onclick = () => { panel.style.display = 'none'; };
}

// Render table with sorting
function renderTable() {
  const filtered = filterData();
  const { category, year } = state;

  const tableHeader = document.getElementById('tableHeader');
  const tableBody = document.getElementById('tableBody');

  // Clear existing content
  tableHeader.innerHTML = '';
  tableBody.innerHTML = '';

  if (filtered.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--muted)">No data for selected criteria</td></tr>';
    return;
  }

  // Create headers based on category and year
  const headers = [];
  headers.push({ key: 'abbr', label: 'Unit', sortable: true });

  if (category === 'bellwether') {
    headers.push({
      key: 'relative_margin',
      label: year === 'all' ? 'Margin' : `${year} Margin`,
      sortable: true
    });
    // Add Streak column for detailed table view (bellwether only)
    if (state.displayType === 'table') {
      headers.push({ key: 'streak', label: 'Streak', sortable: true });
    }

    // Show 2024 status for any specific year (including 2024) but only show
    // margin change and 2024 relative margin when the selected year is NOT 2024.
    if (year !== 'all') {
      headers.push({ key: 'is_2024_bellwether', label: '2024 Status', sortable: true });
    }
    if (year !== 'all' && year !== '2024') {
      //headers.push({ key: 'margin_change', label: `${year} → 2024`, sortable: true });
      headers.push({ key: 'relative_margin_2024', label: '2024 Margin', sortable: true });
    }
  } else {
    headers.push({
      key: 'pres_margin',
      label: year === 'all' ? 'Margin' : `${year} Margin`,
      sortable: true
    });
    headers.push({ key: 'vote_difference', label: 'Vote Difference', sortable: true });
  }

  //headers.push({ key: 'electoral_votes', label: 'EV', sortable: true });

  // Create header row
  headers.forEach(header => {
    const th = document.createElement('th');
    th.textContent = header.label;
    if (header.sortable) {
      th.classList.add('sortable');
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => sortTable(header.key));

      if (state.sortColumn === header.key) {
        th.innerHTML += state.sortDirection === 'asc' ? ' ▲' : ' ▼';
      }
    }
    tableHeader.appendChild(th);
  });

  // Prepare data with computed fields
  const tableData = filtered.map(row => {
    const result = { ...row };

    if (category === 'bellwether' && year !== 'all') {
      // Check if state is bellwether in 2024 for any specific selected year (including 2024)
      const state2024 = state.data.find(r => r.abbr === row.abbr && r.year === '2024');
      if (state2024) {
        const rel2024 = parseFloat(state2024.relative_margin);
        result.is_2024_bellwether = !isNaN(rel2024) && Math.abs(rel2024) < state.bellwetherThreshold;
        result.relative_margin_2024 = rel2024;

        // Ensure formatted strings are present
        result.pres_margin_str = row.pres_margin_str || (row.pres_margin !== undefined ? formatMargin(parseFloat(row.pres_margin)) : '');
        result.relative_margin_str = row.relative_margin_str || (row.relative_margin !== undefined ? formatMargin(parseFloat(row.relative_margin)) : '');
        result.pres_margin_2024_str = state2024.pres_margin_str || (state2024.pres_margin !== undefined ? formatMargin(parseFloat(state2024.pres_margin)) : '');
        result.relative_margin_2024_str = state2024.relative_margin_str || (state2024.relative_margin !== undefined ? formatMargin(parseFloat(state2024.relative_margin)) : '');

        // Only compute margin_change when comparing a prior year to 2024
        if (year !== '2024') {
          const relCurrent = parseFloat(row.relative_margin);
          if (!isNaN(relCurrent) && !isNaN(rel2024)) {
            result.margin_change = rel2024 - relCurrent;
          }
        }

        // compute the most recent year this unit was a bellwether across all data
        const candidates = state.data
          .filter(r => r.abbr === row.abbr)
          .map(r => ({ year: parseInt(r.year, 10), rec: r }))
          .filter(x => !isNaN(x.year))
          .filter(x => {
            const rel = parseFloat(x.rec.relative_margin);
            return !isNaN(rel) && Math.abs(rel) < state.bellwetherThreshold;
          });
        if (candidates.length > 0) {
          const maxYear = Math.max(...candidates.map(c => c.year));
          result.last_bellwether_year = String(maxYear);
        }
      }
    }

    if (category === 'close') {
      const dVotes = parseFloat(row.D_votes) || 0;
      const rVotes = parseFloat(row.R_votes) || 0;
      result.vote_difference = Math.abs(dVotes - rVotes);
    }

    // Compute streaks for bellwether units (across all years) and pick the
    // streak that includes this row's year if possible; otherwise pick the
    // most recent streak. Also record the end year of the previous streak.
    if (category === 'bellwether') {
      const thisYear = parseInt(row.year, 10);
      // collect all bellwether years for this unit
      const bellYears = state.data
        .filter(r => r.abbr === row.abbr)
        .filter(r => {
          const rel = parseFloat(r.relative_margin);
          return !isNaN(rel) && Math.abs(rel) < state.bellwetherThreshold;
        })
        .map(r => parseInt(r.year, 10))
        .filter(y => !isNaN(y))
        .sort((a, b) => a - b);

      if (bellYears.length > 0) {
        // group into streaks (consecutive 4-year steps)
        const streaks = [];
        let s = bellYears[0];
        let e = bellYears[0];
        for (let i = 1; i < bellYears.length; i++) {
          if (bellYears[i] === e + 4) {
            e = bellYears[i];
          } else {
            streaks.push({ start: s, end: e, length: Math.floor((e - s) / 4) + 1 });
            s = bellYears[i];
            e = bellYears[i];
          }
        }
        streaks.push({ start: s, end: e, length: Math.floor((e - s) / 4) + 1 });

        // find streak that includes thisYear
        let currentIdx = -1;
        if (!isNaN(thisYear)) {
          currentIdx = streaks.findIndex(st => thisYear >= st.start && thisYear <= st.end);
        }
        // if not found, choose the most recent streak (last in array)
        if (currentIdx === -1) currentIdx = streaks.length - 1;

        if (currentIdx >= 0 && streaks[currentIdx]) {
          const cur = streaks[currentIdx];
          result.streak = cur.length;
          result.streak_range = `${cur.start}–${cur.end}`;
          if (currentIdx - 1 >= 0) {
            const prev = streaks[currentIdx - 1];
            result.prev_streak_range = `${prev.start}–${prev.end}`;
          }
        }
        // also store the most recent (latest) streak for display in 2024 status
        const latest = streaks[streaks.length - 1];
        if (latest) {
          result.latest_streak_length = latest.length;
          result.latest_streak_range = `${latest.start}–${latest.end}`;
        }
      }
    }

    return result;
  });

  // Sort data
  const sortedData = sortTableData(tableData);

  // Create table rows with animation
  sortedData.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.style.opacity = '0';

    headers.forEach(header => {
      const td = document.createElement('td');

      switch (header.key) {
        case 'abbr':
          td.textContent = row.abbr + (' (' + (row.electoral_votes || '0') + ' EV' + (row.electoral_votes > 1 ? 's' : '') + ')');
          break;
        case 'relative_margin':
          // Show both raw pres margin and relative margin
          if (row.pres_margin_str || row.relative_margin_str) {
            td.innerHTML = `${row.pres_margin_str ? 'Raw: ' + row.pres_margin_str : ''}` + (row.pres_margin_str && row.relative_margin_str ? '<br>' : '') + `${row.relative_margin_str ? 'Relative: ' + row.relative_margin_str : ''}`;
          } else {
            td.textContent = '';
          }
          break;
        case 'pres_margin':
          // Keep pres_margin cell if ever used separately
          td.textContent = row.pres_margin_str || '';
          break;
        case 'electoral_votes':
          td.textContent = row.electoral_votes || '';
          break;
        case 'is_2024_bellwether':
          td.textContent = row.is_2024_bellwether ? '✓' : '✗';
          td.style.color = row.is_2024_bellwether ? '#4ade80' : '#f87171';
          // if (!row.is_2024_bellwether && row.last_bellwether_year) {
          //   td.innerHTML += `<br><span style="font-size:0.85rem;color:var(--muted)">Last: ${row.last_bellwether_year}</span>`;
          // }
          // show latest streak (most recent) beneath the status if available
          if (row.latest_streak_range) {
            const to_2024_streak_length = row.latest_streak_length || '';
            td.innerHTML += `<br><span style="font-size:0.85rem;color:var(--muted)">Latest streak: ${row.latest_streak_range} (${to_2024_streak_length})</span>`;
          }
          break;
        case 'margin_change':
          if (row.margin_change !== undefined) {
            td.textContent = `${formatMargin(row.margin_change)} ${getLeanStr(row.margin_change)}`;
          }
          break;
        case 'relative_margin_2024':
          // Show both raw (if available) and relative margin for 2024 when present
          if (row.relative_margin_2024_str || row.relative_margin_2024 !== undefined) {
            const raw = row.pres_margin_2024_str ? 'Raw: ' + row.pres_margin_2024_str : (row.pres_margin_2024 !== undefined ? 'Raw: ' + formatMargin(row.pres_margin_2024) : '');
            const rel = row.relative_margin_2024_str ? 'Relative: ' + row.relative_margin_2024_str : (row.relative_margin_2024 !== undefined ? 'Relative: ' + formatMargin(row.relative_margin_2024) : '');
            const delta = row.margin_change;
            td.innerHTML = `${raw}${raw && rel ? '<br>' : ''}${rel}<br>Δ ${delta !== undefined ? formatMargin(delta) + ' ' + getLeanStr(delta) : ''}`;
          }
          break;
        case 'streak':
          if (row.streak !== undefined) {
            const range = row.streak_range ? row.streak_range : '';
            td.innerHTML = `${row.streak}${range ? ' (' + range + ')' : ''}`;
            if (row.prev_streak_range) {
              td.innerHTML += `<br><span style="font-size:0.85rem;color:var(--muted)">Previous streak: ${row.prev_streak_range}</span>`;
            }
          }
          break;
        case 'vote_difference':
          if (row.vote_difference !== undefined) {
            td.textContent = formatVotes(row.vote_difference);
          }
          break;
      }

      tr.appendChild(td);
    });
    tableBody.appendChild(tr);

    // Animate row appearance
    setTimeout(() => {
      tr.style.transition = 'opacity 0.3s';
      tr.style.opacity = '1';
    }, index * 20);

    // Click row to open detail panel for that single row
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => {
      showDetailPanel(`${row.abbr} — ${row.year}`, [row]);
    });
  });
}

function renderOutcomeTable() {
  const headerEl = document.getElementById('outcomeTableHeader');
  const bodyEl = document.getElementById('outcomeTableBody');
  if (!headerEl || !bodyEl) return;

  headerEl.innerHTML = '';
  bodyEl.innerHTML = '';

  const rows = computeOutcomeRows();

  if (rows.length === 0) {
    bodyEl.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:40px;color:var(--muted)">No outcome streaks meet the current filters</td></tr>';
    return;
  }

  const columns = [
    { key: 'unit', label: 'Unit', sortable: true },
    { key: 'longest', label: 'Longest Streak', sortable: true },
    { key: 'recent', label: 'Most Recent Streak', sortable: true },
    { key: 'status', label: 'Status', sortable: true }
  ];

  columns.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (col.sortable) {
      th.classList.add('sortable');
      th.style.cursor = 'pointer';
      if (state.outcomeSortColumn === col.key) {
        th.innerHTML = `${col.label} ${state.outcomeSortDirection === 'asc' ? '▲' : '▼'}`;
      }
      th.addEventListener('click', () => {
        if (state.outcomeSortColumn === col.key) {
          state.outcomeSortDirection = state.outcomeSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          state.outcomeSortColumn = col.key;
          state.outcomeSortDirection = col.key === 'unit' ? 'asc' : 'desc';
        }
        renderOutcomeTable();
      });
    }
    headerEl.appendChild(th);
  });

  const sortedRows = sortOutcomeRows(rows);

  sortedRows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.style.opacity = '0';

    columns.forEach(col => {
      const td = document.createElement('td');
      switch (col.key) {
        case 'unit': {
          const ev = row.meta && row.meta.electoralVotes ? ` (${row.meta.electoralVotes} EV)` : '';
          td.textContent = row.abbr + ev;
          break;
        }
        case 'longest':
          renderStreakIntoCell(row.longest, td, false);
          break;
        case 'recent':
          renderStreakIntoCell(row.mostRecent, td, true);
          break;
        case 'status':
          renderStatusIntoCell(row, td);
          break;
        default:
          td.textContent = '';
      }
      tr.appendChild(td);
    });

    bodyEl.appendChild(tr);

    setTimeout(() => {
      tr.style.transition = 'opacity 0.3s';
      tr.style.opacity = '1';
    }, idx * 20);
  });
}

function computeOutcomeRows() {
  const rows = [];
  if (!state.nationalByYear || state.nationalByYear.size === 0) return rows;

  const unitEntries = new Map();
  const unitMeta = new Map();

  state.data.forEach(row => {
    if (row.abbr === 'NATIONAL') return;
    const year = parseInt(row.year, 10);
    if (isNaN(year)) return;
    const nat = state.nationalByYear.get(year);
    if (!nat) return;
    const presMargin = parseFloat(row.pres_margin);
    if (isNaN(presMargin)) return;
    const unitSign = marginSign(presMargin);
    if (unitSign === null) return;

    let targetSign = nat.sign;
    if (state.outcomeType === 'ec' && EC_MISMATCH_YEARS.has(year)) {
      targetSign = targetSign === null ? null : -targetSign;
    }
    if (targetSign === null) return;

    const success = unitSign === targetSign;
    const list = unitEntries.get(row.abbr) || [];
    list.push({
      year,
      success,
      electoralVotes: parseInt(row.electoral_votes, 10)
    });
    unitEntries.set(row.abbr, list);

    const meta = unitMeta.get(row.abbr) || { electoralVotes: null };
    const ev = parseInt(row.electoral_votes, 10);
    if (!isNaN(ev)) {
      if (meta.electoralVotes === null || year === state.latestYear) {
        meta.electoralVotes = ev;
      }
    }
    unitMeta.set(row.abbr, meta);
  });

  unitEntries.forEach((entries, abbr) => {
  entries.sort((a, b) => a.year - b.year);
  const sequences = buildOutcomeSequences(entries, state.maxAllowedMisses || 0);
    const qualifying = sequences.filter(seq => seq.length >= state.streakThreshold);
    if (qualifying.length === 0) return;

    const longest = qualifying.reduce((best, seq) => {
      if (!best) return seq;
      if (seq.length > best.length) return seq;
      if (seq.length === best.length && seq.endYear > best.endYear) return seq;
      return best;
    }, null);

    const mostRecent = qualifying.reduce((best, seq) => {
      if (!best) return seq;
      if (seq.endYear > best.endYear) return seq;
      if (seq.endYear === best.endYear && seq.length > best.length) return seq;
      return best;
    }, null);

    const currentCandidates = qualifying.filter(seq => seq.endYear === state.latestYear);
    let current = null;
    if (currentCandidates.length > 0) {
      current = currentCandidates.reduce((best, seq) => {
        if (!best) return seq;
        if (seq.length > best.length) return seq;
        if (seq.length === best.length && seq.startYear > best.startYear) return seq;
        return best;
      }, null);
    }

    const onCurrent = Boolean(current);
    if (state.onlyCurrentStreak && !onCurrent) return;

    rows.push({
      abbr,
      meta: unitMeta.get(abbr) || {},
      longest,
      mostRecent,
      current,
      onCurrent
    });
  });

  return rows;
}

function buildOutcomeSequences(entries, maxAllowedMisses) {
  const sequences = [];

  // maxAllowedMisses: 0,1,2
  const maxMiss = Math.max(0, Math.min(2, parseInt(maxAllowedMisses, 10) || 0));

  for (let i = 0; i < entries.length; i++) {
    if (!entries[i].success) continue;

    let lastYear = entries[i].year;
    let length = 1;
    let misses = [];
    let endYear = entries[i].year;
    let missCount = 0;
    let j = i + 1;

    while (j < entries.length) {
      const next = entries[j];
      const gap = next.year - lastYear;
      if (gap !== 4) break;

      if (next.success) {
        length += 1;
        lastYear = next.year;
        endYear = next.year;
        j += 1;
        continue;
      }

      // next is a miss; attempt to bridge up to maxMiss misses in a row
      if (missCount >= maxMiss) break;

      // try to see if we can bridge with k misses where k <= maxMiss - missCount
      let bridged = false;
      for (let k = 1; k <= (maxMiss - missCount); k++) {
        // ensure we have at least k missed entries followed by a success at the correct steps
        if (j + k >= entries.length) break;
        const after = entries[j + k];
        // after must be success and consecutive 4-year steps across the block
        let ok = after.success;
        // check the spacing between successive years in the block
        let prevYear = lastYear;
        for (let m = 0; m <= k; m++) {
          const idx = j + m;
          if (idx >= entries.length) { ok = false; break; }
          const yr = entries[idx].year;
          if (yr - prevYear !== 4) { ok = false; break; }
          prevYear = yr;
        }
        if (!ok) continue;

        // we can bridge these k misses
        for (let m = 0; m < k; m++) {
          misses.push(entries[j + m].year);
        }
        missCount += k;
        length += 1; // bridged sequence gains one for the after.success year
        lastYear = after.year;
        endYear = after.year;
        j = j + k + 1;
        bridged = true;
        break;
      }

      if (!bridged) break;
    }

    sequences.push({
      startYear: entries[i].year,
      endYear,
      length,
      missYears: misses.slice()
    });
  }

  // dedupe: prefer longer sequences when duplicates arise
  const dedup = new Map();
  sequences.forEach(seq => {
    const key = `${seq.startYear}-${seq.endYear}-${seq.missYears.join('|')}`;
    if (!dedup.has(key) || dedup.get(key).length < seq.length) {
      dedup.set(key, seq);
    }
  });

  return [...dedup.values()];
}

function formatOutcomeStreak(streak, includeActiveNote) {
  if (!streak) return '—';
  const range = streak.startYear === streak.endYear
    ? `${streak.startYear}`
    : `${streak.startYear}-${streak.endYear}`;
  const total = Math.floor((streak.endYear - streak.startYear) / 4) + 1;
  const lengthLabel = total === 1 ? `${streak.length}/${total} election` : `${streak.length}/${total} elections`;
  const activeLabel = includeActiveNote && streak.endYear === state.latestYear ? ' | Active' : '';
  const missLabel = streak.missYears && streak.missYears.length > 0
    ? ` | Missed ${streak.missYears.join(', ')}`
    : '';
  // keep legacy string form (with <br>) for backwards compatibility
  return `${range} | ${lengthLabel}${missLabel}${activeLabel}`;
}

// Return array of parts to render on separate lines: [range, length, missed?, active?]
function formatOutcomeStreakParts(streak, includeActiveNote) {
  if (!streak) return [];
  const range = streak.startYear === streak.endYear ? `${streak.startYear}` : `${streak.startYear}-${streak.endYear}`;
  const total = Math.floor((streak.endYear - streak.startYear) / 4) + 1;
  const lengthLabel = total === 1 ? `${streak.length}/${total} election` : `${streak.length}/${total} elections`;
  const parts = [range, lengthLabel];
  if (streak.missYears && streak.missYears.length > 0) {
    parts.push(`Missed ${streak.missYears.join(', ')}`);
  }
  if (includeActiveNote && streak.endYear === state.latestYear) {
    parts.push('Active');
  }
  return parts;
}

function renderStreakIntoCell(streak, td, includeActiveNote) {
  td.innerHTML = '';
  const parts = formatOutcomeStreakParts(streak, includeActiveNote);
  if (!parts || parts.length === 0) {
    td.textContent = '—';
    return;
  }

  parts.forEach((p, idx) => {
    const d = document.createElement('div');
    // first line (range) a bit bolder
    if (idx === 0) d.style.fontWeight = '600';
    // missed-years and active get muted/smaller style
    if (p.startsWith('Missed')) {
      d.style.color = 'var(--muted)';
      d.style.fontSize = '0.9rem';
    }
    if (p === 'Active') {
      d.style.color = 'var(--accent)';
      d.style.fontSize = '0.9rem';
    }
    d.textContent = p;
    td.appendChild(d);
  });
}

// Render the status column using multiple lines similar to streak cells.
function renderStatusIntoCell(row, td) {
  td.innerHTML = '';

  // Active/current streak
  if (row.onCurrent && row.current) {
    const parts = [];
    const range = row.current.startYear === row.current.endYear
      ? `${row.current.startYear}`
      : `${row.current.startYear}-${row.current.endYear}`;
    parts.push(range);
    const totalCur = Math.floor((row.current.endYear - row.current.startYear) / 4) + 1;
    const lengthLabel = totalCur === 1 ? `${row.current.length}/${totalCur} election` : `${row.current.length}/${totalCur} elections`;
    parts.push(lengthLabel);
    if (row.current.missYears && row.current.missYears.length > 0) {
      parts.push(`Missed ${row.current.missYears.join(', ')}`);
    }
    parts.push('Active');

    parts.forEach((p, idx) => {
      const d = document.createElement('div');
      if (idx === 0) d.style.fontWeight = '600';
      if (p.startsWith('Missed')) { d.style.color = 'var(--muted)'; d.style.fontSize = '0.9rem'; }
      if (p === 'Active') { d.style.color = 'var(--accent)'; d.style.fontSize = '0.9rem'; d.style.fontWeight = '600';}
      d.textContent = p;
      td.appendChild(d);
    });
    return;
  }

  // Inactive but with a most recent qualifying streak
  if (row.mostRecent) {
    const parts = [];
    parts.push('Inactive');
    parts.push(`End of last streak ${row.mostRecent.endYear}`);
    if (row.mostRecent.length) {
      const totalRecent = Math.floor((row.mostRecent.endYear - row.mostRecent.startYear) / 4) + 1;
      parts.push(`${row.mostRecent.length}/${totalRecent} ${row.mostRecent.length === 1 ? 'election' : 'elections'} (${row.mostRecent.startYear}-${row.mostRecent.endYear})`);
    }

    parts.forEach((p, idx) => {
      const d = document.createElement('div');
      if (idx === 0) d.style.fontWeight = '600';
      if (idx === 1) d.style.fontSize = '0.9rem';
      d.textContent = p;
      td.appendChild(d);
    });
    return;
  }

  // Generic inactive fallback
  td.textContent = 'Inactive';
}

function formatOutcomeStatus(row) {
  if (row.onCurrent && row.current) {
    const range = row.current.startYear === row.current.endYear
      ? `${row.current.startYear}`
      : `${row.current.startYear}-${row.current.endYear}`;
    const lengthLabel = row.current.length === 1 ? '1 election' : `${row.current.length} elections`;
    const missLabel = row.current.missYears && row.current.missYears.length > 0
      ? ` (Missed ${row.current.missYears.join(', ')})`
      : '';
    return `Active | ${range} | ${lengthLabel}${missLabel}`;
  }

  const lastYear = row.mostRecent ? row.mostRecent.endYear : null;
  if (lastYear) {
    return `Inactive | last correct ${lastYear}`;
  }
  return 'Inactive';
}

function sortOutcomeRows(rows) {
  const { outcomeSortColumn, outcomeSortDirection } = state;
  const dir = outcomeSortDirection === 'asc' ? 1 : -1;

  const compare = (a, b) => {
    switch (outcomeSortColumn) {
      case 'unit': {
        const cmp = a.abbr.localeCompare(b.abbr);
        return cmp * dir;
      }
      case 'longest': {
        // Primary: numeric streak length, Secondary: most recent end year, Tertiary: abbr
        const aLen = a.longest ? a.longest.length : 0;
        const bLen = b.longest ? b.longest.length : 0;
        if (aLen !== bLen) return (aLen - bLen) * dir;
        const aYear = a.longest ? a.longest.endYear : 0;
        const bYear = b.longest ? b.longest.endYear : 0;
        if (aYear !== bYear) return (aYear - bYear) * dir;
        return a.abbr.localeCompare(b.abbr) * dir;
      }
      case 'recent': {
        // Primary: numeric length of the most recent qualifying streak
        // Secondary: end year (more recent later), tertiary: abbr
        const aLen = a.mostRecent ? a.mostRecent.length : 0;
        const bLen = b.mostRecent ? b.mostRecent.length : 0;
        if (aLen !== bLen) return (aLen - bLen) * dir;
        const aYear = a.mostRecent ? a.mostRecent.endYear : 0;
        const bYear = b.mostRecent ? b.mostRecent.endYear : 0;
        if (aYear !== bYear) return (aYear - bYear) * dir;
        return a.abbr.localeCompare(b.abbr) * dir;
      }
      case 'status': {
        const aStatus = rowStatusValue(a);
        const bStatus = rowStatusValue(b);
        if (aStatus !== bStatus) return (aStatus - bStatus) * dir;
        const aLen = a.current ? a.current.length : 0;
        const bLen = b.current ? b.current.length : 0;
        if (aLen !== bLen) return (aLen - bLen) * dir;
        const aYear = a.current ? a.current.startYear : 0;
        const bYear = b.current ? b.current.startYear : 0;
        if (aYear !== bYear) return (aYear - bYear) * dir;
        return a.abbr.localeCompare(b.abbr) * dir;
      }
      default:
        return a.abbr.localeCompare(b.abbr) * dir;
    }
  };

  rows.sort(compare);
  return rows;
}

function rowStatusValue(row) {
  if (row.onCurrent) return 2;
  if (row.mostRecent) return 1;
  return 0;
}

function formatStreakThreshold(value) {
  return value === 1 ? '1 election' : `${value} elections`;
}

function refreshOutcomeControls() {
  const outcomeTypeEl = document.getElementById('outcomeType');
  if (outcomeTypeEl) outcomeTypeEl.value = state.outcomeType;

  const streakSlider = document.getElementById('streakThreshold');
  if (streakSlider) streakSlider.value = state.streakThreshold;

  const streakLabel = document.getElementById('streakThresholdVal');
  if (streakLabel) streakLabel.textContent = formatStreakThreshold(state.streakThreshold);

  const maxMissEl = document.getElementById('maxAllowedMisses');
  if (maxMissEl) maxMissEl.value = String(state.maxAllowedMisses || 0);

  const onlyCurrent = document.getElementById('onlyCurrentStreak');
  if (onlyCurrent) onlyCurrent.checked = state.onlyCurrentStreak;
}

// Get lean direction string
function getLeanStr(delta) {
  if (Math.abs(delta) < 0.001) return '';
  return delta > 0 ? '(D)' : '(R)';
}

// Update the browser URL query string to reflect current state (year, category, display)
function updateUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (state.year) params.set('year', state.year);
    else params.delete('year');
    if (state.category) params.set('category', state.category);
    else params.delete('category');
    if (state.displayType) params.set('display', state.displayType);
    else params.delete('display');

    if (state.displayType === 'outcome') {
      params.set('outcome', state.outcomeType);
      params.set('streak', String(state.streakThreshold));
      params.set('maxMisses', String(state.maxAllowedMisses || 0));
      if (state.onlyCurrentStreak) params.set('active', '1');
      else params.delete('active');
    } else {
      params.delete('outcome');
      params.delete('streak');
      params.delete('maxMisses');
      params.delete('active');
    }

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    history.replaceState(null, '', newUrl);
  } catch (e) {
    // ignore (e.g., non-browser env)
    console.warn('Could not update URL params:', e);
  }
}

// Read URL params and apply them to state and UI controls. Called during init.
function applyUrlParamsToState() {
  try {
    const params = new URLSearchParams(window.location.search);
    const y = params.get('year');
    const c = params.get('category');
    const d = params.get('display');

    // apply category
    if (c && (c === 'bellwether' || c === 'close')) {
      state.category = c;
      const sel = document.getElementById('categorySelect');
      if (sel) sel.value = c;
    }

    // apply display
    if (d && (d === 'bar' || d === 'histogram' || d === 'table' || d === 'outcome')) {
      state.displayType = d;
      const disp = document.getElementById('displayType');
      if (disp) disp.value = d;
    }

    const outcomeParam = params.get('outcome');
    if (outcomeParam && (outcomeParam === 'pv' || outcomeParam === 'ec')) {
      state.outcomeType = outcomeParam;
    }

    const streakParam = parseInt(params.get('streak'), 10);
    if (!isNaN(streakParam)) {
      state.streakThreshold = Math.min(5, Math.max(1, streakParam));
    }

    const maxMissParam = parseInt(params.get('maxMisses'), 10);
    if (!isNaN(maxMissParam)) {
      state.maxAllowedMisses = Math.max(0, Math.min(2, maxMissParam));
    }

    const activeParam = params.get('active');
    state.onlyCurrentStreak = activeParam === '1';

    // apply year (accept 'all' or a numeric year present in slider range)
    if (y) {
      const yearSlider = document.getElementById('yearSlider');
      const allChk = document.getElementById('allYearsCheckbox');
      const yearVal = document.getElementById('yearVal');
      if (y === 'all') {
        state.year = 'all';
        if (allChk) { allChk.checked = true; }
        if (yearVal) yearVal.textContent = 'All';
      } else if (!isNaN(parseInt(y, 10)) && yearSlider) {
        const min = parseInt(yearSlider.min, 10);
        const max = parseInt(yearSlider.max, 10);
        const yi = parseInt(y, 10);
        if (yi >= min && yi <= max) {
          state.year = String(yi);
          yearSlider.value = yi;
          if (allChk) { allChk.checked = false; }
          if (yearVal) yearVal.textContent = state.year;
        }
      }

    }

    refreshOutcomeControls();

    // finally render with applied params
    state.sortColumn = null;
    updateVisualization();
  } catch (e) {
    console.warn('Could not apply URL params:', e);
  }
}

// Sort table data
function sortTableData(data) {
  const { sortColumn, sortDirection } = state;

  if (!sortColumn) return data;

  return [...data].sort((a, b) => {
    let aVal = a[sortColumn];
    let bVal = b[sortColumn];

    // Handle numeric values
    if (sortColumn.includes('margin') || sortColumn === 'electoral_votes' || sortColumn === 'vote_difference') {
      aVal = parseFloat(aVal);
      bVal = parseFloat(bVal);

      if (isNaN(aVal)) aVal = 0;
      if (isNaN(bVal)) bVal = 0;
    }

    // Handle boolean values
    if (sortColumn === 'is_2024_bellwether') {
      aVal = aVal ? 1 : 0;
      bVal = bVal ? 1 : 0;
    }

    let comparison = 0;
    if (aVal < bVal) comparison = -1;
    if (aVal > bVal) comparison = 1;

    return sortDirection === 'asc' ? comparison : -comparison;
  });
}

// Sort table by column
function sortTable(column) {
  if (state.sortColumn === column) {
    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortColumn = column;
    state.sortDirection = 'asc';
  }

  renderTable();
}

// Initialize the application
async function init() {
  try {
    // Load data
    state.data = await loadData();

    state.nationalByYear.clear();
    state.data.forEach(row => {
      if (row.abbr !== 'NATIONAL') return;
      const yearNum = parseInt(row.year, 10);
      const marginVal = parseFloat(row.pres_margin);
      if (isNaN(yearNum) || isNaN(marginVal)) return;
      state.nationalByYear.set(yearNum, {
        presMargin: marginVal,
        sign: marginSign(marginVal)
      });
    });

    // Populate year slider and All Years checkbox
    const years = [...new Set(state.data.map(row => row.year))].map(y => parseInt(y, 10)).filter(Boolean).sort((a, b) => a - b);
    state.years = years.map(String);
    if (years.length > 0) {
      state.latestYear = years[years.length - 1];
    }
    const yearSlider = document.getElementById('yearSlider');
    const yearVal = document.getElementById('yearVal');
    const allChk = document.getElementById('allYearsCheckbox');

    if (years.length > 0 && yearSlider) {
      yearSlider.min = years[0];
      yearSlider.max = years[years.length - 1];
      yearSlider.step = 4;
      yearSlider.value = years[years.length - 1];
      state.year = String(yearSlider.value);
      yearVal.textContent = state.year;

      // initialize bellwether threshold display as percent
      const bellDisplay = document.getElementById('bellwetherThresholdVal');
      if (bellDisplay) {
        bellDisplay.textContent = (state.bellwetherThreshold * 100).toFixed(1) + '%';
      }
      // initialize close threshold display as percent
      const closeDisplay = document.getElementById('closeThresholdVal');
      if (closeDisplay) {
        closeDisplay.textContent = (state.closeThreshold * 100).toFixed(1) + '%';
      }

      yearSlider.addEventListener('input', (e) => {
        state.year = String(e.target.value);
        yearVal.textContent = state.year;
        allChk.checked = false;
        state.sortColumn = null;
        updateVisualization();
        updateUrl();
      });

      allChk.addEventListener('change', (e) => {
        if (e.target.checked) {
          state.year = 'all';
          yearVal.textContent = 'All';
        } else {
          state.year = String(yearSlider.value);
          yearVal.textContent = state.year;
        }
        state.sortColumn = null;
        updateVisualization();
        updateUrl();
      });
    }

    const categorySelect = document.getElementById('categorySelect');
    if (categorySelect) {
      categorySelect.addEventListener('change', (e) => {
        state.category = e.target.value;
        state.sortColumn = null;
        toggleControlsForDisplay();
        updateVisualization();
        updateUrl();
      });
    }

    document.getElementById('bellwetherThreshold').addEventListener('input', (e) => {
      state.bellwetherThreshold = parseFloat(e.target.value);
      // display as percentage (e.g., 0.05 -> 5.0%)
      const pct = (state.bellwetherThreshold * 100).toFixed(1) + '%';
      document.getElementById('bellwetherThresholdVal').textContent = pct;
      updateVisualization();
    });

    document.getElementById('closeThreshold').addEventListener('input', (e) => {
      state.closeThreshold = parseFloat(e.target.value);
      // display as percent (e.g., 0.01 -> 1.0%)
      const pct = (state.closeThreshold * 100).toFixed(1) + '%';
      document.getElementById('closeThresholdVal').textContent = pct;
      updateVisualization();
    });

    document.getElementById('displayType').addEventListener('change', (e) => {
      state.displayType = e.target.value;
      updateVisualization();
      updateUrl();
    });

    const outcomeTypeEl = document.getElementById('outcomeType');
    if (outcomeTypeEl) {
      outcomeTypeEl.addEventListener('change', (e) => {
        state.outcomeType = e.target.value;
        refreshOutcomeControls();
        if (state.displayType === 'outcome') {
          renderOutcomeTable();
          updateTitle();
        }
        updateUrl();
      });
    }

    const streakSlider = document.getElementById('streakThreshold');
    if (streakSlider) {
      streakSlider.addEventListener('input', (e) => {
        const nextValue = parseInt(e.target.value, 10);
        if (!isNaN(nextValue)) {
          state.streakThreshold = Math.min(5, Math.max(1, nextValue));
          refreshOutcomeControls();
          if (state.displayType === 'outcome') {
            renderOutcomeTable();
            updateTitle();
          }
          updateUrl();
        }
      });
    }

    const maxMissEl = document.getElementById('maxAllowedMisses');
    if (maxMissEl) {
      maxMissEl.addEventListener('change', (e) => {
        const v = parseInt(e.target.value, 10);
        state.maxAllowedMisses = isNaN(v) ? 0 : Math.max(0, Math.min(2, v));
        refreshOutcomeControls();
        if (state.displayType === 'outcome') {
          renderOutcomeTable();
        }
        updateUrl();
      });
    }

    const onlyCurrent = document.getElementById('onlyCurrentStreak');
    if (onlyCurrent) {
      onlyCurrent.addEventListener('change', (e) => {
        state.onlyCurrentStreak = e.target.checked;
        refreshOutcomeControls();
        if (state.displayType === 'outcome') {
          renderOutcomeTable();
        }
        updateUrl();
      });
    }

    refreshOutcomeControls();

    // Apply URL params (if present) to initial state and controls
    applyUrlParamsToState();

    // Histogram summary button
    const histBtn = document.getElementById('histogramSummaryBtn');
    if (histBtn) {
      histBtn.addEventListener('click', () => {
        // Use filterData to get rows used by histogram for current settings
        const rows = filterData();
        showDetailPanel(`${state.category === 'bellwether' ? 'Bellwether' : 'Close'} — ${state.year === 'all' ? 'All Years' : state.year} (Histogram Summary)`, rows);
      });
    }

    // Initial render
    document.getElementById('loadingMsg').style.display = 'none';
    updateVisualization();

  } catch (error) {
    console.error('Initialization error:', error);
    document.getElementById('loadingMsg').style.display = 'none';
    document.getElementById('errorMsg').style.display = 'block';
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

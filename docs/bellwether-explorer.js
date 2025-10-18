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
  sortDirection: 'asc'
};

// list of available years (populated on init)
state.years = [];

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

// Update visualization based on display type
function updateVisualization() {
  const { displayType } = state;
  
  // Hide all containers
  document.getElementById('barChartContainer').style.display = 'none';
  document.getElementById('histogramContainer').style.display = 'none';
  document.getElementById('tableContainer').style.display = 'none';
  document.getElementById('loadingMsg').style.display = 'none';
  
  // Hide year control when viewing bar chart (bar shows counts across years)
  const yc = document.getElementById('yearControl');
  if (yc) yc.style.display = displayType === 'bar' ? 'none' : 'flex';
  
  // Show appropriate container
  if (displayType === 'bar') {
    document.getElementById('barChartContainer').style.display = 'block';
    renderBarChart();
  } else if (displayType === 'histogram') {
    document.getElementById('histogramContainer').style.display = 'block';
    renderHistogram();
  } else {
    document.getElementById('tableContainer').style.display = 'block';
    renderTable();
  }
  // If the user selected the detailed table, the detailPanel is redundant — hide it
  const detailPanel = document.getElementById('detailPanel');
  if (detailPanel) {
    detailPanel.style.display = displayType === 'table' ? 'none' : detailPanel.style.display;
  }
  updateTitle();
}

// Update title based on current settings
function updateTitle() {
  const { year, category, displayType } = state;
  const categoryLabel = category === 'bellwether' ? 'Bellwether States' : 'Close States';
  const yearLabel = year === 'all' ? 'All Years' : year;
  
  let title = '';
  if (displayType === 'bar') {
    title = `${categoryLabel}: Count by Year`;
  } else if (displayType === 'histogram') {
    title = `${categoryLabel}: Margin Distribution (${yearLabel})`;
  } else {
    title = `${categoryLabel}: Detailed List (${yearLabel})`;
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
    .on('mouseover', function(event, d) {
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

      const listHtml = matches.length === 0 ? '<div style="color:var(--muted)">No matching states</div>' : matches.slice(0,30).map(m => `${m.abbr}: ${m.margin}`).join('<br>');

      tooltip.style('opacity', 1)
        .html(`<strong>${year}</strong><br>Count: ${d.count}<br>${listHtml}${matches.length > 30 ? '<br>...' : ''}`)
        .style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY - 10) + 'px');
    })
    .on('mouseout', function() {
      d3.select(this).style('opacity', 0.8);
      tooltip.style('opacity', 0);
    })
    // click opens detail panel for that year
    .on('click', function(event, d) {
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
    .on('mouseover', function(event, d) {
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
    .on('mouseout', function() {
      d3.select(this).style('opacity', 0.7);
      tooltip.style('opacity', 0);
    })
    .on('click', function(event, d) {
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
  headers.push({ key: 'abbr', label: 'State', sortable: true });
  
  if (category === 'bellwether') {
    headers.push({ 
      key: 'relative_margin', 
      label: year === 'all' ? 'Rel. Margin' : `${year} Rel. Margin`, 
      sortable: true 
    });
    
    if (year !== 'all' && year !== '2024') {
      headers.push({ key: 'is_2024_bellwether', label: '2024 Status', sortable: true });
      headers.push({ key: 'margin_change', label: `${year} → 2024`, sortable: true });
      headers.push({ key: 'relative_margin_2024', label: '2024 Rel. Margin', sortable: true });
    }
  } else {
    headers.push({ 
      key: 'pres_margin', 
      label: year === 'all' ? 'Margin' : `${year} Margin`, 
      sortable: true 
    });
    headers.push({ key: 'vote_difference', label: 'Vote Difference', sortable: true });
  }
  
  headers.push({ key: 'electoral_votes', label: 'EV', sortable: true });
  
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
    
    if (category === 'bellwether' && year !== 'all' && year !== '2024') {
      // Check if state is bellwether in 2024
      const state2024 = state.data.find(r => r.abbr === row.abbr && r.year === '2024');
      if (state2024) {
        const rel2024 = parseFloat(state2024.relative_margin);
        result.is_2024_bellwether = !isNaN(rel2024) && Math.abs(rel2024) < state.bellwetherThreshold;
        result.relative_margin_2024 = rel2024;
        
        const relCurrent = parseFloat(row.relative_margin);
        if (!isNaN(relCurrent) && !isNaN(rel2024)) {
          result.margin_change = rel2024 - relCurrent;
        }
      }
    }
    
    if (category === 'close') {
      const dVotes = parseFloat(row.D_votes) || 0;
      const rVotes = parseFloat(row.R_votes) || 0;
      result.vote_difference = Math.abs(dVotes - rVotes);
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
      
      switch(header.key) {
        case 'abbr':
          td.textContent = row.abbr;
          break;
        case 'relative_margin':
          td.textContent = row.relative_margin_str || '';
          break;
        case 'pres_margin':
          td.textContent = row.pres_margin_str || '';
          break;
        case 'electoral_votes':
          td.textContent = row.electoral_votes || '';
          break;
        case 'is_2024_bellwether':
          td.textContent = row.is_2024_bellwether ? '✓' : '✗';
          td.style.color = row.is_2024_bellwether ? '#4ade80' : '#f87171';
          break;
        case 'margin_change':
          if (row.margin_change !== undefined) {
            td.textContent = `${formatMargin(row.margin_change)} ${getLeanStr(row.margin_change)}`;
          }
          break;
        case 'relative_margin_2024':
          if (row.relative_margin_2024 !== undefined) {
            td.textContent = formatMargin(row.relative_margin_2024);
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

// Get lean direction string
function getLeanStr(delta) {
  if (Math.abs(delta) < 0.001) return '';
  return delta > 0 ? '(D)' : '(R)';
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
    
    // Populate year slider and All Years checkbox
    const years = [...new Set(state.data.map(row => row.year))].map(y => parseInt(y, 10)).filter(Boolean).sort((a,b) => a - b);
    state.years = years.map(String);
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

      yearSlider.addEventListener('input', (e) => {
        state.year = String(e.target.value);
        yearVal.textContent = state.year;
        allChk.checked = false;
        state.sortColumn = null;
        updateVisualization();
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
      });
    }
    
    document.getElementById('categorySelect').addEventListener('change', (e) => {
      state.category = e.target.value;
      
      // Show/hide appropriate controls
      if (state.category === 'bellwether') {
        document.getElementById('bellwetherControls').style.display = 'block';
        document.getElementById('closeControls').style.display = 'none';
      } else {
        document.getElementById('bellwetherControls').style.display = 'none';
        document.getElementById('closeControls').style.display = 'block';
      }
      
      state.sortColumn = null;
      updateVisualization();
    });
    
    document.getElementById('bellwetherThreshold').addEventListener('input', (e) => {
      state.bellwetherThreshold = parseFloat(e.target.value);
      document.getElementById('bellwetherThresholdVal').textContent = e.target.value;
      updateVisualization();
    });
    
    document.getElementById('closeThreshold').addEventListener('input', (e) => {
      state.closeThreshold = parseFloat(e.target.value);
      document.getElementById('closeThresholdVal').textContent = e.target.value;
      updateVisualization();
    });
    
    document.getElementById('displayType').addEventListener('change', (e) => {
      state.displayType = e.target.value;
      updateVisualization();
    });

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

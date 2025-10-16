/*
Interactive Histograms for Presidential Margins Data
- Loads presidential_margins.csv
- Creates animated histograms with dark mode styling
- Supports single-year distribution and time-series views
- Includes hover tooltips, reference lines, and URL sharing
*/

(function () {
  // Elements
  const el = {
    viewMode: document.getElementById('viewMode'),
    yearSelect: document.getElementById('yearSelect'),
    stateSelect: document.getElementById('stateSelect'),
    fieldSelect: document.getElementById('fieldSelect'),
    yearField: document.getElementById('yearField'),
    stateField: document.getElementById('stateField'),
    chart: document.getElementById('chart'),
    tooltip: document.getElementById('tooltip'),
    infoBox: document.getElementById('infoBox'),
    chartLegend: document.getElementById('chartLegend'),
    shareBtn: document.getElementById('shareBtn'),
    shareStatus: document.getElementById('shareStatus'),
    shareUrl: document.getElementById('shareUrl'),
    shareInput: document.getElementById('shareInput')
  };

  // Data storage
  let allData = [];
  let allStates = [];
  let currentConfig = {
    viewMode: 'year',
    year: null,
    state: null,
    field: 'pres_margin',
    buckets: null
  };

  function getDefaultBucketCount(n) {
    return Math.max(5, Math.min(30, Math.min(20, Math.ceil(Math.sqrt(n || 1)))));
  }

  // Field configurations
  const fieldConfigs = {
    // Margin fields
    'pres_margin': { label: 'Presidential Margin', hasZero: true, hasNational: false, format: formatPercent },
    'pres_margin_delta': { label: 'Presidential Margin Delta', hasZero: true, hasNational: false, format: formatPercent },
    'national_margin': { label: 'National Margin', hasZero: true, hasNational: true, format: formatPercent, timeSeriesOnly: true, nationalOnly: true },
    'national_margin_delta': { label: 'National Margin Delta', hasZero: true, hasNational: false, format: formatPercent, timeSeriesOnly: true, nationalOnly: true },
    'relative_margin': { label: 'Relative Margin', hasZero: true, hasNational: false, format: formatPercent, disallowNational: true },
    'relative_margin_delta': { label: 'Relative Margin Delta', hasZero: true, hasNational: false, format: formatPercent, disallowNational: true },
    'median_margin_delta': { label: 'Median Margin Delta', hasZero: true, hasNational: false, format: formatPercent, timeSeriesOnly: true, nationalOnly: true },
    'median_delta_dist': { label: 'Median Delta Distance', hasZero: true, hasNational: false, format: formatNumber },

    // Two-party fields
    'two_party_margin': { label: 'Two-Party Margin', hasZero: true, hasNational: false, format: formatPercent },
    'two_party_margin_delta': { label: 'Two-Party Margin Delta', hasZero: true, hasNational: false, format: formatPercent },
    'two_party_national_margin': { label: 'Two-Party National Margin', hasZero: true, hasNational: true, format: formatPercent },
    'two_party_national_margin_delta': { label: 'Two-Party National Margin Delta', hasZero: true, hasNational: false, format: formatPercent },
    'two_party_relative_margin': { label: 'Two-Party Relative Margin', hasZero: true, hasNational: false, format: formatPercent, disallowNational: true },
    'two_party_relative_margin_delta': { label: 'Two-Party Relative Margin Delta', hasZero: true, hasNational: false, format: formatPercent, disallowNational: true },

    // Share fields
    'D_share': { label: 'Democratic Vote Share', hasZero: false, hasNational: false, format: formatPercent },
    'R_share': { label: 'Republican Vote Share', hasZero: false, hasNational: false, format: formatPercent },
    'third_party_share': { label: 'Third Party Share', hasZero: false, hasNational: false, format: formatPercent },
    'third_party_national_share': { label: 'Third Party National Share', hasZero: false, hasNational: false, format: formatPercent },
    'third_party_relative_share': { label: 'Third Party Relative Share', hasZero: false, hasNational: false, format: formatPercent, disallowNational: true },
    'top_third_party_share': { label: 'Top Third Party Share', hasZero: false, hasNational: false, format: formatPercent },

    // Delta fields
    'D_delta': { label: 'Democratic Vote Delta', hasZero: true, hasNational: false, format: formatNumber },
    'R_delta': { label: 'Republican Vote Delta', hasZero: true, hasNational: false, format: formatNumber },
    'total_delta': { label: 'Total Vote Delta', hasZero: false, hasNational: false, format: formatNumber },

    // Vote counts
    'D_votes': { label: 'Democratic Votes', hasZero: false, hasNational: false, format: formatNumber },
    'R_votes': { label: 'Republican Votes', hasZero: false, hasNational: false, format: formatNumber },
    'total_votes': { label: 'Total Votes', hasZero: false, hasNational: false, format: formatNumber },
    'third_party_votes': { label: 'Third Party Votes', hasZero: false, hasNational: false, format: formatNumber },
    'electoral_votes': { label: 'Electoral Votes', hasZero: false, hasNational: false, format: formatNumber }
  };

  // Colors
  const colors = {
    barPositive: '#4169E1',    // Blue for D+
    barNegative: '#B22222',    // Red for R+
    barNeutral: '#888888',     // Gray for neutral
    median: '#10b981',         // Green
    average: '#f59e0b',        // Yellow/amber
    zero: '#ffffff',           // White
    national: '#f472b6'        // Pink
  };

  // Chart dimensions
  const margin = { top: 40, right: 40, bottom: 60, left: 80 };
  let width = 0, height = 0;
  let svg, g, xScale, yScale, tooltip;

  // Format functions
  function formatPercent(value) {
    if (value == null || isNaN(value)) return 'N/A';
    const absVal = Math.abs(value * 100);
    if (value > 0) return `D+${absVal.toFixed(1)}%`;
    if (value < 0) return `R+${absVal.toFixed(1)}%`;
    return 'EVEN';
  }

  function formatNumber(value) {
    if (value == null || isNaN(value)) return 'N/A';
    if (Math.abs(value) >= 1000000) {
      return (value / 1000000).toFixed(2) + 'M';
    }
    if (Math.abs(value) >= 1000) {
      return (value / 1000).toFixed(1) + 'K';
    }
    return value.toFixed(2);
  }

  // Initialize
  async function init() {
    try {
      allData = await d3.csv('./presidential_margins.csv', d3.autoType);

      // Populate year dropdown
      const years = [...new Set(allData.map(d => d.year))].sort((a, b) => b - a);
      years.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        el.yearSelect.appendChild(option);
      });

      // Populate state dropdown
      allStates = [...new Set(allData.map(d => d.abbr))].sort();
      populateStateSelect(allStates);

      // Populate field dropdown
      Object.entries(fieldConfigs).forEach(([field, config]) => {
        const option = document.createElement('option');
        option.value = field;
        option.textContent = config.label;
        el.fieldSelect.appendChild(option);
      });

      // Create bucket slider control (buckets)
      const sliderWrap = document.createElement('div');
      sliderWrap.className = 'bucket-slider';
      sliderWrap.style.display = 'flex';
      sliderWrap.style.alignItems = 'center';
      sliderWrap.style.gap = '8px';
      sliderWrap.style.marginTop = '6px';

      const sliderLabel = document.createElement('label');
      sliderLabel.textContent = 'Buckets:';
      sliderLabel.htmlFor = 'bucketSlider';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.id = 'bucketSlider';
      slider.min = 3;
      slider.max = 50;
      slider.step = 1;
      slider.value = 0; // will initialize after data selection

      const sliderVal = document.createElement('span');
      sliderVal.id = 'bucketSliderVal';
      sliderVal.textContent = '-';

      slider.addEventListener('input', () => {
        const v = parseInt(slider.value, 10);
        currentConfig.buckets = v;
        sliderVal.textContent = v;
        updateChart();
      });

      sliderWrap.appendChild(sliderLabel);
      sliderWrap.appendChild(slider);
      sliderWrap.appendChild(sliderVal);

      // attach slider near legend (if present) else append to chart container
      if (el.chartLegend && el.chartLegend.parentNode) {
        el.chartLegend.parentNode.insertBefore(sliderWrap, el.chartLegend.nextSibling);
      } else {
        el.chart.appendChild(sliderWrap);
      }

      // Set up event listeners
      el.viewMode.addEventListener('change', onViewModeChange);
      el.yearSelect.addEventListener('change', onConfigChange);
      el.stateSelect.addEventListener('change', onConfigChange);
      el.fieldSelect.addEventListener('change', onConfigChange);
      el.shareBtn.addEventListener('click', copyShareUrl);

      // Parse URL parameters
      parseUrlParams();

      // Set default values if not from URL
      if (!currentConfig.year) {
        currentConfig.year = years[0]; // Most recent year
        el.yearSelect.value = currentConfig.year;
      }
      if (!currentConfig.state) {
        currentConfig.state = 'NATIONAL';
        el.stateSelect.value = currentConfig.state;
      }
      el.fieldSelect.value = currentConfig.field;
      el.viewMode.value = currentConfig.viewMode;
      // Enforce time-series-only field behavior on init
      const initFieldCfg = fieldConfigs[currentConfig.field];
      if (initFieldCfg && initFieldCfg.timeSeriesOnly) {
        // force state/time-series mode and limit states to NATIONAL
        el.viewMode.value = 'state';
        currentConfig.viewMode = 'state';
        populateStateSelect(['NATIONAL'], true);
      } else if (initFieldCfg && initFieldCfg.disallowNational) {
        // For relative fields that disallow NATIONAL, populate excluding NATIONAL
        const nonNational = allStates.filter(s => s !== 'NATIONAL');
        populateStateSelect(nonNational, false);
        if (currentConfig.state === 'NATIONAL' || !nonNational.includes(currentConfig.state)) {
          currentConfig.state = nonNational.length > 0 ? nonNational[0] : 'NATIONAL';
          el.stateSelect.value = currentConfig.state;
        }
      }

      // initialize slider default value based on current selection
      const sliderElem = document.getElementById('bucketSlider');
      const sliderValElem = document.getElementById('bucketSliderVal');
      if (sliderElem) {
        let defaultCount = getDefaultBucketCount((currentConfig.viewMode === 'year') ?
          allData.filter(d => d.year === currentConfig.year).length :
          allData.filter(d => d.abbr === currentConfig.state).length);
        currentConfig.buckets = defaultCount;
        sliderElem.value = defaultCount;
        if (sliderValElem) sliderValElem.textContent = defaultCount;
      }

      // Initialize chart
      initChart();
      updateChart();

    } catch (error) {
      console.error('Error loading data:', error);
      el.infoBox.textContent = 'Error loading data. Please try again later.';
      el.infoBox.style.color = '#ff4444';
    }
  }

  function populateStateSelect(states, onlyNational = false) {
    // Clear existing options
    el.stateSelect.innerHTML = '';

    const list = onlyNational ? ['NATIONAL'] : states;

    list.forEach(state => {
      const option = document.createElement('option');
      option.value = state;
      option.textContent = state;
      el.stateSelect.appendChild(option);
    });

    // If only national, force value and disable selector
    if (onlyNational) {
      el.stateSelect.value = 'NATIONAL';
      el.stateSelect.disabled = true;
      currentConfig.state = 'NATIONAL';
    } else {
      // enable selector and set to currentConfig.state if present
      el.stateSelect.disabled = false;
      if (currentConfig.state && states.includes(currentConfig.state)) {
        el.stateSelect.value = currentConfig.state;
      } else {
        // default
        // prefer first available state that's not NATIONAL if NATIONAL exists and isn't ideal
        if (states.length > 0) {
          currentConfig.state = states[0];
        } else {
          currentConfig.state = 'NATIONAL';
        }
        el.stateSelect.value = currentConfig.state;
      }
    }
  }

  function onViewModeChange() {
    const requestedMode = el.viewMode.value;

    // If switching to year view but current field is timeSeriesOnly, prevent it
    const fieldCfg = fieldConfigs[currentConfig.field];
    if (requestedMode === 'year' && fieldCfg && fieldCfg.timeSeriesOnly) {
      // revert selector to state/time-series mode
      el.viewMode.value = 'state';
      currentConfig.viewMode = 'state';
      // inform user subtly
      el.infoBox.textContent = `${fieldCfg.label} is only available as a time series (NATIONAL).`;
      return;
    }

    currentConfig.viewMode = requestedMode;

    if (currentConfig.viewMode === 'year') {
      el.yearField.style.display = 'block';
      el.stateField.style.display = 'none';
    } else {
      el.yearField.style.display = 'none';
      el.stateField.style.display = 'block';
    }

    updateChart();
    updateUrl();
  }

  function onConfigChange(event) {
    const src = event && event.target ? event.target : null;

    // If the user changed the state selector directly, respect it and don't repopulate
    if (src === el.stateSelect) {
      currentConfig.state = el.stateSelect.value;
      updateChart();
      updateUrl();
      return;
    }

    // If the user changed the year directly, update and redraw
    if (src === el.yearSelect) {
      currentConfig.year = parseInt(el.yearSelect.value);
      updateChart();
      updateUrl();
      return;
    }

    // Otherwise (field changes or programmatic calls), perform the field-driven logic
    // Update field first to allow field-driven behavior
    const newField = el.fieldSelect.value;
    const prevField = currentConfig.field;

    currentConfig.field = newField;

    const fieldCfg = fieldConfigs[newField];

    // If the field is time-series-only, force state view and restrict states to NATIONAL
    if (fieldCfg && fieldCfg.timeSeriesOnly) {
      el.viewMode.value = 'state';
      currentConfig.viewMode = 'state';
      populateStateSelect(['NATIONAL'], true);
    } else if (fieldCfg && fieldCfg.disallowNational) {
      // For relative fields that disallow NATIONAL, ensure state selector excludes NATIONAL
      const nonNational = allStates.filter(s => s !== 'NATIONAL');
      populateStateSelect(nonNational, false);
      // If current state is NATIONAL or invalid, pick the first non-national state
      if (currentConfig.state === 'NATIONAL' || !nonNational.includes(currentConfig.state)) {
        currentConfig.state = nonNational.length > 0 ? nonNational[0] : 'NATIONAL';
        el.stateSelect.value = currentConfig.state;
      }
    } else {
      // restore full state list if previously limited
      populateStateSelect(allStates, false);
    }

    // Now update year and state from controls (state may have been adjusted by populate)
    currentConfig.year = parseInt(el.yearSelect.value);
    currentConfig.state = el.stateSelect.value;

    // If user attempted to switch to year while field requires time series, prevent it
    if (currentConfig.viewMode === 'year' && fieldCfg && fieldCfg.timeSeriesOnly) {
      el.viewMode.value = 'state';
      currentConfig.viewMode = 'state';
    }

    updateChart();
    updateUrl();
  }

  function parseUrlParams() {
    const params = new URLSearchParams(window.location.search);

    if (params.has('mode')) {
      currentConfig.viewMode = params.get('mode');
    }
    if (params.has('year')) {
      currentConfig.year = parseInt(params.get('year'));
      el.yearSelect.value = currentConfig.year;
    }
    if (params.has('state')) {
      currentConfig.state = params.get('state');
      el.stateSelect.value = currentConfig.state;
    }
    if (params.has('field')) {
      currentConfig.field = params.get('field');
      el.fieldSelect.value = currentConfig.field;
    }
  }

  function updateUrl() {
    const params = new URLSearchParams();
    params.set('mode', currentConfig.viewMode);

    if (currentConfig.viewMode === 'year') {
      params.set('year', currentConfig.year);
    } else {
      params.set('state', currentConfig.state);
    }
    params.set('field', currentConfig.field);

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);

    // Update share URL display
    el.shareInput.value = window.location.href;
    el.shareUrl.style.display = 'flex';
  }

  function copyShareUrl() {
    el.shareInput.select();
    document.execCommand('copy');

    el.shareStatus.style.display = 'inline';
    setTimeout(() => {
      el.shareStatus.style.display = 'none';
    }, 2000);
  }

  function initChart() {
    // Clear existing chart
    el.chart.innerHTML = '';

    // Get dimensions
    const rect = el.chart.getBoundingClientRect();
    width = rect.width - margin.left - margin.right;
    height = rect.height - margin.top - margin.bottom;

    // Create SVG
    svg = d3.select(el.chart)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom);

    g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Create scales
    xScale = d3.scaleLinear().range([0, width]);
    yScale = d3.scaleLinear().range([height, 0]);

    // Add axis groups
    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${height})`);

    g.append('g')
      .attr('class', 'y-axis');

    // Add reference line groups
    g.append('g').attr('class', 'ref-lines');

    // Style axes
    svg.selectAll('.axis path, .axis line')
      .style('stroke', '#888');

    svg.selectAll('.axis text')
      .style('fill', '#a5a5a5')
      .style('font-size', '12px');
  }

  function updateChart() {
    if (!allData.length) return;

    const fieldConfig = fieldConfigs[currentConfig.field];
    if (!fieldConfig) return;

    if (currentConfig.viewMode === 'year') {
      updateYearHistogram(fieldConfig);
    } else {
      updateTimeSeriesHistogram(fieldConfig);
    }
  }

  function updateYearHistogram(fieldConfig) {
    // Filter data for selected year
    const yearData = allData.filter(d => d.year === currentConfig.year);

    // Extract values
    const values = yearData
      .map(d => ({
        value: d[currentConfig.field],
        state: d.abbr,
        strValue: d[currentConfig.field + '_str'] || fieldConfig.format(d[currentConfig.field]),
        year: d.year
      }))
      .filter(d => d.value != null && !isNaN(d.value));

    if (values.length === 0) {
      el.infoBox.textContent = 'No data available for this selection.';
      return;
    }

    // Update info box
    el.infoBox.textContent = `Showing distribution of ${fieldConfig.label} for ${currentConfig.year} across ${values.length} states/units`;

    // Calculate statistics
    const numericValues = values.map(d => d.value);
    const median = d3.median(numericValues);
    const average = d3.mean(numericValues);

    // Get national value if applicable
    let nationalValue = null;
    if (fieldConfig.hasNational) {
      const nationalRow = allData.find(d => d.year === currentConfig.year && d.abbr === 'NATIONAL');
      if (nationalRow) {
        nationalValue = nationalRow[currentConfig.field];
      }
    }

    // Create histogram bins
    const extent = d3.extent(numericValues);
    const defaultBins = getDefaultBucketCount(values.length);
    const binCount = currentConfig.buckets || defaultBins;
    const bins = d3.bin()
      .domain(extent)
      .thresholds(binCount - 1)
      (numericValues);

    // Add state information to bins
    // include items equal to the upper bound in the last bin
    bins.forEach((bin, i) => {
      if (i === bins.length - 1) {
        bin.states = values.filter(v => v.value >= bin.x0 && v.value <= bin.x1);
      } else {
        bin.states = values.filter(v => v.value >= bin.x0 && v.value < bin.x1);
      }
    });

    // Update scales
    xScale.domain(extent);
    yScale.domain([0, d3.max(bins, d => d.length)]);

    // Update axes
    const xAxis = d3.axisBottom(xScale)
      .ticks(10)
      .tickFormat(d => fieldConfig.format(d));

    const yAxis = d3.axisLeft(yScale)
      .ticks(8);

    g.select('.x-axis')
      .transition()
      .duration(500)
      .call(xAxis);

    g.select('.y-axis')
      .transition()
      .duration(500)
      .call(yAxis);

    // Add axis labels
    g.selectAll('.axis-label').remove();

    g.append('text')
      .attr('class', 'axis-label')
      .attr('text-anchor', 'middle')
      .attr('x', width / 2)
      .attr('y', height + 40)
      .text(fieldConfig.label);

    g.append('text')
      .attr('class', 'axis-label')
      .attr('text-anchor', 'middle')
      .attr('transform', `translate(-50,${height / 2})rotate(-90)`)
      .text('Number of States/Units');

    // Draw bars
    const bars = g.selectAll('.bar')
      .data(bins, d => `${d.x0}-${d.x1}`);

    bars.exit()
      .transition()
      .duration(500)
      .attr('height', 0)
      .attr('y', height)
      .remove();

    const barsEnter = bars.enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', d => xScale(d.x0))
      .attr('width', d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 1))
      .attr('y', height)
      .attr('height', 0);

    bars.merge(barsEnter)
      .on('mouseenter', function (event, d) {
        d3.select(this).style('opacity', 0.7);
        showTooltip(event, d, fieldConfig);
      })
      .on('mousemove', function (event) {
        updateTooltipPosition(event);
      })
      .on('mouseleave', function () {
        d3.select(this).style('opacity', 1);
        hideTooltip();
      })
      .transition()
      .duration(500)
      .attr('x', d => xScale(d.x0))
      .attr('width', d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 1))
      .attr('y', d => yScale(d.length))
      .attr('height', d => height - yScale(d.length))
      .attr('class', d => {
        const midpoint = (d.x0 + d.x1) / 2;
        if (fieldConfig.hasZero) {
          return 'bar ' + (midpoint > 0 ? 'bar-positive' : midpoint < 0 ? 'bar-negative' : 'bar-neutral');
        }
        return 'bar bar-neutral';
      });

    // Draw reference lines
    drawReferenceLines(median, average, nationalValue, fieldConfig);

    // Update legend
    updateLegend(median, average, nationalValue, fieldConfig);
  }

  function updateTimeSeriesHistogram(fieldConfig) {
    // Get all data for selected state across years
    const stateData = allData
      .filter(d => d.abbr === currentConfig.state)
      .map(d => ({
        value: d[currentConfig.field],
        year: d.year,
        state: d.abbr,
        strValue: d[currentConfig.field + '_str'] || fieldConfig.format(d[currentConfig.field])
      }))
      .filter(d => d.value != null && !isNaN(d.value))
      .sort((a, b) => a.year - b.year);

    if (stateData.length === 0) {
      el.infoBox.textContent = 'No data available for this selection.';
      return;
    }

    // Update info box
    el.infoBox.textContent = `Showing ${fieldConfig.label} for ${currentConfig.state} from ${d3.min(stateData, d => d.year)} to ${d3.max(stateData, d => d.year)} (${stateData.length} data points)`;

    // Calculate statistics
    const numericValues = stateData.map(d => d.value);
    const median = d3.median(numericValues);
    const average = d3.mean(numericValues);

    // Create histogram bins
    const extent = d3.extent(numericValues);
    const defaultBins = getDefaultBucketCount(stateData.length);
    const binCount = currentConfig.buckets || defaultBins;
    const bins = d3.bin()
      .domain(extent)
      .thresholds(binCount - 1)
      (numericValues);

    // Add year information to bins
    // include items equal to the upper bound in the last bin
    bins.forEach((bin, i) => {
      if (i === bins.length - 1) {
        bin.years = stateData.filter(v => v.value >= bin.x0 && v.value <= bin.x1);
      } else {
        bin.years = stateData.filter(v => v.value >= bin.x0 && v.value < bin.x1);
      }
    });

    // Update scales
    xScale.domain(extent);
    yScale.domain([0, d3.max(bins, d => d.length)]);

    // Update axes
    const xAxis = d3.axisBottom(xScale)
      .ticks(10)
      .tickFormat(d => fieldConfig.format(d));

    const yAxis = d3.axisLeft(yScale)
      .ticks(8);

    g.select('.x-axis')
      .transition()
      .duration(500)
      .call(xAxis);

    g.select('.y-axis')
      .transition()
      .duration(500)
      .call(yAxis);

    // Add axis labels
    g.selectAll('.axis-label').remove();

    g.append('text')
      .attr('class', 'axis-label')
      .attr('text-anchor', 'middle')
      .attr('x', width / 2)
      .attr('y', height + 40)
      .text(fieldConfig.label);

    g.append('text')
      .attr('class', 'axis-label')
      .attr('text-anchor', 'middle')
      .attr('transform', `translate(-50,${height / 2})rotate(-90)`)
      .text('Frequency');

    // Draw bars
    const bars = g.selectAll('.bar')
      .data(bins, d => `${d.x0}-${d.x1}`);

    bars.exit()
      .transition()
      .duration(500)
      .attr('height', 0)
      .attr('y', height)
      .remove();

    const barsEnter = bars.enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', d => xScale(d.x0))
      .attr('width', d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 1))
      .attr('y', height)
      .attr('height', 0);

    bars.merge(barsEnter)
      .on('mouseenter', function (event, d) {
        d3.select(this).style('opacity', 0.7);
        showTooltipTimeSeries(event, d, fieldConfig);
      })
      .on('mousemove', function (event) {
        updateTooltipPosition(event);
      })
      .on('mouseleave', function () {
        d3.select(this).style('opacity', 1);
        hideTooltip();
      })
      .transition()
      .duration(500)
      .attr('x', d => xScale(d.x0))
      .attr('width', d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 1))
      .attr('y', d => yScale(d.length))
      .attr('height', d => height - yScale(d.length))
      .attr('class', d => {
        const midpoint = (d.x0 + d.x1) / 2;
        if (fieldConfig.hasZero) {
          return 'bar ' + (midpoint > 0 ? 'bar-positive' : midpoint < 0 ? 'bar-negative' : 'bar-neutral');
        }
        return 'bar bar-neutral';
      });

    // Draw reference lines (no national value for time series)
    drawReferenceLines(median, average, null, fieldConfig);

    // Update legend
    updateLegend(median, average, null, fieldConfig);
  }

  function drawReferenceLines(median, average, nationalValue, fieldConfig) {
    const refLines = g.select('.ref-lines');
    refLines.selectAll('*').remove();

    // Zero line
    if (fieldConfig.hasZero && xScale.domain()[0] < 0 && xScale.domain()[1] > 0) {
      refLines.append('line')
        .attr('class', 'zero-line')
        .attr('x1', xScale(0))
        .attr('x2', xScale(0))
        .attr('y1', 0)
        .attr('y2', height)
        .attr('stroke', colors.zero)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '5,5')
        .attr('opacity', 0.5);
    }

    // Median line
    if (median != null && !isNaN(median)) {
      refLines.append('line')
        .attr('class', 'median-line')
        .attr('x1', xScale(median))
        .attr('x2', xScale(median))
        .attr('y1', 0)
        .attr('y2', height)
        .attr('stroke', colors.median)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '8,4');
    }

    // Average line
    if (average != null && !isNaN(average)) {
      refLines.append('line')
        .attr('class', 'average-line')
        .attr('x1', xScale(average))
        .attr('x2', xScale(average))
        .attr('y1', 0)
        .attr('y2', height)
        .attr('stroke', colors.average)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '8,4');
    }

    // National value line
    if (nationalValue != null && !isNaN(nationalValue)) {
      refLines.append('line')
        .attr('class', 'national-line')
        .attr('x1', xScale(nationalValue))
        .attr('x2', xScale(nationalValue))
        .attr('y1', 0)
        .attr('y2', height)
        .attr('stroke', colors.national)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '8,4');
    }
  }

  function updateLegend(median, average, nationalValue, fieldConfig) {
    let legendHtml = '';

    if (fieldConfig.hasZero && xScale.domain()[0] < 0 && xScale.domain()[1] > 0) {
      legendHtml += `
        <span class="legend-item">
          <span class="legend-line" style="background: ${colors.zero}; opacity: 0.5;"></span>
          Zero Line
        </span>
      `;
    }

    if (median != null && !isNaN(median)) {
      legendHtml += `
        <span class="legend-item">
          <span class="legend-line" style="background: ${colors.median};"></span>
          Median: ${fieldConfig.format(median)}
        </span>
      `;
    }

    if (average != null && !isNaN(average)) {
      legendHtml += `
        <span class="legend-item">
          <span class="legend-line" style="background: ${colors.average};"></span>
          Average: ${fieldConfig.format(average)}
        </span>
      `;
    }

    if (nationalValue != null && !isNaN(nationalValue)) {
      legendHtml += `
        <span class="legend-item">
          <span class="legend-line" style="background: ${colors.national};"></span>
          Popular Vote: ${fieldConfig.format(nationalValue)}
        </span>
      `;
    }

    el.chartLegend.innerHTML = legendHtml;
  }

  function showTooltip(event, bin, fieldConfig) {
    const states = bin.states || [];

    let tooltipHtml = `
      <div style="font-weight: 600; margin-bottom: 4px;">
        Range: ${fieldConfig.format(bin.x0)} to ${fieldConfig.format(bin.x1)}
      </div>
      <div style="margin-bottom: 6px;">Count: ${bin.length}</div>
    `;

    if (states.length > 0) {
      tooltipHtml += '<div style="border-top: 1px solid #2a2a2a; padding-top: 6px; margin-top: 6px;">';
      tooltipHtml += '<div style="font-weight: 600; margin-bottom: 4px;">States/Units:</div>';

      states.forEach(s => {
        tooltipHtml += `<div style="margin-left: 8px;">${s.state}: ${s.strValue}</div>`;
      });

      tooltipHtml += '</div>';
    }

    el.tooltip.innerHTML = tooltipHtml;
    el.tooltip.classList.remove('tooltip-hidden');
    updateTooltipPosition(event);
  }

  function showTooltipTimeSeries(event, bin, fieldConfig) {
    const years = bin.years || [];

    let tooltipHtml = `
      <div style="font-weight: 600; margin-bottom: 4px;">
        Range: ${fieldConfig.format(bin.x0)} to ${fieldConfig.format(bin.x1)}
      </div>
      <div style="margin-bottom: 6px;">Count: ${bin.length}</div>
    `;

    if (years.length > 0) {
      tooltipHtml += '<div style="border-top: 1px solid #2a2a2a; padding-top: 6px; margin-top: 6px;">';
      tooltipHtml += '<div style="font-weight: 600; margin-bottom: 4px;">Years:</div>';

      years.forEach(y => {
        tooltipHtml += `<div style="margin-left: 8px;">${y.year}: ${y.strValue}</div>`;
      });

      tooltipHtml += '</div>';
    }

    el.tooltip.innerHTML = tooltipHtml;
    el.tooltip.classList.remove('tooltip-hidden');
    updateTooltipPosition(event);
  }

  function updateTooltipPosition(event) {
    const tooltipWidth = el.tooltip.offsetWidth;
    const tooltipHeight = el.tooltip.offsetHeight;

    let left = event.clientX + 15;
    let top = event.clientY + 15;

    // Adjust if tooltip goes off screen
    if (left + tooltipWidth > window.innerWidth) {
      left = event.clientX - tooltipWidth - 15;
    }

    if (top + tooltipHeight > window.innerHeight) {
      top = event.clientY - tooltipHeight - 15;
    }

    el.tooltip.style.left = left + 'px';
    el.tooltip.style.top = top + 'px';
  }

  function hideTooltip() {
    el.tooltip.classList.add('tooltip-hidden');
  }

  // Handle window resize
  window.addEventListener('resize', () => {
    initChart();
    updateChart();
  });

  // Start the app
  init();
})();

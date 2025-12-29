# CSS/HTML/JS templates split from build_site

PAGE_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>%TITLE%</title>
<link rel="stylesheet" href="../styles.css" />
<link rel="icon" href="../favicon.svg" />
</head>
<body>
<script src="../maintenance-check.js"></script>
<script src="./last-updated.js"></script>
<div class="container" data-available-datasets="%AVAILABLE_DATASETS%">
  <div id="header-placeholder" data-is-inner="true"></div>
  <div class="legend" style="margin-top:12px">%LEGEND%</div>
  <div id="back-to-map-placeholder" data-is-inner="true"></div>
  <div class="header"><h1 style="margin:0">%HEADING%</h1></div>
  
  <!-- Interactive Chart Section -->
  <div class="card">
    <h2 style="margin-top:0">Interactive Chart</h2>
    <div id="chart-container" style="min-height: 520px;">
      <div id="chart-controls" style="margin-bottom: 16px;">
        <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 12px;">
          <label style="display: flex; align-items: center; gap: 4px;">
            <input type="checkbox" id="chart-twoparty"> Two-party margins
          </label>
          <label style="%RELATIVE_LABEL_STYLE%">
            <input type="checkbox" id="chart-relative"%RELATIVE_DISABLED%> Relative margins
          </label>
          <label style="display: flex; align-items: center; gap: 4px;">
            <input type="checkbox" id="chart-delta"> Show deltas
          </label>
          <label style="display: flex; align-items: center; gap: 4px;">
            <input type="checkbox" id="chart-thirdparty"> Third-party share
          </label>
          <label style="%ELASTICITY_LABEL_STYLE%">
            <input type="checkbox" id="chart-elasticity"%ELASTICITY_DISABLED%> Elasticity
          </label>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <label for="year-range-slider" style="font-size: 0.9rem;">Year Range: <span id="year-range-display">1864-2024</span></label>
          <div class="dual-range-slider">
            <div class="slider-track"></div>
            <div class="slider-range" id="slider-range"></div>
            <input type="range" id="year-start" min="1864" max="2020" value="1864" step="4" class="slider-input">
            <input type="range" id="year-end" min="1864" max="2024" value="2024" step="4" class="slider-input">
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: #888;">
            <span id="year-range-min-label">1864</span>
            <span id="year-range-max-label">2024</span>
          </div>
        </div>
      </div>
      <div id="interactive-chart"></div>
      <div id="chart-notes" class="legend" style="margin-top: 8px;"></div>
    </div>
  </div>
  
  <div class="card dataset-switch" id="dataset-switch">
    <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:center;">
      <label for="dataset-select" class="legend" style="margin:0;font-size:0.95rem;">Dataset:</label>
      <select id="dataset-select" class="dataset-select" style="min-width:180px;">
        <option value="presidential">Presidential</option>
        <option value="senate">Senate</option>
      </select>
      <span id="dataset-select-hint" class="legend" style="font-size:0.85rem;opacity:0.85;">Switch between presidential and senate results.</span>
    </div>
    <div id="dataset-status" class="legend" style="margin-top:8px;display:none;"></div>
  </div>

  %EXTRA_LINKS%
  %DATASET_SECTIONS%
  <div id="footer-placeholder"></div>
</div>

<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
<script src="../utils/TrendsChart.js"></script>
<script>
%DELTA_TOGGLE_JS%

// Interactive chart functionality
(function() {
  const pageStateAbbr = '%STATE_ABBR%';
  const availableDatasetsRaw = '%AVAILABLE_DATASETS%';
  const availableDatasets = availableDatasetsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const datasetLabels = { presidential: 'Presidential', senate: 'Senate' };
  const datasetSwitchCard = document.getElementById('dataset-switch');
  const datasetSelect = document.getElementById('dataset-select');
  const datasetStatusEl = document.getElementById('dataset-status');
  const datasetSections = Array.from(document.querySelectorAll('.dataset-section'));
  const chartContainer = document.getElementById('interactive-chart');
  const chartNotesEl = document.getElementById('chart-notes');
  const yearStartInput = document.getElementById('year-start');
  const yearEndInput = document.getElementById('year-end');
  const yearRangeDisplay = document.getElementById('year-range-display');
  const sliderRange = document.getElementById('slider-range');
  const minLabel = document.getElementById('year-range-min-label');
  const maxLabel = document.getElementById('year-range-max-label');

  let chart = null;
  let datasetData = { presidential: [], senate: [] };
  let chartData = [];
  let activeDataset = availableDatasets.length ? availableDatasets[0] : 'presidential';
  let stateYearBounds = { min: null, max: null };
  let controlsInitialized = false;

  try {
    const storedDataset = localStorage.getItem('statePageDataset');
    const urlDataset = readUrlString('dataset', null);
    if (urlDataset && availableDatasets.includes(urlDataset)) {
      activeDataset = urlDataset;
    } else if (storedDataset && availableDatasets.includes(storedDataset)) {
      activeDataset = storedDataset;
    }
  } catch (err) {
    /* non-fatal */
  }

  const readUrlBool = (name, fallback = null) => (typeof window.__readUrlBool === 'function' ? window.__readUrlBool(name, fallback) : fallback);
  const readUrlInt = (name, fallback = null) => (typeof window.__readUrlInt === 'function' ? window.__readUrlInt(name, fallback) : fallback);
  const readUrlString = (name, fallback = null) => {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const value = params.get(name);
      return value !== null ? value : fallback;
    } catch (err) {
      return fallback;
    }
  };
  const clamp = (value, min, max) => {
    if (!Number.isFinite(value)) return min;
    if (min != null && value < min) return min;
    if (max != null && value > max) return max;
    return value;
  };
  
  // Load data and initialize chart
  Promise.all([
    d3.csv('../presidential_margins.csv'),
    d3.csv('../senate_margins.csv').catch(err => {
      console.warn('Failed to load senate_margins.csv:', err);
      return [];
    })
  ]).then(([presidentialRows, senateRowsRaw]) => {
    datasetData.presidential = presidentialRows || [];
    datasetData.senate = (senateRowsRaw || []).map(transformSenateRow);

    if (!availableDatasets.includes('presidential') && datasetData.presidential.length) {
      availableDatasets.push('presidential');
    }

    configureDatasetSelect();
    initializeControls();

    if (chartContainer) {
      chart = TrendsChart.create(chartContainer);
    }

    setActiveDataset(activeDataset);
  }).catch(err => {
    console.error('Failed to load chart data:', err);
    if (chartContainer) {
      chartContainer.innerHTML = '<div class="legend" style="text-align: center; padding: 40px;">Unable to load interactive chart. Please ensure the data files are available.</div>';
    }
  });

  function transformSenateRow(row) {
    if (!row) return row;
    const copy = { ...row };
    if (copy.abbr === 'ME') copy.abbr = 'ME-AL';
    if (copy.abbr === 'NE') copy.abbr = 'NE-AL';
    if (Object.prototype.hasOwnProperty.call(copy, 'sen_margin')) {
      copy.pres_margin = copy.sen_margin;
    }
    if (Object.prototype.hasOwnProperty.call(copy, 'sen_margin_delta')) {
      copy.pres_margin_delta = copy.sen_margin_delta;
    }
    if (Object.prototype.hasOwnProperty.call(copy, 'sen_margin_str')) {
      copy.pres_margin_str = copy.sen_margin_str;
    }
    if (Object.prototype.hasOwnProperty.call(copy, 'sen_margin_delta_str')) {
      copy.pres_margin_delta_str = copy.sen_margin_delta_str;
    }
    return copy;
  }

  function configureDatasetSelect() {
    if (!datasetSelect) return;
    while (datasetSelect.options.length) {
      datasetSelect.remove(0);
    }
    availableDatasets.forEach(ds => {
      const option = document.createElement('option');
      option.value = ds;
      option.textContent = datasetLabels[ds] || ds.charAt(0).toUpperCase() + ds.slice(1);
      datasetSelect.appendChild(option);
    });
    if (datasetSelect.options.length === 0) {
      const fallback = document.createElement('option');
      fallback.value = 'presidential';
      fallback.textContent = datasetLabels.presidential;
      datasetSelect.appendChild(fallback);
      if (!availableDatasets.length) availableDatasets.push('presidential');
    }
    datasetSelect.value = activeDataset;
    const hint = document.getElementById('dataset-select-hint');
    if (availableDatasets.length <= 1) {
      if (datasetSwitchCard) datasetSwitchCard.style.display = 'none';
      if (hint) hint.style.display = 'none';
    } else {
      if (datasetSwitchCard) datasetSwitchCard.style.display = '';
      if (hint) hint.style.display = '';
    }
    datasetSelect.addEventListener('change', (event) => {
      setActiveDataset(event.target.value);
      try {
        localStorage.setItem('statePageDataset', event.target.value);
      } catch (err) {
        /* non-fatal */
      }
    });
  }

  function initializeControls() {
    if (controlsInitialized) return;
    controlsInitialized = true;

    const controls = ['chart-twoparty', 'chart-relative', 'chart-delta', 'chart-thirdparty', 'chart-elasticity'];
    controls.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => {
        if (id === 'chart-elasticity' && el.checked) {
          // Elasticity is mutually exclusive with other options
          const chartTwoParty = document.getElementById('chart-twoparty');
          const chartRelative = document.getElementById('chart-relative');
          const chartDelta = document.getElementById('chart-delta');
          const chartThirdParty = document.getElementById('chart-thirdparty');
          if (chartTwoParty) chartTwoParty.checked = false;
          if (chartRelative) chartRelative.checked = false;
          if (chartDelta) chartDelta.checked = false;
          if (chartThirdParty) chartThirdParty.checked = false;
        } else if (id !== 'chart-elasticity' && el.checked) {
          // Uncheck elasticity when any other option is selected
          const elasticityToggle = document.getElementById('chart-elasticity');
          if (elasticityToggle) elasticityToggle.checked = false;
        }
        if (id === 'chart-twoparty' && el.checked) {
          const footerTwoParty = document.getElementById('twoPartyToggle');
          const footerRelative = document.getElementById('relativeToggle');
          const chartThirdParty = document.getElementById('chart-thirdparty');
          if (footerTwoParty) footerTwoParty.checked = true;
          if (footerRelative) footerRelative.checked = false;
          if (chartThirdParty) chartThirdParty.checked = false;
          const chartRelativeToggle = document.getElementById('chart-relative');
          if (chartRelativeToggle) chartRelativeToggle.checked = false;
          if (typeof window.updateTableVisibilityFromChart === 'function') {
            window.updateTableVisibilityFromChart();
          }
        } else if (id === 'chart-thirdparty' && el.checked) {
          const footerTwoParty = document.getElementById('twoPartyToggle');
          const footerRelative = document.getElementById('relativeToggle');
          const chartTwoParty = document.getElementById('chart-twoparty');
          if (footerTwoParty) footerTwoParty.checked = false;
          if (footerRelative) footerRelative.checked = true;
          if (chartTwoParty) chartTwoParty.checked = false;
          const chartRelativeToggle = document.getElementById('chart-relative');
          if (chartRelativeToggle) chartRelativeToggle.checked = true;
          if (typeof window.updateTableVisibilityFromChart === 'function') {
            window.updateTableVisibilityFromChart();
          }
        }
        updateChart();
      });
    });

    if (yearStartInput) {
      yearStartInput.addEventListener('input', () => {
        if (yearEndInput && parseInt(yearStartInput.value, 10) > parseInt(yearEndInput.value, 10)) {
          yearStartInput.value = yearEndInput.value;
        }
        updateYearDisplay();
        updateChart();
      });
    }
    if (yearEndInput) {
      yearEndInput.addEventListener('input', () => {
        if (yearStartInput && parseInt(yearEndInput.value, 10) < parseInt(yearStartInput.value, 10)) {
          yearEndInput.value = yearStartInput.value;
        }
        updateYearDisplay();
        updateChart();
      });
    }

    (function setupCustomThumbs(){
      if (!yearStartInput || !yearEndInput) return;
      const container = yearStartInput.closest && yearStartInput.closest('.dual-range-slider');
      if (!container) return;

      yearStartInput.style.pointerEvents = 'none';
      yearEndInput.style.pointerEvents = 'none';

      const makeThumb = (cls) => {
        const t = document.createElement('div');
        t.className = 'slider-thumb ' + cls;
        container.appendChild(t);
        return t;
      };
      const thumbStart = makeThumb('thumb-start');
      const thumbEnd = makeThumb('thumb-end');

      const minY = () => parseInt(yearStartInput.min || '1864', 10);
      const maxY = () => parseInt(yearStartInput.max || '2024', 10);

      const updateThumbs = () => {
        const mi = minY();
        const ma = maxY();
        const s = Math.max(mi, Math.min(ma, parseInt(yearStartInput.value, 10) || mi));
        const e = Math.max(mi, Math.min(ma, parseInt(yearEndInput.value, 10) || ma));
        const span = Math.max(1, ma - mi);
        const pctS = ((s - mi) / span) * 100;
        const pctE = ((e - mi) / span) * 100;
        thumbStart.style.left = pctS + '%';
        thumbEnd.style.left = pctE + '%';
      };

      yearStartInput.addEventListener('input', updateThumbs);
      yearEndInput.addEventListener('input', updateThumbs);
      updateThumbs();

      let active = null;
      const onPointerMove = (ev) => {
        if (!active) return;
        const rect = container.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const mi = minY(); const ma = maxY();
        const yr = Math.round(mi + pct * (ma - mi));
        active.input.value = String(yr);
        active.input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const onPointerUp = (ev) => {
        if (!active) return;
        try { active.thumb.releasePointerCapture(ev.pointerId); } catch (e) {}
        active = null;
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
      };

      const attachThumb = (thumb, input) => {
        thumb.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          try { thumb.setPointerCapture(ev.pointerId); } catch (e) {}
          active = { thumb, input };
          document.addEventListener('pointermove', onPointerMove);
          document.addEventListener('pointerup', onPointerUp);
        });
      };
      attachThumb(thumbStart, yearStartInput);
      attachThumb(thumbEnd, yearEndInput);

      container.addEventListener('pointerup', (ev) => {
        if (ev.target && ev.target.closest && ev.target.closest('input[type="range"]')) return;
        const rect = container.getBoundingClientRect();
        const clickX = Math.max(rect.left, Math.min(rect.right, ev.clientX));
        const mi = minY(); const ma = maxY();
        const span = Math.max(1, ma - mi);
        const clickedPct = (clickX - rect.left) / rect.width;
        const clickedYear = Math.round(mi + clickedPct * span);
        const startVal = parseInt(yearStartInput.value, 10);
        const endVal = parseInt(yearEndInput.value, 10);
        if (clickedYear >= startVal && clickedYear <= endVal) return;
        const startX = rect.left + ((startVal - mi) / span) * rect.width;
        const endX = rect.left + ((endVal - mi) / span) * rect.width;
        const targetInput = Math.abs(clickX - startX) <= Math.abs(clickX - endX) ? yearStartInput : yearEndInput;
        const clamped = Math.max(mi, Math.min(ma, clickedYear));
        targetInput.value = String(clamped);
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
    })();

    const chartTwoPartyEl = document.getElementById('chart-twoparty');
    const chartRelativeEl = document.getElementById('chart-relative');
    const chartDeltaEl = document.getElementById('chart-delta');
    const chartThirdEl = document.getElementById('chart-thirdparty');
    const chartElasticityEl = document.getElementById('chart-elasticity');

    const savedTwoParty = localStorage.getItem('chartTwoParty') === 'true';
    const savedRelative = localStorage.getItem('chartRelative') === 'true';
    const savedDelta = localStorage.getItem('chartDelta') === 'true';
    const savedThirdParty = localStorage.getItem('chartThirdParty') === 'true';
    const savedElasticity = localStorage.getItem('chartElasticity') === 'true';

    const urlChartTwo = readUrlBool('chartTwo', null);
    const urlChartRel = readUrlBool('chartRelative', null);
    const urlChartDelta = readUrlBool('chartDelta', null);
    const urlChartThird = readUrlBool('chartThird', null);
    const urlChartElasticity = readUrlBool('chartElasticity', null);

    let initialTwoParty = urlChartTwo !== null ? urlChartTwo : savedTwoParty;
    let initialRelative = urlChartRel !== null ? urlChartRel : savedRelative;
    let initialThird = urlChartThird !== null ? urlChartThird : savedThirdParty;
    let initialElasticity = urlChartElasticity !== null ? urlChartElasticity : savedElasticity;
    const initialDelta = urlChartDelta !== null ? urlChartDelta : savedDelta;

    if (initialTwoParty) {
      initialThird = false;
      initialElasticity = false;
      if (urlChartRel === null) initialRelative = false;
    }
    if (initialThird) {
      initialTwoParty = false;
      initialElasticity = false;
      initialRelative = true;
    }
    if (initialElasticity) {
      initialTwoParty = false;
      initialThird = false;
    }

    if (chartTwoPartyEl) chartTwoPartyEl.checked = !!initialTwoParty;
    if (chartRelativeEl) chartRelativeEl.checked = !!initialRelative;
    if (chartDeltaEl) chartDeltaEl.checked = !!initialDelta;
    if (chartThirdEl) chartThirdEl.checked = !!initialThird;
    if (chartElasticityEl) chartElasticityEl.checked = !!initialElasticity;

    // Disable / hide the "Relative margins" control on the national page because
    // relative margins make every unit effectively 0 for NATIONAL/NAT and are
    // therefore not useful on the national overview.
    try {
      const up = String(pageStateAbbr || '').toUpperCase();
      if (up === 'NAT' || up === 'NATIONAL') {
        if (chartRelativeEl) {
          chartRelativeEl.checked = false;
          chartRelativeEl.disabled = true;
          const lab = chartRelativeEl.closest && chartRelativeEl.closest('label');
          if (lab) lab.style.display = 'none';
        }
      }
    } catch (e) { /* non-fatal */ }
  }

  function getStateCandidates() {
    const set = new Set();
    if (pageStateAbbr) {
      set.add(pageStateAbbr);
      // Special-case national page abbreviations: map NAT -> NATIONAL and vice versa so
      // CSV rows using 'NATIONAL' (or 'NAT') are matched for the national page.
      try {
        const up = String(pageStateAbbr).toUpperCase();
        if (up === 'NAT' || up === 'NATIONAL') {
          set.add('NATIONAL');
          set.add('NAT');
        }
      } catch (e) {}
    }
    if (pageStateAbbr && pageStateAbbr.endsWith('-AL')) {
      set.add(pageStateAbbr.slice(0, 2));
    } else if (pageStateAbbr && pageStateAbbr.length === 2) {
      set.add(`${pageStateAbbr}-AL`);
    }
    return set;
  }

  function getStateRows(source = chartData) {
    if (!source || !source.length) return [];
    const candidates = getStateCandidates();
    return source.filter(r => candidates.has(r.abbr));
  }

  function toggleDatasetSections(dataset) {
    datasetSections.forEach(section => {
      const type = section.getAttribute('data-dataset');
      if (type === dataset) {
        section.classList.add('is-active');
      } else {
        section.classList.remove('is-active');
      }
    });
  }

  function updateDatasetStatus() {
    if (!datasetStatusEl) return;
    // Consider NATIONAL/NAT a valid match for the national page
    const rows = getStateRows();
    const hasNat = (chartData || []).some(r => {
      const ab = String(r.abbr || r.unit || '').toUpperCase();
      return ab === 'NATIONAL' || ab === 'NAT';
    });
    if (!rows.length && !hasNat) {
      datasetStatusEl.textContent = `${datasetLabels[activeDataset] || activeDataset} data is not available for this location.`;
      datasetStatusEl.style.display = 'block';
    } else {
      datasetStatusEl.textContent = '';
      datasetStatusEl.style.display = 'none';
    }
  }

  function updateYearBounds() {
    const datasetYears = (chartData || []).map(r => parseInt(r.year, 10)).filter(year => Number.isFinite(year)).sort((a, b) => a - b);
    const stateYears = getStateRows().map(r => parseInt(r.year, 10)).filter(year => Number.isFinite(year)).sort((a, b) => a - b);

    // Compute bounds from the union of datasetYears and stateYears so that
    // the UI isn't artificially limited by one source missing years.
    const allYears = [];
    if (datasetYears && datasetYears.length) allYears.push(...datasetYears);
    if (stateYears && stateYears.length) allYears.push(...stateYears);
    const uniq = Array.from(new Set(allYears)).sort((a,b)=>a-b);

    let computedMinYear = uniq.length ? uniq[0] : parseInt(yearStartInput?.min || '1864', 10);
    let computedMaxYear = uniq.length ? uniq[uniq.length - 1] : parseInt(yearEndInput?.max || '2024', 10);

    if (!Number.isFinite(computedMinYear)) computedMinYear = 1864;
    if (!Number.isFinite(computedMaxYear)) computedMaxYear = 2024;
    if (computedMinYear > computedMaxYear) computedMinYear = computedMaxYear;

    stateYearBounds = { min: computedMinYear, max: computedMaxYear };
    window.__chartYearBounds = stateYearBounds;

    if (yearStartInput) {
      yearStartInput.min = String(computedMinYear);
      yearStartInput.max = String(computedMaxYear);
      if (!Number.isFinite(parseInt(yearStartInput.value, 10))) {
        yearStartInput.value = String(computedMinYear);
      }
      if (parseInt(yearStartInput.value, 10) < computedMinYear) {
        yearStartInput.value = String(computedMinYear);
      }
      if (parseInt(yearStartInput.value, 10) > computedMaxYear) {
        yearStartInput.value = String(computedMaxYear);
      }
    }
    if (yearEndInput) {
      yearEndInput.min = String(computedMinYear);
      yearEndInput.max = String(computedMaxYear);
      if (!Number.isFinite(parseInt(yearEndInput.value, 10))) {
        yearEndInput.value = String(computedMaxYear);
      }
      if (parseInt(yearEndInput.value, 10) > computedMaxYear) {
        yearEndInput.value = String(computedMaxYear);
      }
      if (parseInt(yearEndInput.value, 10) < computedMinYear) {
        yearEndInput.value = String(computedMinYear);
      }
    }

    if (yearStartInput && yearEndInput && parseInt(yearStartInput.value, 10) > parseInt(yearEndInput.value, 10)) {
      yearStartInput.value = yearEndInput.value;
    }

    if (minLabel) minLabel.textContent = computedMinYear;
    if (maxLabel) maxLabel.textContent = computedMaxYear;
    try {
      // Debug: expose dataset/state years and computed bounds to the console/window
      console.log('[debug] updateYearBounds', { activeDataset: activeDataset, datasetYears: datasetYears, stateYears: stateYears, bounds: stateYearBounds });
      window.__lastDatasetYears = datasetYears;
      window.__lastStateYears = stateYears;
    } catch (e) { /* non-fatal */ }
  }

  function updateYearDisplay() {
    if (!yearRangeDisplay || !yearStartInput || !yearEndInput) return;
    const start = parseInt(yearStartInput.value, 10);
    const end = parseInt(yearEndInput.value, 10);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      yearRangeDisplay.textContent = `${start}-${end}`;
    }
    if (sliderRange && Number.isFinite(start) && Number.isFinite(end)) {
      const min = parseInt(yearStartInput.min || '1864', 10);
      const max = parseInt(yearStartInput.max || '2024', 10);
      const span = Math.max(1, max - min);
      const percentStart = ((start - min) / span) * 100;
      const percentEnd = ((end - min) / span) * 100;
      const safeStart = Math.max(0, Math.min(100, percentStart));
      const safeEnd = Math.max(0, Math.min(100, percentEnd));
      sliderRange.style.left = `${safeStart}%`;
      sliderRange.style.width = `${Math.max(0, safeEnd - safeStart)}%`;
    }
  }

  function setActiveDataset(nextDataset) {
    if (!availableDatasets.includes(nextDataset)) {
      nextDataset = availableDatasets[0] || 'presidential';
    }
    activeDataset = nextDataset;
    chartData = datasetData[nextDataset] || [];
    if (datasetSelect && datasetSelect.value !== nextDataset) {
      datasetSelect.value = nextDataset;
    }
    toggleDatasetSections(nextDataset);
    updateDatasetStatus();
    updateYearBounds();
    updateYearDisplay();
    // If senate dataset is selected, disable/show deltas control appropriately
    try {
      const chartDelta = document.getElementById('chart-delta');
      if (chartDelta) {
        if (nextDataset === 'senate') {
          chartDelta.checked = false;
          chartDelta.disabled = true;
          chartDelta.closest && chartDelta.closest('label') && (chartDelta.closest('label').style.opacity = '0.5');
        } else {
          chartDelta.disabled = false;
          chartDelta.closest && chartDelta.closest('label') && (chartDelta.closest('label').style.opacity = '1');
          // restore saved state if any
          const savedDelta = localStorage.getItem('chartDelta') === 'true';
          chartDelta.checked = !!savedDelta;
        }
      }
    } catch (e) {}

    updateChart();
    if (typeof window.updateTableVisibilityFromChart === 'function') {
      window.updateTableVisibilityFromChart();
    }
  }
  
  function updateChart() {
    if (!chart) return;

    const twoP = document.getElementById('chart-twoparty')?.checked || false;
    const rel = document.getElementById('chart-relative')?.checked || false;
  let delta = document.getElementById('chart-delta')?.checked || false;
    const thirdParty = document.getElementById('chart-thirdparty')?.checked || false;
    const elasticity = document.getElementById('chart-elasticity')?.checked || false;

    let yearStartVal = parseInt(yearStartInput?.value ?? '', 10);
    let yearEndVal = parseInt(yearEndInput?.value ?? '', 10);

    const minBound = stateYearBounds?.min ?? null;
    const maxBound = stateYearBounds?.max ?? null;

    if (minBound != null) {
      yearStartVal = clamp(Number.isFinite(yearStartVal) ? yearStartVal : minBound, minBound, maxBound);
    }
    if (maxBound != null) {
      yearEndVal = clamp(Number.isFinite(yearEndVal) ? yearEndVal : maxBound, minBound != null ? Math.max(minBound, yearStartVal) : yearStartVal, maxBound);
    }
    if (!Number.isFinite(yearStartVal)) yearStartVal = minBound != null ? minBound : yearStartVal;
    if (!Number.isFinite(yearEndVal)) yearEndVal = maxBound != null ? maxBound : yearEndVal;
    if (yearStartVal > yearEndVal) {
      yearEndVal = yearStartVal;
    }

    if (yearStartInput && parseInt(yearStartInput.value, 10) !== yearStartVal) {
      yearStartInput.value = String(yearStartVal);
    }
    if (yearEndInput && parseInt(yearEndInput.value, 10) !== yearEndVal) {
      yearEndInput.value = String(yearEndVal);
    }

    updateYearDisplay();

    try {
      localStorage.setItem('chartTwoParty', twoP ? 'true' : 'false');
      localStorage.setItem('chartRelative', rel ? 'true' : 'false');
      localStorage.setItem('chartDelta', delta ? 'true' : 'false');
      localStorage.setItem('chartThirdParty', thirdParty ? 'true' : 'false');
      localStorage.setItem('chartElasticity', elasticity ? 'true' : 'false');
      if (Number.isFinite(yearStartVal)) localStorage.setItem('chartYearStart', String(yearStartVal));
      if (Number.isFinite(yearEndVal)) localStorage.setItem('chartYearEnd', String(yearEndVal));
    } catch (err) {
      /* non-fatal */
    }

    const stateRows = getStateRows();
    if (!chartData || !chartData.length || !stateRows.length) {
      if (chartNotesEl) {
        chartNotesEl.textContent = `${datasetLabels[activeDataset] || activeDataset} data is not available for this location.`;
      }
      if (chartContainer) {
        chartContainer.classList.add('chart-empty');
      }
      return;
    }

    if (chartContainer) {
      chartContainer.classList.remove('chart-empty');
    }

  // Ensure deltas are disabled for senate dataset
  if (activeDataset === 'senate') delta = false;

  const metric = elasticity ? 'elasticity' : (thirdParty ? 'thirdParty' : 'margin');
    chart.update({
      data: chartData,
      state: pageStateAbbr,
      metric,
      chart: 'line',
      rel,
      delta,
      twoP,
      yearStart: yearStartVal,
      yearEnd: yearEndVal,
      dataset: activeDataset,
      presData: datasetData.presidential,
      notesEl: chartNotesEl
    });

    if (!window.__suppressViewStateUrl && typeof window.updateUrl === 'function') {
      window.updateUrl(undefined, undefined, undefined);
    }
  }
  
  // Expose updateChart globally for footer toggle sync
  window.updateChart = updateChart;
})();
</script>
<div id="footer-placeholder"></div>
<script src="../header.js"></script>
<script src="../back-to-map.js"></script>
<script src="../footer.js"></script>
<script src="../other-pages.js"></script>
</body>
</html>
"""

# simple SVG favicon
FAVICON_SVG = r'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0b0b0b"/>
  <rect x="9" y="22" width="46" height="26" rx="3" fill="#ffffff"/>
  <rect x="16" y="8" width="32" height="18" rx="2" fill="#ffd166"/>
  <path d="M20 28 L28 36 L44 20" stroke="#0b0b0b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>'''

# JavaScript for table and toggle functionality
ENHANCED_TOGGLE_JS = r"""
// URL helper utilities shared across state/unit pages
if (typeof window.__readUrlBool !== 'function') {
  window.__readUrlBool = function(name, fallback = null) {
    const params = new URLSearchParams(window.location.search);
    if (!params.has(name)) return fallback;
    const raw = params.get(name);
    if (raw === null || raw === undefined) return fallback;
    if (raw === '') return true;
    const lowered = raw.toLowerCase();
    if (lowered === '1' || lowered === 'true' || lowered === 'yes') return true;
    if (lowered === '0' || lowered === 'false' || lowered === 'no') return false;
    return fallback;
  };
}
if (typeof window.__readUrlInt !== 'function') {
  window.__readUrlInt = function(name, fallback = null) {
    const params = new URLSearchParams(window.location.search);
    if (!params.has(name)) return fallback;
    const value = parseInt(params.get(name), 10);
    return Number.isNaN(value) ? fallback : value;
  };
}
if (typeof window.__suppressViewStateUrl === 'undefined') {
  window.__suppressViewStateUrl = false;
}
window.__collectViewStateForUrl = function() {
  try {
    const deltaToggle = document.getElementById('deltaToggle');
    const twoPartyToggle = document.getElementById('twoPartyToggle');
    const relativeToggle = document.getElementById('relativeToggle');
    const chartTwoParty = document.getElementById('chart-twoparty');
    const chartRelative = document.getElementById('chart-relative');
    const chartDelta = document.getElementById('chart-delta');
    const chartThird = document.getElementById('chart-thirdparty');
    const yearStartInput = document.getElementById('year-start');
    const yearEndInput = document.getElementById('year-end');
    const toInt = (input) => {
      if (!input) return null;
      const v = parseInt(input.value, 10);
      return Number.isNaN(v) ? null : v;
    };
    return {
      deltas: deltaToggle ? !!deltaToggle.checked : null,
      twoParty: twoPartyToggle ? !!twoPartyToggle.checked : null,
      relative: relativeToggle ? !!relativeToggle.checked : null,
      chartTwoParty: chartTwoParty ? !!chartTwoParty.checked : null,
      chartRelative: chartRelative ? !!chartRelative.checked : null,
      chartDelta: chartDelta ? !!chartDelta.checked : null,
      chartThirdParty: chartThird ? !!chartThird.checked : null,
      // indicate whether the currently active dataset is the senate dataset
      senate: (function(){
        try {
          const dsEl = document.getElementById('dataset-select');
          if (dsEl && typeof dsEl.value === 'string') return dsEl.value === 'senate';
          const activeSection = document.querySelector('.dataset-section.is-active');
          if (activeSection) return activeSection.getAttribute('data-dataset') === 'senate';
        } catch(e) {}
        return false;
      })(),
      chartYearStart: toInt(yearStartInput),
      chartYearEnd: toInt(yearEndInput)
    };
  } catch (err) {
    console.warn('collectViewStateForUrl failed', err);
    return null;
  }
};

// Enhanced toggle functionality for state/unit pages
(function() {
  function createEnhancedToggle() {
    const tablesWithDeltas = document.querySelectorAll('table .delta');
    if (tablesWithDeltas.length === 0) {
      return;
    }

    const footer = document.createElement('div');
    footer.className = 'delta-toggle-footer';
    footer.innerHTML = `
      <div class="toggle-group">
        <input type="checkbox" id="deltaToggle" checked>
        <label for="deltaToggle">Show deltas (Δ changes from previous election)</label>
      </div>
      <div class="toggle-group">
        <input type="checkbox" id="twoPartyToggle">
        <label for="twoPartyToggle">Two-party margin mode</label>
      </div>
      <div class="toggle-group">
        <input type="checkbox" id="relativeToggle">
        <label for="relativeToggle">Third-party view</label>
      </div>
      <div class="toggle-group">
        <button type="button" id="clearUrlState" class="btn" style="padding:6px 14px;">Reset view link</button>
      </div>
    `;

    document.body.appendChild(footer);
    document.body.classList.add('has-delta-toggle');

    const deltaToggle = document.getElementById('deltaToggle');
    const twoPartyToggle = document.getElementById('twoPartyToggle');
    const relativeToggle = document.getElementById('relativeToggle');
    const clearButton = document.getElementById('clearUrlState');

    const updateTableVisibility = () => {
      const twoPartyMode = twoPartyToggle ? twoPartyToggle.checked : false;
      const relativeMode = relativeToggle ? relativeToggle.checked : false;

      const activeSection = document.querySelector('.dataset-section.is-active') || document;
      const totalDataTable = activeSection.querySelector('[data-table-type="total"]');
      const thirdPartyTable = activeSection.querySelector('[data-table-type="third-party"]');
      const twoPartyTable = activeSection.querySelector('[data-table-type="two-party"]');

      if (totalDataTable) totalDataTable.style.display = 'none';
      if (thirdPartyTable) thirdPartyTable.style.display = 'none';
      if (twoPartyTable) twoPartyTable.style.display = 'none';

      if (twoPartyMode && twoPartyTable) {
        twoPartyTable.style.display = 'block';
      } else if (relativeMode) {
        if (thirdPartyTable) thirdPartyTable.style.display = 'block';
        else if (totalDataTable) totalDataTable.style.display = 'block';
      } else if (totalDataTable) {
        totalDataTable.style.display = 'block';
      }

      localStorage.setItem('twoPartyMode', twoPartyMode ? 'true' : 'false');
      localStorage.setItem('relativeMode', relativeMode ? 'true' : 'false');

      if (!window.__suppressViewStateUrl && typeof window.updateUrl === 'function') {
        window.updateUrl(undefined, undefined, undefined);
      }
    };

    window.updateTableVisibilityFromChart = updateTableVisibility;

    if (deltaToggle) {
      const urlDelta = typeof window.__readUrlBool === 'function' ? window.__readUrlBool('deltas', null) : null;
      const storedDelta = localStorage.getItem('showDeltas');
      if (urlDelta !== null) {
        deltaToggle.checked = urlDelta;
        localStorage.setItem('showDeltas', urlDelta ? 'true' : 'false');
      } else if (storedDelta === 'false') {
        deltaToggle.checked = false;
      }
      if (!deltaToggle.checked) {
        document.body.classList.add('hide-deltas');
      }
      deltaToggle.addEventListener('change', function() {
        if (this.checked) {
          document.body.classList.remove('hide-deltas');
          localStorage.setItem('showDeltas', 'true');
        } else {
          document.body.classList.add('hide-deltas');
          localStorage.setItem('showDeltas', 'false');
        }
        if (!window.__suppressViewStateUrl && typeof window.updateUrl === 'function') {
          window.updateUrl(undefined, undefined, undefined);
        }
      });
    }

    const urlTwoParty = typeof window.__readUrlBool === 'function' ? window.__readUrlBool('twoParty', null) : null;
    const urlRelative = typeof window.__readUrlBool === 'function' ? window.__readUrlBool('relative', null) : null;
    const storedTwoParty = localStorage.getItem('twoPartyMode') === 'true';
    const storedRelative = localStorage.getItem('relativeMode') === 'true';

    if (twoPartyToggle) {
      if (urlTwoParty !== null) {
        twoPartyToggle.checked = urlTwoParty;
      } else {
        twoPartyToggle.checked = storedTwoParty;
      }
    }

    if (relativeToggle) {
      if (urlRelative !== null) {
        relativeToggle.checked = urlRelative;
      } else {
        relativeToggle.checked = storedRelative;
      }
      if (relativeToggle.checked && twoPartyToggle) {
        twoPartyToggle.checked = false;
      }
    }

    const syncWithChart = () => {
      const chartTwoParty = document.getElementById('chart-twoparty');
      const chartThirdParty = document.getElementById('chart-thirdparty');
      if (twoPartyToggle && twoPartyToggle.checked) {
        if (chartTwoParty) chartTwoParty.checked = true;
        if (chartThirdParty) chartThirdParty.checked = false;
      }
      if (relativeToggle && relativeToggle.checked) {
        if (chartThirdParty) chartThirdParty.checked = true;
        if (chartTwoParty) chartTwoParty.checked = false;
      }
    };

    if (twoPartyToggle) {
      twoPartyToggle.addEventListener('change', function() {
        if (this.checked && relativeToggle) {
          relativeToggle.checked = false;
        }
        const chartTwoParty = document.getElementById('chart-twoparty');
        const chartThirdParty = document.getElementById('chart-thirdparty');
        if (this.checked) {
          if (chartTwoParty) chartTwoParty.checked = true;
          if (chartThirdParty) chartThirdParty.checked = false;
        }
        if (typeof window.updateChart === 'function') window.updateChart();
        updateTableVisibility();
      });
    }

    if (relativeToggle) {
      relativeToggle.addEventListener('change', function() {
        if (this.checked && twoPartyToggle) {
          twoPartyToggle.checked = false;
        }
        const chartTwoParty = document.getElementById('chart-twoparty');
        const chartThirdParty = document.getElementById('chart-thirdparty');
        if (this.checked) {
          if (chartTwoParty) chartTwoParty.checked = false;
          if (chartThirdParty) chartThirdParty.checked = true;
        }
        if (typeof window.updateChart === 'function') window.updateChart();
        updateTableVisibility();
      });
    }

    if (clearButton) {
      clearButton.addEventListener('click', () => {
        window.__suppressViewStateUrl = true;
        try {
          localStorage.removeItem('showDeltas');
          localStorage.removeItem('twoPartyMode');
          localStorage.removeItem('relativeMode');
          localStorage.removeItem('chartTwoParty');
          localStorage.removeItem('chartRelative');
          localStorage.removeItem('chartDelta');
          localStorage.removeItem('chartThirdParty');
          localStorage.removeItem('chartYearStart');
          localStorage.removeItem('chartYearEnd');

          if (deltaToggle) {
            deltaToggle.checked = true;
            document.body.classList.remove('hide-deltas');
          }
          if (twoPartyToggle) twoPartyToggle.checked = false;
          if (relativeToggle) relativeToggle.checked = false;

          const chartTwoParty = document.getElementById('chart-twoparty');
          const chartRelative = document.getElementById('chart-relative');
          const chartDelta = document.getElementById('chart-delta');
          const chartThirdParty = document.getElementById('chart-thirdparty');
          if (chartTwoParty) chartTwoParty.checked = false;
          if (chartRelative) chartRelative.checked = false;
          if (chartDelta) chartDelta.checked = false;
          if (chartThirdParty) chartThirdParty.checked = false;

          const yearStartInput = document.getElementById('year-start');
          const yearEndInput = document.getElementById('year-end');
          if (yearStartInput) {
            yearStartInput.value = yearStartInput.min || yearStartInput.value;
            yearStartInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (yearEndInput) {
            yearEndInput.value = yearEndInput.max || yearEndInput.value;
            yearEndInput.dispatchEvent(new Event('input', { bubbles: true }));
          }

          updateTableVisibility();
          if (typeof window.updateChart === 'function') window.updateChart();
        } finally {
          window.__suppressViewStateUrl = false;
        }
        if (typeof window.updateUrl === 'function') {
          window.updateUrl(undefined, undefined, undefined, { clearViewState: true });
        }
      });
    }

    syncWithChart();
    updateTableVisibility();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createEnhancedToggle);
  } else {
    createEnhancedToggle();
  }
})();
"""

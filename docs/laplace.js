// Laplace Rule of Succession Analyzer for Presidential Margins
// Uses docs/presidential_margins.csv

class LaplaceAnalyzer {
  constructor(csvData) {
    // csvData should be array of objects with headers as keys
    this.data = csvData;
    this.nationalAbbrs = new Set(['NATIONAL', 'USA', 'US', 'UNITED STATES', 'NAT']);
  }

  /**
   * Parse CSV text into array of objects
   * @param {string} csvText - Raw CSV text
   * @returns {Array<Object>} Parsed data
   */
  static parseCSV(csvText) {
    const lines = csvText.trim().split(/\r?\n/);
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
      const values = line.split(','); // dataset is simple CSV (no embedded commas expected)
      const row = {};
      headers.forEach((header, i) => {
        row[header] = (values[i] ?? '').trim();
      });
      return row;
    });
  }

  /**
   * Calculate Laplace probability for a given window size
   * @param {Array<number>} deltas - Array of delta values
   * @param {number} N - Window size
   * @param {number} deltaThresh - Threshold for counting as success
   * @returns {number|null} Probability or null if insufficient data
   */
  laplaceProb(deltas, N, deltaThresh) {
    if (!deltas.length || N <= 0) return null;
    const recent = deltas.slice(-N);
    // default direction is 'left' (count deltas > threshold). Caller may pass 'right' to invert.
    const direction = arguments.length >= 4 ? arguments[3] : 'left';
    // If deltaThresh is null, caller intends to use median-mode (comparison values are booleans or are handled externally)
    const k = recent.filter(d => {
      if (!Number.isFinite(d)) return false;
      return direction === 'left' ? d > deltaThresh : d < deltaThresh;
    }).length;
    return (k + 1) / (N + 2);
  }

  /**
   * Calculate Laplace probability using the sign of median_delta_dist values.
   * Counts entries where median_delta_dist >= 0 (or <= 0 for 'right') in the last N years.
   * @param {Array<number>} medianDists - Array of median_delta_dist numeric values (chronological)
   * @param {number} N
   * @param {string} direction - 'left' means positive is success, 'right' means negative is success
   * @returns {number|null}
   */
  laplaceProbMedianDist(medianDists, N, direction = 'left') {
    // Backwards-compatible: allow calling as (medianDists, N, direction)
    // New signature will be (medianDists, presDists, N, direction)
    if (!Array.isArray(medianDists) || N <= 0) return null;
    // If presDists wasn't supplied, arguments[1] may actually be N (old call); handle both forms
    let presDists = null;
    let useN = N;
    let dir = direction;
    if (arguments.length === 3) {
      // called as (medianDists, N, direction)
      useN = arguments[1];
      dir = arguments[2] || 'left';
    } else if (arguments.length >= 4) {
      // called as (medianDists, presDists, N, direction)
      presDists = arguments[1];
      useN = arguments[2];
      dir = arguments[3] || 'left';
    }

    // Walk the last useN entries in chronological order and consider only finite median values
    const len = medianDists.length;
    const start = Math.max(0, len - useN);
    const considered = [];
    for (let i = start; i < len; i++) {
      const m = medianDists[i];
      if (!Number.isFinite(m)) continue;
      const p = Array.isArray(presDists) ? presDists[i] : NaN;
      considered.push({ m, p });
    }
    if (!considered.length) return null;
    const k = considered.filter(item => LaplaceAnalyzer.medianEntrySuccess(item.m, item.p, dir)).length;
    return (k + 1) / (considered.length + 2);
  }

  /**
   * Determine whether a single entry counts as a success under median-mode rules.
   * - If median > 0: counts as 'left' success
   * - If median < 0: counts as 'right' success
   * - If median === 0: use raw pres margin delta (pres) sign to decide (pres>0 => left, pres<0 => right)
   * Returns true if entry counts as a success for the requested direction, false otherwise.
   */
  static medianEntrySuccess(median, pres, direction = 'left') {
    if (!Number.isFinite(median)) return false;
    if (median > 0) return direction === 'left';
    if (median < 0) return direction === 'right';
    // median === 0: fall back to raw pres margin delta
    if (!Number.isFinite(pres)) return false;
    return direction === 'left' ? pres > 0 : pres < 0;
  }

  /**
   * Determine whether a single entry counts as a success under EV-orthogonalized sign rules.
   * - If ev > 0: counts as 'left' success
   * - If ev < 0: counts as 'right' success
   * - If ev === 0: use raw pres margin delta (pres) sign to decide
   */
  static evEntrySuccess(ev, pres, direction = 'left') {
    if (!Number.isFinite(ev)) return false;
    if (ev > 0) return direction === 'left';
    if (ev < 0) return direction === 'right';
    // ev === 0: fallback to pres
    if (!Number.isFinite(pres)) return false;
    return direction === 'left' ? pres > 0 : pres < 0;
  }

  /**
   * Calculate Laplace probability using sign of EV-orthogonalized margin deltas.
   * Signature mirrors laplaceProbMedianDist for backward compatibility: (evVals, presDists, N, direction)
   */
  laplaceProbSign(evVals, N, direction = 'left') {
    // Handle legacy calling forms similar to laplaceProbMedianDist
    if (!Array.isArray(evVals) || N <= 0) return null;
    let presDists = null;
    let useN = N;
    let dir = direction;
    if (arguments.length === 3) {
      // called as (evVals, N, direction)
      useN = arguments[1];
      dir = arguments[2] || 'left';
    } else if (arguments.length >= 4) {
      presDists = arguments[1];
      useN = arguments[2];
      dir = arguments[3] || 'left';
    }

    const len = evVals.length;
    const start = Math.max(0, len - useN);
    const considered = [];
    for (let i = start; i < len; i++) {
      const v = evVals[i];
      if (!Number.isFinite(v)) continue;
      const p = Array.isArray(presDists) ? presDists[i] : NaN;
      considered.push({ v, p });
    }
    if (!considered.length) return null;
    const k = considered.filter(item => LaplaceAnalyzer.evEntrySuccess(item.v, item.p, dir)).length;
    return (k + 1) / (considered.length + 2);
  }

  /**
   * Calculate weights for different window sizes
   * @param {Array<number>} windowSizes - Array of N values
   * @param {number} lambda - Decay parameter
   * @param {string} weightType - 'exponential' or 'linear'
   * @returns {Object} Map of N -> weight
   */
  calculateWeights(windowSizes, lambda, weightType) {
    const minN = Math.min(...windowSizes);
    const weights = {};
    windowSizes.forEach(N => {
      if (weightType === 'exponential') {
        weights[N] = Math.exp(-lambda * (N - minN));
      } else {
        const denom = 1 + lambda * (N - minN);
        weights[N] = denom > 0 ? 1 / denom : 0;
      }
    });
    return weights;
  }

  /**
   * Main analysis function
   * @param {Object} options - Configuration options
   * @param {number} options.endYear - Last year to consider (default: 2024)
   * @param {number} options.absThresh - Absolute margin threshold (default: 0.3)
   * @param {number} options.deltaThresh - Delta threshold for success (default: -0.005)
   * @param {Array<number>} options.windowSizes - Window sizes to analyze (default: [4,5,6,7])
   * @param {number} options.lambda - Decay parameter (default: 0.25)
   * @param {string} options.weightType - 'exponential' or 'linear' (default: 'exponential')
   * @returns {Array<Object>} Analysis results
   */
  analyze(options = {}) {
    const {
      endYear = 2024,
      absThresh = 1.0,
      windowSizes = [3, 4, 5, 6, 7],
      lambda = 0.25,
      weightType = 'linear',
      trendDir = 'left',
      mode = 'ev'
    } = options;
    // normalize mode value to avoid issues with whitespace/case
    const modeStr = typeof mode === 'string' ? mode.trim().toLowerCase() : String(mode);
    if (typeof console !== 'undefined' && console.debug) console.debug('Laplace.analyze: modeStr=', modeStr);
    // Determine delta threshold default:
    // - If the caller supplied options.deltaThresh, use it.
    // - Otherwise, if medianMode is OFF, default to 0 per requested behavior.
    // - If medianMode is ON (or unspecified), keep the historical default of -0.005.
    let deltaThresh;
    // Ensure the delta slider visibility matches the current mode (in case change event didn't fire)
    try {
      const container = els.deltaThresh && els.deltaThresh.parentNode;
      if (container) container.style.display = mode === 'relative' ? '' : 'none';
    } catch (e) { }
    // Debug: log selected mode for troubleshooting
    if (Object.prototype.hasOwnProperty.call(options, 'deltaThresh')) {
      deltaThresh = options.deltaThresh;
    } else {
      deltaThresh = 0;
    }

    // Filter data to valid years and exclude national aggregates
    if (typeof console !== 'undefined' && console.debug) console.debug('Laplace.analyze: mode=', mode, 'windowSizes=', windowSizes);
    const filtered = this.data.filter(row => {
      const year = parseInt(row.year);
      const abbr = row.abbr?.toUpperCase();
      return Number.isFinite(year) && year <= endYear && abbr && !this.nationalAbbrs.has(abbr);
    });

    // End-year slice
    const endYearData = filtered.filter(row => parseInt(row.year) === endYear);

    // Eligible units: pass absolute threshold in end year
    const validUnits = new Set(
      endYearData
        .filter(row => {
          const v = parseFloat(row.relative_margin);
          return Number.isFinite(v) && Math.abs(v) < absThresh;
        })
        .map(row => row.abbr)
        .filter(Boolean)
    );

    // Group by unit
    const byUnit = {};
    filtered.forEach(row => {
      const unit = row.abbr;
      if (!validUnits.has(unit)) return;
      if (!byUnit[unit]) byUnit[unit] = [];
      byUnit[unit].push({
        year: parseInt(row.year),
        delta: parseFloat(row.relative_margin_delta),
        delta_str: row.relative_margin_delta_str != null ? String(row.relative_margin_delta_str) : (row.relative_margin_delta != null ? String(row.relative_margin_delta) : ''),
        // raw presidential margin delta (two-party or full margin depending on CSV)
        pres_margin_delta: row.pres_margin_delta != null ? parseFloat(row.pres_margin_delta) : NaN,
        pres_margin_delta_str: row.pres_margin_delta_str != null ? String(row.pres_margin_delta_str) : '',
        median_delta_dist: row.median_delta_dist != null ? row.median_delta_dist : '',
        median_delta_dist_str: row.median_delta_dist_str != null ? String(row.median_delta_dist_str) : '',
        // EV-orthogonalized margin delta (signed). Use field name as provided in CSV.
        ev_orthogonalized_margin_delta: row.ev_orthogonalized_margin_delta != null ? parseFloat(row.ev_orthogonalized_margin_delta) : NaN,
        ev_orthogonalized_margin_delta_str: row.ev_orthogonalized_margin_delta_str != null ? String(row.ev_orthogonalized_margin_delta_str) : ''
      });
    });

    // Sort chronologically
    Object.values(byUnit).forEach(rows => rows.sort((a, b) => a.year - b.year));
    // Calculate weights
    const Ws = this.calculateWeights(windowSizes, lambda, weightType);

    // Calculate probabilities for each unit
    const results = [];
    Object.entries(byUnit).forEach(([unit, rows]) => {
      const deltas = rows.map(r => r.delta).filter(d => Number.isFinite(d));
      // collect median distance values (if present in the source CSV)
      // keep medians aligned with rows (may contain NaN for missing)
      const medians_all = rows.map(r => {
        const raw = r.median_delta_dist;
        return Number.isFinite(Number(raw)) ? Number(raw) : NaN;
      });
      // EV orthogonalized values (aligned with rows)
      const ev_all = rows.map(r => Number.isFinite(parseFloat(r.ev_orthogonalized_margin_delta)) ? parseFloat(r.ev_orthogonalized_margin_delta) : NaN);
      // Keep years aligned with string deltas and also include pres_margin_delta strings
      const deltas_str_all = rows.map(r => ({
        year: r.year,
        val: r.delta_str ?? (Number.isFinite(r.delta) ? r.delta.toFixed(4) : '—'),
        pres_val: r.pres_margin_delta_str ?? (Number.isFinite(r.pres_margin_delta) ? r.pres_margin_delta.toFixed(4) : '')
      }));
      // use normalized mode from above (modeStr)
      const probsByN = {};
      windowSizes.forEach(N => {
        if (modeStr === 'median') {
          // For median mode we need median delta distances and raw pres margin deltas (aligned arrays)
          probsByN[`N${N}`] = this.laplaceProbMedianDist(medians_all, rows.map(r => Number.isFinite(parseFloat(r.pres_margin_delta)) ? parseFloat(r.pres_margin_delta) : NaN), N, trendDir);
        } else if (modeStr === 'ev') {
          // EV-orthogonalized sign-based mode: count sign of ev_orthogonalized_margin_delta
          probsByN[`N${N}`] = this.laplaceProbSign(ev_all, rows.map(r => Number.isFinite(parseFloat(r.pres_margin_delta)) ? parseFloat(r.pres_margin_delta) : NaN), N, trendDir);
        } else {
          // relative delta mode
          probsByN[`N${N}`] = this.laplaceProb(deltas, N, deltaThresh, trendDir);
        }
      });

      // Weighted average across available windows
      const entries = windowSizes
        .map(N => ({ N, p: probsByN[`N${N}`], w: Ws[N] }))
        .filter(e => e.p !== null && Number.isFinite(e.p) && e.w > 0);

      const weightedProb =
        entries.length > 0
          ? entries.reduce((sum, e) => sum + e.p * e.w, 0) /
          entries.reduce((sum, e) => sum + e.w, 0)
          : null;

      const endYearRow = endYearData.find(r => r.abbr === unit);
      results.push({
        abbr: unit,
        relative_margin: endYearRow?.relative_margin_str || '',
        relative_margin_numeric: parseFloat(endYearRow?.relative_margin ?? NaN),
        p_weighted: weightedProb,
        ...probsByN,
        deltas,
        medians_all,
        ev_all,
        deltas_str: deltas_str_all,
        // expose pres delta values/strings so details can display raw pres margins
        pres_margin_deltas: rows.map(r => Number.isFinite(parseFloat(r.pres_margin_delta)) ? parseFloat(r.pres_margin_delta) : NaN),
        pres_margin_delta_str: rows.map(r => r.pres_margin_delta_str ?? ''),
        // include median strings (if available) aligned with rows
        median_delta_dist_str: rows.map(r => r.median_delta_dist_str ?? ''),
        ev_orthogonalized_margin_delta_str: rows.map(r => r.ev_orthogonalized_margin_delta_str ?? ''),
      });
    });

    // Sort by weighted probability (descending)
    results.sort((a, b) => {
      if (a.p_weighted === null) return 1;
      if (b.p_weighted === null) return -1;
      if (a.p_weighted === b.p_weighted) return a.abbr.localeCompare(b.abbr);
      return b.p_weighted - a.p_weighted;
    });

    return results;
  }

  /**
   * Format results as CSV
   * @param {Array<Object>} results - Analysis results
   * @param {Array<number>} windowSizes - Window sizes used
   * @returns {string} CSV text
   */
  static formatCSV(results, windowSizes = [4, 5, 6, 7]) {
    const headers = ['abbr', 'relative_margin', 'p_weighted', ...windowSizes.map(N => `p_N${N}`)];
    const rows = [headers.join(',')];
    results.forEach(row => {
      const values = [
        row.abbr,
        row.relative_margin,
        row.p_weighted != null && Number.isFinite(row.p_weighted) ? row.p_weighted.toFixed(6) : ''
      ];
      windowSizes.forEach(N => {
        const v = row[`N${N}`];
        values.push(v != null && Number.isFinite(v) ? v.toFixed(6) : '');
      });
      rows.push(values.join(','));
    });
    return rows.join('\n');
  }

  /**
   * Format probability as percentage string
   * @param {number|null} p - Probability
   * @returns {string} Formatted percentage
   */
  static formatProb(p) {
    if (p === null || !Number.isFinite(p)) return '—';
    return (p * 100).toFixed(1) + '%';
  }
}

// Page wiring
(function () {
  const els = {
    endYear: document.getElementById('endYear'),
    absThresh: document.getElementById('absThresh'),
    absThreshVal: document.getElementById('absThreshVal'),
    deltaThresh: document.getElementById('deltaThresh'),
    deltaThreshVal: document.getElementById('deltaThreshVal'),
    modeSelect: document.getElementById('modeSelect'),
    windowSizes: document.getElementById('windowSizes'),
    lambda: document.getElementById('lambda'),
    lambdaVal: document.getElementById('lambdaVal'),
    weightType: document.getElementById('weightType'),
    trendDir: document.getElementById('trendDir'),
    runBtn: document.getElementById('runBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    // topN removed — always show all units
    status: document.getElementById('status'),
    tableContainer: document.getElementById('tableContainer'),
    stateDetails: document.getElementById('stateDetails'),
    simCount: document.getElementById('simCount'),
    simCountVal: document.getElementById('simCountVal'),
    mcContainer: document.getElementById('mcContainer'),
    mcSummary: document.getElementById('mcSummary'),
    mcTipping: document.getElementById('mcTipping'),
    mcBellwethers: document.getElementById('mcBellwethers')
  };

  /** @type {LaplaceAnalyzer|null} */
  let analyzer = null;
  /** cached last results for download */
  let lastResults = [];
  let lastWindows = [3, 4, 5, 6];
  // Sort state: key and direction (asc/desc)
  let sortKey = 'p_weighted';
  let sortDir = 'desc';
  const BELLWETHER_THRESHOLD = 0.05;
  const MAX_MARGIN_ABS = 0.75;
  const evInfoCache = new Map();
  let evRows = null;
  let mcRunToken = 0;

  function parseWindowSizes(text) {
    return text
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
  }

  // Update display spans when sliders change
  function wireSliders() {
    if (els.lambda && els.lambdaVal) {
      const update = () => {
        els.lambdaVal.textContent = Number(els.lambda.value).toFixed(2);
        updateWeightFormula();
      };
      els.lambda.addEventListener('input', update);
      update();
    }
    if (els.absThresh && els.absThreshVal) {
      const update = () => {
        const v = Number(els.absThresh.value);
        // display as percentage (e.g., 0.15 -> 15%)
        els.absThreshVal.textContent = isFinite(v) ? (v * 100).toFixed(1) + '%' : '';
      };
      els.absThresh.addEventListener('input', update);
      update();
    }
    if (els.deltaThresh && els.deltaThreshVal) {
      const update = () => {
        const v = Number(els.deltaThresh.value);
        // prefer Formatters.leanStr if available for clearer D+/R+ display
        if (typeof window !== 'undefined' && window.Formatters && typeof window.Formatters.leanStr === 'function') {
          els.deltaThreshVal.textContent = window.Formatters.leanStr(v);
        } else {
          els.deltaThreshVal.textContent = isFinite(v) ? v.toFixed(4) : '';
        }
      };
      els.deltaThresh.addEventListener('input', update);
      update();
    }
    if (els.simCount && els.simCountVal) {
      const update = () => {
        const val = parseInt(els.simCount.value, 10);
        els.simCountVal.textContent = Number.isFinite(val) ? val.toLocaleString('en-US') : '';
      };
      els.simCount.addEventListener('input', update);
      els.simCount.addEventListener('change', () => {
        update();
        runMonteCarlo(lastResults, lastWindows, getCurrentContext());
      });
      update();
    }

    // modeSelect: hide delta threshold UI when mode !== 'relative'
    if (els.modeSelect) {
      const hideShow = () => {
        const mode = els.modeSelect.value || 'relative';
        const container = els.deltaThresh && els.deltaThresh.parentNode;
        if (container) container.style.display = mode === 'relative' ? '' : 'none';
      };
      els.modeSelect.addEventListener('change', () => {
        hideShow();
        runAnalysis();
      });
      try { hideShow(); } catch (e) { }
    }
  }

  // Wire weightType and windowSizes to update the formula and re-run analysis where sensible
  if (els.weightType) {
    els.weightType.addEventListener('change', () => {
      updateWeightFormula();
      // re-run to apply new weighting
      runAnalysis();
    });
  }
  if (els.windowSizes) {
    // update formula as the user types and re-run when they finish (change)
    els.windowSizes.addEventListener('input', updateWeightFormula);
    els.windowSizes.addEventListener('change', () => {
      updateWeightFormula();
      runAnalysis();
    });
  }

  function wireTrendDirection() {
    const opEl = document.getElementById('deltaOp');
    if (!els.trendDir) return;
    const updateOp = () => {
      const val = els.trendDir.value === 'left' ? '>' : '<';
      if (opEl) opEl.textContent = val;
    };
    els.trendDir.addEventListener('change', () => {
      // Flip the delta threshold sign so the magnitude is preserved but the comparison direction is inverted
      if (els.deltaThresh) {
        const curr = parseFloat(els.deltaThresh.value) || 0;
        const flipped = -curr;
        // Set the slider value and trigger its input handler to update the displayed value
        els.deltaThresh.value = String(flipped);
        try {
          els.deltaThresh.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e) {
          // ignore if dispatching events isn't supported in this environment
        }
      }
      updateOp();
      runAnalysis();
    });
    updateOp();
  }

  function updateWeightFormula() {
    const formulaEl = document.getElementById('weightFormula');
    if (!formulaEl) return;
    const wt = els.weightType && els.weightType.value ? els.weightType.value : 'linear';
    const lambda = Number(els.lambda && els.lambda.value ? els.lambda.value : 0.25);
    const windowSizes = parseWindowSizes(els.windowSizes.value);
    const minN = windowSizes.length ? Math.min(...windowSizes) : 3;
    if (wt === 'exponential') {
      formulaEl.textContent = `Weight(N) = exp(-${lambda} * (N - ${minN}))`;
    } else {
      formulaEl.textContent = `Weight(N) = 1 / (1 + ${lambda} * (N - ${minN}))`;
    }
  }

  function setStatus(msg) {
    els.status.textContent = msg || '';
  }

  function formatLean(value) {
    if (!Number.isFinite(value)) return '—';
    if (typeof window !== 'undefined' && window.Formatters && typeof window.Formatters.leanStr === 'function') {
      return window.Formatters.leanStr(value);
    }
    if (Math.abs(value) < 1e-6) return 'EVEN';
    const pct = Math.abs(value * 100).toFixed(1);
    return value > 0 ? `D+${pct}` : `R+${pct}`;
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return '—';
    return (value * 100).toFixed(1) + '%';
  }

  function computeStd(values) {
    if (!Array.isArray(values) || !values.length) return 0;
    const finite = values.filter(Number.isFinite);
    if (finite.length < 2) return 0;
    const mean = finite.reduce((sum, v) => sum + v, 0) / finite.length;
    const variance = finite.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (finite.length - 1);
    return Math.sqrt(Math.max(variance, 0));
  }

  function sampleNormal(std) {
    const sigma = Math.max(std, 0);
    if (sigma === 0) return 0;
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-9))) * Math.cos(2 * Math.PI * u2);
    return z * sigma;
  }

  function sampleTruncatedMagnitude(std) {
    const sigma = Math.max(std || 0, 0.005);
    const cap = Math.max(0.01, Math.min(0.2, sigma * 4));
    for (let i = 0; i < 8; i++) {
      const candidate = Math.abs(sampleNormal(sigma));
      if (candidate <= cap) return candidate;
    }
    return cap;
  }

  function clampMargin(value) {
    if (!Number.isFinite(value)) return 0;
    if (value > MAX_MARGIN_ABS) return MAX_MARGIN_ABS;
    if (value < -MAX_MARGIN_ABS) return -MAX_MARGIN_ABS;
    return value;
  }

  function computeMedian(values) {
    if (!Array.isArray(values) || !values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  const baselineCache = new Map();
  let lastMonteCarloSummary = null;

  function determineParty(margin) {
    if (!Number.isFinite(margin)) return null;
    if (margin > 0) return 'D';
    if (margin < 0) return 'R';
    return 'EVEN';
  }

  function getBaselineMap(year) {
    const targetYear = parseInt(year, 10);
    if (!Number.isFinite(targetYear) || !analyzer) return new Map();
    if (baselineCache.has(targetYear)) return baselineCache.get(targetYear);
    const map = new Map();
    const natSet = analyzer && analyzer.nationalAbbrs ? analyzer.nationalAbbrs : new Set();
    analyzer.data.forEach(row => {
      const rowYear = parseInt(row.year, 10);
      if (rowYear !== targetYear) return;
      const abbr = (row.abbr || '').toUpperCase();
      if (!abbr || natSet.has(abbr)) return;
      const rel = parseFloat(row.relative_margin);
      const relStr = row.relative_margin_str != null ? String(row.relative_margin_str) : '';
      const margin = parseFloat(row.pres_margin);
      const marginStr = row.pres_margin_str != null ? String(row.pres_margin_str) : '';
      map.set(abbr, {
        relative: Number.isFinite(rel) ? rel : NaN,
        relativeStr: relStr,
        margin: Number.isFinite(margin) ? margin : NaN,
        marginStr,
        party: determineParty(margin)
      });
    });
    baselineCache.set(targetYear, map);
    return map;
  }

  function renderTipDetailContent(abbr, detail) {
    if (!detail || !Array.isArray(detail.combos) || !detail.combos.length) {
      return '<div class="muted">No scenario breakdown recorded.</div>';
    }
    const lines = [];
    const top = detail.combos[0];
    const winner = top.winner || 'D';
    const loser = winner === 'D' ? 'R' : 'D';
    lines.push(`<div><strong>Top scenario</strong> (${formatPercent(top.share)} of ${abbr} runs)</div>`);
    if (top.altEv || top.finalEv) {
      const withTip = top.finalEv || {};
      const withoutTip = top.altEv || {};
      const withTipText = `D ${withTip.D != null ? withTip.D : '—'} • R ${withTip.R != null ? withTip.R : '—'}`;
      const withoutTipText = `D ${withoutTip.D != null ? withoutTip.D : '—'} • R ${withoutTip.R != null ? withoutTip.R : '—'}`;
      lines.push(`<div class="muted">Final EV: (${withoutTipText}) or (${withTipText})</div>`);
    }
    if (top.tipping) {
      const { abbr: tipAbbr, from, to, ev } = top.tipping;
      const evText = Number.isFinite(ev) ? ` (${ev} EV)` : '';
      const change = from === to ? `${tipAbbr} holds ${to}${evText}` : `${tipAbbr}: ${from}&rarr;${to}${evText}`;
      lines.push(`<div><strong>Tipping state:</strong> ${change}</div>`);
    }

    const hasWinnerChanges = Array.isArray(top.orderedWinnerFlips) && top.orderedWinnerFlips.length > 0;
    const hasLoserChanges = Array.isArray(top.flipsToLoser) && top.flipsToLoser.length > 0;

    const winnerDir = winner === 'D' ? 'R&nbsp;→&nbsp;D' : 'D&nbsp;→&nbsp;R';
    if (hasWinnerChanges) {
      const listHtml = top.orderedWinnerFlips.map(item => {
        const evText = Number.isFinite(item.ev) ? ` (${item.ev} EV)` : '';
        const baseText = `${item.abbr}: ${item.from}&rarr;${item.to}${evText}`;
        return item.tipping ? `${item.abbr}: Tipping point${evText}` : baseText;
      }).join('<br>');
      lines.push(`<div style="margin-top:6px;"><strong>${winnerDir}:</strong><br>${listHtml}</div>`);
    }

    const loserDir = winner === 'D' ? 'D&nbsp;→&nbsp;R' : 'R&nbsp;→&nbsp;D';
    if (hasLoserChanges) {
      const listHtml = top.flipsToLoser.map(item => {
        const evText = Number.isFinite(item.ev) ? ` (${item.ev} EV)` : '';
        return `${item.abbr}: ${item.from}&rarr;${item.to}${evText}`;
      }).join('<br>');
      lines.push(`<div style="margin-top:6px;"><strong>${loserDir}:</strong><br>${listHtml}</div>`);
    }

    if (!hasWinnerChanges && !hasLoserChanges) {
      lines.push('<div class="muted">Matches the 2024 map.</div>');
    }

    if (detail.combos.length > 1) {
      const extras = detail.combos.slice(1, 3).map(alt => {
        const share = formatPercent(alt.share);
        const withTip = alt.finalEv || {};
        const withoutTip = alt.altEv || {};
        const withTipText = `with tip D ${withTip.D != null ? withTip.D : '—'} • R ${withTip.R != null ? withTip.R : '—'}`;
        const withoutTipText = `no tip D ${withoutTip.D != null ? withoutTip.D : '—'} • R ${withoutTip.R != null ? withoutTip.R : '—'}`;
        const segments = [`${withTipText}`, `${withoutTipText}`];
        if (Array.isArray(alt.orderedWinnerFlips) && alt.orderedWinnerFlips.length) {
          const altWinner = alt.winner || winner;
          const directional = altWinner === 'D' ? 'R→D' : 'D→R';
          const names = alt.orderedWinnerFlips.map(item => {
            if (item.tipping) return `${item.abbr}*`;
            return item.abbr;
          }).join(', ');
          segments.push(`${directional}: ${names}`);
        }
        return `<li>${share} • ${segments.join(' | ')}</li>`;
      });
      if (extras.length) {
        lines.push(`<div style="margin-top:6px;"><strong>Other common change sets</strong><ul>${extras.join('')}</ul></div>`);
      }
    }
    return lines.join('');
  }

  async function loadElectoralRows() {
    if (evRows) return evRows;
    let rows = null;
    if (typeof DataLoader !== 'undefined' && DataLoader && typeof DataLoader.loadCsv === 'function') {
      try {
        rows = await DataLoader.loadCsv('electoral_college.csv');
      } catch (err) {
        console.warn('DataLoader loadCsv failed for electoral_college.csv, falling back to fetch.', err);
      }
    }
    if (!rows) {
      const res = await fetch('electoral_college.csv', { cache: 'no-store' });
      const text = await res.text();
      rows = LaplaceAnalyzer.parseCSV(text);
    }
    evRows = Array.isArray(rows) ? rows : [];
    return evRows;
  }

  async function ensureElectoralVotes(year) {
    const yr = parseInt(year, 10);
    if (!Number.isFinite(yr)) {
      return {
        evMap: new Map(),
        districtGroups: new Map(),
        districtParents: new Map()
      };
    }
    if (evInfoCache.has(yr)) return evInfoCache.get(yr);
    const rows = await loadElectoralRows();
    const evMap = new Map();
    const stateTotals = new Map();
    rows.forEach(row => {
      const y = parseInt(row.year, 10);
      if (y !== yr) return;
      const abbr = (row.abbr || '').toUpperCase();
      const ev = parseInt(row.electoral_votes, 10);
      if (!abbr || !Number.isFinite(ev) || ev <= 0) return;
      if (abbr === 'NE' || abbr === 'ME') {
        stateTotals.set(abbr, ev);
        return;
      }
      evMap.set(abbr, ev);
    });

    const baseline = getBaselineMap(yr);
    const districtGroups = new Map();
    const districtParents = new Map();

    ['NE', 'ME'].forEach(state => {
      const atLargeKey = `${state}-AL`;
      const districts = [];
      baseline.forEach((_, abbr) => {
        if (abbr.startsWith(`${state}-`) && abbr !== atLargeKey) {
          districts.push(abbr);
        }
      });
      if (!districts.length) return;

      const totalStateEv = stateTotals.get(state) || 0;
      const atLargeEv = Math.max(0, totalStateEv - districts.length);

      districts.forEach(dist => {
        evMap.set(dist, 1);
        districtParents.set(dist, atLargeKey);
      });

      if (atLargeEv > 0) {
        evMap.set(atLargeKey, atLargeEv);
      }

      districtGroups.set(atLargeKey, {
        state,
        districts: districts.slice(),
        ev: atLargeEv
      });
    });

    const info = { evMap, districtGroups, districtParents };
    evInfoCache.set(yr, info);
    return info;
  }

  function clearMonteCarlo(message) {
    if (!els.mcContainer) return;
    lastMonteCarloSummary = null;
    if (message) {
      els.mcContainer.style.display = 'block';
      if (els.mcSummary) els.mcSummary.textContent = message;
    } else {
      els.mcContainer.style.display = 'none';
      if (els.mcSummary) els.mcSummary.textContent = '';
    }
    if (els.mcTipping) els.mcTipping.innerHTML = '';
    if (els.mcBellwethers) els.mcBellwethers.innerHTML = '';
  }

  function renderMonteCarlo(summary) {
    if (!els.mcContainer || !summary) return;
    lastMonteCarloSummary = summary;
    els.mcContainer.style.display = 'block';
    const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
    const parts = [];
    parts.push(`Ran ${summary.simCount.toLocaleString('en-US')} simulations`);
    parts.push(`EV coverage ${summary.totalEv}${summary.totalEv < 538 ? '/538' : ''}`);
    parts.push(`${summary.simulatedEv.toLocaleString('en-US')} EV simulated`);
    if (summary.tipping.count) {
      parts.push(`avg tipping PV ${formatLean(summary.tipping.mean)}`);
      parts.push(`median ${formatLean(summary.tipping.median)}`);
      parts.push(`capture ${formatPercent(summary.tipping.count / summary.simCount)}`);
    } else {
      parts.push('no tipping outcomes recorded');
    }
    parts.push(`${summary.elapsed.toFixed(0)} ms`);
    if (warnings.length) parts.push(warnings.join(' • '));
    if (els.mcSummary) els.mcSummary.textContent = parts.join(' • ');

    if (els.mcTipping) {
      if (summary.tipStates.length) {
        const tipColumns = [
          { key: 'abbr', label: 'State', type: 'string' },
          { key: 'share', label: 'Share', type: 'percent' },
          { key: 'avgPv', label: 'Avg tipping PV', type: 'number' }
        ];
        const tipSort = summary.tipSort || (summary.tipSort = { key: 'share', dir: 'desc' });
        const sorter = (a, b, key, dir) => {
          if (key === 'abbr') {
            const cmp = a.abbr.localeCompare(b.abbr);
            return dir === 'asc' ? cmp : -cmp;
          }
          const av = Number(a[key]);
          const bv = Number(b[key]);
          if (Number.isFinite(av) && Number.isFinite(bv)) {
            return dir === 'asc' ? av - bv : bv - av;
          }
          const as = String(a[key] ?? '');
          const bs = String(b[key] ?? '');
          const cmp = as.localeCompare(bs);
          return dir === 'asc' ? cmp : -cmp;
        };
        const tipRows = summary.tipStates.slice().sort((a, b) => sorter(a, b, tipSort.key, tipSort.dir));
        const rowsHtml = tipRows
          .map(item => `
            <tr class="summary-row" data-abbr="${item.abbr}">
              <td data-key="abbr">${item.abbr}</td>
              <td data-key="share">${formatPercent(item.share)}</td>
              <td data-key="avgPv">${formatLean(item.avgPv)}</td>
            </tr>`)
          .join('');
        const headerHtml = tipColumns
          .map(col => {
            const active = tipSort.key === col.key;
            const arrow = active ? (tipSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
            const sortAttr = active ? ` data-sort="${tipSort.dir}"` : '';
            return `<th data-key="${col.key}" data-label="${col.label}" class="sortable${active ? ' active' : ''}"${sortAttr}>${col.label}${arrow}</th>`;
          })
          .join('');
        els.mcTipping.innerHTML = `
          <h3>Most common tipping-point states</h3>
          <table>
            <thead><tr>${headerHtml}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        `;
        const table = els.mcTipping.querySelector('table');
        if (table) {
          let openDetail = null;
          Array.from(table.querySelectorAll('tbody tr.summary-row')).forEach(tr => {
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => {
              const abbr = tr.getAttribute('data-abbr');
              const detail = summary.tipDetails && summary.tipDetails[abbr];
              if (openDetail && openDetail.previousSibling === tr) {
                openDetail.remove();
                openDetail = null;
                return;
              }
              if (openDetail) {
                openDetail.remove();
                openDetail = null;
              }
              const detailTr = document.createElement('tr');
              detailTr.className = 'mc-detail';
              const td = document.createElement('td');
              td.setAttribute('colspan', '3');
              td.innerHTML = renderTipDetailContent(abbr, detail);
              detailTr.appendChild(td);
              tr.parentNode.insertBefore(detailTr, tr.nextSibling);
              openDetail = detailTr;
            });
          });
          Array.from(table.querySelectorAll('thead th.sortable')).forEach(th => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', () => {
              const key = th.getAttribute('data-key');
              if (!key) return;
              const current = summary.tipSort || { key: 'share', dir: 'desc' };
              const newDir = current.key === key && current.dir === 'desc' ? 'asc' : 'desc';
              summary.tipSort = { key, dir: newDir };
              lastMonteCarloSummary = summary;
              renderMonteCarlo(summary);
            });
          });
        }
      } else {
        els.mcTipping.innerHTML = '<p class="muted">No tipping point states to report.</p>';
      }
    }

    if (els.mcBellwethers) {
      if (summary.bellwethers.length) {
        const bwColumns = [
          { key: 'abbr', label: 'State', type: 'string' },
          { key: 'share', label: 'Bellwether rate', type: 'percent' },
          { key: 'blueShare', label: 'Blue when bellwether', type: 'percent' }
        ];
        const bwSort = summary.bwSort || (summary.bwSort = { key: 'share', dir: 'desc' });
        const sorter = (a, b, key, dir) => {
          if (key === 'abbr') {
            const cmp = a.abbr.localeCompare(b.abbr);
            return dir === 'asc' ? cmp : -cmp;
          }
          const av = Number(a[key]);
          const bv = Number(b[key]);
          if (Number.isFinite(av) && Number.isFinite(bv)) {
            return dir === 'asc' ? av - bv : bv - av;
          }
          const as = String(a[key] ?? '');
          const bs = String(b[key] ?? '');
          const cmp = as.localeCompare(bs);
          return dir === 'asc' ? cmp : -cmp;
        };
        const bwRows = summary.bellwethers.slice().sort((a, b) => sorter(a, b, bwSort.key, bwSort.dir));
        const rowsHtml = bwRows
          .map(item => `
            <tr>
              <td data-key="abbr">${item.abbr}</td>
              <td data-key="share">${formatPercent(item.share)}</td>
              <td data-key="blueShare">${formatPercent(item.blueShare)}</td>
            </tr>`)
          .join('');
        const headerHtml = bwColumns
          .map(col => {
            const active = bwSort.key === col.key;
            const arrow = active ? (bwSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
            const sortAttr = active ? ` data-sort="${bwSort.dir}"` : '';
            return `<th data-key="${col.key}" data-label="${col.label}" class="sortable${active ? ' active' : ''}"${sortAttr}>${col.label}${arrow}</th>`;
          })
          .join('');
        els.mcBellwethers.innerHTML = `
          <h3>Bellwether likelihoods (|rel| &lt; 5 pts)</h3>
          <table>
            <thead><tr>${headerHtml}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        `;
        const bTable = els.mcBellwethers.querySelector('table');
        if (bTable) {
          Array.from(bTable.querySelectorAll('thead th.sortable')).forEach(th => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', () => {
              const key = th.getAttribute('data-key');
              if (!key) return;
              const current = summary.bwSort || { key: 'share', dir: 'desc' };
              const newDir = current.key === key && current.dir === 'desc' ? 'asc' : 'desc';
              summary.bwSort = { key, dir: newDir };
              lastMonteCarloSummary = summary;
              renderMonteCarlo(summary);
            });
          });
        }
      } else {
        els.mcBellwethers.innerHTML = '<p class="muted">No states landed within ±5 points often enough to list.</p>';
      }
    }
  }

  function getCurrentContext() {
    return {
      endYear: parseInt(els.endYear && els.endYear.value, 10) || 2024,
      trendDir: els.trendDir && els.trendDir.value ? els.trendDir.value : 'left',
      mode: els.modeSelect && els.modeSelect.value ? els.modeSelect.value : 'relative'
    };
  }

  async function runMonteCarlo(results, windowSizes, context = {}) {
    if (!els.mcContainer) return;
    if (!Array.isArray(results) || !results.length) {
      clearMonteCarlo('');
      return;
    }
    const simCount = parseInt(els.simCount && els.simCount.value, 10);
    if (!Number.isFinite(simCount) || simCount <= 0) {
      clearMonteCarlo('Monte Carlo disabled — increase simulation count.');
      return;
    }
    const token = ++mcRunToken;
    clearMonteCarlo('Running Monte Carlo…');

    try {
      const { evMap, districtGroups } = await ensureElectoralVotes(context.endYear || 2024);
      if (token !== mcRunToken) return;
      if (!evMap || !evMap.size) {
        clearMonteCarlo('Electoral vote data unavailable.');
        return;
      }

      const derivedAtLarge = new Set();
      const districtByAtLarge = new Map();
      if (districtGroups && typeof districtGroups.forEach === 'function') {
        districtGroups.forEach((group, atLargeKey) => {
          derivedAtLarge.add(atLargeKey);
          if (group && Array.isArray(group.districts)) {
            districtByAtLarge.set(atLargeKey, group.districts.slice());
          }
        });
      }

      const baseline = getBaselineMap(context.endYear || 2024);
      const maxWindow = windowSizes && windowSizes.length ? Math.max(...windowSizes) : 0;
      const states = results
        .map(row => {
          const abbr = row.abbr;
          if (!abbr || derivedAtLarge.has(abbr)) return null;
          const ev = evMap.get(abbr);
          const baseMargin = Number(row.relative_margin_numeric);
          if (!Number.isFinite(ev) || ev <= 0 || !Number.isFinite(baseMargin)) return null;
          const deltas = Array.isArray(row.deltas) ? row.deltas.filter(Number.isFinite) : [];
          const windowValues = maxWindow ? deltas.slice(-maxWindow) : deltas;
          const std = computeStd(windowValues) || computeStd(deltas) || 0.01;
          let probWeight = Number(row.p_weighted);
          if (!Number.isFinite(probWeight)) probWeight = 0.5;
          let probLeft = context.trendDir === 'right' ? 1 - probWeight : probWeight;
          probLeft = Math.min(0.999, Math.max(0.001, probLeft));
          return { abbr, ev, baseMargin, std, probLeft, source: 'sim', baseInfo: baseline.get(abbr) || null };
        })
        .filter(Boolean);

      if (!states.length) {
        clearMonteCarlo('No states available for Monte Carlo.');
        return;
      }

      const statesByAbbr = new Map(states.map(s => [s.abbr, s]));
      const fixedStates = [];
      evMap.forEach((ev, abbr) => {
        if (statesByAbbr.has(abbr)) {
          const info = baseline.get(abbr) || null;
          const ref = statesByAbbr.get(abbr);
          ref.baseInfo = info;
          const fallbackParty = determineParty(ref.baseMargin) || 'EVEN';
          ref.baseParty = info && info.party ? info.party : fallbackParty;
        } else if (!derivedAtLarge.has(abbr)) {
          const baseInfo = baseline.get(abbr) || null;
          let margin = baseInfo && Number.isFinite(baseInfo.relative) ? baseInfo.relative : NaN;
          if (!Number.isFinite(margin)) margin = baseInfo && Number.isFinite(baseInfo.margin) ? baseInfo.margin : NaN;
          if (!Number.isFinite(margin)) {
            if (baseInfo && baseInfo.party === 'D') margin = 0.1;
            else if (baseInfo && baseInfo.party === 'R') margin = -0.1;
            else margin = 0;
          }
          const baseParty = baseInfo && baseInfo.party ? baseInfo.party : determineParty(margin);
          fixedStates.push({
            abbr,
            ev,
            relMargin: clampMargin(margin),
            source: 'baseline',
            baseInfo,
            baseParty,
            baseMargin: margin
          });
        }
      });

      states.forEach(state => {
        if (!state.baseParty) {
          state.baseParty = determineParty(state.baseMargin) || 'EVEN';
        }
      });

      const derivedEvSim = Array.from(districtByAtLarge.entries()).reduce((sum, [atLargeKey, districts]) => {
        const group = districtGroups && typeof districtGroups.get === 'function' ? districtGroups.get(atLargeKey) : null;
        if (!group || !group.ev || !Array.isArray(districts) || !districts.length) return sum;
        const covered = districts.every(dist => statesByAbbr.has(dist));
        return covered ? sum + group.ev : sum;
      }, 0);
      const totalEvSim = states.reduce((sum, item) => sum + item.ev, 0) + derivedEvSim;
      const warnings = [];
      const totalEv = evMap && evMap.size
        ? Array.from(evMap.values()).reduce((acc, val) => acc + val, 0)
        : totalEvSim;
      const missingEv = totalEv - totalEvSim;
      // if (missingEv > 0) {
      //   warnings.push(`coverage warning: ${totalEvSim} EV simulated, ${missingEv} EV held at baseline; widen abs threshold for full map`);
      // }

      const tippingStats = new Map();
      const tippingDetails = new Map();
      const bellwetherStats = new Map();
      states.forEach(s => {
        bellwetherStats.set(s.abbr, { count: 0, blue: 0 });
      });
      const tippingValues = [];
      let tippingSum = 0;

      const t0 = performance.now();
      for (let i = 0; i < simCount; i++) {
        const simulated = states.map(state => {
          const leftMove = Math.random() < state.probLeft;
          const sign = leftMove ? 1 : -1;
          const delta = sign * sampleTruncatedMagnitude(state.std);
          const relMargin = clampMargin(state.baseMargin + delta);
          return {
            abbr: state.abbr,
            ev: state.ev,
            relMargin,
            source: 'sim',
            baseInfo: state.baseInfo,
            baseParty: state.baseParty || 'EVEN',
            baseMargin: state.baseMargin
          };
        });

        const outcomeByAbbr = new Map();
        simulated.forEach(entry => {
          outcomeByAbbr.set(entry.abbr, entry);
        });

        fixedStates.forEach(fs => {
          outcomeByAbbr.set(fs.abbr, {
            abbr: fs.abbr,
            ev: fs.ev,
            relMargin: fs.relMargin,
            source: 'baseline',
            baseInfo: fs.baseInfo,
            baseParty: fs.baseParty || (fs.baseInfo && fs.baseInfo.party ? fs.baseInfo.party : 'EVEN'),
            baseMargin: fs.baseMargin
          });
        });

        districtByAtLarge.forEach((districts, atLargeKey) => {
          const group = districtGroups && typeof districtGroups.get === 'function' ? districtGroups.get(atLargeKey) : null;
          if (!group || !group.ev) return;
          const districtEntries = Array.isArray(districts)
            ? districts.map(dist => outcomeByAbbr.get(dist)).filter(Boolean)
            : [];
          const baseInfo = baseline.get(atLargeKey) || null;
          let baseMargin = baseInfo && Number.isFinite(baseInfo.relative) ? baseInfo.relative : NaN;
          if (!Number.isFinite(baseMargin) && baseInfo && Number.isFinite(baseInfo.margin)) baseMargin = baseInfo.margin;
          if (!Number.isFinite(baseMargin)) baseMargin = 0;
          if (!districtEntries.length) {
            outcomeByAbbr.set(atLargeKey, {
              abbr: atLargeKey,
              ev: group.ev,
              relMargin: clampMargin(baseMargin),
              source: 'baseline',
              baseInfo,
              baseParty: baseInfo && baseInfo.party ? baseInfo.party : determineParty(baseMargin) || 'EVEN',
              baseMargin
            });
            return;
          }
          const avg = districtEntries.reduce((sum, entry) => sum + entry.relMargin, 0) / districtEntries.length;
          const relMargin = clampMargin(avg);
          const anySim = districtEntries.some(entry => entry && entry.source !== 'baseline');
          outcomeByAbbr.set(atLargeKey, {
            abbr: atLargeKey,
            ev: group.ev,
            relMargin,
            source: anySim ? 'sim' : 'baseline',
            baseInfo,
            baseParty: baseInfo && baseInfo.party ? baseInfo.party : determineParty(baseMargin) || 'EVEN',
            baseMargin
          });
        });

        const combined = Array.from(outcomeByAbbr.values());

        combined.sort((a, b) => b.relMargin - a.relMargin);

        let tally = 0;
        let tipping = null;
        for (const st of combined) {
          tally += st.ev;
          if (tipping === null && tally >= 270) {
            tipping = st;
            break;
          }
        }
        if (!tipping && combined.length) {
          tipping = combined[combined.length - 1];
        }
        if (tipping) {
          const pvValue = -tipping.relMargin;
          tippingValues.push(pvValue);
          tippingSum += pvValue;
          const stat = tippingStats.get(tipping.abbr) || { count: 0, pvSum: 0 };
          stat.count += 1;
          stat.pvSum += pvValue;
          tippingStats.set(tipping.abbr, stat);

          const detailList = tippingDetails.get(tipping.abbr) || [];
          const tipIdx = combined.findIndex(item => item === tipping);
          const coalitionEntries = tipIdx >= 0 ? combined.slice(0, tipIdx + 1) : combined.slice();

          const baseDemEv = combined.reduce((sum, entry) => sum + (entry.baseParty === 'D' ? entry.ev : 0), 0);
          const baseRepEv = combined.reduce((sum, entry) => sum + (entry.baseParty === 'R' ? entry.ev : 0), 0);
          const finalDemEv = combined.reduce((sum, entry) => sum + ((determineParty(entry.relMargin) === 'D') ? entry.ev : 0), 0);
          const finalRepEv = totalEv - finalDemEv;
          const winner = finalDemEv >= 270 ? 'D' : (finalRepEv >= 270 ? 'R' : 'EVEN');
          if (winner === 'EVEN') {
            tippingDetails.set(tipping.abbr, detailList);
            continue;
          }

          const tippingParty = determineParty(tipping.relMargin) || 'EVEN';
          const tipBaseParty = tipping.baseParty || (tipping.baseInfo && tipping.baseInfo.party) || 'EVEN';
          if (tippingParty !== winner || tipBaseParty === winner) {
            tippingDetails.set(tipping.abbr, detailList);
            continue;
          }

          const loser = winner === 'D' ? 'R' : 'D';

          const flipsToWinner = [];
          const flipsToLoser = [];
          combined.forEach(entry => {
            const baseParty = entry.baseParty || (entry.baseInfo && entry.baseInfo.party) || 'EVEN';
            const newParty = determineParty(entry.relMargin) || 'EVEN';
            if (newParty === winner && baseParty !== winner) {
              flipsToWinner.push({ abbr: entry.abbr, ev: entry.ev, from: baseParty, to: newParty });
            } else if (newParty === loser && baseParty !== loser) {
              flipsToLoser.push({ abbr: entry.abbr, ev: entry.ev, from: baseParty, to: newParty });
            }
          });

          const orderedWinnerFlips = [];
          coalitionEntries.forEach(entry => {
            const baseParty = entry.baseParty || (entry.baseInfo && entry.baseInfo.party) || 'EVEN';
            const newParty = determineParty(entry.relMargin) || 'EVEN';
            if (newParty === winner && baseParty !== winner) {
              orderedWinnerFlips.push({
                abbr: entry.abbr,
                ev: entry.ev,
                from: baseParty,
                to: newParty,
                tipping: entry === tipping
              });
            }
          });

          if (!orderedWinnerFlips.some(entry => entry.tipping)) {
            tippingDetails.set(tipping.abbr, detailList);
            continue;
          }

          const baseWinnerEv = winner === 'D' ? baseDemEv : baseRepEv;
          const baseLoserEv = winner === 'D' ? baseRepEv : baseDemEv;
          const finalWinnerEv = winner === 'D' ? finalDemEv : finalRepEv;

          const winnerGain = flipsToWinner.reduce((sum, entry) => sum + (entry.ev || 0), 0);
          const winnerLoss = flipsToLoser.reduce((sum, entry) => sum + (entry.ev || 0), 0);
          const reconstructedWinner = baseWinnerEv + winnerGain - winnerLoss;
          if (Math.abs(reconstructedWinner - finalWinnerEv) >= 0.5) {
            tippingDetails.set(tipping.abbr, detailList);
            continue;
          }

          const tippingChange = {
            abbr: tipping.abbr,
            ev: tipping.ev,
            from: tipBaseParty,
            to: tippingParty
          };

          const finalWithTip = { D: finalDemEv, R: finalRepEv };
          const finalWithoutTip = { D: finalDemEv, R: finalRepEv };
          if (winner === 'D') {
            finalWithoutTip.D = Math.max(0, finalWithoutTip.D - (tipping.ev || 0));
            finalWithoutTip.R = Math.min(totalEv, finalWithoutTip.R + (tipping.ev || 0));
          } else {
            finalWithoutTip.R = Math.max(0, finalWithoutTip.R - (tipping.ev || 0));
            finalWithoutTip.D = Math.min(totalEv, finalWithoutTip.D + (tipping.ev || 0));
          }

          detailList.push({
            winner,
            tipping: tippingChange,
            flipsToWinner,
            flipsToLoser,
            orderedWinnerFlips,
            finalEv: finalWithTip,
            altEv: finalWithoutTip,
            baseEv: { D: baseDemEv, R: baseRepEv }
          });
          tippingDetails.set(tipping.abbr, detailList);
        }

        simulated.forEach(st => {
          const rec = bellwetherStats.get(st.abbr);
          if (!rec) return;
          if (Math.abs(st.relMargin) < BELLWETHER_THRESHOLD) {
            rec.count += 1;
            if (st.relMargin > 0) rec.blue += 1;
          }
        });
      }
      const elapsed = performance.now() - t0;

      const tippingCount = tippingValues.length;
      const tipMean = tippingCount ? tippingSum / tippingCount : null;
      const tipMedian = tippingCount ? computeMedian(tippingValues) : null;

      const tipStates = Array.from(tippingStats.entries())
        .map(([abbr, stat]) => ({
          abbr,
          share: tippingCount ? stat.count / tippingCount : 0,
          avgPv: stat.count ? stat.pvSum / stat.count : null
        }))
        .sort((a, b) => b.share - a.share)
        .slice(0, 10);

      const tipDetails = {};
      tippingDetails.forEach((list, abbr) => {
        const total = list.length || 1;
        const grouped = new Map();
        list.forEach(entry => {
          const sortedWinner = Array.isArray(entry.flipsToWinner)
            ? entry.flipsToWinner.map(f => f.abbr).sort().join('|')
            : '';
          const sortedLoser = Array.isArray(entry.flipsToLoser)
            ? entry.flipsToLoser.map(f => f.abbr).sort().join('|')
            : '';
          const key = `${entry.winner}__${sortedWinner}__${sortedLoser}`;
          const normalized = {
            tipping: entry.tipping,
            winner: entry.winner,
            flipsToWinner: Array.isArray(entry.flipsToWinner) ? entry.flipsToWinner.map(f => ({ ...f })) : [],
            flipsToLoser: Array.isArray(entry.flipsToLoser) ? entry.flipsToLoser.map(f => ({ ...f })) : [],
            orderedWinnerFlips: Array.isArray(entry.orderedWinnerFlips) ? entry.orderedWinnerFlips.map(f => ({ ...f })) : [],
            finalEv: entry.finalEv ? { ...entry.finalEv } : null,
            altEv: entry.altEv ? { ...entry.altEv } : null,
            baseEv: entry.baseEv ? { ...entry.baseEv } : null
          };
          const g = grouped.get(key);
          if (g) {
            g.count += 1;
          } else {
            grouped.set(key, { count: 1, entry: normalized });
          }
        });
        const combos = Array.from(grouped.values())
          .map(({ count, entry }) => ({
            share: count / total,
            tipping: entry.tipping,
            winner: entry.winner,
            flipsToWinner: entry.flipsToWinner,
            flipsToLoser: entry.flipsToLoser,
            orderedWinnerFlips: entry.orderedWinnerFlips,
            finalEv: entry.finalEv,
            altEv: entry.altEv,
            baseEv: entry.baseEv
          }))
          .sort((a, b) => b.share - a.share);
        tipDetails[abbr] = { combos };
      });

      const bellwethers = Array.from(bellwetherStats.entries())
        .map(([abbr, stat]) => ({
          abbr,
          share: stat.count / simCount,
          blueShare: stat.count ? stat.blue / stat.count : 0
        }))
        .filter(item => item.share > 0)
        .sort((a, b) => b.share - a.share)
        .slice(0, 15);

      if (token !== mcRunToken) return;
      renderMonteCarlo({
        simCount,
        totalEv,
        simulatedEv: totalEvSim,
        elapsed,
        tipping: { count: tippingCount, mean: tipMean, median: tipMedian },
        tipStates,
        tipDetails,
        bellwethers,
        warnings
      });
    } catch (err) {
      console.error('Monte Carlo simulation failed', err);
      if (token === mcRunToken) {
        clearMonteCarlo('Monte Carlo simulation failed. Check console for details.');
      }
    }
  }

  function renderTable(results, windowSizes) {
    const dirLabel = (els.trendDir && els.trendDir.value === 'right') ? 'right' : 'left';
    const cols = [
      { key: '__rank', label: 'Rank' },
      { key: 'abbr', label: 'Unit' },
      // use relative_margin_numeric as the sortable key; display string comes from relative_margin
      { key: 'relative_margin_numeric', label: 'Last rel. margin' },
      { key: 'p_weighted', label: `P(${dirLabel} | weighted)`, fmt: v => LaplaceAnalyzer.formatProb(v) },
      ...windowSizes.map(N => ({
        key: `N${N}`,
        label: `P(${dirLabel} | N=${N})`,
        fmt: v => LaplaceAnalyzer.formatProb(v)
      }))
    ];

    const limited = results; // always show all units
    // Ensure results are sorted according to current sort state before rendering
    function parseDisplayMargin(str) {
      if (!str || typeof str !== 'string') return NaN;
      str = str.trim();
      if (str === 'EVEN' || str === '—') return 0;
      const pct = str.match(/^(-?\d+(?:\.\d+)?)%$/);
      if (pct) return parseFloat(pct[1]) / 100;
      const m = str.match(/^([DR])?\+?(-?\d+(?:\.\d+)?)/i);
      if (m) {
        const party = (m[1] || '').toUpperCase();
        const val = parseFloat(m[2]);
        if (!Number.isFinite(val)) return NaN;
        if (party === 'R') return -Math.abs(val) / 100;
        return val / 100;
      }
      return NaN;
    }

    function compareRows(a, b, key, direction) {
      const vaRaw = a[key];
      const vbRaw = b[key];

      // Special-case alphabetical sorting for unit/abbr column (case-insensitive)
      if (key === 'abbr') {
        const sa = String(a.abbr || '').toLowerCase();
        const sb = String(b.abbr || '').toLowerCase();
        const cmp = sa.localeCompare(sb);
        return direction === 'asc' ? cmp : -cmp;
      }

      // Null/undefined handling
      if (vaRaw == null && vbRaw == null) return 0;
      if (vaRaw == null) return 1;
      if (vbRaw == null) return -1;

      let vaNum = Number(vaRaw);
      let vbNum = Number(vbRaw);
      if (!Number.isFinite(vaNum)) {
        if (key === 'relative_margin_numeric') {
          vaNum = Number(a.relative_margin_numeric);
        }
        if (!Number.isFinite(vaNum)) vaNum = parseDisplayMargin(a.relative_margin);
      }
      if (!Number.isFinite(vbNum)) {
        if (key === 'relative_margin_numeric') {
          vbNum = Number(b.relative_margin_numeric);
        }
        if (!Number.isFinite(vbNum)) vbNum = parseDisplayMargin(b.relative_margin);
      }

      if (Number.isFinite(vaNum) && Number.isFinite(vbNum)) {
        const cmp = vaNum - vbNum;
        return direction === 'asc' ? cmp : -cmp;
      }

      const sa = String(vaRaw);
      const sb = String(vbRaw);
      const cmp = sa.localeCompare(sb);
      return direction === 'asc' ? cmp : -cmp;
    }

    // Apply current sort state to results (in-place)
    if (sortKey) {
      results.sort((a, b) => compareRows(a, b, sortKey, sortDir));
    }

    const thead = `
      <thead>
        <tr>${cols.map(c => {
      // Render rank column as non-sortable and sticky
      if (c.key === '__rank') return `<th class="sticky rank">${c.label}</th>`;
      const active = c.key === sortKey;
      const arrow = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      const attr = active ? ` data-sort="${sortDir}"` : '';
      // Make the unit/abbr header sticky as well
      const extraClass = c.key === 'abbr' ? ' sticky abbr' : '';
      return `<th data-key="${c.key}" class="sortable${extraClass}"${attr}>${c.label}${arrow}</th>`;
    }).join('')}</tr>
      </thead>
    `;
    const tbody = `
      <tbody>
        ${limited
        .map((r, idx) => {
          const tds = cols.map(c => {
            // Rank column uses the current index + 1 (1-based)
            if (c.key === '__rank') return `<td class="sticky rank">${idx + 1}</td>`;
            const raw = r[c.key];
            let val;
            if (c.key === 'relative_margin_numeric') {
              // display the preformatted string if available, otherwise show percent
              val = r.relative_margin || (Number.isFinite(raw) ? (raw * 100).toFixed(1) + '%' : '—');
            } else {
              val = c.fmt ? c.fmt(raw) : raw ?? '';
            }
            // add sticky class to the unit column cells so they stick on horizontal scroll
            const extraClass = c.key === 'abbr' ? ' sticky abbr' : '';
            const baseClass = c.key === 'relative_margin_numeric' ? 'muted nowrap' : '';
            const cls = `${baseClass}${extraClass ? ' ' + extraClass.trim() : ''}`.trim();
            return `<td class="${cls}">${val ?? ''}</td>`;
          }).join('');
          return `<tr data-abbr="${r.abbr}">${tds}</tr>`;
        })
        .join('')}
      </tbody>
    `;

    els.tableContainer.innerHTML = `<table>${thead}${tbody}</table>`;
    // After inserting table HTML, make the rank and abbr columns sticky with correct left offsets.
    try {
      const table = els.tableContainer.querySelector('table');
      if (table) {
        // Measure the rendered rank header cell to compute left offset for the abbr column
        const rankTh = table.querySelector('th.rank');
        const rankWidth = rankTh ? Math.ceil(rankTh.getBoundingClientRect().width) : 0;

        // Determine a background color to avoid transparent overlap; fallback to white
        const tableBg = window.getComputedStyle(table).backgroundColor || '#fff';

        // Apply sticky styles to all sticky elements
        Array.from(table.querySelectorAll('th.sticky, td.sticky')).forEach(el => {
          el.style.position = 'sticky';
          // header cells should sit above body cells
          const isHeader = el.tagName === 'TH';
          el.style.zIndex = isHeader ? '4' : '3';
          // set background to table background to mask underlying content
          el.style.background = tableBg;
        });

        // Set left offsets: rank at 0, abbr at rankWidth
        Array.from(table.querySelectorAll('th.rank, td.rank')).forEach(el => {
          el.style.left = '0px';
        });
        Array.from(table.querySelectorAll('th.abbr, td.abbr')).forEach(el => {
          el.style.left = rankWidth + 'px';
        });
      }
    } catch (e) {
      // Non-fatal: if anything goes wrong with layout math, ignore and continue
      console.warn('Sticky column setup failed', e);
    }
    // Set up row click handlers: insert a details <tr> directly under the clicked row
    let openDetailsRow = null;
    Array.from(els.tableContainer.querySelectorAll('tbody tr')).forEach(tr => {
      tr.addEventListener('click', () => {
        const abbr = tr.getAttribute('data-abbr');
        const row = results.find(x => x.abbr === abbr);
        if (!row) return;

        // If a details row is already open for this row, remove it (toggle)
        if (openDetailsRow && openDetailsRow.previousSibling === tr) {
          openDetailsRow.remove();
          openDetailsRow = null;
          return;
        }

        // Remove existing details row if open elsewhere
        if (openDetailsRow) {
          openDetailsRow.remove();
          openDetailsRow = null;
        }

        const deltas = row.deltas ?? [];
        const deltas_str = row.deltas_str ?? [];
        const maxN = Math.max(...(windowSizes && windowSizes.length ? windowSizes : [3]));

        const startIndex = Math.max(0, deltas_str.length - maxN);
        const recentEntries = deltas_str.slice(startIndex).reverse();
        const recentNum = deltas.slice(-maxN).reverse();

        const mode = els.modeSelect && els.modeSelect.value ? els.modeSelect.value : 'relative';
        const trendDir = els.trendDir && els.trendDir.value ? els.trendDir.value : 'left';

        // Prepare aligned median arrays for the recent window (chronological order -> we reverse for display)
        const medians_all = row.medians_all ?? [];
        const medianStrs_all = row.median_delta_dist_str ?? [];
        const medians_recent = medians_all.slice(-maxN).reverse();
        const medianStrs_recent = medianStrs_all.slice(-maxN).reverse();

        // prepare pres_recent aligned with medians for fallback when median === 0
        const pres_all = row.pres_margin_deltas ?? [];
        const pres_recent = pres_all.slice(-maxN).reverse();

        // EV orthogonalized arrays aligned with rows
        const ev_all = row.ev_all ?? [];
        const evStrs_all = row.ev_orthogonalized_margin_delta_str ?? [];
        const ev_recent = ev_all.slice(-maxN).reverse();
        const evStrs_recent = evStrs_all.slice(-maxN).reverse();

        const formatted = recentEntries.map((entry, i) => {
          // entry: { year, val, pres_val } where val is the relative delta string and pres_val is pres_margin_delta_str
          const year = entry.year;
          const presDeltaStr = entry.pres_val || entry.val || ''; // prefer raw pres margin delta string
          const num = recentNum[i];
          let success = false;
          let metricLabel = '';
          let metricValue = '';

          if (mode === 'median') {
            const medianNum = Number.isFinite(medians_recent[i]) ? medians_recent[i] : NaN;
            const presNum = Number.isFinite(pres_recent[i]) ? pres_recent[i] : NaN;
            if (Number.isFinite(medianNum)) {
              success = LaplaceAnalyzer.medianEntrySuccess(medianNum, presNum, trendDir);
            }
            metricLabel = 'median_dist';
            metricValue = medianStrs_recent[i] || '';
          } else if (mode === 'ev') {
            const evNum = Number.isFinite(ev_recent[i]) ? ev_recent[i] : NaN;
            const presNum = Number.isFinite(pres_recent[i]) ? pres_recent[i] : NaN;
            if (Number.isFinite(evNum)) {
              success = LaplaceAnalyzer.evEntrySuccess(evNum, presNum, trendDir);
            }
            metricLabel = 'ev_orth';
            metricValue = evStrs_recent[i] || (Number.isFinite(evNum) ? evNum.toFixed(4) : '');
          } else {
            const deltaThresh = parseFloat(els.deltaThresh.value);
            if (Number.isFinite(num)) {
              success = trendDir === 'left' ? num > deltaThresh : num < deltaThresh;
            }
            metricLabel = 'relative';
            // for relative mode, metric value should be the relative delta (entry.val) or numeric
            metricValue = entry.val || (Number.isFinite(num) ? num.toFixed(4) : '');
          }

          const metricNote = metricValue ? ` (${metricLabel}: ${metricValue})` : '';
          const s = `${year}: ${presDeltaStr}`;
          return success ? `<strong class="success">${s}${metricNote} ★</strong>` : `${s}${metricNote}`;
        });

        // Create a details row spanning the full table width
        const detailsTr = document.createElement('tr');
        const td = document.createElement('td');
        td.setAttribute('colspan', String(cols.length));
        td.className = 'state-details';
        td.innerHTML = `
          <div><strong>${abbr}</strong></div>
          <div class="muted">${mode === 'median' ? 'Delta distance from median delta (most recent)' : (mode === 'ev' ? 'EV-orthogonalized deltas (most recent)' : 'Relative deltas (most recent ' + recentEntries.length + ')')}:</div>
          <div style="margin-top:6px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">
            ${recentEntries.length ? formatted.join('<br/> ') : '—'}
          </div>
        `;
        detailsTr.appendChild(td);

        // Insert after the clicked row
        tr.parentNode.insertBefore(detailsTr, tr.nextSibling);
        openDetailsRow = detailsTr;
      });
    });

    // Sorting: attach handlers to header cells and toggle global sort state
    const headerCells = els.tableContainer.querySelectorAll('thead th.sortable');
    headerCells.forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-key');
        if (sortKey === key) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortKey = key;
          // sensible default directions: ascending for names, descending for probabilities
          sortDir = key === 'abbr' ? 'asc' : 'desc';
        }

        // Re-render using the global sort state (renderTable will sort before building HTML)
        renderTable(lastResults, windowSizes);
      });
    });
  }

  async function ensureData() {
    if (analyzer) return analyzer;
    setStatus('Loading data…');
    let data;
    // Prefer DataLoader if present (provides d3-based loading and caching)
    if (typeof DataLoader !== 'undefined' && DataLoader && typeof DataLoader.loadPresidentialMargins === 'function') {
      try {
        data = await DataLoader.loadPresidentialMargins();
      } catch (err) {
        console.warn('DataLoader failed, falling back to fetch:', err);
      }
    }

    if (!data) {
      const res = await fetch('presidential_margins.csv', { cache: 'no-store' });
      const text = await res.text();
      data = LaplaceAnalyzer.parseCSV(text);
    }

    // Auto-set endYear to max available
    const years = data.map(r => parseInt(r.year, 10)).filter(Number.isFinite);
    const maxYear = years.length ? Math.max(...years) : 2024;
    if (!els.endYear.value || parseInt(els.endYear.value, 10) < 1900) {
      els.endYear.value = String(maxYear);
    }

    analyzer = new LaplaceAnalyzer(data);
    setStatus('Data loaded.');
    return analyzer;
  }

  function runAnalysis() {
    if (!analyzer) return;
    const endYear = parseInt(els.endYear.value, 10) || 2024;
    // sliders provide string values; parse as numbers
    const absThresh = parseFloat(els.absThresh.value);
    const deltaThresh = parseFloat(els.deltaThresh.value);
    const windowSizes = parseWindowSizes(els.windowSizes.value);
    const lambda = parseFloat(els.lambda.value);
    const weightType = els.weightType.value === 'linear' ? 'linear' : 'exponential';
    const trendDir = els.trendDir && els.trendDir.value ? els.trendDir.value : 'left';
    lastWindows = windowSizes.length ? windowSizes : [3, 4, 5, 6];

    const mode = els.modeSelect && els.modeSelect.value ? els.modeSelect.value : 'relative';
    const t0 = performance.now();
    const results = analyzer.analyze({
      endYear,
      absThresh: Number.isFinite(absThresh) ? absThresh : 0.3,
      deltaThresh: Number.isFinite(deltaThresh) ? deltaThresh : -0.005,
      windowSizes: lastWindows,
      lambda: Number.isFinite(lambda) ? lambda : 0.25,
      weightType,
      trendDir,
      mode
    });
    const dt = performance.now() - t0;

    lastResults = results;
    renderTable(results, lastWindows);
    runMonteCarlo(results, lastWindows, { endYear, trendDir, mode });

    // Format thresholds for status display
    const absDisplay = Number.isFinite(absThresh) ? (absThresh * 100).toFixed(1) + '%' : String(absThresh);
    const operator = trendDir === 'right' ? '<' : '>';
    let deltaDisplay;
    if (typeof window !== 'undefined' && window.Formatters && typeof window.Formatters.leanStr === 'function') {
      deltaDisplay = window.Formatters.leanStr(deltaThresh);
    } else {
      deltaDisplay = Number.isFinite(deltaThresh) ? deltaThresh.toFixed(4) : String(deltaThresh);
    }

    const modeLabel = mode === 'median' ? 'median-mode' : (mode === 'ev' ? 'ev-orthogonalized' : `Δ${operator}${deltaDisplay}`);
    setStatus(`Analyzed ${results.length} units in ${dt.toFixed(1)} ms • endYear=${endYear} • abs≤${absDisplay} • ${modeLabel} • windows=[${lastWindows.join(', ')}] • ${weightType}, λ=${lambda}`);
  }

  function downloadCSV() {
    if (!lastResults.length) return;
    const csv = LaplaceAnalyzer.formatCSV(lastResults, lastWindows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: 'laplace_results.csv'
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Wire up events
  els.runBtn.addEventListener('click', runAnalysis);
  els.downloadBtn.addEventListener('click', downloadCSV);
  // initialize slider wiring
  wireSliders();
  wireTrendDirection();
  // topN removed: no event listener needed

  // Auto-run once ready
  ensureData().then(runAnalysis).catch(err => {
    console.error(err);
    setStatus('Failed to load data.');
  });
})();
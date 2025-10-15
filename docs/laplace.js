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
    const k = recent.filter(d => {
      if (!Number.isFinite(d)) return false;
      return direction === 'left' ? d > deltaThresh : d < deltaThresh;
    }).length;
    return (k + 1) / (N + 2);
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
      deltaThresh = -0.005,
      windowSizes = [3, 4, 5, 6, 7],
      lambda = 0.25,
      weightType = 'linear',
      trendDir = 'left'
    } = options;

    // Filter data to valid years and exclude national aggregates
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
        delta_str: row.relative_margin_delta_str != null ? String(row.relative_margin_delta_str) : (row.relative_margin_delta != null ? String(row.relative_margin_delta) : '')
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
  // Keep years aligned with string deltas
  const deltas_str_all = rows.map(r => ({ year: r.year, val: r.delta_str ?? (Number.isFinite(r.delta) ? r.delta.toFixed(4) : '—') }));
      const probsByN = {};
      windowSizes.forEach(N => {
        probsByN[`N${N}`] = this.laplaceProb(deltas, N, deltaThresh, trendDir);
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
        deltas_str: deltas_str_all,
      });
    });

    // Sort by weighted probability (descending)
    results.sort((a, b) => {
      if (a.p_weighted === null) return 1;
      if (b.p_weighted === null) return -1;
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
    stateDetails: document.getElementById('stateDetails')
  };

  /** @type {LaplaceAnalyzer|null} */
  let analyzer = null;
  /** cached last results for download */
  let lastResults = [];
  let lastWindows = [3, 4, 5, 6];
  // Sort state: key and direction (asc/desc)
  let sortKey = 'p_weighted';
  let sortDir = 'desc';

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
      // Render rank column as non-sortable
      if (c.key === '__rank') return `<th>${c.label}</th>`;
      const active = c.key === sortKey;
      const arrow = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      const attr = active ? ` data-sort="${sortDir}"` : '';
      return `<th data-key="${c.key}" class="sortable"${attr}>${c.label}${arrow}</th>`;
    }).join('')}</tr>
      </thead>
    `;
    const tbody = `
      <tbody>
        ${limited
        .map((r, idx) => {
          const tds = cols.map(c => {
            // Rank column uses the current index + 1 (1-based)
            if (c.key === '__rank') return `<td class="rank">${idx + 1}</td>`;
            const raw = r[c.key];
            let val;
            if (c.key === 'relative_margin_numeric') {
              // display the preformatted string if available, otherwise show percent
              val = r.relative_margin || (Number.isFinite(raw) ? (raw * 100).toFixed(1) + '%' : '—');
            } else {
              val = c.fmt ? c.fmt(raw) : raw ?? '';
            }
            return `<td class="${c.key === 'relative_margin_numeric' ? 'muted nowrap' : ''}">${val ?? ''}</td>`;
          }).join('');
          return `<tr data-abbr="${r.abbr}">${tds}</tr>`;
        })
        .join('')}
      </tbody>
    `;

    els.tableContainer.innerHTML = `<table>${thead}${tbody}</table>`;
    // Set up row click handlers: show chronological deltas (string form), up to the largest N
    Array.from(els.tableContainer.querySelectorAll('tbody tr')).forEach(tr => {
      tr.addEventListener('click', () => {
        const abbr = tr.getAttribute('data-abbr');
        const row = results.find(x => x.abbr === abbr);
        if (!row) return;
        const deltas = row.deltas ?? [];
  const deltas_str = row.deltas_str ?? [];
  const maxN = Math.max(...(windowSizes && windowSizes.length ? windowSizes : [3]));

  // We want the most recent maxN entries. deltas_str entries are objects {year, val} in chronological order
  const startIndex = Math.max(0, deltas_str.length - maxN);
  const recentEntries = deltas_str.slice(startIndex).reverse(); // reverse so most-recent-first
  // Align numeric array: take last maxN numeric deltas and reverse for most-recent-first
  const recentNum = deltas.slice(-maxN).reverse();

        // Determine successes based on current delta threshold and trend direction
        const deltaThresh = parseFloat(els.deltaThresh.value);
        const trendDir = els.trendDir && els.trendDir.value ? els.trendDir.value : 'left';
        const isSuccess = (v) => {
          if (!Number.isFinite(v)) return false;
          return trendDir === 'left' ? v > deltaThresh : v < deltaThresh;
        };

        const formatted = recentEntries.map((entry, i) => {
          const s = `${entry.year}: ${entry.val}`;
          const num = recentNum[i];
          if (isSuccess(num)) {
            return `<strong>★ ${s}</strong>`;
          }
          return s;
        });

        els.stateDetails.style.display = 'block';
        els.stateDetails.innerHTML = `
          <strong>${abbr}</strong>
          <div class="muted">Deltas (most recent ${recentEntries.length}, most-recent-first):</div>
          <div style="margin-top:6px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">
            ${recentEntries.length ? formatted.join(', ') : '—'}
          </div>
        `;
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

    const t0 = performance.now();
    const results = analyzer.analyze({
      endYear,
      absThresh: Number.isFinite(absThresh) ? absThresh : 0.3,
      deltaThresh: Number.isFinite(deltaThresh) ? deltaThresh : -0.005,
      windowSizes: lastWindows,
      lambda: Number.isFinite(lambda) ? lambda : 0.25,
      weightType,
      trendDir
    });
    const dt = performance.now() - t0;

    lastResults = results;
    renderTable(results, lastWindows);

    // Format thresholds for status display
    const absDisplay = Number.isFinite(absThresh) ? (absThresh * 100).toFixed(1) + '%' : String(absThresh);
    const operator = trendDir === 'right' ? '<' : '>';
    let deltaDisplay;
    if (typeof window !== 'undefined' && window.Formatters && typeof window.Formatters.leanStr === 'function') {
      deltaDisplay = window.Formatters.leanStr(deltaThresh);
    } else {
      deltaDisplay = Number.isFinite(deltaThresh) ? deltaThresh.toFixed(4) : String(deltaThresh);
    }

    setStatus(`Analyzed ${results.length} units in ${dt.toFixed(1)} ms • endYear=${endYear} • abs≤${absDisplay} • Δ${operator}${deltaDisplay} • windows=[${lastWindows.join(', ')}] • ${weightType}, λ=${lambda}`);
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
  // topN removed: no event listener needed

  // Auto-run once ready
  ensureData().then(runAnalysis).catch(err => {
    console.error(err);
    setStatus('Failed to load data.');
  });
})();
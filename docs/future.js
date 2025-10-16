(function () {
  console.log('***FUTURE.JS LOADED WITH SYNTHETIC STOPS DEBUG v2***');
  // This script generates future relative margins (2028–2048) client-side using
  // a Brownian-bridge around a 2048 target, derived from 2000–2024 trends.
  // It plugs into tester.js by writing to the same globals (byYear, evByUnit, etc.).

  const PV_CAP = 0.5;
  const EPS = 1e-8;
  const EV_PROJECTION_THRESHOLD_YEAR = 2032;
  const EV_PROJECTION_BASE_KEY = 'baseline';
  const EV_PROJECTION_LABEL_OVERRIDES = {
    brennan: 'Brennan Center',
    election_data_services: 'Election Data Services',
    arp: 'American Redistricting Project'
  };
  const evProjectionState = {
    maps: new Map(),
    selectionKey: EV_PROJECTION_BASE_KEY,
    futureOnly: false,
    selectEl: null,
    futureOnlyEl: null,
    updatingControls: false,
    pendingSelectionKey: null
  };
  let evProjectionRowsCache = null;
  let evProjectionWarned = false;

  // Soft clip like Python softclip(x, L)
  function softclip(x, L) { return L * Math.tanh(x / L); }
  function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
  function wavg(values, weights) {
    let s = 0, w = 0; for (let i = 0; i < values.length; i++) { const vi = +values[i] || 0; const wi = +weights[i] || 0; s += vi * wi; w += wi; }
    return w ? s / w : 0;
  }
  function seedToRng(seed) {
    // Simple mulberry32 PRNG for reproducibility
    let t = (seed >>> 0) + 0x6D2B79F5;
    return function () { t |= 0; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function titleizeProjectionKey(key) {
    if (!key) return '';
    return String(key).replace(/[_\s]+/g, ' ').replace(/\b\w/g, chr => chr.toUpperCase());
  }
  function evProjectionLabelForKey(key) {
    if (!key) return '';
    if (key === EV_PROJECTION_BASE_KEY) return '2024 Baseline';
    const lower = String(key).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(EV_PROJECTION_LABEL_OVERRIDES, lower)) {
      return EV_PROJECTION_LABEL_OVERRIDES[lower];
    }
    return titleizeProjectionKey(lower);
  }
  function parseEvProjectionRows(rows) {
    const out = new Map();
    if (!Array.isArray(rows)) return out;
    rows.forEach(row => {
      if (!row) return;
      const rawAbbr = row.abbr || row.ABBR || '';
      const abbr = String(rawAbbr).trim().toUpperCase();
      if (!abbr) return;
      Object.keys(row).forEach(col => {
        if (!col || col.toLowerCase() === 'abbr') return;
        const raw = row[col];
        if (raw === undefined || raw === null || raw === '') return;
        const delta = +raw;
        if (!Number.isFinite(delta)) return;
        const key = String(col).trim().toLowerCase();
        if (!out.has(key)) out.set(key, new Map());
        out.get(key).set(abbr, delta);
      });
    });
    return out;
  }
  async function loadEvProjectionRows() {
    if (Array.isArray(evProjectionRowsCache)) return evProjectionRowsCache;
    const candidates = [
      '2030_electoral_vote_projections.csv',
      '../election_data/2030_electoral_vote_projections.csv'
    ];
    for (let i = 0; i < candidates.length; i++) {
      const path = candidates[i];
      try {
        const rows = await d3.csv(path);
        if (rows && rows.length) {
          console.log(`[future] Loaded EV projection data from ${path}`);
          evProjectionRowsCache = rows;
          return rows;
        }
      } catch (err) {
        // try next path
      }
    }
    if (!evProjectionWarned) {
      console.warn('[future] EV projection CSV not found; using baseline 2024 EVs for all years.');
      evProjectionWarned = true;
    }
    evProjectionRowsCache = [];
    return evProjectionRowsCache;
  }
  function ensureEvProjectionSelectionValid() {
    if (evProjectionState.selectionKey && evProjectionState.selectionKey !== EV_PROJECTION_BASE_KEY) {
      if (!evProjectionState.maps.has(evProjectionState.selectionKey)) {
        evProjectionState.selectionKey = EV_PROJECTION_BASE_KEY;
      }
    }
  }
  function refreshEvProjectionControls() {
    const selectEl = evProjectionState.selectEl;
    evProjectionState.updatingControls = true;
    if (selectEl) {
      const keys = Array.from(new Set([EV_PROJECTION_BASE_KEY, ...evProjectionState.maps.keys()]));
      selectEl.innerHTML = '';
      keys.forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = evProjectionLabelForKey(key);
        selectEl.appendChild(opt);
      });
      ensureEvProjectionSelectionValid();
      const target = keys.includes(evProjectionState.selectionKey) ? evProjectionState.selectionKey : EV_PROJECTION_BASE_KEY;
      selectEl.value = target;
      evProjectionState.selectionKey = target;
    }
    if (evProjectionState.futureOnlyEl) {
      evProjectionState.futureOnlyEl.checked = !!evProjectionState.futureOnly;
      evProjectionState.futureOnlyEl.disabled = (evProjectionState.selectionKey === EV_PROJECTION_BASE_KEY);
    }
    try { window._futureEvProjectionSelection = { key: evProjectionState.selectionKey, futureOnly: evProjectionState.futureOnly }; } catch (e) { }
    evProjectionState.updatingControls = false;
  }
  function setupEvProjectionControls() {
    const selectEl = document.getElementById('evProjectionSelect');
    const futureOnlyEl = document.getElementById('evProjectionFutureOnly');
    evProjectionState.selectEl = selectEl || null;
    evProjectionState.futureOnlyEl = futureOnlyEl || null;
    if (selectEl) {
      selectEl.addEventListener('change', async () => {
        if (evProjectionState.updatingControls) return;
        const value = selectEl.value || EV_PROJECTION_BASE_KEY;
        evProjectionState.selectionKey = value;
        const isBaseline = (value === EV_PROJECTION_BASE_KEY);
        if (evProjectionState.futureOnlyEl) {
          evProjectionState.futureOnlyEl.disabled = isBaseline;
          evProjectionState.futureOnlyEl.checked = !!evProjectionState.futureOnly;
        }
        updateUrl({
          evProjection: isBaseline ? null : value,
          evProjectionFutureOnly: isBaseline ? null : evProjectionState.futureOnly
        });
        try {
          await regenerateWithCurrentSeed();
          // refresh tester UI (map, labels, EV bar)
          if (typeof window.updateAll === 'function') window.updateAll();
          const curYear = (document.getElementById('yearSlider') && document.getElementById('yearSlider').value) ? parseInt(document.getElementById('yearSlider').value) : (window._curYear || 2024);
          if (typeof window.updateStateLabels === 'function') window.updateStateLabels(curYear);
        } catch (e) { console.warn('[future] failed to apply EV projection change', e); }
      });
    }
    if (futureOnlyEl) {
      futureOnlyEl.checked = !!evProjectionState.futureOnly;
      futureOnlyEl.disabled = (evProjectionState.selectionKey === EV_PROJECTION_BASE_KEY);
      futureOnlyEl.addEventListener('change', async () => {
        if (evProjectionState.updatingControls) return;
        evProjectionState.futureOnly = !!futureOnlyEl.checked;
        updateUrl({
          evProjection: (evProjectionState.selectionKey === EV_PROJECTION_BASE_KEY) ? null : evProjectionState.selectionKey,
          evProjectionFutureOnly: (evProjectionState.selectionKey === EV_PROJECTION_BASE_KEY) ? null : evProjectionState.futureOnly
        });
        try {
          await regenerateWithCurrentSeed();
          if (typeof window.updateAll === 'function') window.updateAll();
          const curYear = (document.getElementById('yearSlider') && document.getElementById('yearSlider').value) ? parseInt(document.getElementById('yearSlider').value) : (window._curYear || 2024);
          if (typeof window.updateStateLabels === 'function') window.updateStateLabels(curYear);
        } catch (e) { console.warn('[future] failed to apply EV projection future-only toggle', e); }
      });
    }
    refreshEvProjectionControls();
  }
  function getSelectedEvProjectionMap() {
    if (evProjectionState.selectionKey === EV_PROJECTION_BASE_KEY) return null;
    return evProjectionState.maps.get(evProjectionState.selectionKey) || null;
  }
  function createEvLookup(evByUnit, projectionMap, opts) {
    const base = new Map();
    if (evByUnit && typeof evByUnit.forEach === 'function') {
      evByUnit.forEach((value, key) => {
        if (typeof key !== 'string') return;
        const parts = key.split(':');
        if (parts.length !== 2) return;
        if (parts[0] === '2024') {
          base.set(parts[1], +value || 0);
        }
      });
    }
    const futureOnly = !!(opts && opts.futureOnly);
    return function getEvForYear(year, unit) {
      if (!unit || unit === 'NATIONAL') return 0;
      const baseVal = base.has(unit) ? base.get(unit) : 0;
      const applyProjection = projectionMap && (!futureOnly || year >= EV_PROJECTION_THRESHOLD_YEAR);
      if (!applyProjection) return baseVal;
      const delta = projectionMap.get(unit) || 0;
      const next = baseVal + delta;
      return next >= 0 ? next : 0;
    };
  }
  function updateEvProjectionStateFromRows(rows) {
    const maps = parseEvProjectionRows(rows);
    evProjectionState.maps = maps;
    if (evProjectionState.pendingSelectionKey && maps.has(evProjectionState.pendingSelectionKey)) {
      evProjectionState.selectionKey = evProjectionState.pendingSelectionKey;
    }
    evProjectionState.pendingSelectionKey = null;
    ensureEvProjectionSelectionValid();
    try { window._futureEvProjectionMaps = maps; } catch (e) { }
    refreshEvProjectionControls();
  }
  function randn(rng) { // Box-Muller
    let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  // Student-t with df using normal approx if df large; here df=4 in Python version
  function rand_t_df4(rng) {
    // t(4) = Z / sqrt(V/4), V~ChiSq(4). ChiSq(4) = sum of 4 N(0,1)^2.
    const Z = randn(rng);
    let V = 0; for (let i = 0; i < 4; i++) { const z = randn(rng); V += z * z; }
    return Z / Math.sqrt(V / 4);
  }

  function computeSlopes(hist, opts) {
    // Compute a per-abbr slope for year -> relative_margin.
    // Methods: 'ols' (default), 'wls' (recently-weighted), 'loess' (local around 2024), 'poly2'/'poly3'.
    // opts = { method, wls: { type: 'exp'|'linear', tau: 12, power: 2 }, loess: { bandwidth: 0.6 }, poly: { deg: 2|3 }, refYear: 2024 }
    const method = (opts && opts.method) || 'ols';
    const refYear = (opts && opts.refYear) || 2024;

    function wlsSlopeIntercept(x, y, w) {
      // Weighted linear regression y ~ a + b x
      let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let i = 0; i < x.length; i++) {
        const wi = +w[i] || 0; const xi = +x[i]; const yi = +y[i];
        sw += wi; sx += wi * xi; sy += wi * yi; sxx += wi * xi * xi; sxy += wi * xi * yi;
      }
      if (sw === 0) { return { intercept: y[y.length - 1] || 0, slope: 0 }; }
      const den = (sw * sxx - sx * sx);
      if (Math.abs(den) < 1e-12) { return { intercept: y[y.length - 1] || 0, slope: 0 }; }
      const slope = (sw * sxy - sx * sy) / den;
      const intercept = (sy - slope * sx) / sw;
      return { intercept, slope };
    }

    function olsSlopeIntercept(x, y) {
      const xbar = mean(x); const ybar = mean(y);
      let num = 0, den = 0; for (let i = 0; i < x.length; i++) { const dx = x[i] - xbar; num += dx * (y[i] - ybar); den += dx * dx; }
      const slope = den ? num / den : 0; const intercept = ybar - slope * xbar; return { intercept, slope };
    }

    function loessSlopeAt(x, y, x0, bandwidth) {
      // Local linear regression around x0 with tricube weights; slope at x0 is the fitted linear coefficient
      const n = x.length; if (n < 2) return { intercept: y[y.length - 1] || 0, slope: 0 };
      const f = (isFinite(bandwidth) && bandwidth > 0 && bandwidth <= 1) ? bandwidth : 0.6; // fraction of points
      const dists = x.map(xi => Math.abs(xi - x0));
      const k = Math.max(2, Math.ceil(f * n));
      const sorted = [...dists].sort((a, b) => a - b);
      let h = sorted[k - 1];
      if (!isFinite(h) || h <= 0) {
        // Fallback to small window using unique distances
        h = sorted.find(v => v > 0) || 1;
      }
      const w = dists.map(d => {
        const u = Math.min(1, Math.max(0, d / h));
        const tc = (1 - Math.pow(u, 3));
        return Math.pow(Math.max(0, tc), 3);
      });
      // Fit centered model y ~ a + b*(x - x0)
      const xc = x.map(v => v - x0);
      let sw = 0, sy = 0, sxx = 0, sxy = 0;
      for (let i = 0; i < n; i++) {
        const wi = +w[i] || 0; sw += wi; sy += wi * y[i]; const xi = xc[i]; sxx += wi * xi * xi; sxy += wi * xi * y[i];
      }
      const den = sxx; // since sum wi*xi = 0 by centering at x0
      if (Math.abs(den) < 1e-12 || sw === 0) { return { intercept: y[y.length - 1] || 0, slope: 0 }; }
      const slope = sxy / den; const intercept = (sy - 0 /* b*sum wi*xi */) / sw;
      return { intercept, slope };
    }

    function polySlopeAt(x, y, deg, x0) {
      // Fit polynomial of degree deg via normal equations; return derivative at x0
      deg = Math.max(1, Math.min(3, Math.floor(deg || 2)));
      const m = deg + 1; // number of coefficients
      // Build normal equations A * beta = b, where A_ij = sum x^(i+j), b_i = sum y*x^i, i,j=0..deg
      const A = Array.from({ length: m }, () => Array(m).fill(0));
      const b = Array(m).fill(0);
      const sums = {}; // sums[k] = sum x^k up to 2*deg
      for (let k = 0; k <= 2 * deg; k++) { sums[k] = 0; }
      for (let i = 0; i < x.length; i++) {
        const xi = +x[i]; const yi = +y[i];
        let p = 1; // xi^0
        const pow = [1];
        for (let k = 1; k <= 2 * deg; k++) { p *= xi; pow[k] = p; }
        for (let k = 0; k <= 2 * deg; k++) { sums[k] += pow[k]; }
        for (let r = 0; r <= deg; r++) { b[r] += yi * pow[r]; }
      }
      for (let i = 0; i <= deg; i++) {
        for (let j = 0; j <= deg; j++) {
          A[i][j] = sums[i + j];
        }
      }
      // Solve A beta = b using small Gaussian elimination
      function solve(Ain, bin) {
        const n = bin.length; const M = Ain.map(row => row.slice()); const bb = bin.slice();
        for (let i = 0; i < n; i++) {
          // pivot
          let piv = i; for (let r = i + 1; r < n; r++) { if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r; }
          if (Math.abs(M[piv][i]) < 1e-12) return null;
          if (piv !== i) { const tmp = M[i]; M[i] = M[piv]; M[piv] = tmp; const t = bb[i]; bb[i] = bb[piv]; bb[piv] = t; }
          const diag = M[i][i];
          for (let j = i; j < n; j++) M[i][j] /= diag; bb[i] /= diag;
          for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i]; if (f !== 0) { for (let j = i; j < n; j++) M[r][j] -= f * M[i][j]; bb[r] -= f * bb[i]; } }
        }
        return bb;
      }
      const beta = solve(A, b);
      if (!beta) return { intercept: y[y.length - 1] || 0, slope: 0 };
      // derivative of poly at x0: p'(x0) = beta1 + 2*beta2*x0 + 3*beta3*x0^2
      let slope = 0;
      if (deg >= 1) slope += beta[1];
      if (deg >= 2) slope += 2 * beta[2] * x0;
      if (deg >= 3) slope += 3 * beta[3] * x0 * x0;
      const intercept = beta[0] + (deg >= 1 ? beta[1] * x0 : 0) + (deg >= 2 ? beta[2] * x0 * x0 : 0) + (deg >= 3 ? beta[3] * x0 * x0 * x0 : 0) - slope * x0;
      return { intercept, slope };
    }

    // Group rows by abbr and apply selected method
    const byAbbr = new Map();
    hist.forEach(r => {
      const a = r.abbr; if (!byAbbr.has(a)) byAbbr.set(a, []); byAbbr.get(a).push(r);
    });
    const out = new Map();
    byAbbr.forEach(rows => {
      rows.sort((a, b) => a.year - b.year);
      const x = rows.map(r => +r.year);
      const y = rows.map(r => +r.relative_margin);
      if (new Set(x).size < 2) { out.set(rows[0].abbr, { intercept: y[y.length - 1] || 0, slope: 0 }); return; }

      let res;
      if (method === 'ols') {
        res = olsSlopeIntercept(x, y);
      } else if (method === 'wls') {
        const wType = (opts && opts.wls && opts.wls.type) || 'exp';
        const tau = (opts && opts.wls && opts.wls.tau) || 12; // years scale for exponential
        const power = (opts && opts.wls && opts.wls.power) || 2; // for linear weighting
        const xmin = x[0]; const xmax = x[x.length - 1]; const span = Math.max(1, xmax - xmin);
        const w = x.map(xi => {
          if (wType === 'linear') {
            const t = (xi - xmin) / span; return Math.pow(Math.max(0, Math.min(1, t)), power);
          } else {
            // exponential recency weight: w = exp((xi - xmax)/tau)
            return Math.exp((xi - xmax) / Math.max(1, tau));
          }
        });
        res = wlsSlopeIntercept(x, y, w);
      } else if (method === 'loess') {
        const bw = (opts && opts.loess && opts.loess.bandwidth);
        res = loessSlopeAt(x, y, refYear, bw);
      } else if (method === 'poly2' || method === 'poly3') {
        const deg = (method === 'poly3') ? 3 : 2;
        res = polySlopeAt(x, y, deg, refYear);
      } else {
        // fallback
        res = olsSlopeIntercept(x, y);
      }
      out.set(rows[0].abbr, res);
    });
    return out; // Map abbr -> {intercept, slope}
  }
  // ---- Model A: Laplace/Beta direction-of-trend endpoint builder ----
  // Uses sign counts of past cycles (2000→2024) + heavy-tailed magnitude,
  // plus a one-factor national shock and vote-weighted recentring.
  function buildTargetsLaplace(dfAll, rng, opts) {
    const yearsAhead = (opts && opts.years_ahead) || 24;
    const soft_delta_L = (opts && opts.soft_delta_L) || 0.33;
    const hist = dfAll.filter(r => r.year >= 2000 && r.year <= 2024);

    // 1) per-state 2024 base + votes
    const base2024 = dfAll
      .filter(r => r.year === 2024)
      .map(r => ({ abbr: r.abbr, rel2024: +r.relative_margin || 0, total_votes: +r.total_votes || 0 }));

    // 2) per-state historical step sigma (already have a helper, reuse it if present; else inline)
    const sigMap = (typeof stateSigma === 'function')
      ? stateSigma(hist)
      : (function inlineSigma(h) {
        const by = new Map();
        h.sort((a, b) => a.abbr.localeCompare(b.abbr) || a.year - b.year);
        h.forEach(r => { if (!by.has(r.abbr)) by.set(r.abbr, []); by.get(r.abbr).push(+r.relative_margin || 0); });
        const out = new Map();
        by.forEach((vals, a) => {
          const deltas = []; for (let i = 1; i < vals.length; i++) deltas.push(vals[i] - vals[i - 1]);
          const m = deltas.reduce((s, v) => s + v, 0) / (deltas.length || 1);
          const v = deltas.reduce((s, v) => s + (v - m) * (v - m), 0) / (deltas.length || 1);
          out.set(a, Math.sqrt(v || 0) || 0.02);
        });
        return out;
      })(hist);

    // 3) prepare per-abbr ordered margins and change series (deltas) for windowed Laplace
    const perMargins = (function () {
      const by = new Map();
      const sorted = [...hist].sort((a, b) => a.abbr.localeCompare(b.abbr) || a.year - b.year);
      sorted.forEach(r => { if (!by.has(r.abbr)) by.set(r.abbr, []); by.get(r.abbr).push(+r.relative_margin || 0); });
      return by;
    })();

    // function to get delta series (year-to-year changes) for an abbr
    function deltasForAbbr(a) {
      const arr = perMargins.get(a) || [];
      const deltas = [];
      for (let i = 1; i < arr.length; i++) deltas.push(arr[i] - arr[i - 1]);
      return deltas;
    }

    // 4) PCA loadings for a shared one-factor national shock (use first factor)
    const { loadMap, k } = (typeof pcaLoadings === 'function') ? pcaLoadings(hist, 3) : { loadMap: new Map(), k: 0 };

    // heavy-tail draws
    function rand_t_df4() {
      const Z = randn(rng);
      let V = 0; for (let i = 0; i < 4; i++) { const z = randn(rng); V += z * z; }
      return Z / Math.sqrt(V / 4);
    }

  // knobs
  const c_scale = (opts && opts.c_scale) || 1.15; // magnitude multiplier (diffusive intuition)
  const gamma = (opts && opts.gamma) || 0.30;     // shared-shock mix
  const sigmaG = (opts && opts.sigmaG) || 0.06;   // scale of national shock (t4)

  // Laplace window-weighting options (defaults mirror laplace.js suggestion)
  const windowSizes = (opts && opts.windowSizes) || [3, 4, 5, 6];
  const lambda = (opts && Number.isFinite(opts.lambda)) ? opts.lambda : 0.25;
  const weightType = (opts && opts.weightType) ? opts.weightType : 'linear';
  const minN = Math.min(...windowSizes);
  const weightForN = n => (weightType === 'exponential') ? Math.exp(-lambda * (n - minN)) : (1 / (1 + lambda * (n - minN)));

    // 5) sample raw deltas per state and record metadata for debugging/inspection
    const deltas = [];
    for (const row of base2024) {
      const a = row.abbr;
      // compute delta series and per-window Laplace probabilities
      const deltasSeries = deltasForAbbr(a);
      const probsByN = {}; const weightsByN = {};
      let num = 0, den = 0;
      for (const N of windowSizes) {
        if (deltasSeries.length >= N) {
          const recent = deltasSeries.slice(-N);
          const k = recent.filter(d => d > 0).length; // count of left-moving deltas
          const pN = (k + 1) / (N + 2);
          const w = weightForN(N);
          probsByN[`N${N}`] = pN; weightsByN[`N${N}`] = w;
          num += pN * w; den += w;
        } else {
          // mark as unavailable
          probsByN[`N${N}`] = null; weightsByN[`N${N}`] = null;
        }
      }
  // compute full-history counts (U/D) for fallback and diagnostics
  const fullArr = perMargins.get(a) || [];
  let U = 0, D = 0; for (let i = 1; i < fullArr.length; i++) { const dd = fullArr[i] - fullArr[i - 1]; if (dd > 0) U++; else if (dd < 0) D++; }

  // If no windows had sufficient data, fall back to full-history rule-of-succession
      let pLeftWeighted = null;
      if (den > 0) pLeftWeighted = num / den; else {
        // use full history sign counts as fallback
        const arr = perMargins.get(a) || [];
        let U = 0, D = 0; for (let i = 1; i < arr.length; i++) { const d = arr[i] - arr[i - 1]; if (d > 0) U++; else if (d < 0) D++; }
        pLeftWeighted = (U + 1) / (U + D + 2);
      }

      // direction draw based on weighted pLeft
      const S = (rng() < pLeftWeighted) ? +1 : -1;

      // magnitude (half-t): scale from per-state sigma * sqrt(yearsAhead/4)
      const sigma_i = sigMap.get(a) || 0.02;
      const s_i = c_scale * sigma_i * Math.sqrt(yearsAhead / 4);
      const M = Math.abs(rand_t_df4()) * s_i;

      // base delta
      let delta = S * M;

      // shared national/regional factor using first PCA loading
      const Li = loadMap.get(a) || [];
      const l1 = (Li && Li.length) ? Li[0] : 0;
      const G = rand_t_df4() * sigmaG;
      const combined = (1 - gamma) * delta + gamma * l1 * G;

  // store metadata per-state for later inspection
  deltas.push({ abbr: a, raw_delta: combined, pLeft: pLeftWeighted, pLeftByN: probsByN, pLeftWeights: weightsByN, signDraw: S, M, s_i, sigma_i, l1, G, counts: { U, D } });
    }

    // 6) recentre by 2024 votes
    const w = base2024.map(b => b.total_votes || 0);
    const mu = (function wavg(vals, wts) {
      let S = 0, W = 0; for (let i = 0; i < vals.length; i++) { S += vals[i] * (wts[i] || 0); W += (wts[i] || 0); }
      return W ? S / W : 0;
    })(deltas.map(d => d.raw_delta), w);
    deltas.forEach(d => { d.centered = d.raw_delta - mu; });

    // 7) soft-squash and return merged records (attach laplace_meta for inspection)
    const out = [];
    for (const base of base2024) {
      const d = deltas.find(x => x.abbr === base.abbr) || { raw_delta: 0, centered: 0, pLeft: 0, counts: { U: 0, D: 0 }, signDraw: 0, M: 0, s_i: 0, sigma_i: 0, l1: 0, G: 0 };
      const shift = softclip(d.centered, soft_delta_L);
        out.push({
        abbr: base.abbr,
        rel_2024: base.rel2024,
        rel_2048_target: base.rel2024 + shift,
        total_votes: base.total_votes,
        laplace_meta: {
          pLeft: d.pLeft,
          pLeftByN: d.pLeftByN || null,
          pLeftWeights: d.pLeftWeights || null,
          counts: d.counts,
          signDraw: d.signDraw,
          raw_delta: d.raw_delta,
          centered_delta: d.centered,
          shift: shift,
          M: d.M,
          s_i: d.s_i,
          sigma_i: d.sigma_i,
          l1: d.l1,
          G: d.G
        }
      });
    }
    return out;
  }

  function buildTargets(dfAll, rng, yearsAhead = 24, shrink = 0.8, soft_delta_L = 0.33, slopeOpts) {
    const hist = dfAll.filter(r => r.year >= 2000 && r.year <= 2024);
    const slopes = computeSlopes(hist, slopeOpts || { method: 'ols', refYear: 2024 });
    const base2024 = dfAll.filter(r => r.year === 2024);
    const merged = base2024.map(r => ({ abbr: r.abbr, rel2024: +r.relative_margin, total_votes: +r.total_votes || 0, slope: (slopes.get(r.abbr) || { slope: 0 }).slope || 0 }));
    const drift = merged.map(() => rand_t_df4(rng) * 0.02);
    const proj_raw = merged.map((m, i) => m.rel2024 + m.slope * yearsAhead * shrink + drift[i]);
    const center = wavg(proj_raw, merged.map(m => m.total_votes || 1));
    const proj_centered = proj_raw.map(v => v - center);
    const delta = proj_centered.map((v, i) => v - merged[i].rel2024);
    const delta_soft = delta.map(d => softclip(d, soft_delta_L));
    return merged.map((m, i) => ({ abbr: m.abbr, rel_2024: m.rel2024, rel_2048_target: m.rel2024 + delta_soft[i], total_votes: m.total_votes }));
  }

  function pcaLoadings(hist, k = 3) {
    // Build abbr x years matrix, mean-center rows, get U*s; normalize rows
    const byAbbr = new Map();
    const years = Array.from(new Set(hist.map(r => r.year))).sort((a, b) => a - b);
    hist.forEach(r => { if (!byAbbr.has(r.abbr)) byAbbr.set(r.abbr, new Map()); byAbbr.get(r.abbr).set(r.year, +r.relative_margin); });
    const abbrs = Array.from(byAbbr.keys()).filter(a => years.every(y => byAbbr.get(a).has(y)));
    const X = abbrs.map(a => years.map(y => byAbbr.get(a).get(y)));
    // mean-center rows
    X.forEach(row => { const m = mean(row); for (let i = 0; i < row.length; i++) row[i] -= m; });
    if (!X.length) { return { loadMap: new Map(), k: 0, abbrs: [] }; }
    const svd = numeric.svd(X);
    const U = svd.U; const S = svd.S; const L = U.map(row => row.map((v, j) => v * (S[j] || 0)).slice(0, k));
    // normalize rows
    for (let i = 0; i < L.length; i++) {
      let norm = Math.sqrt(L[i].reduce((s, v) => s + v * v, 0)) + 1e-12; for (let j = 0; j < L[i].length; j++) L[i][j] /= norm;
    }
    const loadMap = new Map();
    for (let i = 0; i < abbrs.length; i++) loadMap.set(abbrs[i], L[i]);
    return { loadMap, k: Math.min(k, (S || []).length) };
  }

  function stateSigma(hist) {
    // std dev of deltas per abbr
    const byAbbr = new Map();
    hist.sort((a, b) => a.abbr.localeCompare(b.abbr) || a.year - b.year);
    hist.forEach(r => { if (!byAbbr.has(r.abbr)) byAbbr.set(r.abbr, []); byAbbr.get(r.abbr).push(+r.relative_margin); });
    const out = new Map();
    byAbbr.forEach((vals, a) => {
      let deltas = []; for (let i = 1; i < vals.length; i++) deltas.push(vals[i] - vals[i - 1]);
      const m = mean(deltas); const v = mean(deltas.map(x => (x - m) * (x - m)));
      out.set(a, Math.sqrt(v || 0) || 0.02);
    });
    return out;
  }

  function humpEarly(u) { return Math.exp(-Math.pow((u - 0.35) / 0.20, 2)); }

  function simulatePaths(dfAll, rng, opts) {
    const { soft_delta_L = 0.33, soft_value_L = 0.95, years_ahead = 24, shrink = 0.8, n_steps = 240, beta = 0.8, alpha = 0.45, kappa = 0.25, global_scale = 1.05, k_factors = 3, slopeOptions = null,
  endpointMethod = 'laplace',     // NEW: 'slope' | 'laplace' (default to laplace)
      laplaceOptions = {}           // optional knobs for Model A if endpointMethod='laplace'
    } = (opts || {});
    const hist = dfAll.filter(r => r.year >= 2000 && r.year <= 2024);
    //const merged = buildTargets(dfAll, rng, years_ahead, shrink, soft_delta_L, slopeOptions || { method: 'ols', refYear: 2024 });
    const merged = (endpointMethod === 'laplace')
      ? buildTargetsLaplace(dfAll, rng, { years_ahead, soft_delta_L, ...laplaceOptions })
      : buildTargets(dfAll, rng, years_ahead, shrink, soft_delta_L, slopeOptions || { method: 'ols', refYear: 2024 });
    const base = new Map(merged.map(r => [r.abbr, r.rel_2024]));
    const { loadMap, k } = pcaLoadings(hist, k_factors);
    const sig = stateSigma(hist);
    const t_grid = Array.from({ length: n_steps + 1 }, (_, i) => Math.pow(i / n_steps, beta));
    const dt = t_grid.slice(1).map((v, i) => v - t_grid[i]);
    const years = [2024, 2028, 2032, 2036, 2040, 2044, 2048];
    const coarse_u = years.map(y => (y - 2024) / 24);
    // common latent factors
    const Z = Array.from({ length: n_steps }, () => Array.from({ length: k }, () => randn(rng)));
    function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
    const out = new Map(); // abbr -> { rel_2024, rel_2048_target, 2028: v, ... }
    merged.forEach(row => {
      const a = row.abbr; const y0 = row.rel_2024; const yT = row.rel_2048_target; const total = yT - y0;
      // preserve laplace metadata if present on the merged row
      const rowLapMeta = row.laplace_meta;
      const sigma0 = sig.get(a) || 0.02; const sigma = global_scale * sigma0;
      const step_std = dt.map((d, i) => Math.sqrt(d) * sigma * (1.0 + kappa * humpEarly(t_grid[i + 1])));
      const Li = loadMap.get(a) || (k ? Array.from({ length: k }, (_, j) => j === 0 ? 1 : 0) : []);
      // project factors and add idio noise
      let W = 0; const Wseq = [];
      for (let i = 0; i < n_steps; i++) {
        const proj = k ? dot(Z[i], Li) : 0;
        const idio = randn(rng);
        const inc = step_std[i] * (alpha * proj + Math.sqrt(Math.max(1e-9, 1.0 - alpha * alpha)) * idio);
        W += inc; Wseq.push(W);
      }
      const B = Wseq.map((w, i) => w - t_grid[i + 1] * Wseq[Wseq.length - 1]);
      const straight = t_grid.slice(1).map(u => y0 + total * u);
      const path = straight.map((v, i) => v + B[i]);
      const rec = { abbr: a, rel_2024: y0, rel_2048_target: yT };
  if (rowLapMeta) rec.laplace_meta = rowLapMeta;
      function nearestIdx(u) {
        let bestI = 1, bestD = 1e9; for (let i = 0; i < t_grid.length; i++) { const d = Math.abs(t_grid[i] - u); if (d < bestD) { bestD = d; bestI = i; } }
        return Math.max(1, Math.min(bestI, n_steps)) - 1; // index for path[]
      }
      [2028, 2032, 2036, 2040, 2044].forEach((Y, ix) => {
        const u = coarse_u[ix + 1]; const i = nearestIdx(u); let v = path[i]; v = softclip(v, soft_value_L); rec[Y] = v;
      });
      rec[2048] = softclip(yT, soft_value_L);
      out.set(a, rec);
    });
    return out; // Map abbr -> record
  }

  async function loadHistorical() {
    const [marginsRaw, ecRaw, projectionRows] = await Promise.all([
      d3.csv('presidential_margins.csv'),
      d3.csv('electoral_college.csv').catch(() => []),
      loadEvProjectionRows()
    ]);
    const margins = marginsRaw || [];
    const ec = ecRaw || [];
    // Filter out national rows for hist generation
    const filtered = margins.filter(r => r.abbr && !(r.abbr === 'US' || r.abbr === 'USA' || r.abbr === 'National' || r.abbr === 'NATIONAL' || r.unit === 'NATIONAL'))
      .map(r => ({
        abbr: r.abbr,
        year: +r.year,
        relative_margin: +r.relative_margin || 0,
        total_votes: +r.total_votes || 0,
        // keep tp for color window reuse in tester.js
        third_party_share: +r.third_party_share || 0
      }));
    // EV by year/unit map; we will use 2024 EVs for future years
    const evByUnit = new Map();
    (ec || []).forEach(e => { const y = +e.year; const u = e.abbr; const ev = +e.electoral_votes; if (y && u) evByUnit.set(`${y}:${u}`, ev); });
    // fallback: take 2024 from margins if present
    (margins || []).forEach(r => { const y = +r.year; if (y !== 2024) return; const u = r.abbr; const ev = +r.electoral_votes; if (u && ev && !evByUnit.has(`2024:${u}`)) evByUnit.set(`2024:${u}`, ev); });
    return { filtered, margins, evByUnit, evProjectionRows: projectionRows || [] };
  }

  function applyAtLarge(outMap, totals2024) {
    // Compute ME-AL/NE-AL as weighted avg of districts if districts exist
    function setAL(prefix) {
      const dists = Array.from(outMap.keys()).filter(a => a.startsWith(prefix + '-') && a !== `${prefix}-AL`).sort();
      if (!dists.length) return;
      const wts = dists.map(d => totals2024.get(d) || 1);
      const rec = { abbr: `${prefix}-AL` };
      [2024, 2028, 2032, 2036, 2040, 2044, 2048].forEach(Y => {
        const vals = dists.map(d => {
          const rd = (outMap.get(d) || {});
          // For 2024, use rel_2024 from the simulated record; otherwise use the year key
          return (Y === 2024) ? rd.rel_2024 : rd[Y];
        });
        rec[Y] = wavg(vals, wts);
      });
      // Ensure rel_2024 and rel_2048_target fields are present on the AL record to match other records
      if (isFinite(rec[2024])) rec.rel_2024 = rec[2024];
      if (isFinite(rec[2048])) rec.rel_2048_target = rec[2048];
      // Debug: log district composition and computed at-large values for 2024
      // try {
      //   const dbgVals = dists.map((d, i) => ({ dist: d, ev: (totals2024.get(d) || 0), rel2024: (outMap.get(d) || {}).rel_2024 }));
      //   console.log(`[future] applyAtLarge ${prefix}: districts=`, dbgVals);
      //   console.log(`[future] applyAtLarge ${prefix}: computed AL rel_2024=`, rec[2024]);
      // } catch (e) { }
      outMap.set(`${prefix}-AL`, rec);
    }
    setAL('ME'); setAL('NE');
  }

  function buildFutureDataset(histAll, paths, marginsAll, evMap, evLookupFn) {
    // Create rows for each future year with fields expected by tester.js: {year, unit, rm, nm, ev, tp, dVotes, rVotes, tVotes, total}
    const byYear = new Map();
    const years = [2024, 2028, 2032, 2036, 2040, 2044, 2048];
    const totals2024 = new Map();
    marginsAll.forEach(r => { if (+r.year === 2024) totals2024.set(r.abbr, +r.total_votes || 0); });
    // compute at-large from districts if needed
    applyAtLarge(paths, totals2024);
    const baseRows2024 = new Map();
    marginsAll.forEach(r => { if (+r.year === 2024 && r.abbr) baseRows2024.set(r.abbr, r); });
    function clampShare(value) {
      const v = Number(value);
      if (!isFinite(v) || v <= 0) return 0;
      if (v >= 1) return 1;
      return v;
    }
    function getBaseRow(abbr) {
      if (!abbr) return null;
      if (baseRows2024.has(abbr)) return baseRows2024.get(abbr);
      if (abbr.includes('-')) {
        const state = abbr.split('-')[0];
        if (baseRows2024.has(state)) return baseRows2024.get(state);
      }
      return null;
    }
    // national margin for 2024 baseline
    function natMargin2024() {
      // Prefer explicit NATIONAL row if present
      const natRow = marginsAll.find(r => +r.year === 2024 && (r.abbr === 'NATIONAL' || r.unit === 'NATIONAL' || r.abbr === 'US' || r.abbr === 'USA' || r.abbr === 'National'));
      if (natRow && isFinite(+natRow.national_margin)) return +natRow.national_margin;
      // Fallback: compute from two-party votes if available; else weighted avg of per-row national_margin
      const rows = marginsAll.filter(r => +r.year === 2024 && r.abbr && r.abbr !== 'NATIONAL');
      let d = 0, r = 0; rows.forEach(x => { d += (+x.D_votes || 0); r += (+x.R_votes || 0); });
      if ((d + r) > 0) { return (d - r) / (d + r); }
      const w = rows.map(r => +r.total_votes || 0); const v = rows.map(r => +r.national_margin || 0);
      return wavg(v, w) || 0;
    }
    const nat2024 = natMargin2024();
    years.forEach(Y => {
      const nationalMargin = (Y === 2024) ? nat2024 : 0.0;
      const rows = [];
      let natD = 0, natR = 0, natT = 0, natTotal = 0, natTopThirdVotes = 0;
      // make per-unit rows
      paths.forEach((rec, abbr) => {
        if (!rec || !abbr) return;
        const rel = (Y === 2024) ? rec.rel_2024 : rec[Y];
        const rm = isFinite(rel) ? rel : 0;
        const base = getBaseRow(abbr);
        const totalVotes = base ? (+base.total_votes || (+base.D_votes || 0) + (+base.R_votes || 0) + (+base.third_party_votes || 0)) : (totals2024.get(abbr) || 0);
        // For simulated future years we do NOT model third-party votes; allocate only between D and R.
        const isFutureYear = (Y > 2024);
        const thirdShare = isFutureYear ? 0 : clampShare(base ? base.third_party_share : 0);
        const topThirdShare = isFutureYear ? 0 : clampShare(base ? base.top_third_party_share : thirdShare);
        const tVotes = isFutureYear ? 0 : Math.max(0, totalVotes * thirdShare);
        const twoPartyTotal = Math.max(0, totalVotes - tVotes);
        let dShare2 = 0.5 + (rm + nationalMargin) / 2;
        if (!isFinite(dShare2)) dShare2 = 0.5;
        dShare2 = Math.max(0, Math.min(1, dShare2));
        let rShare2 = 1 - dShare2;
        if (!isFinite(rShare2)) rShare2 = 0.5;
        rShare2 = Math.max(0, Math.min(1, rShare2));
        const denom = dShare2 + rShare2;
        if (denom > 0) {
          dShare2 /= denom;
          rShare2 /= denom;
        } else {
          dShare2 = rShare2 = 0.5;
        }
        const dVotes = twoPartyTotal * dShare2;
        const rVotes = twoPartyTotal * rShare2;
        const topThirdVotes = isFutureYear ? 0 : Math.max(0, Math.min(totalVotes, topThirdShare * totalVotes));
        // EV: reuse 2024 mapping
  const ev = evLookupFn ? evLookupFn(Y, abbr) : (evMap.get(`2024:${abbr}`) || 0);
        rows.push({
          year: Y,
          unit: abbr,
          rm,
          nm: nationalMargin,
          ev,
          tp: topThirdShare,
          thirdShare,
          dVotes,
          rVotes,
          tVotes,
          total: totalVotes,
          topThirdVotes
        });
        const includeInNat = !(abbr.includes('-') && !abbr.endsWith('-AL'));
        if (includeInNat) {
          natD += dVotes;
          natR += rVotes;
          natT += tVotes;
          natTotal += totalVotes;
          natTopThirdVotes += topThirdVotes;
        }
      });
      const natTwo = natD + natR;
      const natNm = (Y === 2024) ? nat2024 : (natTwo > 0 ? (natD - natR) / natTwo : 0);
      const natThirdShare = natTotal > 0 ? natT / natTotal : 0;
      const natTopThirdShare = natTotal > 0 ? natTopThirdVotes / natTotal : 0;
      rows.unshift({
        year: Y,
        unit: 'NATIONAL',
        rm: 0,
        nm: natNm,
        ev: 0,
        tp: natTopThirdShare,
        thirdShare: natThirdShare,
        dVotes: natD,
        rVotes: natR,
        tVotes: natT,
        total: natTotal,
        topThirdVotes: natTopThirdVotes
      });
      byYear.set(Y, rows);
    });
    return byYear;
  }

  async function generate(seed) {
    console.log('[future] generate() function called with seed:', seed);
  const { filtered, margins, evByUnit, evProjectionRows } = await loadHistorical();
  updateEvProjectionStateFromRows(evProjectionRows);
    const rng = seedToRng(seed);
    console.log('[future] loadHistorical completed, filtered rows:', filtered.length);
    // Build slope options from URL (if any)
    const params = getUrlParams();
    // Default to 'laplace' when no URL param is specified; allow explicit 'slope' via ?endpoint=slope
    let endpointMethod = 'laplace';
    if (params && params.endpoint) {
      endpointMethod = (String(params.endpoint).toLowerCase() === 'laplace') ? 'laplace' : 'slope';
    }
    let slopeOptions = { method: 'ols', refYear: 2024 };
    if (params && params.method) {
      const m = String(params.method).toLowerCase();
      if (['ols', 'wls', 'loess', 'poly2', 'poly3'].includes(m)) {
        slopeOptions.method = m;
        if (Number.isFinite(params.refYear)) slopeOptions.refYear = params.refYear;
        if (m === 'loess' && Number.isFinite(params.slopeBW)) slopeOptions.loess = { bandwidth: params.slopeBW };
        if (m === 'wls') {
          slopeOptions.wls = {
            type: (params.slopeType === 'linear') ? 'linear' : 'exp',
            tau: Number.isFinite(params.slopeTau) ? params.slopeTau : 12,
            power: Number.isFinite(params.slopePower) ? params.slopePower : 2
          };
        }
      }
    }
    const paths = simulatePaths(filtered, rng, {
      slopeOptions,
      endpointMethod,
      laplaceOptions: {               // optional: tweak Model A defaults if you want
        c_scale: 1.15,                // magnitude multiplier
        gamma: 0.30,                  // factor mix
        sigmaG: 0.06                  // national t(4) shock scale
      },
    }); // Map abbr -> record with future years
    console.log('[future] simulatePaths completed, paths size:', paths.size);
    // If endpointMethod was laplace, collect laplace metadata from the merged targets (buildTargetsLaplace)
    try {
      console.log('[future] endpointMethod:', endpointMethod);
      if (endpointMethod === 'laplace') {
        // buildTargetsLaplace previously returned merged array but simulatePaths used it internally; however
        // buildTargetsLaplace would have computed laplace_meta on each element if used directly. We can reconstruct
        // a simple map of rel_2048_target and laplace_meta by iterating the 'paths' Map and pulling laplace_meta if present.
        const lapMeta = new Map();
        paths.forEach((rec, abbr) => { if (rec && rec.laplace_meta) lapMeta.set(abbr, rec.laplace_meta); });
        window._laplaceMeta = lapMeta; // Map abbr -> meta
        console.log('[future] laplace metadata collected, size:', lapMeta.size);
      } else {
        window._laplaceMeta = null;
      }
    } catch (e) { console.warn('[future] failed to set laplace metadata', e); }
    // plug into tester.js global maps
  const projectionMap = getSelectedEvProjectionMap();
  console.log('[future] EV projection:', evProjectionState.selectionKey, 'futureOnly:', evProjectionState.futureOnly);
  const evLookup = createEvLookup(evByUnit, projectionMap, { futureOnly: evProjectionState.futureOnly });
  const BY = buildFutureDataset(filtered, paths, margins, evByUnit, evLookup);
    console.log('[future] buildFutureDataset completed');
    // Clear any previous future years then set
    const years = [2024, 2028, 2032, 2036, 2040, 2044, 2048];
    years.forEach(Y => { window._byYearMap && window._byYearMap.set(Y, BY.get(Y)); });
    // EV map for years (use 2024 values)
    years.forEach(Y => {
      const rows = BY.get(Y) || [];
      rows.forEach(r => { if (r.unit && r.ev != null) window._evByUnitMap && window._evByUnitMap.set(`${Y}:${r.unit}`, r.ev); });
    });

    // Ensure ME-AL and NE-AL stops are present in the by-year rows (they should have been created by applyAtLarge)
    // If applyAtLarge produced ME-AL/NE-AL in paths, they will be included already by buildFutureDataset; however
    // when evMap originates from electoral_college.csv, make sure the window EV map includes these AL keys for 2024.
    ['ME-AL', 'NE-AL'].forEach(al => {
      const baseEv = evLookup ? evLookup(2024, al) : evByUnit.get(`2024:${al}`);
      if (baseEv != null) {
        years.forEach(Y => {
          const val = evLookup ? evLookup(Y, al) : baseEv;
          window._evByUnitMap && window._evByUnitMap.set(`${Y}:${al}`, Number.isFinite(val) ? val : baseEv);
        });
      }
    });
    // total EV per year
    if (!window._totalEvByYear) window._totalEvByYear = new Map();
    years.forEach(Y => {
      const rows = BY.get(Y) || []; const tot = rows.reduce((s, r) => s + (+r.ev || 0), 0);
      window._totalEvByYear.set(Y, tot || 538);
    });

    // EV projection validation: for years where projection applies, ensure total == 538
    try {
      const warnEl = document.getElementById('evProjectionWarning');
      const warnTextEl = document.getElementById('evProjectionWarningText');
      const projectionMap = getSelectedEvProjectionMap();
      const futureOnly = !!evProjectionState.futureOnly;
      const mismatches = [];
      years.forEach(Y => {
        // only check years where projection applies (if a projection selected)
        if (!projectionMap) return;
        if (futureOnly && Y < EV_PROJECTION_THRESHOLD_YEAR) return;
        // compute total using evLookup (which respects projection rules)
        const total = Array.from(BY.get(Y) || []).reduce((s, r) => s + (evLookup ? evLookup(Y, r.unit) : (+r.ev || 0)), 0);
        if (Math.round(total) !== 538) mismatches.push({ year: Y, total: total });
      });
      if (mismatches.length) {
        if (warnEl) warnEl.style.display = '';
        if (warnTextEl) {
          warnTextEl.innerHTML = `Selected EV projection <strong>${evProjectionState.selectionKey}</strong> produces unexpected totals for: ` +
            mismatches.map(m => `${m.year} (total: ${Math.round(m.total)})`).join(', ') +
            `. Expected 538 electoral votes. Please adjust the projection CSV or choose baseline.`;
        }
      } else {
        if (warnEl) warnEl.style.display = 'none';
        if (warnTextEl) warnTextEl.textContent = '';
      }
    } catch (e) { console.warn('[future] EV projection validation failed', e); }

    // Update laplace panel visibility if present
    try {
      const lp = document.getElementById('laplacePanel');
      if (lp) {
        if (endpointMethod === 'laplace' && window._laplaceMeta && window._laplaceMeta.size > 0) {
          lp.style.display = '';
        } else {
          lp.style.display = 'none';
        }
      }
      // if visible and content area is shown, refresh it
      const lc = document.getElementById('laplaceContent'); if (lc && lc.style.display !== 'none') renderLaplaceMeta();
    } catch (e) { }

    // Debug: inspect 2024 data loading and margins
    // try {
    //   const rows2024 = BY.get(2024) || [];
    //   const nonNat = rows2024.filter(r => r && r.unit !== 'NATIONAL');
    //   const undefRm = nonNat.filter(r => !isFinite(r.rm)).length;
    //   const zeroRm = nonNat.filter(r => isFinite(r.rm) && Math.abs(r.rm) < 1e-12).length;
    //   const sample = ['PA', 'WI', 'MI', 'AZ', 'GA', 'NV'].map(u => nonNat.find(r => r.unit === u)).filter(Boolean);
    //   console.log('[future] 2024 rows:', rows2024.length, 'nonNat:', nonNat.length, 'undef rm:', undefRm, 'zero rm:', zeroRm);
    //   console.log('[future] 2024 NATIONAL row:', rows2024.find(r => r.unit === 'NATIONAL'));
    //   console.log('[future] 2024 sample states:', sample);
    // } catch (e) { console.warn('[future] debug 2024 inspection failed', e); }

    // Debug: show ME/NE EV composition for 2024 and total EVs for verification
    // try {
    //   const rows2024 = BY.get(2024) || [];
    //   const units = new Map(rows2024.map(r => [r.unit, r]));
    //   const me01 = units.get('ME-01'); const me02 = units.get('ME-02'); const meAL = units.get('ME-AL');
    //   const ne01 = units.get('NE-01'); const ne02 = units.get('NE-02'); const ne03 = units.get('NE-03'); const neAL = units.get('NE-AL');
    //   console.log('[future] ME 2024 EVs: ME-01 ev=', me01 && me01.ev, 'ME-02 ev=', me02 && me02.ev, 'ME-AL ev=', meAL && meAL.ev);
    //   console.log('[future] NE 2024 EVs: NE-01 ev=', ne01 && ne01.ev, 'NE-02 ev=', ne02 && ne02.ev, 'NE-03 ev=', ne03 && ne03.ev, 'NE-AL ev=', neAL && neAL.ev);
    //   const totalEV = rows2024.reduce((s, r) => s + (+r.ev || 0), 0);
    //   console.log('[future] 2024 total EV sum from BY:', totalEV);
    // } catch (e) { console.warn('[future] debug ME/NE EV inspection failed', e); }

    // Allocation debug: for each year, list each unit, its rm, ev and which party wins those EVs; aggregate per-year totals
    try {
      years.forEach(Y => {
        const rows = BY.get(Y) || [];
        let demEV = 0, repEV = 0, tieEV = 0;
        const allocations = rows.map(r => {
          const unit = r.unit || r.abbr || '?';
          const rm = (r && isFinite(r.rm)) ? r.rm : (r && isFinite(r.rel_2024) ? r.rel_2024 : 0);
          const ev = +r.ev || 0;
          let winner = 'TIE';
          if (rm > 0) { winner = 'D'; demEV += ev; }
          else if (rm < 0) { winner = 'R'; repEV += ev; }
          else { tieEV += ev; }
          return { unit, year: Y, rm, ev, winner };
        });
        //console.log(`[future] allocation ${Y}: totals D=${demEV} R=${repEV} TIE=${tieEV}`);
        // Also print ME/NE AL winners explicitly if present
        const meal = allocations.find(a => a.unit === 'ME-AL'); const neal = allocations.find(a => a.unit === 'NE-AL');
        // if (meal) console.log(`[future] ${Y} ME-AL: rm=${meal.rm} ev=${meal.ev} winner=${meal.winner}`);
        // if (neal) console.log(`[future] ${Y} NE-AL: rm=${neal.rm} ev=${neal.ev} winner=${neal.winner}`);
        // For verbosity, only log allocations for small list of battleground units
        const sampleUnits = ['ME-AL', 'NE-AL', 'ME-02', 'NE-02', 'PA', 'WI', 'MI', 'AZ', 'GA', 'NV'];
        const sampleAlloc = allocations.filter(a => sampleUnits.includes(a.unit));
        //if (sampleAlloc.length) console.log(`[future] ${Y} sample allocations:`, sampleAlloc);
      });
    } catch (e) { console.warn('[future] allocation debug failed', e); }

    //console.log('[future] About to start synthetic stop generation');

    // --- Generate synthetic stops for future years (no stop_colors.csv rows exist) ---
    try {
      const STOP_KEY_PREC = 6;
      if (!window._stopColorsByYear) window._stopColorsByYear = new Map();
      if (!window._stopEffByYear) window._stopEffByYear = new Map();
      // IMPORTANT: when regenerating (e.g. slope method change), wipe prior future-year
      // synthetic stops so we don't accumulate an ever-growing list of stale stops.
      years.filter(y => y > 2024).forEach(year => {
        if (window._stopColorsByYear.has(year)) window._stopColorsByYear.delete(year);
        if (window._stopEffByYear.has(year)) window._stopEffByYear.delete(year);
      });

      // console.log('[future] Starting synthetic stop generation for future years');
      // console.log('[future] Future years to process:', years.filter(y => y > 2024));

      // Helper to record a stop/unit
      function recordStop(year, s, eff, unit, winner, color) {
        if (!isFinite(s) || Math.abs(s) > PV_CAP) return;
        const key = s.toFixed(STOP_KEY_PREC);
        if (!window._stopColorsByYear.has(year)) window._stopColorsByYear.set(year, new Map());
        if (!window._stopEffByYear.has(year)) window._stopEffByYear.set(year, new Map());
        const byStop = window._stopColorsByYear.get(year);
        const effMap = window._stopEffByYear.get(year);
        if (!byStop.has(key)) byStop.set(key, new Map());
        // Preserve first effective mapping; subsequent units share
        if (!effMap.has(key) && isFinite(eff)) effMap.set(key, eff);
        byStop.get(key).set(unit, { winner, color_css: color, color_name: (winner === 'D' ? 'BLUE' : winner === 'R' ? 'RED' : 'YELLOW') });
        //console.log('[future] recorded stop', { year, key, eff, unit, winner });
      }
      function sign(x) { return x > 0 ? 1 : (x < 0 ? -1 : 0); }
      // Basic color chooser (aligned roughly with tester.js palette extremes)
      function colorForWinner(w) { return (w === 'D') ? '#4169E1' : (w === 'R' ? '#B22222' : '#C9A400'); }
      // For each future year > 2024, create a stop at -rm per unit (flip point) and any third-party window boundaries
      years.filter(y => y > 2024).forEach(year => {
        // console.log('[future] Processing year', year);
        const rows = BY.get(year) || [];
        // console.log('[future] Year', year, 'has', rows.length, 'rows');
        const nat = 0; // future national margin locked to 0
        let stopCount = 0;
        // EVEN / Actual (0) handled by tester.js automatically; we add unit stops
        rows.forEach(r => {
          if (!r || !r.unit || r.unit === 'NATIONAL') return;
          const rm = +r.rm || 0;
          const tp = +r.tp || 0; // third-party share propagated from 2024
          const a = 3 * tp - 1; // third-party window indicator
          // Always add naive flip stop s = -rm
          const s = -rm;
          if (isFinite(s)) {
            const eff = s + (sign(s - nat) === 0 ? EPS : sign(s - nat) * EPS);
            // After applying eff, margin becomes ~ sign(s)*EPS so winner is sign(s)
            const postWinner = (sign(s) > 0) ? 'D' : (sign(s) < 0 ? 'R' : 'D');
            recordStop(year, s, eff, r.unit, postWinner, colorForWinner(postWinner));
            stopCount++;
          }
          // If third-party window exists, add both boundaries nD / nR similar to Python build_stop_colors logic
          if (a > 0) {
            // Approximate D and R shares using two-party split derived from rm
            const twoD = 0.5 + rm / 2; // two-party D share
            const twoR = 0.5 - rm / 2; // two-party R share
            const D_share = (1 - tp) * twoD;
            const R_share = (1 - tp) * twoR;
            const T_share = tp;
            const nD = nat + 2 * (T_share - D_share);
            const nR = nat + 2 * (R_share - T_share);
            if (isFinite(nD)) {
              const effD = nD + (sign(nD - nat) === 0 ? EPS : sign(nD - nat) * EPS);
              // Winner inside window treated as T (other)
              recordStop(year, nD, effD, r.unit, 'T', colorForWinner('T'));
              stopCount++;
            }
            if (isFinite(nR)) {
              const effR = nR + (sign(nR - nat) === 0 ? EPS : sign(nR - nat) * EPS);
              recordStop(year, nR, effR, r.unit, 'T', colorForWinner('T'));
              stopCount++;
            }
          }
        });
        //console.log('[future] Year', year, 'generated', stopCount, 'stops');
        const finalStopCount = window._stopColorsByYear.get(year) ? window._stopColorsByYear.get(year).size : 0;
        //console.log('[future] Year', year, 'final stop count in map:', finalStopCount);
      });
      //console.log('[future] synthetic stops generated for future years');

      // Debug: check final state of maps
      years.filter(y => y > 2024).forEach(year => {
        const byYear = window._stopColorsByYear.get(year);
        const effByYear = window._stopEffByYear.get(year);
        // console.log('[future] Final state for year', year, ':', {
        //   hasStops: !!byYear,
        //   stopCount: byYear ? byYear.size : 0,
        //   hasEff: !!effByYear,
        //   effCount: effByYear ? effByYear.size : 0,
        //   sampleKeys: byYear ? Array.from(byYear.keys()).slice(0, 5) : []
        // });
      });
    } catch (e) { console.warn('[future] failed to generate synthetic future stops', e); }
  }

  // UI wiring
  async function runWithSeed(seed) {
    let numericSeed = null;
    if (Number.isFinite(seed)) {
      numericSeed = Number(seed);
    } else if (seed !== null && seed !== undefined && seed !== '') {
      const parsed = parseInt(String(seed), 10);
      if (!isNaN(parsed)) numericSeed = parsed;
    }
    const finalSeed = Number.isFinite(numericSeed) ? numericSeed : computeTodaySeed();
    try { window._futureLastSeed = finalSeed; } catch (e) { }
    console.log('***RUNWITHSEED CALLED WITH SEED:', finalSeed, '***');
    await generate(finalSeed);
    console.log('***GENERATE COMPLETED***');
    // Don't call updateAll here - let the caller control when to update
  }

  function getCurrentSeedValue() {
    const seedInput = document.getElementById('seedInput');
    if (seedInput && seedInput.value !== undefined) {
      const parsed = parseInt(String(seedInput.value), 10);
      if (!isNaN(parsed)) return parsed;
    }
    if (typeof window !== 'undefined' && Number.isFinite(window._futureLastSeed)) {
      return Number(window._futureLastSeed);
    }
    return null;
  }

  async function regenerateWithCurrentSeed() {
    const current = getCurrentSeedValue();
    const seed = Number.isFinite(current) ? current : computeTodaySeed();
    try {
      await runWithSeed(seed);
    } catch (err) {
      console.warn('[future] regenerateWithCurrentSeed failed', err);
    }
  }

  function computeTodaySeed() {
    try {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      return parseInt(`${y}${m}${da}`, 10);
    } catch (e) {
      return 20250101;
    }
  }

  function getUrlParams() {
    const p = new URLSearchParams(location.search);
    const out = { seed: p.get('seed') ? parseInt(p.get('seed')) : null, year: p.get('year') ? parseInt(p.get('year')) : null, pv: null, pvValue: null, pvPreset: null };
    const endpoint = p.get('endpoint'); // 'slope' | 'laplace'
    if (endpoint) out.endpoint = endpoint.toLowerCase();
    // Optional slope options: method=ols|wls|loess|poly2|poly3; slopeBW, slopeTau, slopePower
    const method = p.get('method');
    if (method) out.method = method;
    const slopeBW = p.get('slopeBW'); if (slopeBW != null) out.slopeBW = parseFloat(slopeBW);
    const slopeTau = p.get('slopeTau'); if (slopeTau != null) out.slopeTau = parseFloat(slopeTau);
    const slopePower = p.get('slopePower'); if (slopePower != null) out.slopePower = parseFloat(slopePower);
    const slopeType = p.get('slopeType'); if (slopeType) out.slopeType = slopeType;
    const refYear = p.get('refYear'); if (refYear != null) out.refYear = parseInt(refYear);
    const pvRaw = p.get('pv');
    if (pvRaw != null) {
      // integer index
      if (/^-?\d+$/.test(pvRaw)) {
        out.pv = parseInt(pvRaw);
      } else if (!isNaN(parseFloat(pvRaw))) {
        out.pvValue = parseFloat(pvRaw);
      } else {
        out.pvPreset = pvRaw;
      }
    }
    const evProj = p.get('evProjection');
    if (evProj) out.evProjection = evProj.toLowerCase();
    const evProjFutureOnly = p.get('evProjectionFutureOnly');
    if (evProjFutureOnly != null) {
      const str = evProjFutureOnly.toLowerCase();
      out.evProjectionFutureOnly = (str === '1' || str === 'true');
    }
    // No flipped flag; numeric pvValue encodes sign when present
    return out;
  }

  function updateUrl(params) {
    const url = new URL(location);
    // seed/year handled if present in params
    if (params && Object.prototype.hasOwnProperty.call(params, 'seed')) {
      if (params.seed === null || params.seed === undefined) url.searchParams.delete('seed'); else url.searchParams.set('seed', String(params.seed));
    }
    if (params && Object.prototype.hasOwnProperty.call(params, 'year')) {
      if (params.year === null || params.year === undefined) url.searchParams.delete('year'); else url.searchParams.set('year', String(params.year));
    }
    // PV: prefer an explicit numeric override if present on window._pvOverride
    if (typeof window !== 'undefined' && Number.isFinite(window._pvOverride)) {
      url.searchParams.set('pv', String(window._pvOverride));
    } else if (params && Object.prototype.hasOwnProperty.call(params, 'pv')) {
      if (params.pv === null || params.pv === undefined) url.searchParams.delete('pv'); else url.searchParams.set('pv', String(params.pv));
    }
    // Preserve pvPreset if explicitly passed (rare for future.js)
    if (params && Object.prototype.hasOwnProperty.call(params, 'pvPreset')) {
      if (params.pvPreset === null || params.pvPreset === undefined) url.searchParams.delete('pvPreset'); else url.searchParams.set('pvPreset', String(params.pvPreset));
    }
    // Slope params (only touch if explicitly provided to avoid cluttering URL)
    if (params && Object.prototype.hasOwnProperty.call(params, 'method')) {
      if (!params.method) url.searchParams.delete('method'); else url.searchParams.set('method', String(params.method));
    }
    if (params && Object.prototype.hasOwnProperty.call(params, 'slopeBW')) {
      if (params.slopeBW == null) url.searchParams.delete('slopeBW'); else url.searchParams.set('slopeBW', String(params.slopeBW));
    }
    if (params && Object.prototype.hasOwnProperty.call(params, 'slopeTau')) {
      if (params.slopeTau == null) url.searchParams.delete('slopeTau'); else url.searchParams.set('slopeTau', String(params.slopeTau));
    }
    if (params && Object.prototype.hasOwnProperty.call(params, 'slopePower')) {
      if (params.slopePower == null) url.searchParams.delete('slopePower'); else url.searchParams.set('slopePower', String(params.slopePower));
    }
    if (params && Object.prototype.hasOwnProperty.call(params, 'slopeType')) {
      if (!params.slopeType) url.searchParams.delete('slopeType'); else url.searchParams.set('slopeType', String(params.slopeType));
    }
    if (params && Object.prototype.hasOwnProperty.call(params, 'refYear')) {
      if (params.refYear == null) url.searchParams.delete('refYear'); else url.searchParams.set('refYear', String(params.refYear));
    }
    if (params && Object.prototype.hasOwnProperty.call(params, 'evProjection')) {
      const v = params.evProjection;
      if (v === null || v === undefined || v === '') {
        url.searchParams.delete('evProjection');
      } else {
        url.searchParams.set('evProjection', String(v));
      }
    }
    if (params && Object.prototype.hasOwnProperty.call(params, 'evProjectionFutureOnly')) {
      const flag = params.evProjectionFutureOnly;
      if (flag === null || flag === undefined) {
        url.searchParams.delete('evProjectionFutureOnly');
      } else {
        url.searchParams.set('evProjectionFutureOnly', flag ? '1' : '0');
      }
    }
    // No separate flipped flag; numeric pv overrides encode sign directly
    history.replaceState({}, '', url);
  }

  // Initialize controls
  window.addEventListener('DOMContentLoaded', async () => {
    const seedInput = document.getElementById('seedInput');
    const genBtn = document.getElementById('genBtn');
    const randBtn = document.getElementById('randBtn');
    const shareBtn = document.getElementById('shareBtn');
    const yearSlider = document.getElementById('yearSlider');
    const pvSlider = document.getElementById('pvSlider');
    const pvText = document.getElementById('pvText');
    const pvPreset = document.getElementById('pvPreset');
    const pvApply = document.getElementById('pvApply');
    const pvFlip = document.getElementById('pvFlip');
    const pvClear = document.getElementById('pvClear');

    const params = getUrlParams();
    const todaySeed = computeTodaySeed();
    if (params && params.evProjection) {
      evProjectionState.pendingSelectionKey = params.evProjection;
    }
    if (params && Object.prototype.hasOwnProperty.call(params, 'evProjectionFutureOnly')) {
      evProjectionState.futureOnly = !!params.evProjectionFutureOnly;
    }
    const seed = (params.seed && !isNaN(params.seed)) ? params.seed : todaySeed;
    if (seedInput) seedInput.value = String(seed);

    // --- Slope method UI controls ---
    (function setupSlopeControls() {
      // container placement: try to append near genBtn if possible
      let container = document.getElementById('slopeControls');
      if (!container) { container = document.createElement('div'); container.id = 'slopeControls'; container.style.marginTop = '8px'; container.style.display = 'flex'; container.style.gap = '8px'; container.style.flexWrap = 'wrap'; if (genBtn && genBtn.parentNode) genBtn.parentNode.appendChild(container); else document.body.appendChild(container); }

      function makeLabel(text) { const l = document.createElement('label'); l.style.fontSize = '12px'; l.style.marginRight = '4px'; l.textContent = text; return l; }

      // method select
      const methodWrap = document.createElement('div'); methodWrap.style.display = 'flex'; methodWrap.style.flexDirection = 'column'; methodWrap.style.minWidth = '160px';
      const methodTop = document.createElement('div'); methodTop.style.display = 'flex'; methodTop.style.alignItems = 'center';
      const methodLabel = makeLabel('Slope method:');
      // If a slopeMethod select already exists in the page (static HTML), reuse it instead of creating a duplicate
      let methodSel = document.getElementById('slopeMethod');
      if (!methodSel) {
        methodSel = document.createElement('select'); methodSel.id = 'slopeMethod';
        ['ols', 'wls', 'loess', 'poly2', 'poly3'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v.toUpperCase(); methodSel.appendChild(o); });
      } else {
        // ensure expected options exist if the static select was minimal
        if (!methodSel.options || methodSel.options.length === 0) {
          ['ols', 'wls', 'loess', 'poly2', 'poly3'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v.toUpperCase(); methodSel.appendChild(o); });
        }
      }
      if (params && params.method) methodSel.value = params.method;
      methodTop.appendChild(methodLabel); methodTop.appendChild(methodSel);
      const methodHelp = document.createElement('div'); methodHelp.style.fontSize = '11px'; methodHelp.style.color = '#666'; methodHelp.style.marginTop = '2px'; methodHelp.textContent = 'OLS: linear trend. WLS: recent years weighted. LOESS: local slope near RefYr. POLY2/3: global polynomial.';
      methodSel.title = 'Choose slope estimation method. OLS is the default.';
      methodWrap.appendChild(methodTop); methodWrap.appendChild(methodHelp);

      // wls type
      const wlsWrap = document.createElement('div'); wlsWrap.style.display = 'flex'; wlsWrap.style.flexDirection = 'column'; wlsWrap.style.minWidth = '140px';
      const wlsTop = document.createElement('div'); wlsTop.style.display = 'flex'; wlsTop.style.alignItems = 'center';
      const wlsLabel = makeLabel('WLS type:'); const wlsType = document.createElement('select'); wlsType.id = 'slopeWlsType';['exp', 'linear'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; wlsType.appendChild(o); });
      if (params && params.slopeType) wlsType.value = params.slopeType; wlsTop.appendChild(wlsLabel); wlsTop.appendChild(wlsType);
      const wlsHelp = document.createElement('div'); wlsHelp.style.fontSize = '11px'; wlsHelp.style.color = '#666'; wlsHelp.style.marginTop = '2px'; wlsHelp.textContent = 'EXP: exponential recency weight (Tau years). LINEAR: linear recency scaling (Power).';
      wlsType.title = 'Select exponential or linear recency weighting for WLS.';
      wlsWrap.appendChild(wlsTop); wlsWrap.appendChild(wlsHelp);

      // bandwidth / tau / power / refYear inputs
      const bwWrap = document.createElement('div'); bwWrap.style.display = 'flex'; bwWrap.style.flexDirection = 'column'; bwWrap.style.minWidth = '120px'; const bwTop = document.createElement('div'); bwTop.style.display = 'flex'; bwTop.style.alignItems = 'center'; const bwLabel = makeLabel('LOESS BW:'); const bwIn = document.createElement('input'); bwIn.type = 'number'; bwIn.step = '0.05'; bwIn.min = '0'; bwIn.max = '1'; bwIn.id = 'slopeBW'; bwIn.value = '0.5'; if (params && Number.isFinite(params.slopeBW)) bwIn.value = String(params.slopeBW);
      const bwHelp = document.createElement('div'); bwHelp.style.fontSize = '11px'; bwHelp.style.color = '#666'; bwHelp.style.marginTop = '2px'; bwHelp.textContent = 'Bandwidth is fraction of points used for local fit (0.4-0.8 typical). Larger = smoother.';
      bwIn.title = 'LOESS bandwidth (fraction of points used in local fit).';
      bwTop.appendChild(bwLabel); bwTop.appendChild(bwIn); bwWrap.appendChild(bwTop); bwWrap.appendChild(bwHelp);

      const tauWrap = document.createElement('div'); tauWrap.style.display = 'flex'; tauWrap.style.flexDirection = 'column'; tauWrap.style.minWidth = '120px'; const tauTop = document.createElement('div'); tauTop.style.display = 'flex'; tauTop.style.alignItems = 'center'; const tauLabel = makeLabel('Tau (yrs):'); const tauIn = document.createElement('input'); tauIn.type = 'number'; tauIn.step = '1'; tauIn.min = '1'; tauIn.value = 2; tauIn.id = 'slopeTau'; if (params && Number.isFinite(params.slopeTau)) tauIn.value = String(params.slopeTau); const tauHelp = document.createElement('div'); tauHelp.style.fontSize = '11px'; tauHelp.style.color = '#666'; tauHelp.style.marginTop = '2px'; tauHelp.textContent = 'Exponential decay timescale in years for recency weighting (smaller -> more weight on recent).'; tauIn.title = 'Exponential decay timescale (years) for WLS recency weights.'; tauTop.appendChild(tauLabel); tauTop.appendChild(tauIn); tauWrap.appendChild(tauTop); tauWrap.appendChild(tauHelp);

      const powerWrap = document.createElement('div'); powerWrap.style.display = 'flex'; powerWrap.style.flexDirection = 'column'; powerWrap.style.minWidth = '120px'; const powerTop = document.createElement('div'); powerTop.style.display = 'flex'; powerTop.style.alignItems = 'center'; const powerLabel = makeLabel('Linear power:'); const powerIn = document.createElement('input'); powerIn.type = 'number'; powerIn.step = '0.1'; powerIn.id = 'slopePower'; powerIn.value = '1'; if (params && Number.isFinite(params.slopePower)) powerIn.value = String(params.slopePower); const powerHelp = document.createElement('div'); powerHelp.style.fontSize = '11px'; powerHelp.style.color = '#666'; powerHelp.style.marginTop = '2px'; powerHelp.textContent = 'Power exponent for linear recency weighting (1 is linear).'; powerIn.title = 'Power exponent for linear WLS weighting.'; powerTop.appendChild(powerLabel); powerTop.appendChild(powerIn); powerWrap.appendChild(powerTop); powerWrap.appendChild(powerHelp);

      const refWrap = document.createElement('div'); refWrap.style.display = 'flex'; refWrap.style.flexDirection = 'column'; refWrap.style.minWidth = '110px'; const refTop = document.createElement('div'); refTop.style.display = 'flex'; refTop.style.alignItems = 'center'; const refLabel = makeLabel('Ref year:'); const refIn = document.createElement('input'); refIn.type = 'number'; refIn.step = '1'; refIn.id = 'slopeRefYear'; refIn.value = (params && params.refYear) ? String(params.refYear) : '2024'; const refHelp = document.createElement('div'); refHelp.style.fontSize = '11px'; refHelp.style.color = '#666'; refHelp.style.marginTop = '2px'; refHelp.textContent = 'Reference year where LOESS or polynomial slope is evaluated (defaults to 2024).'; refIn.title = 'Reference year for local or polynomial slope evaluation.'; refTop.appendChild(refLabel); refTop.appendChild(refIn); refWrap.appendChild(refTop); refWrap.appendChild(refHelp);

      const applyBtn = document.createElement('button'); applyBtn.id = 'slopeApply'; applyBtn.textContent = 'Apply Slope'; applyBtn.style.marginLeft = '6px'; applyBtn.title = 'Apply slope settings and regenerate futures.';
      const resetBtn = document.createElement('button'); resetBtn.id = 'slopeReset'; resetBtn.textContent = 'Reset Slope'; resetBtn.style.marginLeft = '6px'; resetBtn.title = 'Reset slope settings to defaults and regenerate.';

      container.appendChild(methodWrap); container.appendChild(wlsWrap); container.appendChild(bwWrap); container.appendChild(tauWrap); container.appendChild(powerWrap); container.appendChild(refWrap); container.appendChild(applyBtn); container.appendChild(resetBtn);

      // remember defaults so we can toggle visibility cleanly
      wlsWrap.dataset.defaultDisplay = wlsWrap.style.display || 'flex'; bwWrap.dataset.defaultDisplay = bwWrap.style.display || 'flex'; tauWrap.dataset.defaultDisplay = tauWrap.style.display || 'flex'; powerWrap.dataset.defaultDisplay = powerWrap.style.display || 'flex'; refWrap.dataset.defaultDisplay = refWrap.style.display || 'flex';

      function updateVisibility() {
        const m = methodSel.value;
        // show only relevant controls
        wlsWrap.style.display = (m === 'wls') ? wlsWrap.dataset.defaultDisplay : 'none';
        // LOESS uses bandwidth and ref year
        bwWrap.style.display = (m === 'loess') ? bwWrap.dataset.defaultDisplay : 'none';
        // WLS uses either tau (exp) or power (linear)
        if (m === 'wls') {
          const wt = (wlsType && wlsType.value) || 'exp';
          tauWrap.style.display = (wt === 'exp') ? tauWrap.dataset.defaultDisplay : 'none';
          powerWrap.style.display = (wt === 'linear') ? powerWrap.dataset.defaultDisplay : 'none';
        } else {
          tauWrap.style.display = 'none'; powerWrap.style.display = 'none';
        }
        // refYear shown for loess and polys
        refWrap.style.display = (m === 'loess' || m === 'poly2' || m === 'poly3') ? refWrap.dataset.defaultDisplay : 'none';
      }

      // initial visibility and wiring
      updateVisibility();
      methodSel.addEventListener('change', updateVisibility);
      if (wlsType) wlsType.addEventListener('change', updateVisibility);

      function getSlopeParamsFromForm() { const m = methodSel.value || 'ols'; const out = { method: m }; const bw = parseFloat(bwIn.value); if (isFinite(bw)) out.slopeBW = bw; const tau = parseFloat(tauIn.value); if (isFinite(tau)) out.slopeTau = tau; const power = parseFloat(powerIn.value); if (isFinite(power)) out.slopePower = power; const st = wlsType.value; if (st) out.slopeType = st; const ry = parseInt(refIn.value); if (!isNaN(ry)) out.refYear = ry; return out; }

      applyBtn.addEventListener('click', async () => {
        const sparams = getSlopeParamsFromForm(); const seedVal = parseInt(seedInput && seedInput.value) || todaySeed; updateUrl(sparams); await runWithSeed(seedVal);
        // Call updateAll after runWithSeed to refresh the display
        if (typeof window.updateAll === 'function') window.updateAll();
      });
      resetBtn.addEventListener('click', async () => {
        // remove slope-related URL params and reload defaults
        updateUrl({ method: null, slopeBW: null, slopeTau: null, slopePower: null, slopeType: null, refYear: null }); const seedVal = parseInt(seedInput && seedInput.value) || todaySeed; // reset form values
        methodSel.value = 'ols'; wlsType.value = 'exp'; bwIn.value = ''; tauIn.value = ''; powerIn.value = ''; refIn.value = '2024'; updateVisibility(); await runWithSeed(seedVal);
        // Call updateAll after runWithSeed to refresh the display
        if (typeof window.updateAll === 'function') window.updateAll();
      });
    })();

    // Wire model-level controls (endpoint method + slope method) so changes update URL and regenerate
    (function wireModelControls() {
      const endpointSelect = document.getElementById('endpointSelect');
      const slopeSelect = document.getElementById('slopeMethod');
    // initialize from URL params if present; default to laplace when no param provided
    try { if (endpointSelect) endpointSelect.value = (params && params.endpoint) ? params.endpoint : 'laplace'; } catch (e) { }
      try { if (slopeSelect && params && params.method) slopeSelect.value = params.method; } catch (e) { }

      async function onModelChange() {
        const p = {};
        if (endpointSelect && endpointSelect.value) p.endpoint = endpointSelect.value;
        if (slopeSelect && slopeSelect.value) p.method = slopeSelect.value;
        // Preserve existing seed/year/pv when updating model params
        try {
          const s = parseInt(seedInput && seedInput.value) || null;
          if (s != null) p.seed = s;
          const y = document.getElementById('yearSlider'); if (y) p.year = parseInt(y.value);
          const pv = document.getElementById('pvSlider'); if (pv) p.pv = parseInt(pv.value);
        } catch (e) { }
        updateUrl(p);
        const seedVal = parseInt(seedInput && seedInput.value) || (params.seed || null) || 0;
        await runWithSeed(seedVal);
        if (typeof window.updateAll === 'function') window.updateAll();
      }

      if (endpointSelect) endpointSelect.addEventListener('change', onModelChange);
      if (slopeSelect) slopeSelect.addEventListener('change', onModelChange);
    })();

      setupEvProjectionControls();

    // apply URL year/pv BEFORE running seed generation
    if (params.year && yearSlider) {
      yearSlider.value = String(params.year);
      console.log('[future] Set year slider to URL year:', params.year);
    } else if (yearSlider) {
      // Default to 2028 only if no URL year is specified
      yearSlider.value = '2028';
      console.log('[future] Set year slider to default: 2028');
    }
    // PV handling: allow index (pv), numeric pvValue override, or pvPreset name
    if (params.pv != null && pvSlider) {
      pvSlider.value = String(params.pv);
      console.log('[future] Set PV slider to URL pv:', params.pv);
    }
    if (Number.isFinite(params.pvValue)) {
      // numeric override -> set global override used by updateUrl
      window._pvOverride = clampPv(params.pvValue);
      // reflect in text input if present
      if (pvText) pvText.value = (params.pvValue >= 0 ? `D+${(params.pvValue * 100).toFixed(1)}` : `R+${(Math.abs(params.pvValue) * 100).toFixed(1)}`);
      console.log('[future] Set PV override to URL pvValue:', params.pvValue);
    }
    if (params.pvPreset && pvPreset) { pvPreset.value = params.pvPreset; }

    await runWithSeed(seed);

    // console.log('[future] After runWithSeed - year slider value:', yearSlider ? yearSlider.value : 'no yearSlider');
    // console.log('[future] After runWithSeed - pv slider value:', pvSlider ? pvSlider.value : 'no pvSlider');
    // console.log('[future] Before updateAll - year slider value:', yearSlider ? yearSlider.value : 'no yearSlider');
    // console.log('[future] Before updateAll - pv slider value:', pvSlider ? pvSlider.value : 'no pvSlider');

    if (typeof window.updateAll === 'function') {
      window.updateAll();
      // console.log('[future] After updateAll - year slider value:', yearSlider ? yearSlider.value : 'no yearSlider');
      // console.log('[future] After updateAll - pv slider value:', pvSlider ? pvSlider.value : 'no pvSlider');

      // updateAll() resets sliders, so reapply URL params after it runs
      let needsSecondUpdate = false;
      if (params.year && yearSlider) {
        yearSlider.value = String(params.year);
        //console.log('[future] Re-set year slider to URL year after updateAll:', params.year);
        needsSecondUpdate = true;
      }
      if (params.pv != null && pvSlider) {
        pvSlider.value = String(params.pv);
        //console.log('[future] Re-set PV slider to URL pv after updateAll:', params.pv);
        needsSecondUpdate = true;
      } else if (params.pvValue != null) {
        window._pvOverride = clampPv(params.pvValue);
        //console.log('[future] Re-set PV override to URL pvValue after updateAll:', params.pvValue);
        needsSecondUpdate = true;
      }

      // Call updateAll() again to reflect the corrected slider values
      if (needsSecondUpdate) {
        console.log('[future] Calling updateAll() again to reflect corrected slider values');
        // Let updateAll rebuild stops for the new year, then reset PV slider afterward
        window.updateAll();

        // After updateAll rebuilds stops, reset PV slider to URL value again
        if (params.pv != null && pvSlider) {
          pvSlider.value = String(params.pv);
          console.log('[future] Re-set PV slider AGAIN after stops rebuild:', params.pv);
          // Call updateAll one more time to use the correct PV index with new stops
          window.updateAll();
        }

        // console.log('[future] Final year slider value:', yearSlider ? yearSlider.value : 'no yearSlider');
        // console.log('[future] Final pv slider value:', pvSlider ? pvSlider.value : 'no pvSlider');

        // Debug: check what PV value is actually being used
        // try {
        //   const year = parseInt(yearSlider.value);
        //   const pvIndex = parseInt(pvSlider.value);
        //   console.log('[future] Debug - year:', year, 'pvIndex:', pvIndex);
        //   console.log('[future] Debug - window._curYear:', window._curYear);
        //   console.log('[future] Debug - window._curPv:', window._curPv);
        //   console.log('[future] Debug - window._pvOverride:', window._pvOverride);
        // } catch (e) { console.warn('[future] Debug failed:', e); }
      }
    }

    if (typeof window.resetElectionNightSimulation === 'function') {
      window.resetElectionNightSimulation(true);
    } else if (window._electionNightActive) {
      const enReset = document.getElementById('enReset');
      if (enReset) enReset.click();
    }

    if (genBtn) genBtn.addEventListener('click', async () => {
      const s = parseInt(seedInput.value) || 0; updateUrl({ seed: s }); await runWithSeed(s);
    });
    if (randBtn) randBtn.addEventListener('click', async () => {
      const s = Math.floor(Math.random() * 1e8);
      if (seedInput) seedInput.value = String(s);
      updateUrl({ seed: s });
      await runWithSeed(s);
    });
    if (shareBtn) shareBtn.addEventListener('click', () => {
      const yEl = document.getElementById('yearSlider'); const pvEl = document.getElementById('pvSlider');
      const y = yEl ? parseInt(yEl.value) : null; const pv = pvEl ? parseInt(pvEl.value) : null; const seed = parseInt(seedInput.value) || 0;
      updateUrl({ seed, year: y, pv });
      shareBtn.textContent = 'Copied!';
      try { navigator.clipboard.writeText(window.location.href); } catch (e) { }
      setTimeout(() => shareBtn.textContent = 'Share', 1200);
    });

    if (yearSlider) yearSlider.addEventListener('input', () => {
      const y = parseInt(yearSlider.value); const pvEl = document.getElementById('pvSlider'); const pv = pvEl ? parseInt(pvEl.value) : 0; const seed = parseInt(seedInput.value) || 0; updateUrl({ seed, year: y, pv }); if (typeof window.updateAll === 'function') window.updateAll();
    });
    if (pvSlider) pvSlider.addEventListener('input', () => {
      // Moving the slider should cancel any custom PV override or active preset
      try { window._pvOverride = null; } catch (e) { }
      try { const pvPreset = document.getElementById('pvPreset'); if (pvPreset) pvPreset.value = ''; } catch (e) { }
      const yEl = document.getElementById('yearSlider');
      const y = yEl ? parseInt(yEl.value) : null;
      const pv = parseInt(pvSlider.value);
      const seed = parseInt(seedInput.value) || 0;
      updateUrl({ seed, year: y, pv });
      if (typeof window.updateAll === 'function') window.updateAll();
    });

    // PV override handlers
    function parsePvText(txt) {
      if (!txt) return null;
      txt = String(txt).trim().toUpperCase();
      if (txt === 'EVEN' || txt === '0' || txt === 'D+0' || txt === 'R+0') return 0;
      // D+4.5 or R+1.6
      let m = txt.match(/^([DR])\s*\+\s*([0-9]*\.?[0-9]+)$/);
      if (m) { const sign = (m[1] === 'D') ? 1 : -1; return sign * (parseFloat(m[2]) / 100); }
      // raw decimal like 0.045 or -0.016
      if (!isNaN(parseFloat(txt))) return parseFloat(txt);
      return null;
    }
    function clampPv(x) { if (!isFinite(x)) return 0; return Math.max(-PV_CAP, Math.min(PV_CAP, x)); }

    function applyPvOverride(val) {
      const yearEl = document.getElementById('yearSlider');
      const y = yearEl ? parseInt(yearEl.value) : 2028;
      // store override globally and update
      window._pvOverride = clampPv(val);
      // When overriding, do not show 'Actual' label; tester.js will hide when override is set
      if (typeof window.updateAll === 'function') window.updateAll();
      // Move pv slider to nearest stop purely for UI alignment, but keep override active
      try {
        const stops = (window._stopsByYear && window._stopsByYear.get(y)) || [0];
        let best = 0, bestD = 1e9; stops.forEach((s, idx) => { const d = Math.abs(s - window._pvOverride); if (d < bestD) { bestD = d; best = idx; } });
        const sEl = document.getElementById('pvSlider'); if (sEl) sEl.value = String(best);
      } catch (e) { }
    }

    if (pvApply) pvApply.addEventListener('click', () => {
      const v = parsePvText(pvText && pvText.value);
      if (v == null) return;
      applyPvOverride(v);
      const yEl = document.getElementById('yearSlider'); const y = yEl ? parseInt(yEl.value) : null; const seed = parseInt(seedInput.value) || 0;
      updateUrl({ seed, year: y });
    });
    if (pvPreset) pvPreset.addEventListener('change', () => {
      const v = parseFloat(pvPreset.value);
      if (!isNaN(v)) {
        // Derive preset name from selected option's label
        let name = '';
        try { const opt = pvPreset.options[pvPreset.selectedIndex]; if (opt) name = (opt.text || '').split(':')[0].trim(); } catch (e) { }
        window._pvPresetName = name || '';
        const baseStr = (v >= 0 ? `D+${(v * 100).toFixed(1)}` : `R+${(Math.abs(v) * 100).toFixed(1)}`);
        if (pvText) pvText.value = name ? `${baseStr} (${name})` : baseStr;
        applyPvOverride(v);
      }
      // store preset name in URL if element includes name attribute or data-name
      try {
        const el = document.getElementById('pvPreset');
        const presetName = el && (el.dataset && el.dataset.name) ? el.dataset.name : null;
        const yEl = document.getElementById('yearSlider'); const y = yEl ? parseInt(yEl.value) : null; const seed = parseInt(seedInput.value) || 0;
        if (presetName) updateUrl({ seed, year: y, pvPreset: presetName }); else updateUrl({ seed, year: y });
      } catch (e) { const yEl = document.getElementById('yearSlider'); const y = yEl ? parseInt(yEl.value) : null; const seed = parseInt(seedInput.value) || 0; updateUrl({ seed, year: y }); }
      if (typeof window.updateAll === 'function') window.updateAll();
    });
    if (pvFlip) pvFlip.addEventListener('click', () => {
      if (typeof window._pvFlipInProgress !== 'undefined' && window._pvFlipInProgress) {
        //try { console.log('pvFlip: ignored (already in progress)'); } catch (e) { }
        return;
      }
      window._pvFlipInProgress = true;
      let cur = 0;
      try {
        const parsed = (pvText && typeof pvText.value === 'string') ? (typeof parsePvText === 'function' ? parsePvText(pvText.value) : null) : null;
        if (parsed != null && isFinite(parsed)) cur = parsed;
        else if (typeof window._pvOverride === 'number' && isFinite(window._pvOverride)) cur = window._pvOverride;
        else {
          const yearEl = document.getElementById('yearSlider'); const y = yearEl ? parseInt(yearEl.value) : 2028;
          const pvEl = document.getElementById('pvSlider');
          const stops = (window._stopsByYear && window._stopsByYear.get(y)) || [0];
          const idx = pvEl ? parseInt(pvEl.value) : 0; const stopVal = stops[idx] || 0;
          cur = stopVal;
        }
      } catch (e) { console.warn(e); }
      const flipped = -cur;
      try {
        const pvTextRaw = (pvText && typeof pvText.value === 'string') ? pvText.value : null;
        console.log('pvFlip clicked (future)', { pvTextRaw, cur, flipped });
      } catch (e) { }
      finally {
        setTimeout(() => { try { window._pvFlipInProgress = false; } catch (e) { } }, 0);
      }
      try { window._pvPresetName = null; } catch (e) { }
      try { applyPvOverride(flipped); } catch (e) { console.warn(e); }
      try {
        if (pvText) {
          if (Math.abs(flipped) < 1e-12) pvText.value = 'EVEN';
          else if (flipped >= 0) pvText.value = `D+${(flipped * 100).toFixed(1)}`;
          else pvText.value = `R+${(Math.abs(flipped) * 100).toFixed(1)}`;
        }
      } catch (e) { }
      const yEl = document.getElementById('yearSlider'); const y = yEl ? parseInt(yEl.value) : null; const seed = parseInt(seedInput.value) || 0;
      updateUrl({ seed, year: y });
    });
    if (pvClear) pvClear.addEventListener('click', () => {
      window._pvOverride = null;
      try { window._pvPresetName = null; } catch (e) { }
      if (pvText) pvText.value = '';
      const yEl = document.getElementById('yearSlider'); const y = yEl ? parseInt(yEl.value) : null; const seed = parseInt(seedInput.value) || 0;
      updateUrl({ seed, year: y });
      if (typeof window.updateAll === 'function') window.updateAll();
    });

    // Laplace panel toggle and render helper
    const laplacePanel = document.getElementById('laplacePanel');
    const laplaceToggle = document.getElementById('laplaceToggle');
    const laplaceContent = document.getElementById('laplaceContent');
    console.log('[future] laplacePanel:', laplacePanel, 'laplaceToggle:', laplaceToggle, 'laplaceContent:', laplaceContent);
    // Sort state for laplace table (preserved between renders)
    let laplaceSortKey = 'pWeighted';
    let laplaceSortDir = 'desc'; // 'asc' | 'desc'

    function renderLaplaceMeta() {
      try {
        if (!laplaceContent) return console.warn('[future] renderLaplaceMeta - no laplaceContent element');
        console.log('[future] renderLaplaceMeta called. window:', window);
        const meta = window._laplaceMeta;
        console.log('[future] renderLaplaceMeta - meta:', meta);
        if (!meta || meta.size === 0) {
          laplaceContent.innerHTML = '<div>No Laplace metadata available for this run.</div>';
          return;
        }
        // Build rows array from meta Map
        const entries = Array.from(meta.keys()).map(abbr => ({ abbr, m: meta.get(abbr) }));

        function getNumericForKey(m, key) {
          if (!m) return NaN;
          if (key === 'pWeighted') return Number.isFinite(m.pLeft) ? m.pLeft : (Number.isFinite(m.pLeftWeighted) ? m.pLeftWeighted : NaN);
          if (/^N\d+$/.test(key)) {
            const v = m.pLeftByN && (m.pLeftByN[key] != null ? m.pLeftByN[key] : m.pLeftByN[key]);
            return Number.isFinite(v) ? v : NaN;
          }
          if (key === 'abbr') return String(m && m.abbr ? m.abbr : '');
          if (key === 'sign') return Number.isFinite(m && m.signDraw) ? m.signDraw : (Number.isFinite(m && m.S) ? m.S : 0);
          if (key === 'raw_delta') return Number.isFinite(m && m.raw_delta) ? m.raw_delta : (Number.isFinite(m && m.rawDelta) ? m.rawDelta : NaN);
          if (key === 'centered_delta') return Number.isFinite(m && m.centered) ? m.centered : (Number.isFinite(m && m.centered_delta) ? m.centered_delta : NaN);
          if (key === 'shift') return Number.isFinite(m && m.shift) ? m.shift : NaN;
          return NaN;
        }

        // sort entries according to laplaceSortKey/Dir
        entries.sort((a, b) => {
          const ka = getNumericForKey(a.m, laplaceSortKey);
          const kb = getNumericForKey(b.m, laplaceSortKey);
          const na = isFinite(ka) ? ka : (laplaceSortKey === 'abbr' ? (a.abbr || '') : -Infinity);
          const nb = isFinite(kb) ? kb : (laplaceSortKey === 'abbr' ? (b.abbr || '') : -Infinity);
          if (laplaceSortKey === 'abbr') {
            const cmp = String(na).localeCompare(String(nb));
            return laplaceSortDir === 'asc' ? cmp : -cmp;
          }
          const diff = na - nb;
          return laplaceSortDir === 'asc' ? diff : -diff;
        });

        // build HTML table header with data-key attributes for sorting
        const headerHtml = `<thead><tr>` +
          `<th data-key="abbr" style="text-align:left;padding:6px;cursor:pointer">Unit</th>` +
          `<th data-key="pWeighted" style="text-align:right;padding:6px;cursor:pointer">pWeighted</th>` +
          `<th data-key="N3" style="text-align:right;padding:6px;cursor:pointer">p[N=3]</th>` +
          `<th data-key="N4" style="text-align:right;padding:6px;cursor:pointer">p[N=4]</th>` +
          `<th data-key="N5" style="text-align:right;padding:6px;cursor:pointer">p[N=5]</th>` +
          `<th data-key="N6" style="text-align:right;padding:6px;cursor:pointer">p[N=6]</th>` +
          `<th data-key="sign" style="text-align:right;padding:6px;cursor:pointer">sign</th>` +
          `<th data-key="raw_delta" style="text-align:right;padding:6px;cursor:pointer">rawΔ</th>` +
          `<th data-key="centered_delta" style="text-align:right;padding:6px;cursor:pointer">centeredΔ</th>` +
          `<th data-key="shift" style="text-align:right;padding:6px;cursor:pointer">shift</th>` +
          `</tr></thead>`;

        const bodyRows = entries.map(({ abbr, m }) => {
          const pN3 = (m.pLeftByN && m.pLeftByN.N3 != null) ? m.pLeftByN.N3 : (m.pLeftByN && m.pLeftByN['N3'] != null ? m.pLeftByN['N3'] : null);
          const pN4 = (m.pLeftByN && m.pLeftByN.N4 != null) ? m.pLeftByN.N4 : (m.pLeftByN && m.pLeftByN['N4'] != null ? m.pLeftByN['N4'] : null);
          const pN5 = (m.pLeftByN && m.pLeftByN.N5 != null) ? m.pLeftByN.N5 : (m.pLeftByN && m.pLeftByN['N5'] != null ? m.pLeftByN['N5'] : null);
          const pN6 = (m.pLeftByN && m.pLeftByN.N6 != null) ? m.pLeftByN.N6 : (m.pLeftByN && m.pLeftByN['N6'] != null ? m.pLeftByN['N6'] : null);
          const pWeightedVal = Number.isFinite(m.pLeft) ? m.pLeft : (Number.isFinite(m.pLeftWeighted) ? m.pLeftWeighted : 0);
          const signVal = (m.signDraw || m.sign || m.S || 0);
          const raw = (m.raw_delta || m.rawDelta || 0);
          const centered = (m.centered_delta || m.centered || 0);
          const shift = (m.shift || 0);
          return `<tr>` +
            `<td style="padding:6px;border-top:1px solid #222">${abbr}</td>` +
            `<td style="padding:6px;border-top:1px solid #222;text-align:right">${pWeightedVal.toFixed(3)}</td>` +
            `<td style="padding:6px;border-top:1px solid #222;text-align:right">${(pN3!=null? pN3.toFixed(3): '—')}</td>` +
            `<td style="padding:6px;border-top:1px solid #222;text-align:right">${(pN4!=null? pN4.toFixed(3): '—')}</td>` +
            `<td style="padding:6px;border-top:1px solid #222;text-align:right">${(pN5!=null? pN5.toFixed(3): '—')}</td>` +
            `<td style="padding:6px;border-top:1px solid #222;text-align:right">${(pN6!=null? pN6.toFixed(3): '—')}</td>` +
            `<td style="padding:6px;border-top:1px solid #222;text-align:right">${signVal}</td>` +
            `<td style="padding:6px;border-top:1px solid #222;text-align:right">${raw.toFixed(3)}</td>` +
            `<td style="padding:6px;border-top:1px solid #222;text-align:right">${centered.toFixed(3)}</td>` +
            `<td style="padding:6px;border-top:1px solid #222;text-align:right">${shift.toFixed(3)}</td>` +
            `</tr>`;
        }).join('\n');

        laplaceContent.innerHTML = `<table style="width:100%;border-collapse:collapse">${headerHtml}<tbody>${bodyRows}</tbody></table>`;

        // attach click handlers to header cells to toggle sort
        const ths = laplaceContent.querySelectorAll('th[data-key]');
        ths.forEach(th => {
          th.addEventListener('click', () => {
            const k = th.getAttribute('data-key');
            if (laplaceSortKey === k) {
              laplaceSortDir = (laplaceSortDir === 'asc') ? 'desc' : 'asc';
            } else {
              laplaceSortKey = k; laplaceSortDir = (k === 'abbr') ? 'asc' : 'desc';
            }
            renderLaplaceMeta();
          });
        });
      } catch (e) { console.warn('[future] renderLaplaceMeta failed', e); }
    }
    if (laplaceToggle) {
      laplaceToggle.addEventListener('click', () => {
        if (!laplacePanel) return;
        const showing = laplaceContent && laplaceContent.style.display !== 'none';
        if (showing) {
          laplaceContent.style.display = 'none'; laplaceToggle.textContent = 'Show';
        } else {
          laplaceContent.style.display = 'block'; laplaceToggle.textContent = 'Hide';
          renderLaplaceMeta();
        }
      });
    }
  });
})();

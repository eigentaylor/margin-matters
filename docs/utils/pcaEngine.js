'use strict';

/**
 * Shared PCA math for the PCA Explorer page.
 * Runs PCA client-side via numeric.js's SVD (same dependency already used by
 * docs/future.js's pcaLoadings()), so components can be recomputed live for
 * any year range/metric the user picks instead of being locked to precomputed
 * output. Exposes window.PcaEngine.
 */

// 51 "state-level" units: 49 plain state+DC codes plus Maine/Nebraska's
// statewide at-large totals (ME-AL/NE-AL). Mirrors the STATE_FILTER
// convention in docs/trending-states.js, minus the district-level rows.
const BASE_UNITS = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME-AL', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE-AL', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT',
  'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

const DISTRICT_UNITS = ['ME-01', 'ME-02', 'NE-01', 'NE-02', 'NE-03'];

// First election year each district split actually appears in presidential_margins.csv.
const DISTRICT_SUPPORT_START = { ME: 1972, NE: 1992 };

function districtSplitAvailable(yearStart) {
  return {
    ME: yearStart >= DISTRICT_SUPPORT_START.ME,
    NE: yearStart >= DISTRICT_SUPPORT_START.NE,
  };
}

/**
 * Pivot presidential_margins.csv rows into a years x units matrix on the
 * chosen metric, using complete-case filtering: a unit is only kept if it has
 * a value for every year in [yearStart, yearEnd]. This directly answers
 * "does PCA need states with margins for every year in the range?" — yes,
 * rather than imputing missing years (see pca/do_pca.py for the alternative
 * mean-imputation approach used offline).
 */
function buildMatrix(rows, { metric, yearStart, yearEnd, splitDistricts }) {
  const support = districtSplitAvailable(yearStart);
  const allowed = new Set(BASE_UNITS);
  if (splitDistricts && support.ME) {
    allowed.delete('ME-AL');
    allowed.add('ME-01');
    allowed.add('ME-02');
  }
  if (splitDistricts && support.NE) {
    allowed.delete('NE-AL');
    allowed.add('NE-01');
    allowed.add('NE-02');
    allowed.add('NE-03');
  }

  const years = [];
  for (let y = yearStart; y <= yearEnd; y += 4) years.push(y);
  const yearSet = new Set(years);

  const byUnit = new Map(); // unit -> Map(year -> value)
  for (const r of rows) {
    const abbr = r.abbr;
    if (!abbr || !allowed.has(abbr)) continue;
    const year = +r.year;
    if (!yearSet.has(year)) continue;
    const raw = r[metric];
    const v = raw == null || raw === '' ? NaN : +raw;
    if (!Number.isFinite(v)) continue;
    if (!byUnit.has(abbr)) byUnit.set(abbr, new Map());
    byUnit.get(abbr).set(year, v);
  }

  const units = Array.from(byUnit.keys())
    .filter(u => years.every(y => byUnit.get(u).has(y)))
    .sort();
  const X = years.map(y => units.map(u => byUnit.get(u).get(y)));

  return { years, units, X, districtSplitApplied: { ME: !!(splitDistricts && support.ME), NE: !!(splitDistricts && support.NE) } };
}

/** Per-unit (column) mean/std standardization, population std (ddof=0) to match sklearn's StandardScaler default. */
function standardize(X) {
  const m = X.length;
  const n = m ? X[0].length : 0;
  const mean = new Array(n).fill(0);
  const std = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += X[i][j];
    mean[j] = m ? s / m : 0;
  }
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) { const d = X[i][j] - mean[j]; s += d * d; }
    std[j] = (m ? Math.sqrt(s / m) : 0) || 1e-12;
  }
  const Xstd = X.map(row => row.map((v, j) => (v - mean[j]) / std[j]));
  return { Xstd, mean, std };
}

function transpose(A) {
  const m = A.length;
  const n = m ? A[0].length : 0;
  const T = [];
  for (let j = 0; j < n; j++) {
    const row = new Array(m);
    for (let i = 0; i < m; i++) row[i] = A[i][j];
    T.push(row);
  }
  return T;
}

function matMul(A, B) {
  const m = A.length;
  const n = m ? A[0].length : 0;
  const p = n ? B[0].length : 0;
  const C = [];
  for (let i = 0; i < m; i++) {
    const row = new Array(p).fill(0);
    for (let l = 0; l < n; l++) {
      const a = A[i][l];
      if (a === 0) continue;
      const bRow = B[l];
      for (let j = 0; j < p; j++) row[j] += a * bRow[j];
    }
    C.push(row);
  }
  return C;
}

function identity(k) {
  const I = [];
  for (let i = 0; i < k; i++) { const row = new Array(k).fill(0); row[i] = 1; I.push(row); }
  return I;
}

/**
 * numeric.svd is only exercised elsewhere in this codebase (docs/future.js)
 * with a "tall" matrix (more rows than columns). Our natural years x units
 * matrix is almost always "wide" instead (years count is well under unit
 * count for every realistic range), so always feed numeric.svd a tall
 * matrix — transposing first and swapping U/V back on the way out — rather
 * than relying on unverified wide-matrix support.
 */
function svdSafe(X) {
  const m = X.length;
  const n = m ? X[0].length : 0;
  if (m >= n) {
    const { U, S, V } = numeric.svd(X);
    return { U, S, V };
  }
  const XT = transpose(X);
  const { U: U2, S: S2, V: V2 } = numeric.svd(XT);
  return { U: V2, S: S2, V: U2 };
}

/**
 * Runs PCA on an already-standardized years x units matrix.
 * Returns:
 *  - scores: years x k, the PC coordinates for each year (U * diag(S))
 *  - components: units x k, orthonormal principal axes (V) — used for reconstruction
 *  - loadings: units x k, correlation-style (components scaled by sqrt(explainedVariance)),
 *    matching pca/do_pca.py's convention — used for map coloring/interpretability
 *  - explainedVariance / explainedVarianceRatio: length k
 */
function runPca(Xstd) {
  const m = Xstd.length; // years
  const { U, S, V } = svdSafe(Xstd);
  const k = S.length;
  const scores = U.map(row => row.slice(0, k).map((v, j) => v * (S[j] || 0)));
  const components = V.map(row => row.slice(0, k));
  const totalVar = S.reduce((s, v) => s + v * v, 0) || 1;
  const explainedVarianceRatio = S.map(s => (s * s) / totalVar);
  const explainedVariance = S.map(s => (s * s) / Math.max(1, m - 1));
  const loadings = components.map(row => row.map((v, j) => v * Math.sqrt(explainedVariance[j] || 0)));
  return { scores, components, loadings, explainedVariance, explainedVarianceRatio, k };
}

/**
 * Direct JS port of the varimax rotation in pca/do_pca.py (Kaiser-normalized,
 * SVD-based iteration). Operates on a loadings-style (units x k) matrix, per
 * standard factor-analysis convention — varimax is always defined on
 * variance-scaled loadings, not raw orthonormal components, since the
 * criterion isn't invariant to per-component rescaling.
 * Returns { rotated, R } — R is the orthogonal rotation matrix, which callers
 * should also apply to the orthonormal `components` (components @ R) and to
 * `scores` (scores @ R) to keep reconstruction consistent under rotation.
 */
function varimax(Phi, { gamma = 1.0, maxIter = 50, tol = 1e-6 } = {}) {
  const p = Phi.length;
  const k = p ? Phi[0].length : 0;
  let R = identity(k);
  let dOld = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    const Lambda = matMul(Phi, R); // p x k
    const colSumSq = new Array(k).fill(0);
    for (let j = 0; j < k; j++) {
      for (let i = 0; i < p; i++) colSumSq[j] += Lambda[i][j] * Lambda[i][j];
    }
    const term = Lambda.map(row => row.map((v, j) => v * v * v - (gamma / p) * v * colSumSq[j]));
    const M = matMul(transpose(Phi), term); // k x k
    const { U, S, V } = svdSafe(M);
    R = matMul(U, transpose(V));
    const d = S.reduce((s, v) => s + v, 0);
    if (dOld !== 0 && (d - dOld) < tol) break;
    dOld = d;
  }
  const rotated = matMul(Phi, R);
  return { rotated, R };
}

/**
 * Reconstructs a units-length margin vector from a (possibly hypothetical)
 * PC score vector, truncated to the first k components. Used both for the
 * interactive slider map (arbitrary hypothetical scores) and the historical
 * error map (real scores for a given year, truncated) — same code path.
 */
function reconstruct(scoresVector, components, mean, std, k) {
  const n = components.length; // units
  const kUse = Math.min(k, scoresVector.length, n ? components[0].length : 0);
  const xStdHat = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < kUse; i++) s += scoresVector[i] * components[j][i];
    xStdHat[j] = s;
  }
  return xStdHat.map((v, j) => v * std[j] + mean[j]);
}

/** Ordinary least squares slope/intercept/R^2 for a simple xs -> ys fit. */
function olsFit(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: n ? ys[0] : 0, r2: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]; sumY += ys[i]; sumXY += xs[i] * ys[i]; sumXX += xs[i] * xs[i];
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * xs[i] + intercept;
    ssRes += (ys[i] - pred) * (ys[i] - pred);
    ssTot += (ys[i] - yMean) * (ys[i] - yMean);
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

const PcaEngine = {
  BASE_UNITS,
  DISTRICT_UNITS,
  DISTRICT_SUPPORT_START,
  districtSplitAvailable,
  buildMatrix,
  standardize,
  runPca,
  varimax,
  reconstruct,
  olsFit,
  transpose,
  matMul,
};

if (typeof window !== 'undefined') {
  try { window.PcaEngine = PcaEngine; } catch (e) { /* noop */ }
}

export default PcaEngine;
export {
  BASE_UNITS,
  DISTRICT_UNITS,
  DISTRICT_SUPPORT_START,
  districtSplitAvailable,
  buildMatrix,
  standardize,
  runPca,
  varimax,
  reconstruct,
  olsFit,
};

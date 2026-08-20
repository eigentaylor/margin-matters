'use strict';

// Aleck Lickman's "13 Beets to the Presidency" prediction model - a parody
// of Allan Lichtman's 13 Keys. Rather than maintaining a separate parody
// dataset, Lickman runs the exact same least-squares fit docs/keys.js uses
// (false_keys -> incumbent-relative national popular vote margin), just
// inverted: given the election's true NPV margin (already known internally
// before election night starts, since it drives the whole simulation), solve
// for how many "beets" must be false to produce that result, add a seeded
// wobble sized off the fit's own residual spread, and use whichever side of
// 6 the result lands on to pick a winner. That wobble is deliberate - it's
// what lets Lickman be confidently wrong sometimes, same as the real Keys.

import { hashCode, mulberry32, randn } from '../randomUtils.js';

const CSV_URL = '../../keys_with_npv.csv';

// Elections not covered by keys_with_npv.csv (currently just the fictional
// 2028 race). Trump/R won 2024, so 2028 opens with an R incumbent.
const INCUMBENT_PARTY_OVERRIDE = { 2028: 'R' };

const BEETS_TOTAL = 13;
const BEETS_MAJORITY = 6; // >= this many false beets -> the challenger wins

let regressionPromise = null;

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  const yearIdx = headers.indexOf('year');
  const incumbentIdx = headers.indexOf('incumbent_party');
  const falseKeysIdx = headers.indexOf('false_keys');
  const npvIncumbentRelIdx = headers.indexOf('npv_incumbent_relative');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (!cols.length || !cols[yearIdx]) continue;
    rows.push({
      year: parseInt(cols[yearIdx], 10),
      incumbentParty: cols[incumbentIdx],
      falseKeys: parseFloat(cols[falseKeysIdx]),
      npvIncumbentRelative: parseFloat(cols[npvIncumbentRelIdx])
    });
  }
  return rows;
}

// Same OLS fit as docs/keys.js's linearRegression()/calculateResidualStd() -
// reimplemented locally rather than imported since keys.js is a page-scoped
// IIFE, not a module.
function fitRegression(rows) {
  const n = rows.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  rows.forEach(({ falseKeys: x, npvIncumbentRelative: y }) => {
    sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x;
  });
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const residuals = rows.map(({ falseKeys: x, npvIncumbentRelative: y }) => y - (slope * x + intercept));
  const meanResidual = residuals.reduce((a, b) => a + b, 0) / n;
  const variance = residuals.reduce((a, r) => a + (r - meanResidual) ** 2, 0) / n;
  const residualStd = Math.sqrt(variance);
  return { slope, intercept, residualStd };
}

/** Fetches + fits the regression once, caching the promise for the life of the page. */
function loadKeysRegression() {
  if (!regressionPromise) {
    regressionPromise = fetch(CSV_URL)
      .then(res => (res.ok ? res.text() : ''))
      .then(text => {
        if (!text) return null;
        const rows = parseCsv(text);
        // One row per year (a handful of source rows repeat a year from both
        // parties' perspective) - keep the first, matching keys.js's
        // getUniqueElections().
        const seenYears = new Set();
        const uniqueRows = [];
        const incumbentByYear = new Map();
        rows.forEach(row => {
          if (!incumbentByYear.has(row.year)) incumbentByYear.set(row.year, row.incumbentParty);
          if (seenYears.has(row.year)) return;
          seenYears.add(row.year);
          uniqueRows.push(row);
        });
        return { ...fitRegression(uniqueRows), incumbentByYear };
      })
      .catch(() => null);
  }
  return regressionPromise;
}

/** Incumbent party for a given election year, or null if unknown. */
export async function getIncumbentParty(year) {
  if (INCUMBENT_PARTY_OVERRIDE[year]) return INCUMBENT_PARTY_OVERRIDE[year];
  const regression = await loadKeysRegression();
  return (regression && regression.incumbentByYear.get(year)) || null;
}

/**
 * Estimate Lickman's false-beet count and predicted winner from the
 * election's true (D-positive) national popular vote margin.
 *
 * @param {object} o
 * @param {number} o.year
 * @param {number} o.npvMarginDPositive - the true final NPV margin, D-positive.
 * @param {number} o.seed - integer seed for the "decided" draw's wobble.
 * @returns {Promise<null|{incumbentParty, challengerParty, predicted, decided,
 *   band, predictedWinnerParty, slope, intercept, residualStd}>}
 */
export async function estimateFalseBeets({ year, npvMarginDPositive, seed }) {
  const regression = await loadKeysRegression();
  if (!regression || !isFinite(regression.slope) || regression.slope === 0) return null;
  const incumbentParty = INCUMBENT_PARTY_OVERRIDE[year] || regression.incumbentByYear.get(year);
  if (incumbentParty !== 'D' && incumbentParty !== 'R') return null;
  const challengerParty = incumbentParty === 'D' ? 'R' : 'D';

  const { slope, intercept, residualStd } = regression;
  const incumbentRelativeNpv = incumbentParty === 'D' ? npvMarginDPositive : -npvMarginDPositive;
  const predicted = (incumbentRelativeNpv - intercept) / slope;
  const band = Math.abs(residualStd / slope);

  const rng = mulberry32(hashCode(`lickman:${year}:${seed}`) >>> 0);
  const decidedRaw = predicted + randn(rng) * band;
  const decided = Math.max(0, Math.min(BEETS_TOTAL, Math.round(decidedRaw)));
  const predictedWinnerParty = decided < BEETS_MAJORITY ? incumbentParty : challengerParty;

  return { incumbentParty, challengerParty, predicted, decided, band, predictedWinnerParty, slope, intercept, residualStd };
}

export const LICKMAN_BEETS_TOTAL = BEETS_TOTAL;
export const LICKMAN_BEETS_MAJORITY = BEETS_MAJORITY;

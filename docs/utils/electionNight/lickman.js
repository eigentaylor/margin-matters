'use strict';

// Aleck Lickman's "13 Beets to the Presidency" prediction model - a parody
// of Allan Lichtman's 13 Keys.
//
// For any election docs/keys_with_npv.csv actually covers (every real
// election through 2024), Lickman uses the REAL graded false-key count
// directly - it's ground truth, not something to re-derive. That means his
// historical track record is exactly the real 13 Keys system's track
// record: right when the Keys were right (PV and/or EC), wrong when they
// were wrong (2024).
//
// For an election with no CSV row (currently just the fictional 2028 race,
// where no one has hand-graded 13 real keys), Lickman falls back to the
// exact same least-squares fit docs/keys.js uses (false_keys -> incumbent-
// relative NPV margin), inverted: given the election's true NPV margin
// (already known internally before election night starts, since it drives
// the whole simulation), solve for how many "beets" must be false to
// produce that result, then add a seeded wobble sized off the fit's own
// residual spread. That wobble is deliberate - it's what lets Lickman be
// confidently wrong sometimes on a hypothetical race, the same way the real
// Keys can be on a real one.

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
        // getUniqueElections(). keysByYear carries the REAL graded
        // incumbent party + false-key count, so estimateFalseBeets() can use
        // ground truth directly for any year this covers.
        const seenYears = new Set();
        const uniqueRows = [];
        const keysByYear = new Map();
        rows.forEach(row => {
          if (!keysByYear.has(row.year)) {
            keysByYear.set(row.year, { incumbentParty: row.incumbentParty, falseKeys: row.falseKeys });
          }
          if (seenYears.has(row.year)) return;
          seenYears.add(row.year);
          uniqueRows.push(row);
        });
        return { ...fitRegression(uniqueRows), keysByYear };
      })
      .catch(() => null);
  }
  return regressionPromise;
}

/** Incumbent party for a given election year, or null if unknown. */
export async function getIncumbentParty(year) {
  const regression = await loadKeysRegression();
  const actual = regression && regression.keysByYear.get(year);
  if (actual) return actual.incumbentParty;
  return INCUMBENT_PARTY_OVERRIDE[year] || null;
}

/**
 * Aleck Lickman's false-beet count and predicted winner for an election.
 * Uses the real graded false-key count directly for any year
 * keys_with_npv.csv covers (ground truth - see this file's header comment);
 * only falls back to estimating from the true NPV margin (with a seeded
 * wobble) for a year with no CSV row, e.g. the fictional 2028 race.
 *
 * @param {object} o
 * @param {number} o.year
 * @param {number} o.npvMarginDPositive - the true final NPV margin, D-positive
 *   (only used for the no-ground-truth fallback).
 * @param {number} o.seed - integer seed for the fallback's wobble.
 * @returns {Promise<null|{incumbentParty, challengerParty, predicted, decided,
 *   band, predictedWinnerParty, isActual, slope, intercept, residualStd}>}
 */
export async function estimateFalseBeets({ year, npvMarginDPositive, seed }) {
  const regression = await loadKeysRegression();
  if (!regression || !isFinite(regression.slope) || regression.slope === 0) return null;
  const { slope, intercept, residualStd } = regression;

  const actual = regression.keysByYear.get(year);
  if (actual && (actual.incumbentParty === 'D' || actual.incumbentParty === 'R')) {
    const incumbentParty = actual.incumbentParty;
    const challengerParty = incumbentParty === 'D' ? 'R' : 'D';
    const decided = Math.max(0, Math.min(BEETS_TOTAL, Math.round(actual.falseKeys)));
    const predictedWinnerParty = decided < BEETS_MAJORITY ? incumbentParty : challengerParty;
    return {
      incumbentParty, challengerParty, predicted: decided, decided, band: 0,
      predictedWinnerParty, isActual: true, slope, intercept, residualStd
    };
  }

  const incumbentParty = INCUMBENT_PARTY_OVERRIDE[year];
  if (incumbentParty !== 'D' && incumbentParty !== 'R') return null;
  const challengerParty = incumbentParty === 'D' ? 'R' : 'D';

  const incumbentRelativeNpv = incumbentParty === 'D' ? npvMarginDPositive : -npvMarginDPositive;
  const predicted = (incumbentRelativeNpv - intercept) / slope;
  const band = Math.abs(residualStd / slope);

  const rng = mulberry32(hashCode(`lickman:${year}:${seed}`) >>> 0);
  const decidedRaw = predicted + randn(rng) * band;
  const decided = Math.max(0, Math.min(BEETS_TOTAL, Math.round(decidedRaw)));
  const predictedWinnerParty = decided < BEETS_MAJORITY ? incumbentParty : challengerParty;

  return {
    incumbentParty, challengerParty, predicted, decided, band,
    predictedWinnerParty, isActual: false, slope, intercept, residualStd
  };
}

export const LICKMAN_BEETS_TOTAL = BEETS_TOTAL;
export const LICKMAN_BEETS_MAJORITY = BEETS_MAJORITY;

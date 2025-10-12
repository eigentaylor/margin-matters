'use strict';

import { EPS, STOP_EPS, STOP_KEY_PREC } from './constants.js';
import { computePvAdjustedBreakdown, totalVotesFromRow, clampMargin } from './voteMath.js';
import { isUnitFlipped } from './flipScenarios.js';

const CONFIG = {
  ME: {
    threshold: 1972,
    atLarge: 'ME-AL',
    districts: ['ME-01', 'ME-02']
  },
  NE: {
    threshold: 1992,
    atLarge: 'NE-AL',
    districts: ['NE-01', 'NE-02', 'NE-03']
  }
};

function normalizeUnit(unitOrState) {
  if (!unitOrState) return { state: null, atLarge: null, config: null, kind: null };
  const str = String(unitOrState);
  let state = null;
  let kind = null;
  if (/^[A-Z]{2}$/.test(str)) {
    state = str;
    kind = 'state';
  } else if (/^[A-Z]{2}-AL$/.test(str)) {
    state = str.slice(0, 2);
    kind = 'atLarge';
  } else if (/^[A-Z]{2}-\d{2}$/.test(str)) {
    state = str.slice(0, 2);
    kind = 'district';
  } else if (str.includes('-')) {
    state = str.slice(0, 2);
    kind = 'other';
  } else if (str.length === 2) {
    state = str;
    kind = 'state';
  }
  if (!state) return { state: null, atLarge: null, config: null, kind: null };
  const config = CONFIG[state] || null;
  const atLarge = config ? config.atLarge : `${state}-AL`;
  return { state, atLarge, config, kind };
}

function resolveRowsForYear(year, byYearOverride) {
  if (byYearOverride && typeof byYearOverride.get === 'function') {
    const rows = byYearOverride.get(Number(year));
    if (Array.isArray(rows)) return rows;
  }
  if (typeof window !== 'undefined') {
    if (window._byYearMap instanceof Map) {
      const rows = window._byYearMap.get(Number(year));
      if (Array.isArray(rows)) return rows;
    }
    if (typeof window.getRowsForYear === 'function') {
      const rows = window.getRowsForYear(Number(year));
      if (Array.isArray(rows)) return rows;
    }
  }
  return null;
}

function computeNatMarginFromRows(rows) {
  if (!Array.isArray(rows)) return 0;
  const natRow = rows.find(r => r && (r.unit === 'NATIONAL' || r.unit === 'NAT'));
  if (natRow) {
    const nm = Number(natRow.nm);
    if (isFinite(nm)) return nm;
    const d = Number(natRow.dVotes || natRow.dvotes || 0);
    const r = Number(natRow.rVotes || natRow.rvotes || 0);
    const total = d + r;
    if (total > EPS) return clampMargin((d - r) / total);
  }
  return 0;
}

function computeRawAggregateTotals(districtRows) {
  if (!Array.isArray(districtRows) || districtRows.length === 0) return null;
  let dVotes = 0;
  let rVotes = 0;
  let topThirdVotes = 0;
  let totalThirdVotes = 0;
  let totalVotes = 0;

  districtRows.forEach(row => {
    if (!row) return;
    const d = Number(row.dVotes || 0);
    const r = Number(row.rVotes || 0);
    const top = Number(row.topThirdVotes != null ? row.topThirdVotes : row.tVotes || 0);
    const third = Number(row.tVotes || top || 0);
    const total = totalVotesFromRow(row);

    dVotes += isFinite(d) ? Math.max(0, d) : 0;
    rVotes += isFinite(r) ? Math.max(0, r) : 0;
    const topClamped = isFinite(top) ? Math.max(0, top) : 0;
    const thirdClamped = Math.max(topClamped, isFinite(third) ? Math.max(0, third) : 0);
    topThirdVotes += topClamped;
    totalThirdVotes += thirdClamped;
    totalVotes += isFinite(total) && total > 0 ? total : (Math.max(0, d) + Math.max(0, r) + thirdClamped);
  });

  totalThirdVotes = Math.max(totalThirdVotes, topThirdVotes);
  totalVotes = Math.max(totalVotes, dVotes + rVotes + totalThirdVotes);

  return { dVotes, rVotes, topThirdVotes, totalThirdVotes, totalVotes };
}

function buildVotesToFlipMap(year, useActiveFlip) {
  const map = new Map();
  if (!useActiveFlip || typeof window === 'undefined') return map;
  const activeFlip = window._activeFlip && window._activeFlip.year === Number(year) ? window._activeFlip : null;
  if (!activeFlip || !Array.isArray(activeFlip.units)) return map;
  activeFlip.units.forEach(u => {
    if (!u || !u.unit) return;
    const votes = Number(u.votes_to_flip || 0);
    if (votes > 0) map.set(u.unit, votes);
  });
  return map;
}

function applyVotesToFlip(dVotes, rVotes, votesToFlip) {
  if (!votesToFlip || votesToFlip <= 0) return { dVotes, rVotes };
  if (dVotes >= rVotes) {
    return { dVotes: Math.max(0, dVotes - votesToFlip), rVotes: rVotes + votesToFlip };
  }
  return { dVotes: dVotes + votesToFlip, rVotes: Math.max(0, rVotes - votesToFlip) };
}

export function shouldAggregateAtLarge(year, unitOrState) {
  const { config, kind } = normalizeUnit(unitOrState);
  if (!config) return false;
  if (!(kind === 'state' || kind === 'atLarge')) return false;
  return Number(year) >= config.threshold;
}

export function getAtLargeAdjustedTotals(year, unitOrState, options = {}) {
  const { pv, useActiveFlip = true, rowsOverride = null, natMarginOverride = null } = options;
  const { state, atLarge, config, kind } = normalizeUnit(unitOrState);
  if (!config || !(kind === 'state' || kind === 'atLarge') || Number(year) < config.threshold) return null;

  const rows = rowsOverride || resolveRowsForYear(year, options.byYear);
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const districts = config.districts.map(unit => rows.find(r => r && r.unit === unit));
  if (districts.some(r => !r)) return null;

  const natMargin = (natMarginOverride != null) ? natMarginOverride : computeNatMarginFromRows(rows);
  const pvValue = isFinite(pv) ? Number(pv) : (
    typeof window !== 'undefined' && isFinite(window._curPv) ? Number(window._curPv) : natMargin
  );

  const votesToFlip = buildVotesToFlipMap(year, useActiveFlip);

  let dSum = 0;
  let rSum = 0;
  let topSum = 0;
  let thirdSum = 0;
  let totalSum = 0;

  for (const row of districts) {
    const breakdown = computePvAdjustedBreakdown(row, pvValue, natMargin);
    let d = isFinite(breakdown.dVotes) ? Math.max(0, breakdown.dVotes) : 0;
    let r = isFinite(breakdown.rVotes) ? Math.max(0, breakdown.rVotes) : 0;
    const total = isFinite(breakdown.totalVotes) && breakdown.totalVotes > 0
      ? breakdown.totalVotes
      : totalVotesFromRow(row);
    const top = isFinite(breakdown.topThirdVotes) ? Math.max(0, breakdown.topThirdVotes) : 0;
    const third = Math.max(top, isFinite(breakdown.totalThirdVotes) ? Math.max(0, breakdown.totalThirdVotes) : 0);

    if (useActiveFlip && isUnitFlipped(year, row.unit)) {
      const vt = votesToFlip.get(row.unit) || 0;
      if (vt > 0) {
        const adj = applyVotesToFlip(d, r, vt);
        d = adj.dVotes;
        r = adj.rVotes;
      }
    }

    dSum += d;
    rSum += r;
    topSum += top;
    thirdSum += third;
    totalSum += isFinite(total) && total > 0 ? total : (d + r + third);
  }

  thirdSum = Math.max(thirdSum, topSum);
  totalSum = Math.max(totalSum, dSum + rSum + thirdSum);

  let dVotes = dSum;
  let rVotes = rSum;

  if (useActiveFlip && isUnitFlipped(year, atLarge)) {
    const vt = votesToFlip.get(atLarge) || 0;
    if (vt > 0) {
      const adj = applyVotesToFlip(dVotes, rVotes, vt);
      dVotes = adj.dVotes;
      rVotes = adj.rVotes;
    }
  }

  const twoPartyVotes = Math.max(0, dVotes + rVotes);
  const twoPartyMargin = twoPartyVotes > EPS ? clampMargin((dVotes - rVotes) / twoPartyVotes) : 0;
  const thirdPartyDominant = topSum >= dVotes && topSum >= rVotes;
  const winner = thirdPartyDominant ? 'O' : (dVotes >= rVotes ? 'D' : 'R');

  return {
    dVotes,
    rVotes,
    topThirdVotes: topSum,
    totalThirdVotes: thirdSum,
    totalVotes: totalSum,
    twoPartyVotes,
    twoPartyMargin,
    winner,
    thirdPartyDominant
  };
}

function matchExistingStopKey(stopMap, value) {
  if (!(stopMap instanceof Map)) return null;
  let bestKey = null;
  let bestDiff = STOP_EPS;
  for (const key of stopMap.keys()) {
    const num = Number(key);
    if (!isFinite(num)) continue;
    const diff = Math.abs(num - value);
    if (diff <= STOP_EPS && diff <= bestDiff) {
      bestDiff = diff;
      bestKey = key;
    }
  }
  return bestKey;
}

function buildStopEntry(totals, colorForMargin) {
  if (!totals) return null;
  const { dVotes, rVotes, topThirdVotes, twoPartyMargin, thirdPartyDominant } = totals;
  let winner = thirdPartyDominant ? 'T' : (dVotes >= rVotes ? 'D' : 'R');
  let colorCss;
  let colorName;
  if (winner === 'T') {
    colorCss = '#C9A400';
    colorName = 'YELLOW';
  } else {
    if (typeof colorForMargin === 'function') {
      colorCss = colorForMargin(twoPartyMargin, false);
    } else {
      colorCss = winner === 'D' ? '#1e4bd1' : '#b22222';
    }
    colorName = winner === 'D' ? 'BLUE' : 'RED';
  }
  return { winner: winner === 'T' ? 'T' : winner, color_css: colorCss, color_name: colorName };
}

function findZeroCrossing(year, config, rows, natMargin) {
  const range = 0.35;
  const leftBound = -range;
  const rightBound = range;
  const f = pv => {
    const totals = getAtLargeAdjustedTotals(year, config.atLarge, {
      pv,
      useActiveFlip: false,
      rowsOverride: rows,
      natMarginOverride: natMargin
    });
    return totals ? totals.twoPartyMargin : null;
  };

  let fLeft = f(leftBound);
  let fRight = f(rightBound);
  if (fLeft == null || fRight == null) return null;
  if (Math.abs(fLeft) < STOP_EPS) return leftBound;
  if (Math.abs(fRight) < STOP_EPS) return rightBound;
  if (fLeft * fRight > 0) return null;

  let a = leftBound;
  let b = rightBound;
  let fa = fLeft;
  let fb = fRight;
  for (let i = 0; i < 48; i++) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (fm == null) return null;
    if (Math.abs(fm) <= 5e-7) return mid;
    if (fa * fm <= 0) {
      b = mid;
      fb = fm;
    } else {
      a = mid;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

function ensureStopYearMap(map, year) {
  if (!(map instanceof Map)) return null;
  if (!map.has(year)) map.set(year, new Map());
  return map.get(year);
}

function normalizeWinnerCode(totals) {
  if (!totals || !totals.winner) return null;
  const w = String(totals.winner).toUpperCase();
  if (w === 'O') return 'T';
  return w === 'D' || w === 'R' || w === 'T' ? w : null;
}

function getMarginValue(totals) {
  if (!totals || totals.twoPartyMargin == null) return null;
  const m = Number(totals.twoPartyMargin);
  return Number.isFinite(m) ? m : null;
}

function shouldAttachAtLargeStop(totalsBelow, totalsAt, totalsAbove) {
  const winners = [normalizeWinnerCode(totalsBelow), normalizeWinnerCode(totalsAt), normalizeWinnerCode(totalsAbove)].filter(Boolean);
  if (winners.length >= 2) {
    const unique = new Set(winners);
    if (unique.size > 1) return true;
  }

  const margins = [getMarginValue(totalsBelow), getMarginValue(totalsAt), getMarginValue(totalsAbove)];
  const nearZero = margins.some(m => m != null && Math.abs(m) <= STOP_EPS * 2);
  if (nearZero) return true;

  const pairs = [
    [margins[0], margins[1]],
    [margins[1], margins[2]],
    [margins[0], margins[2]]
  ];
  for (const [a, b] of pairs) {
    if (a == null || b == null) continue;
    if (Math.abs(a) <= STOP_EPS * 2 || Math.abs(b) <= STOP_EPS * 2) return true;
    if (a * b < 0) return true;
  }

  const thirdPartyDominant = [totalsBelow, totalsAt, totalsAbove].some(t => t && t.thirdPartyDominant);
  if (thirdPartyDominant && winners.length > 0) {
    const unique = new Set(winners);
    if (unique.size > 1) return true;
  }

  return false;
}

function updateStopMetadata(year, config, stopColorsByYear, stopEffByYear, colorForMargin, rows, natMargin) {
  if (!(stopColorsByYear instanceof Map)) return;
  const byStop = ensureStopYearMap(stopColorsByYear, year);
  if (!(byStop instanceof Map)) return;
  const effByStop = stopEffByYear instanceof Map ? ensureStopYearMap(stopEffByYear, year) : null;
  const delta = Math.max(STOP_EPS * 10, 0.00005);

  byStop.forEach((unitsMap, stopKey) => {
    if (!(unitsMap instanceof Map)) {
      unitsMap = new Map();
      byStop.set(stopKey, unitsMap);
    }
    unitsMap.delete(config.atLarge);

    const pvVal = effByStop && effByStop.has(stopKey) ? effByStop.get(stopKey) : Number(stopKey);
    if (!isFinite(pvVal)) return;

    const totalsAt = getAtLargeAdjustedTotals(year, config.atLarge, {
      pv: pvVal,
      useActiveFlip: false,
      rowsOverride: rows,
      natMarginOverride: natMargin
    });
    const totalsBelow = getAtLargeAdjustedTotals(year, config.atLarge, {
      pv: pvVal - delta,
      useActiveFlip: false,
      rowsOverride: rows,
      natMarginOverride: natMargin
    });
    const totalsAbove = getAtLargeAdjustedTotals(year, config.atLarge, {
      pv: pvVal + delta,
      useActiveFlip: false,
      rowsOverride: rows,
      natMarginOverride: natMargin
    });

    const include = shouldAttachAtLargeStop(totalsBelow, totalsAt, totalsAbove);
    if (!include) return;

    const entryTotals = totalsAt || totalsAbove || totalsBelow;
    const entry = buildStopEntry(entryTotals, colorForMargin);
    if (!entry) return;
    unitsMap.set(config.atLarge, entry);
  });

  const zero = findZeroCrossing(year, config, rows, natMargin);
  if (zero == null) return;
  let key = matchExistingStopKey(byStop, zero);
  if (!key) {
    key = zero.toFixed(STOP_KEY_PREC);
    if (!byStop.has(key)) {
      byStop.set(key, new Map());
    }
  }
  const totals = getAtLargeAdjustedTotals(year, config.atLarge, {
    pv: zero,
    useActiveFlip: false,
    rowsOverride: rows,
    natMarginOverride: natMargin
  });
  const entry = buildStopEntry(totals, colorForMargin);
  if (entry) {
    const targetMap = byStop.get(key);
    targetMap.set(config.atLarge, entry);
  }
  if (effByStop instanceof Map) {
    effByStop.set(key, zero);
  }
}

function applyAtLargeBaseRow(year, config, rows, natMargin) {
  const districts = config.districts.map(unit => rows.find(r => r && r.unit === unit));
  if (districts.some(r => !r)) return;
  const totals = computeRawAggregateTotals(districts);
  if (!totals) return;

  let row = rows.find(r => r && r.unit === config.atLarge);
  if (!row) {
    row = { year: Number(year), unit: config.atLarge };
    rows.push(row);
  }

  row.dVotes = totals.dVotes;
  row.rVotes = totals.rVotes;
  row.tVotes = totals.totalThirdVotes;
  row.topThirdVotes = totals.topThirdVotes;
  row.total = totals.totalVotes;

  const twoParty = Math.max(0, totals.dVotes + totals.rVotes);
  const rawMargin = twoParty > EPS ? clampMargin((totals.dVotes - totals.rVotes) / twoParty) : 0;
  row.rm = clampMargin(rawMargin - natMargin);
  row.nm = natMargin;

  const totalShare = totals.totalVotes > EPS ? Math.max(0, totals.totalThirdVotes / totals.totalVotes) : 0;
  const topShare = totals.totalVotes > EPS ? Math.max(0, totals.topThirdVotes / totals.totalVotes) : totalShare;
  row.thirdShare = totalShare;
  row.tp = topShare;
}

export function prepareAtLargeData(options = {}) {
  const {
    byYear = (typeof window !== 'undefined' ? window._byYearMap : null),
    stopColorsByYear = (typeof window !== 'undefined' ? window._stopColorsByYear : null),
    stopEffByYear = (typeof window !== 'undefined' ? window._stopEffByYear : null),
    colorForMargin = null
  } = options;

  if (!(byYear instanceof Map)) return;

  byYear.forEach((rows, yearKey) => {
    if (!Array.isArray(rows) || !rows.length) return;
    const year = Number(yearKey);
    const natMargin = computeNatMarginFromRows(rows);
    Object.values(CONFIG).forEach(config => {
      if (year < config.threshold) return;
      applyAtLargeBaseRow(year, config, rows, natMargin);
      updateStopMetadata(year, config, stopColorsByYear, stopEffByYear, colorForMargin, rows, natMargin);
    });
  });
}

export default {
  prepareAtLargeData,
  shouldAggregateAtLarge,
  getAtLargeAdjustedTotals
};

'use strict';
// Small shared utilities for unit-level vote/EV computations.
// These are intentionally conservative and read other project helpers from
// the global window (e.g. getRowsForYear, getEvFor, _curYear, _curPv).

export function totalVotesFromRow(row) {
  const direct = +row.total;
  if (isFinite(direct) && direct > 0) return direct;
  const fallback = (+row.dVotes || 0) + (+row.rVotes || 0) + (+row.tVotes || 0);
  return fallback > 0 ? fallback : 0;
}

export function clampMargin(value) {
  if (!isFinite(value)) return 0;
  const LIMIT = 1 - 1e-9;
  if (value > LIMIT) return LIMIT;
  if (value < -LIMIT) return -LIMIT;
  return value;
}

export function computePvAdjustedBreakdown(row, pvShift = 0, natActualMargin = 0) {
  const pv = isFinite(pvShift) ? 1 * (pvShift - natActualMargin) : 0;
  const totalVotes = totalVotesFromRow(row);

  let dVotesBase = Math.max(0, +row.dVotes || 0);
  let rVotesBase = Math.max(0, +row.rVotes || 0);

  let totalThirdVotes = +row.tVotes;
  if (!isFinite(totalThirdVotes) || totalThirdVotes < 0) {
    totalThirdVotes = Math.max(0, totalVotes - dVotesBase - rVotesBase);
  }
  if (totalVotes > 0) totalThirdVotes = Math.min(totalVotes, totalThirdVotes);
  else totalThirdVotes = 0;

  let topThirdVotes = +row.topThirdVotes;
  if (!isFinite(topThirdVotes) || topThirdVotes < 0) topThirdVotes = totalThirdVotes;
  topThirdVotes = Math.max(0, Math.min(totalThirdVotes, topThirdVotes));

  const otherThirdVotes = Math.max(0, totalThirdVotes - topThirdVotes);
  const twoPartyVotes = Math.max(0, totalVotes - totalThirdVotes);

  const twoPartyDenom = twoPartyVotes > Number.EPSILON ? twoPartyVotes : 0;
  let baseDShareTwoParty = twoPartyDenom > 0 ? dVotesBase / twoPartyDenom : 0.5;
  if (!isFinite(baseDShareTwoParty)) baseDShareTwoParty = 0.5;
  baseDShareTwoParty = Math.max(0, Math.min(1, baseDShareTwoParty));

  const baseMargin = clampMargin(2 * baseDShareTwoParty - 1);
  const targetMargin = clampMargin(baseMargin + pv);
  const targetDShareTwoParty = (targetMargin + 1) / 2;
  const targetRShareTwoParty = 1 - targetDShareTwoParty;

  const adjustedDVotes = twoPartyVotes * targetDShareTwoParty;
  const adjustedRVotes = twoPartyVotes * targetRShareTwoParty;

  return {
    totalVotes,
    dVotes: adjustedDVotes,
    rVotes: adjustedRVotes,
    twoPartyVotes,
    totalThirdVotes,
    topThirdVotes,
    otherThirdVotes,
    baseMargin,
    targetMargin,
    twoPartyShareOfTotal: totalVotes > Number.EPSILON ? twoPartyVotes / totalVotes : 0,
    topThirdShareOfTotal: totalVotes > Number.EPSILON ? topThirdVotes / totalVotes : 0,
    totalThirdShareOfTotal: totalVotes > Number.EPSILON ? totalThirdVotes / totalVotes : 0
  };
}

export function getUnitFinalVoteTotals(unit, opts) {
  try {
    if (!unit) return null;
    const options = opts || {};
    let year = (options.year != null && isFinite(options.year)) ? Number(options.year) : null;
    if (!isFinite(year) || year <= 0) {
      if (typeof window._curYear === 'number' && isFinite(window._curYear)) {
        year = window._curYear;
      } else {
        const yearEl = document.getElementById && document.getElementById('yearSlider');
        year = yearEl ? parseInt(yearEl.value, 10) : null;
      }
    }
    if (!isFinite(year) || year <= 0) return null;

    let pv = (options.pv != null && isFinite(options.pv)) ? Number(options.pv) : null;
    if (!isFinite(pv)) pv = (typeof window._curPv === 'number' && isFinite(window._curPv)) ? window._curPv : 0;

    const useActiveFlip = options.useActiveFlip !== false;
    const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
    if (!keyUnit) return null;

    const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
    if (!rows || !rows.length) return null;

    const row = rows.find(x => x.unit === keyUnit);
    if (!row) return null;

    const totalVotesRaw = totalVotesFromRow(row);
    if (!isFinite(totalVotesRaw) || totalVotesRaw <= 0) return null;

    const natMargin = (typeof window.getNatMargin === 'function') ? window.getNatMargin(year) : 0;
    const breakdown = computePvAdjustedBreakdown(row, pv, natMargin);

    let dVotes = Math.max(0, breakdown.dVotes);
    let rVotes = Math.max(0, breakdown.rVotes);
    let totalThirdVotes = Math.max(0, breakdown.totalThirdVotes);
    let topThirdVotes = Math.max(0, breakdown.topThirdVotes);
    let totalVotes = Math.max(0, breakdown.totalVotes || totalVotesRaw);

    if (totalThirdVotes < topThirdVotes) totalThirdVotes = topThirdVotes;

    if (useActiveFlip) {
      const flipped = (typeof window.isUnitFlipped === 'function') ? window.isUnitFlipped(year, keyUnit) : false;
      const activeFlip = window._activeFlip && window._activeFlip.year === year ? window._activeFlip : null;
      if (flipped && activeFlip && Array.isArray(activeFlip.units)) {
        const flipUnit = activeFlip.units.find(u => u.unit === keyUnit);
        if (flipUnit && flipUnit.votes_to_flip) {
          const votesToFlip = Math.max(0, +flipUnit.votes_to_flip || 0);
          if (votesToFlip > 0) {
            if (dVotes >= rVotes) {
              dVotes = Math.max(0, dVotes - votesToFlip);
              rVotes = rVotes + votesToFlip;
            } else {
              dVotes = dVotes + votesToFlip;
              rVotes = Math.max(0, rVotes - votesToFlip);
            }
          }
        }
      }
    }

    return {
      dVotes,
      rVotes,
      topThirdVotes,
      totalThirdVotes,
      totalVotes
    };
  } catch (e) {
    // conservative: do not throw
    return null;
  }
}

// A simple proportional EV allocator used for tooltip previews. It is intentionally
// lightweight: it reads the unit EV total (getEvFor) and divides EVs by two-party
// shares computed from the adjusted PV model. It returns an object with integer
// EV counts (D, R, O) and an empty thirdParties map for compatibility.
export function calculateUnitProportionalEVs(unit, opts) {
  try {
    const year = (opts && isFinite(opts.year)) ? opts.year : (typeof window._curYear === 'number' ? window._curYear : null);
    if (!year) return null;
    const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
    const ev = (typeof window.getEvFor === 'function') ? window.getEvFor(year, keyUnit) : null;
    if (!isFinite(ev) || ev <= 0) return null;

    const totals = getUnitFinalVoteTotals(unit, opts) || null;
    if (!totals) return null;

    const dShare = totals.dVotes || 0;
    const rShare = totals.rVotes || 0;
    const oShare = totals.totalThirdVotes || 0;
    const denom = Math.max(Number.EPSILON, dShare + rShare + oShare);

    let dEV = Math.round((dShare / denom) * ev);
    let rEV = Math.round((rShare / denom) * ev);
    let oEV = Math.round((oShare / denom) * ev);

    // Adjust totals to ensure sum equals ev
    let sum = dEV + rEV + oEV;
    if (sum !== ev) {
      // give or take difference to largest share
      const shares = [{ k: 'd', v: dShare }, { k: 'r', v: rShare }, { k: 'o', v: oShare }];
      shares.sort((a, b) => b.v - a.v);
      const largest = shares[0] && shares[0].k;
      const diff = ev - sum;
      if (largest === 'd') dEV += diff;
      else if (largest === 'r') rEV += diff;
      else oEV += diff;
    }

    return { D: dEV, R: rEV, O: oEV, thirdParties: {} };
  } catch (e) { return null; }
}

export function calculateUnitVoteTallies(unit) {
  try {
    // Defer to the getUnitFinalVoteTotals and election-night snapshot when present
    const isIndexPage = window.location && (window.location.pathname && (window.location.pathname.endsWith('index.html') || window.location.pathname === '/'));
    if (!isIndexPage) return null;

    let year = (typeof window._curYear === 'number' && isFinite(window._curYear)) ? window._curYear : null;
    if (!isFinite(year)) {
      const yearEl = document.getElementById && document.getElementById('yearSlider');
      year = yearEl ? parseInt(yearEl.value, 10) : null;
    }
    const pv = window._curPv || 0;
    if (!year || year > 2024) return null;

    const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;

    if (window._electionNightActive && window._electionNightSnapshot) {
      const snapshot = window._electionNightSnapshot;
      const abbr = (typeof keyUnit === 'string' && keyUnit.length >= 2) ? keyUnit.slice(0, 2) : null;
      const candidates = [];
      if (unit && !candidates.includes(unit)) candidates.push(unit);
      if (keyUnit && !candidates.includes(keyUnit)) candidates.push(keyUnit);
      if (abbr && !candidates.includes(abbr)) candidates.push(abbr);

      let snap = null;
      for (const candidate of candidates) {
        if (candidate && snapshot.has(candidate)) {
          snap = snapshot.get(candidate);
          if (snap) break;
        }
      }
      if (snap) {
        const dVotes = snap.dVotes || 0;
        const rVotes = snap.rVotes || 0;
        const oVotes = snap.oVotes || 0;
        const total = dVotes + rVotes + oVotes;
        if (total <= 0) return null;
        try {
          const ab = (typeof keyUnit === 'string' && keyUnit.length >= 2) ? keyUnit.slice(0, 2) : null;
          if (year === 1948 && ab === 'AL') {
            return { D: 0, R: Math.round(rVotes), O: Math.round(oVotes), total: Math.round(rVotes + oVotes) };
          }
        } catch (e) { }
        return { D: Math.round(dVotes), R: Math.round(rVotes), O: Math.round(oVotes), total: Math.round(total) };
      }
    }

    const totals = getUnitFinalVoteTotals(unit, { year, pv });
    if (!totals) return null;

    // If PV is set to the national actual margin (the 'Actual' PV setting),
    // prefer raw CSV vote counts from the parsed rows rather than the
    // PV-adjusted breakdown. This ensures close states show the exact
    // tallies from `presidential_margins.csv` when the PV slider is set to
    // Actual.
    try {
      const natMargin = (typeof window.getNatMargin === 'function') ? window.getNatMargin(year) : 0;
      const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
      if (isFinite(natMargin) && isFinite(pv) && rows && rows.length && Math.abs(pv - natMargin) < 1e-12) {
        const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
        const row = rows.find(x => x && x.unit === keyUnit);
        if (row) {
          const dRaw = Math.round(Math.max(0, +row.dVotes || 0));
          const rRaw = Math.round(Math.max(0, +row.rVotes || 0));
          const oRaw = Math.round(Math.max(0, (+row.topThirdVotes || +row.tVotes || 0)));
          console.log('calculateUnitVoteTallies: returning RAW CSV counts for', unit, { D: dRaw, R: rRaw, O: oRaw });
          return { D: dRaw, R: rRaw, O: oRaw, total: dRaw + rRaw + oRaw };
        }
      }
    } catch (e) { /* non-fatal; fall through to adjusted totals */ }

    const dRounded = Math.round(Math.max(0, totals.dVotes || 0));
    const rRounded = Math.round(Math.max(0, totals.rVotes || 0));
    const oRounded = Math.round(Math.max(0, totals.topThirdVotes || 0));

    try {
      const keyU = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
      const ab = (typeof keyU === 'string' && keyU.length >= 2) ? keyU.slice(0, 2) : null;
      if (year === 1948 && ab === 'AL') {
        const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
        const row = (rows && rows.length) ? rows.find(x => x.unit === (keyU || unit)) : null;
        let rawR = rRounded;
        let rawO = oRounded;
        if (row) {
          rawR = Math.round(Math.max(0, +row.rVotes || 0));
          rawO = Math.round(Math.max(0, (+row.topThirdVotes || +row.tVotes || oRounded || 0)));
        }
        return { D: 0, R: rawR, O: rawO, total: rawR + rawO };
      }
    } catch (e) { }

    return { D: dRounded, R: rRounded, O: oRounded, total: dRounded + rRounded + oRounded };
  } catch (e) { return null; }
}

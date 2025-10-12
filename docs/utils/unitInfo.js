'use strict';
import { isUnitFlipped } from "./flipScenarios.js";
import { totalVotesFromRow, clampMargin, computePvAdjustedBreakdown } from "./voteMath.js";
import { shouldAggregateAtLarge, getAtLargeAdjustedTotals } from "./atLargeAggregator.js";
// Small shared utilities for unit-level vote/EV computations.
// These are intentionally conservative and read other project helpers from
// the global window (e.g. getRowsForYear, getEvFor, _curYear, _curPv).

export { totalVotesFromRow, clampMargin, computePvAdjustedBreakdown };

export function getNatMargin(year, sourceMap) {
    try {
        const y = (typeof year === 'number' && isFinite(year)) ? Number(year) : parseInt(year, 10);
        if (!isFinite(y)) return 0;

        let map = sourceMap;
        if (!map && typeof window !== 'undefined' && window._byYearMap instanceof Map) {
            map = window._byYearMap;
        }

        let rows = null;
        if (map && typeof map.get === 'function') {
            rows = map.get(y) || [];
        } else if (typeof window !== 'undefined' && typeof window.getRowsForYear === 'function') {
            rows = window.getRowsForYear(y) || [];
        }

        if (!rows || rows.length === 0) return 0;

        for (const r of rows) {
            if (!r) continue;
            const unit = r.unit;
            if (unit === 'NATIONAL' || unit === 'NAT') {
                const nmVal = Number(r.nm);
                if (isFinite(nmVal)) return nmVal;
                const alt = Number(r.national_margin);
                if (isFinite(alt)) return alt;
                break;
            }
        }

        let sum = 0;
        let count = 0;
        for (const r of rows) {
            if (!r) continue;
            const nmVal = Number(r.nm);
            if (isFinite(nmVal)) {
                sum += nmVal;
                count += 1;
            }
        }
        return count > 0 ? (sum / count) : 0;
    } catch (e) {
        return 0;
    }
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

        if (shouldAggregateAtLarge(year, keyUnit)) {
            const aggregated = getAtLargeAdjustedTotals(year, keyUnit, { pv, useActiveFlip });
            if (aggregated) {
                return {
                    dVotes: aggregated.dVotes,
                    rVotes: aggregated.rVotes,
                    topThirdVotes: aggregated.topThirdVotes,
                    totalThirdVotes: aggregated.totalThirdVotes,
                    totalVotes: aggregated.totalVotes
                };
            }
        }

        const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
        if (!rows || !rows.length) return null;

        const row = rows.find(x => x.unit === keyUnit);
        if (!row) return null;

        const totalVotesRaw = totalVotesFromRow(row);
        if (!isFinite(totalVotesRaw) || totalVotesRaw <= 0) return null;

        const natMargin = (typeof window._getNatMargin === 'function') ? window._getNatMargin(year) : ((typeof window.getNatMargin === 'function') ? window.getNatMargin(year) : 0);
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

// Winner-take-all EV allocator: returns all EVs to the party with the
// highest vote tally according to calculateUnitVoteTallies / getUnitFinalVoteTotals.
export function calculateUnitWinnerTakeAllEVs(unit, opts) {
    try {
        const year = (opts && isFinite(opts.year)) ? opts.year : (typeof window._curYear === 'number' ? window._curYear : null);
        if (!year) return null;
        const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
        const ev = (typeof window.getEvFor === 'function') ? window.getEvFor(year, keyUnit) : null;
        if (!isFinite(ev) || ev <= 0) return null;

        // Prefer election-night/raw tallies when available via calculateUnitVoteTallies
        let tallies = null;
        try { if (typeof calculateUnitVoteTallies === 'function') tallies = calculateUnitVoteTallies(unit); } catch (e) { tallies = null; }
        if (!tallies) {
            const totals = getUnitFinalVoteTotals(unit, { year, pv: (opts && opts.pv != null) ? opts.pv : (typeof window._curPv === 'number' ? window._curPv : 0) });
            if (totals) tallies = { D: Math.round(Math.max(0, totals.dVotes || 0)), R: Math.round(Math.max(0, totals.rVotes || 0)), O: Math.round(Math.max(0, totals.topThirdVotes || 0)), total: Math.round(totals.totalVotes || 0) };
        }
        if (!tallies) return null;

        // Determine winner (highest share). In ties, prefer D then R then O deterministically.
        const d = Number(tallies.D || 0);
        const r = Number(tallies.R || 0);
        const o = Number(tallies.O || 0);
        let alloc = { D: 0, R: 0, O: 0, thirdParties: {} };
        if (d >= r && d >= o) alloc.D = ev;
        else if (r >= d && r >= o) alloc.R = ev;
        else alloc.O = ev;
        return alloc;
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
        if (!totals) { console.log('calculateUnitVoteTallies: no totals found for', unit); return null; }

        // If PV is set to the national actual margin (the 'Actual' PV setting),
        // prefer raw CSV vote counts from the parsed rows rather than the
        // PV-adjusted breakdown. This ensures close states show the exact
        // tallies from `presidential_margins.csv` when the PV slider is set to
        // Actual.
        try {
            const natMargin = (typeof window._getNatMargin === 'function') ? window._getNatMargin(year) : ((typeof window.getNatMargin === 'function') ? window.getNatMargin(year) : 0);
            const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
            if (isFinite(natMargin) && isFinite(pv) && rows && rows.length && Math.abs(pv - natMargin) < 1e-9) {
                if (window.DEBUG_TOOLTIP) console.log('calculateUnitVoteTallies: PV equals natMargin, using raw CSV counts for', unit, { pv, natMargin });
                const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
                const row = rows.find(x => x && x.unit === keyUnit);
                if (row) {
                    // If this unit is flipped in the active scenario, prefer the
                    // flipped/adjusted totals from getUnitFinalVoteTotals so the
                    // tooltip reflects the scenario. Otherwise, return raw CSV counts.
                    let useAdjustedForFlip = false;
                    try {
                        const keyU = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
                        const flipped = (typeof isUnitFlipped === 'function') ? isUnitFlipped(year, keyU) : (typeof window.isUnitFlipped === 'function' ? window.isUnitFlipped(year, keyU) : false);
                        useAdjustedForFlip = !!flipped;
                    } catch (e) { useAdjustedForFlip = false; }

                    if (useAdjustedForFlip) {
                        try {
                            const totals = getUnitFinalVoteTotals(unit, { year, pv });
                            if (totals) {
                                const dAdj = Math.round(Math.max(0, totals.dVotes || 0));
                                const rAdj = Math.round(Math.max(0, totals.rVotes || 0));
                                const oAdj = Math.round(Math.max(0, totals.topThirdVotes || 0));
                                if (window.DEBUG_TOOLTIP) console.log('calculateUnitVoteTallies: returning ADJUSTED counts for flipped unit', unit, { D: dAdj, R: rAdj, O: oAdj });
                                return { D: dAdj, R: rAdj, O: oAdj, total: dAdj + rAdj + oAdj };
                            }
                        } catch (e) { /* fallthrough to raw */ }
                    }

                    const dRaw = Math.round(Math.max(0, +row.dVotes || 0));
                    const rRaw = Math.round(Math.max(0, +row.rVotes || 0));
                    const oRaw = Math.round(Math.max(0, (+row.topThirdVotes || +row.tVotes || 0)));
                    if (window.DEBUG_TOOLTIP) console.log('calculateUnitVoteTallies: returning RAW CSV counts for', unit, { D: dRaw, R: rRaw, O: oRaw });
                    return { D: dRaw, R: rRaw, O: oRaw, total: dRaw + rRaw + oRaw };
                }
                else { console.log('calculateUnitVoteTallies: no matching row found for', unit); }
            }
            // else {
            //     console.log('calculateUnitVoteTallies: PV not equal to natMargin, using adjusted totals for', unit, { pv, natMargin }, 'diff: (pv - natMargin) =', (pv - natMargin));
            // }
        } catch (e) { console.warn(e); }

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

// Backwards-compatibility: expose functions to the global `window` so
// legacy code (tooltipManager.js and other inline scripts) can call them
// as globals instead of importing the module.
try {
    if (typeof window !== 'undefined') {
        try { window.getNatMargin = getNatMargin; } catch (e) { }
        try { window._getNatMargin = getNatMargin; } catch (e) { }
        try { window.calculateUnitProportionalEVs = calculateUnitProportionalEVs; } catch (e) { }
        try { window.calculateUnitWinnerTakeAllEVs = calculateUnitWinnerTakeAllEVs; } catch (e) { }
        try { window.calculateUnitVoteTallies = calculateUnitVoteTallies; } catch (e) { }
        try { window.getUnitFinalVoteTotals = getUnitFinalVoteTotals; } catch (e) { }
        try { window.totalVotesFromRow = totalVotesFromRow; } catch (e) { }
    }
} catch (e) { }

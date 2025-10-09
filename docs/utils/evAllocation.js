'use strict';
import {
    getStateName
} from './constants.js';
import { totalVotesFromRow, computePvAdjustedBreakdown } from './unitInfo.js';
import { isUnitFlipped } from './flipScenarios.js';
export function allocateProportionalEVs(dVotes, rVotes, oVotes, totalEVs, topThirdPartyShare, thirdPartyResults) {
    // Proportional EV allocation function using largest remainder method
    // Now supports multiple third parties via thirdPartyResults object
    const total = dVotes + rVotes + oVotes;
    if (total <= 0 || totalEVs <= 0) return { D: 0, R: 0, O: 0, thirdParties: {} };

    // When thirdPartyResults is provided and has multiple parties, split third party votes proportionally
    const thirdParties = {};
    let hasMultipleThirdParties = false;

    if (thirdPartyResults && typeof thirdPartyResults === 'object') {
        const thirdPartyEntries = Object.entries(thirdPartyResults).filter(([name, votes]) => {
            // Filter out "Other(s)"
            return name !== 'Other' && name !== 'Others';
        });
        if (thirdPartyEntries.length > 0) {
            hasMultipleThirdParties = thirdPartyEntries.length > 1;

            // Calculate quotas for each party including third parties
            const parties = [
                { name: 'D', votes: dVotes },
                { name: 'R', votes: rVotes }
            ];

            // Add each third party
            thirdPartyEntries.forEach(([name, votes]) => {
                parties.push({ name: name, votes: +votes || 0, isThirdParty: true });
            });

            // Calculate quotas using largest remainder method
            const allocated = {};
            let totalAllocated = 0;
            const remainders = [];

            parties.forEach(p => {
                const share = p.votes / total;
                const quota = Math.floor(share * totalEVs);
                const remainder = (share * totalEVs) - quota;

                if (p.isThirdParty) {
                    thirdParties[p.name] = quota;
                } else {
                    allocated[p.name] = quota;
                }
                totalAllocated += quota;
                remainders.push({ name: p.name, remainder, isThirdParty: p.isThirdParty });
            });

            // Allocate remaining EVs
            let remaining = totalEVs - totalAllocated;
            remainders.sort((a, b) => b.remainder - a.remainder);

            for (let i = 0; i < remaining && i < remainders.length; i++) {
                const r = remainders[i];
                if (r.isThirdParty) {
                    thirdParties[r.name] = (thirdParties[r.name] || 0) + 1;
                } else {
                    allocated[r.name] = (allocated[r.name] || 0) + 1;
                }
            }

            return {
                D: allocated.D || 0,
                R: allocated.R || 0,
                O: 0, // Not used when we have detailed third parties
                thirdParties: thirdParties
            };
        }
    }

    // Fallback to simple D/R/O allocation when no detailed third party data
    const dShare = dVotes / total;
    const rShare = rVotes / total;
    const oShare = oVotes / total;

    const dQuota = Math.floor(dShare * totalEVs);
    const rQuota = Math.floor(rShare * totalEVs);
    const oQuota = Math.floor(oShare * totalEVs);

    let allocated = { D: dQuota, R: rQuota, O: oQuota };
    let remaining = totalEVs - (dQuota + rQuota + oQuota);

    if (remaining > 0) {
        const remainders = [
            { party: 'D', remainder: (dShare * totalEVs) - dQuota },
            { party: 'R', remainder: (rShare * totalEVs) - rQuota },
            { party: 'O', remainder: (oShare * totalEVs) - oQuota }
        ];

        remainders.sort((a, b) => b.remainder - a.remainder);

        for (let i = 0; i < remaining; i++) {
            allocated[remainders[i].party]++;
        }
    }

    return { ...allocated, thirdParties: {} };
}

export function isProportionalEvMode() {
    try {
        const toggle = document.getElementById('propEvToggle');
        return toggle && toggle.checked;
    } catch (e) {
        return false;
    }
}

// Calculate proportional EV allocation for a specific unit
// Returns {D: number, R: number, O: number, thirdParties: {}} or null if proportional mode is off
export function calculateUnitProportionalEVs(unit) {
    try {
        if (!isProportionalEvMode()) return null;

        const year = window._curYear;
        const pv = window._curPv || 0;
        if (!year) return null;

        const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
        const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
        if (!rows || !rows.length) return null;

        const r = rows.find(x => x.unit === keyUnit);
        if (!r) return null;

        const ev = +r.ev || 0;
        if (ev <= 0) return null;

        const activeFlip = window._activeFlip && window._activeFlip.year === year ? window._activeFlip : null;
        const flipped = isUnitFlipped(year, keyUnit);

        if (flipped && activeFlip && activeFlip.units) {
            const flipUnit = activeFlip.units.find(u => u.unit === keyUnit);
            if (flipUnit && flipUnit.votes_to_flip) {
                let dVotesBase = Math.max(0, +r.dVotes || 0);
                let rVotesBase = Math.max(0, +r.rVotes || 0);
                let tVotesBase = Math.max(0, +r.tVotes || 0);
                const votesToFlip = Math.max(0, +flipUnit.votes_to_flip || 0);
                if (dVotesBase >= rVotesBase) {
                    dVotesBase = Math.max(0, dVotesBase - votesToFlip);
                    rVotesBase = rVotesBase + votesToFlip;
                } else {
                    dVotesBase = dVotesBase + votesToFlip;
                    rVotesBase = Math.max(0, rVotesBase - votesToFlip);
                }
                const topThirdShare = totalVotesFromRow(r) > 0 ? (Math.max(0, +r.topThirdVotes || 0) / totalVotesFromRow(r)) : 0;
                return allocateProportionalEVs(dVotesBase, rVotesBase, Math.max(0, tVotesBase), ev, topThirdShare, r.thirdPartyResults);
            }
        }
        // console.log('Calculating proportional EVs for', keyUnit, 'with PV shift', pv);
        const natForYear = (typeof window._getNatMargin === 'function') ? window._getNatMargin(year) : 0;
        const breakdown = computePvAdjustedBreakdown(r, pv, natForYear);
        let dVotes = Math.max(0, breakdown.dVotes);
        let rVotes = Math.max(0, breakdown.rVotes);
        let tVotes = Math.max(0, breakdown.totalThirdVotes);

        if (flipped && activeFlip && activeFlip.units) {
            const flipUnit = activeFlip.units.find(u => u.unit === keyUnit);
            if (flipUnit && flipUnit.votes_to_flip) {
                const votesToFlip = Math.max(0, +flipUnit.votes_to_flip || 0);
                if (dVotes >= rVotes) {
                    dVotes = Math.max(0, dVotes - votesToFlip);
                    rVotes = rVotes + votesToFlip;
                } else {
                    dVotes = dVotes + votesToFlip;
                    rVotes = Math.max(0, rVotes - votesToFlip);
                }
            }
        }

        const topThirdShare = breakdown.topThirdShareOfTotal;
        // Capture allocation result so we can log it for 1960 (compare with map/election-night)
        const allocResult = allocateProportionalEVs(dVotes, rVotes, tVotes, ev, topThirdShare, r.thirdPartyResults);

        // try {
        //   if (year === 1960) {
        //     console.log('[EV-TRACE] calculateUnitProportionalEVs', { year, keyUnit, ev, dVotes, rVotes, tVotes, thirdPartyResults: r.thirdPartyResults, allocResult });
        //   }
        // } catch(e) {}

        return allocResult;
    } catch (e) {
        return null;
    }
}

export   // Get EV allocations for all states
    function getAllEvAllocations() {
    const year = window._curYear;
    if (!year) return [];

    const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
    if (!rows || !rows.length) return [];

    const isProportional = (() => {
        try {
            const toggle = document.getElementById('propEvToggle');
            return toggle && toggle.checked;
        } catch (e) {
            return false;
        }
    })();

    const isElectionNight = window._electionNightActive || false;
    const snapshot = window._electionNightSnapshot || null;

    const allocations = [];

    // Get all unique state/unit codes (excluding NATIONAL)
    const processedStates = new Set();
    rows.forEach(r => {
        if (!r || !r.unit) return;
        const unit = r.unit;

        // Skip national totals
        if (unit === 'NATIONAL' || unit === 'NAT') return;

        // Use the unit as-is for display (including ME-01, ME-02, NE-01, NE-02, NE-03)
        let displayUnit = unit;

        // Skip duplicates
        if (processedStates.has(displayUnit)) return;
        processedStates.add(displayUnit);

        const ev = +r.ev || 0;
        if (ev <= 0) return;

        // Get state name
        const stateName = getStateName(displayUnit);

        // Initialize allocation
        let dEV = 0, rEV = 0, oEV = 0;
        let thirdPartyEVs = {}; // Store individual third party EVs
        let showBlank = false;
        let dVotes = 0, rVotes = 0, oVotes = 0;

        // Check if we should show blank (election night mode)
        if (isElectionNight && snapshot) {
            // snapshot is a Map, get the state data by unit key
            const stateData = snapshot.get(displayUnit);
            if (stateData) {
                const called = stateData.called || false;
                const reporting = stateData.reporting || 0;

                // Show blank if not called or not 100% counted
                if (!called || reporting < 0.999) {
                    showBlank = true;
                } else {
                    // Use election night vote counts
                    dVotes = stateData.dVotes || 0;
                    rVotes = stateData.rVotes || 0;
                    oVotes = stateData.oVotes || 0;
                }
            } else {
                showBlank = true;
            }
        }

        // Calculate allocations if not blank
        if (!showBlank) {
            // Special case: Alabama 1960 and Mississippi 1960 - always use fixed allocation
            if (year === 1960 && (displayUnit === 'AL' || displayUnit === 'MS')) {
                // Check winner with PV adjustment (use >= 0 to match map logic)
                const margin = +r.rm || 0;
                const pv = window._curPv || 0;
                const adjMargin = margin + pv;
                const winner = adjMargin >= 0 ? 'D' : 'R';  // Match map's m >= 0 check

                if (winner !== 'R') {
                    // Democrats/Third party win: use the special fixed split
                    if (displayUnit === 'AL') {
                        dEV = 5;  // Alabama: 5D, 6O
                        oEV = 6;
                    } else {
                        dEV = 0;  // Mississippi: 0D, 8O
                        oEV = 8;
                    }
                } else {
                    // Republicans win: normal winner-take-all
                    rEV = ev;
                }

                // Get vote counts
                if (!isElectionNight) {
                    dVotes = +r.dVotes || 0;
                    rVotes = +r.rVotes || 0;
                    oVotes = +r.tVotes || 0;
                }
            } else if (isProportional) {
                // Use proportional allocation
                // Get base vote counts for BOTH EV allocation AND margin display
                const baseD = +r.dVotes || 0;
                const baseR = +r.rVotes || 0;
                const baseO = +r.tVotes || 0;

                // Store the original votes for margin display (before PV adjustment)
                dVotes = baseD;
                rVotes = baseR;
                oVotes = baseO;

                if (!isElectionNight) {
                    // Apply PV adjustment ONLY for EV allocation calculation
                    const pv = window._curPv || 0;
                    const total = +r.total || (baseD + baseR + baseO) || 0;
                    let dVotesAdj = baseD;
                    let rVotesAdj = baseR;
                    let oVotesAdj = baseO;

                    if (total > 0 && pv !== 0) {
                        // Apply uniform swing adjustment for EV allocation
                        const rm = +r.rm || 0;
                        const adjMargin = rm + pv;
                        const tp = Math.max(0, Math.min(1, (r.thirdShare != null ? +r.thirdShare : +r.tp) || 0));

                        // Calculate adjusted two-party share
                        let twoD = 0.5 + adjMargin / 2;
                        twoD = Math.max(0, Math.min(1, twoD));

                        const dShare = (1 - tp) * twoD;
                        const rShare = (1 - tp) * (1 - twoD);
                        const oShare = tp;

                        dVotesAdj = total * dShare;
                        rVotesAdj = total * rShare;
                        oVotesAdj = total * oShare;
                    }

                    // Allocate EVs proportionally using adjusted votes
                    const allocFn = window.allocateProportionalEVs || function (d, r, o, ev) {
                        // Fallback if function not available
                        return { D: 0, R: 0, O: 0, thirdParties: {} };
                    };
                    const alloc = allocFn(dVotesAdj, rVotesAdj, oVotesAdj, ev, +r.tp || 0, r.thirdPartyResults);
                    dEV = alloc.D;
                    rEV = alloc.R;
                    oEV = alloc.O;
                    // Store third party allocations if they exist
                    thirdPartyEVs = alloc.thirdParties || {};
                }
            } else {
                // Winner-take-all - match map logic exactly
                const margin = +r.rm || 0;
                const pv = window._curPv || 0;
                const adjMargin = margin + pv;

                // Check if this is a third party winner (color = 'yellow')
                const isThirdPartyWinner = (r.color === 'yellow' || r.color === '#C9A400');

                if (isThirdPartyWinner) {
                    // Third party won - allocate all EVs to O
                    oEV = ev;
                } else {
                    // Normal two-party winner-take-all
                    // Match the map's logic from updateAll()
                    if (adjMargin > 0) {
                        dEV = ev;
                    } else if (adjMargin < 0) {
                        rEV = ev;
                    } else {
                        // Tie-breaking: match map's logic (line 2083-2085)
                        // Get national margin and stop value for tie-breaking
                        const nat = (typeof window._getNatMargin === 'function') ? window._getNatMargin(year) : 0;
                        const stopVal = pv;  // Current PV is the stop value
                        const side = Math.sign((stopVal || 0) - (nat || 0));
                        if (side >= 0) dEV = ev;
                        else rEV = ev;
                    }
                }

                // Get vote counts
                if (!isElectionNight) {
                    dVotes = +r.dVotes || 0;
                    rVotes = +r.rVotes || 0;
                    oVotes = +r.tVotes || 0;
                }
            }
        }

        // If there are Other EVs but we don't have a detailed thirdPartyEVs
        // mapping, infer a breakdown. However, when NOT in proportional mode
        // (winner-take-all), don't proportionally split O EVs across multiple
        // third-party names — instead give the entire O block to the single
        // top third-party candidate (by votes). Proportional splitting only
        // applies when proportional mode is active.
        if (!showBlank && oEV > 0 && Object.keys(thirdPartyEVs || {}).length === 0) {
            try {
                const tpVotes = (r.thirdPartyResults && typeof r.thirdPartyResults === 'object') ? r.thirdPartyResults : {};
                const tpNames = Object.keys(tpVotes).filter(n => (tpVotes[n] || 0) > 0);
                // If we're in proportional mode, keep the existing floor+largest-fractions
                // behavior to split O EVs among third parties.
                if (typeof isProportional !== 'undefined' && isProportional) {
                    if (tpNames.length > 0) {
                        const totalTpVotes = tpNames.reduce((s, n) => s + (+tpVotes[n] || 0), 0);
                        if (totalTpVotes > 0) {
                            // Proportionally assign integer EVs using floor+largest-fractions method
                            const floats = tpNames.map(name => {
                                const raw = (oEV * (+tpVotes[name] || 0)) / totalTpVotes;
                                return { name, raw, frac: raw - Math.floor(raw), assigned: Math.floor(raw) };
                            });
                            let assignedSum = floats.reduce((s, f) => s + f.assigned, 0);
                            let remaining = oEV - assignedSum;
                            // Sort by fractional part descending to distribute remainders fairly
                            floats.sort((a, b) => b.frac - a.frac);
                            let idx = 0;
                            while (remaining > 0 && floats.length > 0) {
                                floats[idx % floats.length].assigned += 1;
                                remaining -= 1;
                                idx += 1;
                            }
                            const allocMap = {};
                            floats.forEach(f => { if (f.assigned > 0) allocMap[f.name] = f.assigned; });
                            // If rounding produced no assignments (shouldn't), fall back to Other
                            thirdPartyEVs = Object.keys(allocMap).length ? allocMap : { Other: oEV };
                        } else {
                            // No vote totals for third parties, but names exist: give the whole
                            // O EV block to the first listed third party to at least surface a name
                            const map = {}; map[tpNames[0]] = oEV; thirdPartyEVs = map;
                        }
                    } else {
                        // No per-row third-party vote info available: fall back to generic
                        thirdPartyEVs = { Other: oEV };
                    }
                } else {
                    // Winner-take-all: give all O EVs to the top third-party candidate (if any)
                    if (tpNames.length > 0) {
                        // Find the third-party with the maximum votes
                        let topName = tpNames[0];
                        for (let i = 1; i < tpNames.length; i++) {
                            const n = tpNames[i];
                            if ((+tpVotes[n] || 0) > (+tpVotes[topName] || 0)) topName = n;
                        }
                        const map = {};
                        map[topName] = oEV;
                        thirdPartyEVs = map;
                    } else {
                        thirdPartyEVs = { Other: oEV };
                    }
                }
            } catch (e) {
                thirdPartyEVs = { Other: oEV };
            }
        }

        // Calculate vote percentages for margin column
        let dPct = 0, rPct = 0, oPct = 0;
        if (!showBlank && (dVotes > 0 || rVotes > 0 || oVotes > 0)) {
            const totalVotes = dVotes + rVotes + oVotes;
            if (totalVotes > 0) {
                dPct = (dVotes / totalVotes) * 100;
                rPct = (rVotes / totalVotes) * 100;
                oPct = (oVotes / totalVotes) * 100;
            }
        }

        allocations.push({
            state: displayUnit,
            stateName: stateName,
            dEV: showBlank ? null : dEV,
            rEV: showBlank ? null : rEV,
            oEV: showBlank ? null : oEV,
            thirdPartyEVs: showBlank ? {} : thirdPartyEVs, // Include third party EVs
            thirdPartyVotes: showBlank ? {} : (r.thirdPartyResults || {}), // Include third party votes for tooltips
            totalEV: ev,
            dVotes: showBlank ? null : dVotes,
            rVotes: showBlank ? null : rVotes,
            oVotes: showBlank ? null : oVotes,
            dPct: showBlank ? null : dPct,
            rPct: showBlank ? null : rPct,
            oPct: showBlank ? null : oPct,
            dCandidate: r.dCandidate || '', // Add candidate names
            rCandidate: r.rCandidate || '',
            showBlank: showBlank
        });
    });

    return allocations;
}

// Compute winner-take-all EV allocation for a specific unit.
// Returns {D: number, R: number, O: number, thirdParties: {}} or null if unavailable.
export function calculateUnitWinnerTakeAllEVs(unit) {
    try {
        const year = window._curYear;
        const pv = window._curPv || 0;
        if (!year) return null;

        const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
        const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
        if (!rows || !rows.length) return null;

        const r = rows.find(x => x.unit === keyUnit);
        if (!r) return null;

        const ev = +r.ev || 0;
        if (ev <= 0) return null;

        const isElectionNight = window._electionNightActive || false;
        const snapshot = window._electionNightSnapshot || null;

        let dEV = 0, rEV = 0, oEV = 0;

        // If election night snapshot present and usable, prefer that
        if (isElectionNight && snapshot) {
            const snap = snapshot.get(keyUnit) || snapshot.get(unit) || null;
            if (snap) {
                const called = !!snap.called;
                const reporting = (snap.reporting != null && isFinite(snap.reporting)) ? snap.reporting : 0;
                // If not called or not fully counted, we shouldn't show allocation here
                if (!called || reporting < 0.999) return null;

                const dVotes = snap.dVotes || 0;
                const rVotes = snap.rVotes || 0;
                const oVotes = snap.oVotes || 0;

                // third-party win if O has the plurality or color indicates third-party
                const isThirdPartyWinner = (oVotes > dVotes && oVotes > rVotes) || (r.color === 'yellow' || r.color === '#C9A400');
                if (isThirdPartyWinner) oEV = ev;
                else if (dVotes > rVotes) dEV = ev;
                else if (rVotes > dVotes) rEV = ev;
                else {
                    // tie: follow same tie-break as map: compare PV vs national margin
                    const nat = (typeof window._getNatMargin === 'function') ? window._getNatMargin(year) : 0;
                    const side = Math.sign((pv || 0) - (nat || 0));
                    if (side >= 0) dEV = ev; else rEV = ev;
                }
                if (unit === 'AL' && year === 1960) {
                    console.log('[EV-TRACE] 1960 AL special case in election night snapshot', { snap, dEV, rEV, oEV });
                }
                return { D: dEV, R: rEV, O: oEV, thirdParties: {} };
            }
            // If no snapshot for this unit, fall through to static row logic
        }

        // Non-election-night or no usable snapshot: use stored row data and PV-adjusted margin
        const margin = +r.rm || 0;
        const adjMargin = margin + pv;

        const isThirdPartyWinnerRow = (r.color === 'yellow' || r.color === '#C9A400');
        if (isThirdPartyWinnerRow) {
            oEV = ev;
        } else {
            if (adjMargin > 0) dEV = ev;
            else if (adjMargin < 0) rEV = ev;
            else {
                const nat = (typeof window._getNatMargin === 'function') ? window._getNatMargin(year) : 0;
                const side = Math.sign((pv || 0) - (nat || 0));
                if (side >= 0) dEV = ev; else rEV = ev;
            }
        }
        if (unit === 'AL' && year === 1960) {
            console.log('[EV-TRACE] 1960 AL special case in static row logic', { r, margin, pv, adjMargin, dEV, rEV, oEV });
            if (rEV === 0) {
                return { D: 5, R: 0, O: 6, thirdParties: {} }; // Special fixed split for 1960 AL if not R winner
            }
            else {
                return { D: 0, R: 11, O: 0, thirdParties: {} }; // Normal R winner-take-all 
            }
        }
        return { D: dEV, R: rEV, O: oEV, thirdParties: {} };
    } catch (e) {
        return null;
    }
}
'use strict';
import { getUnitFinalVoteTotals, calculateUnitVoteTallies } from './unitInfo.js';
import { calculateUnitProportionalEVs, calculateUnitWinnerTakeAllEVs, isProportionalEvMode } from './evAllocation.js';
import { EPS } from './constants.js';
import { leanStr, formatReportingText, formatConfidenceText } from './formatters.js';
import { isUnitFlipped } from './flipScenarios.js';
import { lastNameFrom, getUnitCandidateLastNames, deriveCandidateNames } from './candidateNames.js';

// Helper used by formatUnitTooltip to pick sensible candidate last names
function resolveCandidateNames(infoObj, unitKey) {
    try {
        // 1) If info contains explicit candidates object, derive from that
        if (infoObj && infoObj.candidates && typeof infoObj.candidates === 'object') {
            const candObj = infoObj.candidates || {};
            const out = { D: 'D', R: 'R', O: 'O' };
            try {
                if (candObj.D && candObj.D.name) {
                    const ln = lastNameFrom(String(candObj.D.name)); if (ln) out.D = ln;
                }
                if (candObj.R && candObj.R.name) {
                    const ln = lastNameFrom(String(candObj.R.name)); if (ln) out.R = ln;
                }
                if (candObj.O && candObj.O.name) {
                    const ln = lastNameFrom(String(candObj.O.name)); if (ln) out.O = ln;
                }
            } catch (e) { }
            return out;
        }
        // 2) Prefer simple per-party fields on info (dCandidate/rCandidate)
        if (infoObj) {
            const out = { D: 'D', R: 'R', O: 'O' };
            try {
                if (infoObj.dCandidate) {
                    const ln = lastNameFrom(String(infoObj.dCandidate)); if (ln) out.D = ln;
                }
                if (infoObj.rCandidate) {
                    const ln = lastNameFrom(String(infoObj.rCandidate)); if (ln) out.R = ln;
                }
                if (infoObj.thirdPartyResults && typeof infoObj.thirdPartyResults === 'object') {
                    const entries = Object.entries(infoObj.thirdPartyResults).map(([nm, v]) => ({ name: nm, votes: Number(v) || 0 }));
                    if (entries.length) {
                        entries.sort((a, b) => b.votes - a.votes);
                        const top = entries[0]; if (top && top.name) { const ln = lastNameFrom(String(top.name)); if (ln) out.O = ln; }
                    }
                }
            } catch (e) { }
            // If this produced anything other than placeholders, return it
            if (out.D !== 'D' || out.R !== 'R' || out.O !== 'O') return out;
        }
        // 3) Try the shared CSV helper that reads parsed rows
        try {
            const csvNames = getUnitCandidateLastNames(unitKey);
            if (csvNames && typeof csvNames === 'object') return csvNames;
        } catch (e) { }
    } catch (e) { }
    // Fallback placeholders
    return { D: 'D', R: 'R', O: 'O' };
}

export function _ensureTip() {
    const tip = document.getElementById('mapTip') || null;
    try { if (!tip) console.debug('[tooltipManager] _ensureTip: #mapTip not found'); } catch (e) { }
    return tip;
}
export function _placeTipAt(evt) {
    const tip = _ensureTip(); if (!tip) return;
    const wrap = _getMapWrap();
    const wr = wrap.getBoundingClientRect();
    const offsetX = 12, offsetY = 12;
    const clientX = (evt && evt.clientX != null) ? evt.clientX : (evt && evt.client && evt.clientX != null ? evt.client.clientX : null);
    const clientY = (evt && evt.clientY != null) ? evt.clientY : (evt && evt.client && evt.client.clientY != null ? evt.client.clientY : null);
    // Compute preferred placement depending on tooltip positioning mode.
    // If tooltip is fixed, place using viewport/client coordinates. Otherwise place relative to the map-wrap container.
    const prevDisplay = tip.style.display;
    if (prevDisplay === 'none') tip.style.display = 'block';
    const tr = tip.getBoundingClientRect();
    // Determine computed position style (fallback to inline style if computed not available)
    let computedPos = 'absolute';
    try {
        const cs = window.getComputedStyle ? window.getComputedStyle(tip) : null;
        if (cs && cs.position) computedPos = cs.position;
        else if (tip.style && tip.style.position) computedPos = tip.style.position;
    } catch (e) { }
    const pad = 6;

    if (prevDisplay === 'none') tip.style.display = prevDisplay;

    if (computedPos === 'fixed') {
        // Use client coordinates directly and clamp to viewport
        let x = (clientX != null ? (clientX + offsetX) : 0);
        let y = (clientY != null ? (clientY + offsetY) : 0);
        const vpW = (document.documentElement && document.documentElement.clientWidth) ? document.documentElement.clientWidth : window.innerWidth || 0;
        const vpH = (document.documentElement && document.documentElement.clientHeight) ? document.documentElement.clientHeight : window.innerHeight || 0;
        // Clamp using tooltip size so it doesn't overflow viewport
        x = Math.max(pad, Math.min(Math.max(0, vpW - pad - tr.width), x));
        y = Math.max(pad, Math.min(Math.max(0, vpH - pad - tr.height), y));
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
        return;
    }

    // Default: container-relative positioning (absolute within map-wrap)
    let x = (clientX != null ? (clientX - wr.left + offsetX) : 0);
    let y = (clientY != null ? (clientY - wr.top + offsetY) : 0);
    // Clamp within container using tooltip size
    x = Math.max(pad, Math.min(Math.max(0, wr.width - pad - tr.width), x));
    y = Math.max(pad, Math.min(Math.max(0, wr.height - pad - tr.height), y));
    // try { console.debug('[tooltipManager] _placeTipAt', { clientX: clientX, clientY: clientY, wrapRect: { left: wr.left, top: wr.top, width: wr.width, height: wr.height }, final: { x, y }, pos: computedPos }); } catch (e) { }
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
}
export function showMapTip(evt, text) {
    //try { console.debug('[tooltipManager] showMapTip called', { evt: evt && { clientX: evt.clientX, clientY: evt.clientY }, textSnippet: (text ? (String(text).slice(0, 120)) : text) }); } catch (e) { }
    try {
        const tip = _ensureTip(); if (!tip) return;
        // Handle multi-line tooltips by converting newlines to <br> tags
        const content = text != null ? String(text).replace(/\n/g, '<br>') : '';
        tip.innerHTML = content;
        tip.style.display = 'block';
        _placeTipAt(evt);
    } catch (e) { }
}
export function hideMapTip() {
    try {
        //try { console.debug('[tooltipManager] hideMapTip called'); } catch (e) { }
        const tip = _ensureTip();
        if (tip) tip.style.display = 'none';
    } catch (e) { }
    _setActiveTip(null);
}

export function createUnitTipInfo(unit, opts) {
    const options = { ...(opts || {}) };
    return {
        unit,
        options,
        clientX: null,
        clientY: null,
        getText: function () { return formatUnitTooltip(unit, options); }
    };
}

export function formatUnitTooltip(unit, opts) {
    try {
        const options = opts || {};
        if (options.staticText != null) return options.staticText;
        const display = options.label || unit;
        const info = (typeof window.getAdjustedInfo === 'function') ? window.getAdjustedInfo(unit) : null;
        let ev = options.evOverride;
        if (info && info.ev != null && !isNaN(info.ev)) ev = info.ev;
        //console.log('formatUnitTooltip', { unit, info, ev, options });
        // Prepare marginStr handling. marginOverride may be a string or a function
        let marginStr = '';
        const marginOverride = options.marginOverride;
        if (typeof marginOverride !== 'undefined' && typeof marginOverride !== 'function') marginStr = marginOverride;
        // if info provides a static marginStr (string), prefer it for now
        if (info && info.marginStr && typeof info.marginStr !== 'function') marginStr = info.marginStr;
        //console.log('formatUnitTooltip marginStr (pre-voteTallies)', marginStr);

        // Build tooltip content with multiple rows. We'll assemble rows after computing vote tallies
        const rows = [];

        // Second row: EV allocation (for proportional mode)
        const evAllocation = (function () {
            const electionNightActive = !!window._electionNightActive;
            const reportingVal = (info && info.reporting != null) ? Number(info.reporting) : null;
            const fullyCounted = (reportingVal != null && isFinite(reportingVal)) ? (reportingVal >= 0.999) : false;
            if (electionNightActive && !fullyCounted) return null;
            // Only compute EV allocations when appropriate for the current mode.
            if (typeof isProportionalEvMode === 'function' && isProportionalEvMode()) {
                const alloc = (typeof calculateUnitProportionalEVs === 'function') ? calculateUnitProportionalEVs(unit) : null;
                return alloc;
            }
            // When not in proportional mode, show winner-take-all allocation (based on PV-adjusted winner or snapshot).
            const wta = (typeof calculateUnitWinnerTakeAllEVs === 'function') ? calculateUnitWinnerTakeAllEVs(unit) : null;
            if (unit === 'AL' && window._curYear === 1960) {
                console.log('[EV-TRACE] 1960 AL special case in tooltip WTA allocation', { unit, ev, evAllocation: wta });
            }
            return wta;
        })();
        if (evAllocation) {
            const evParts = [];
            // Resolve candidate last names for labels (prefer snapshot/info, then derived helpers, then CSV map)
            function resolveCandidateNames(infoObj, unitKey) {
                try {
                    // 1) If info contains explicit candidates object, derive from that
                    if (infoObj && infoObj.candidates && typeof infoObj.candidates === 'object') {
                        const candObj = infoObj.candidates || {};
                        const out = { D: 'D', R: 'R', O: 'O' };
                        try {
                            if (candObj.D && candObj.D.name) {
                                const ln = lastNameFrom(String(candObj.D.name)); if (ln) out.D = ln;
                            }
                            if (candObj.R && candObj.R.name) {
                                const ln = lastNameFrom(String(candObj.R.name)); if (ln) out.R = ln;
                            }
                            if (candObj.O && candObj.O.name) {
                                const ln = lastNameFrom(String(candObj.O.name)); if (ln) out.O = ln;
                            }
                        } catch (e) { }
                        return out;
                    }
                    // 2) Prefer simple per-party fields on info (dCandidate/rCandidate)
                    if (infoObj) {
                        const out = { D: 'D', R: 'R', O: 'O' };
                        try {
                            if (infoObj.dCandidate) {
                                const ln = lastNameFrom(String(infoObj.dCandidate)); if (ln) out.D = ln;
                            }
                            if (infoObj.rCandidate) {
                                const ln = lastNameFrom(String(infoObj.rCandidate)); if (ln) out.R = ln;
                            }
                            if (infoObj.thirdPartyResults && typeof infoObj.thirdPartyResults === 'object') {
                                const entries = Object.entries(infoObj.thirdPartyResults).map(([nm, v]) => ({ name: nm, votes: Number(v) || 0 }));
                                if (entries.length) {
                                    entries.sort((a, b) => b.votes - a.votes);
                                    const top = entries[0]; if (top && top.name) { const ln = lastNameFrom(String(top.name)); if (ln) out.O = ln; }
                                }
                            }
                        } catch (e) { }
                        // If this produced anything other than placeholders, return it
                        if (out.D !== 'D' || out.R !== 'R' || out.O !== 'O') return out;
                    }
                    // 3) Try the shared CSV helper that reads parsed rows
                    try {
                        const csvNames = getUnitCandidateLastNames(unitKey);
                        if (csvNames && typeof csvNames === 'object') return csvNames;
                    } catch (e) { }
                } catch (e) { }
                // Fallback placeholders
                return { D: 'D', R: 'R', O: 'O' };
            }
            const evCandidateNames = resolveCandidateNames(info, unit);
            if (evAllocation.D > 0) evParts.push(`${(evCandidateNames && evCandidateNames.D) || 'D'}: ${evAllocation.D}`);
            if (evAllocation.R > 0) evParts.push(`${(evCandidateNames && evCandidateNames.R) || 'R'}: ${evAllocation.R}`);
            // Aggregate any "Other" EVs: include traditional O plus any detailed thirdParty allocations
            const detailed = evAllocation.thirdParties || {};
            let othersTotal = (evAllocation.O || 0);
            try {
                Object.values(detailed).forEach(v => { if (isFinite(v)) othersTotal += Number(v) || 0; });
            } catch (e) { console.error('Error aggregating third-party EVs:', e); }
            // try {
            //   if (window._curYear === 1960) {
            //     console.log('[EV-TRACE] tooltip evParts O aggregation', { unit, ev, evAllocation, detailed, othersTotal });
            //   }
            // } catch(e) {}
            if (othersTotal > 0) {
                // Try to display the top third-party's last name instead of a generic 'O'
                let topThirdLabel = null;
                try {
                    if (info && info.thirdPartyResults && typeof info.thirdPartyResults === 'object') {
                        const entries = Object.entries(info.thirdPartyResults).map(([nm, v]) => ({ name: nm, votes: Number(v) || 0 }));
                        if (entries.length) {
                            entries.sort((a, b) => b.votes - a.votes);
                            const top = entries[0];
                            if (top && top.name) topThirdLabel = lastNameFrom(String(top.name)) || String(top.name);
                        }
                    }
                } catch (e) { }
                const thirdLabel = topThirdLabel || (evCandidateNames && evCandidateNames.O) || 'O';
                evParts.push(`${thirdLabel}: ${othersTotal}`);
            }
            if (evParts.length) {
                // we'll push this later in the final assembly so the basic row stays first
                rows.push(evParts.join(' | '));
            }
        }
        // Third row: Vote tallies (for index.html - real elections only)
        const voteTallies = (typeof calculateUnitVoteTallies === 'function') ? calculateUnitVoteTallies(unit) : calculateUnitVoteTallies(unit);
        // Helper: derive a marginStr from raw vote tallies (leader vs runner-up, percent of two-party)
        function marginStrFromVoteTallies(vt) {
            try {
                const parts = [
                    { party: 'D', count: vt.D },
                    { party: 'R', count: vt.R },
                    { party: 'O', count: vt.O }
                ].filter(v => isFinite(v.count) && v.count > 0).sort((a, b) => b.count - a.count);
                if (parts.length < 2) return '';
                const top = parts[0], second = parts[1];
                const twoPartyTotal = top.count + second.count;
                if (!isFinite(twoPartyTotal) || twoPartyTotal <= 0) return '';
                const pct = (top.count - second.count) / twoPartyTotal * 100;
                const s = Math.abs(pct).toFixed(1);
                return `${top.party}+${s}`;
            } catch (e) { return ''; }
        }

        if (voteTallies) {
            const voteParts = [];
            const formatter = (x) => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '0';

            // Find the party with the highest vote tally
            const maxVotes = Math.max(voteTallies.D, voteTallies.R, voteTallies.O);

            // Calculate total votes for percentage display
            const totalVotes = (voteTallies.D || 0) + (voteTallies.R || 0) + (voteTallies.O || 0);
            const pctFormatter = (x) => {
                if (!isFinite(x) || totalVotes <= 0) return '0.0%';
                return ((x / totalVotes) * 100).toFixed(1) + '%';
            };

            // Candidate name lookup (use the resolver to prefer snapshot/info values)
            const displayNames = true; // show candidate last names when available
            const candidateNames = displayNames ? resolveCandidateNames(info, unit) : { D: 'D', R: 'R', O: 'O' };

            // Determine front-runner party key and build a human-friendly leader label
            const frontRunnerParty = (voteTallies.D === maxVotes) ? 'D' : (voteTallies.R === maxVotes) ? 'R' : (voteTallies.O === maxVotes) ? 'O' : null;
            let leaderLabel = frontRunnerParty || null;
            if (frontRunnerParty) {
                // Prefer explicit candidate info from the snapshot/info object
                // (dCandidate/rCandidate or info.candidates[name]) before using the
                // derived/fallback `candidateNames` map which may contain placeholders
                // like 'D'/'R'. This prevents results like "R (R)" when a real
                // candidate name is available on the info object.
                const rawName = (info && ((frontRunnerParty === 'D' && info.dCandidate) || (frontRunnerParty === 'R' && info.rCandidate))) ||
                    (info && info.candidates && info.candidates[frontRunnerParty] && info.candidates[frontRunnerParty].name) ||
                    (candidateNames && candidateNames[frontRunnerParty]) || null;
                if (rawName) {
                    // Prefer last name only for tooltip brevity. Use lastNameFrom when possible
                    let shortName = null;
                    try {
                        const maybe = String(rawName);
                        shortName = lastNameFrom(maybe) || null;
                    } catch (e) { shortName = null; }
                    const nmStr = shortName || String(rawName);
                    if (nmStr && nmStr.length > 1 && nmStr !== frontRunnerParty) {
                        leaderLabel = (frontRunnerParty === 'O') ? nmStr : `${nmStr} (${frontRunnerParty})`;
                    } else {
                        leaderLabel = frontRunnerParty;
                    }
                }
            }

            // Only display parties with votes, add star to the highest, include percentage
            if (voteTallies.D > 0) {
                const dLabel = candidateNames && candidateNames.D ? candidateNames.D : 'D';
                voteParts.push(`${voteTallies.D === maxVotes ? dLabel + '*' : dLabel}: ${formatter(voteTallies.D)} (${pctFormatter(voteTallies.D)})`);
            }
            if (voteTallies.R > 0) {
                const rLabel = candidateNames && candidateNames.R ? candidateNames.R : 'R';
                voteParts.push(`${voteTallies.R === maxVotes ? rLabel + '*' : rLabel}: ${formatter(voteTallies.R)} (${pctFormatter(voteTallies.R)})`);
            }
            // Only display top third party if it has votes (not all third parties)
            if (voteTallies.O > 0) {
                const oLabel = candidateNames && candidateNames.O ? candidateNames.O : 'O';
                voteParts.push(`${voteTallies.O === maxVotes ? oLabel + '*' : oLabel}: ${formatter(voteTallies.O)} (${pctFormatter(voteTallies.O)})`);
            }

            // Only add vote row if we have votes to display
            if (voteParts.length) {
                // On mobile, display each candidate on a separate line to avoid cutoff
                const isMobile = (typeof window !== 'undefined' && window.innerWidth < 600);
                const separator = isMobile ? '\n' : '\n'; //' | '; // we can use newlines even on desktop since the tooltip will expand vertically as needed
                rows.push(voteParts.join(separator));
                // Add total votes line
                if (totalVotes > 0) {
                    rows.push(`Total: ${formatter(totalVotes)} votes`);
                }
            }
            // Add vote margin between top and runner-up
            const votes = [
                { party: 'D', count: voteTallies.D },
                { party: 'R', count: voteTallies.R },
                { party: 'O', count: voteTallies.O }
            ].filter(v => v.count > 0).sort((a, b) => b.count - a.count);

            if (votes.length >= 2) {
                const voteMargin = votes[0].count - votes[1].count;
                const voteMarginText = `${leaderLabel}+${formatter(voteMargin)} vote${voteMargin !== 1 ? 's' : ''}`;
                const pctMargin = ((voteMargin / votes.reduce((acc, v) => acc + v.count, 0)) * 100).toFixed(1);
                const pctMarginText = `${leaderLabel}+${pctMargin}`;
                if (window.DEBUG_TOOLTIP) console.log('formatUnitTooltip vote margin', { unit, votes, voteMargin: voteMargin, voteMarginText: voteMarginText });
                rows.push(voteMarginText);
                // replace the marginStr with pctMarginText because we have real vote tallies
                marginStr = pctMarginText;
            }

            // If marginStr wasn't provided as a static string, allow a functional override
            if (typeof options.marginOverride === 'function') {
                try { marginStr = options.marginOverride(voteTallies) || marginStr; } catch (e) { }
            }
            // If still no marginStr, derive it from tallies
            if (!marginStr || typeof marginStr !== 'string' || marginStr === '') {
                const derived = marginStrFromVoteTallies(voteTallies);
                if (derived) marginStr = derived;
            }
        }

        // Now that marginStr may have been updated from vote tallies, clamp large values
        const cappedMarginStr = (function () {
            if (!marginStr || typeof marginStr !== 'string') return marginStr;
            // match a trailing +number portion, with optional decimal
            const m = marginStr.match(/(.*)\+([\d.]+)\s*$/);
            if (!m) return marginStr;
            const prefix = m[1];
            const value = parseFloat(m[2]);
            if (!isFinite(value) || value <= 99.9) return marginStr;
            return `${prefix}+99.9`;
        })();

        // First row: Basic info (display name, EV, margin)
        // Keep showing the unit/display name first; marginStr will include candidate label when available
        const basicParts = [];
        if (display) basicParts.push(display);
        if (ev != null && ev !== '') basicParts.push(`${ev} EV`);
        if (cappedMarginStr) basicParts.push(cappedMarginStr);
        if (basicParts.length) rows.unshift(basicParts.join(' · '));

        // Election night reporting info. Shares formatReportingText with the
        // call-log cards so "100.0% counted" only ever appears once
        // remainingVotes is truly zero, not just once it rounds there.
        const reportingText = (window._electionNightActive && info && info.reporting != null)
            ? formatReportingText(info.reporting, info.remainingVotes)
            : '';
        if (reportingText && reportingText !== '0% reporting') rows.push(reportingText);

        // Called/confidence info. Shares formatConfidenceText with the
        // call-log cards so the tooltip's confidence reads on the same
        // rescaled display scale, junctioned to the live call-threshold
        // setting (window._electionNightConfidenceThreshold, kept in sync
        // by updateCallLog since this module has no access to `state`).
        if (info) {
            if (info.called) {
                rows.push('Called');
            } else {
                const reporting = (info.reporting != null && isFinite(info.reporting)) ? info.reporting : 0;
                const confidence = (info.confidence != null && isFinite(info.confidence)) ? info.confidence : null;
                if (reporting > EPS && confidence != null) {
                    const threshold = isFinite(window._electionNightConfidenceThreshold) ? window._electionNightConfidenceThreshold : undefined;
                    rows.push(formatConfidenceText(confidence, threshold));
                }
            }
        }

        return rows.join('\n');
    } catch (e) { return unit; }
}

// Centralized tooltip helpers (consistent positioning; fixes offset glitches)
export function _getMapWrap() {
    return document.getElementById('map-wrap') || document.body;
}

// Make the active-tip state exportable so callers can check/update it
export const _activeTipState = {
    info: null
};
export function moveMapTip(evt) { try { _placeTipAt(evt); } catch (e) { } }

export function _setActiveTip(info) {
    try {
        _activeTipState.info = info || null;
        if (info) _startActiveTipPoll(info);
        else _stopActiveTipPoll();
    } catch (e) { _activeTipState.info = info || null; }
}
export function refreshActiveMapTip() {
    try {
        const info = _activeTipState.info;
        if (!info || typeof info.getText !== 'function') return;
        const text = info.getText();
        if (text == null) return;
        const coords = {
            clientX: info.clientX,
            clientY: info.clientY
        };
        if (coords.clientX == null || coords.clientY == null) return;
        showMapTip(coords, text);
    } catch (e) { }
}

// Active-tip poller: keep trying to refresh the active tooltip until
// richer data becomes available or the tip is cleared by hideMapTip.
let _activeTipPoll = null;
let _activeTipPollAttempts = 0;
const _ACTIVE_TIP_POLL_INTERVAL = 150; // ms
const _ACTIVE_TIP_POLL_MAX = 400; // ~60s safety cap

function _stopActiveTipPoll() {
    try {
        if (_activeTipPoll) {
            clearInterval(_activeTipPoll);
            _activeTipPoll = null;
        }
        _activeTipPollAttempts = 0;
    } catch (e) { }
}

function _isInfoDetailed(info) {
    try {
        if (!info) return false;
        // If info has a unit property, prefer checking getAdjustedInfo
        const unit = info.unit || null;
        if (unit && typeof window.getAdjustedInfo === 'function') {
            try {
                const adj = window.getAdjustedInfo(unit);
                if (!adj) return false;
                // Consider detailed if we have an EV, a margin string, reporting, or candidate metadata
                if ((adj.ev != null && adj.ev !== '') || (adj.marginStr && String(adj.marginStr).trim() !== '') || adj.reporting > 0 || adj.called || adj.dCandidate || adj.rCandidate) return true;
            } catch (e) { }
        }
        // Otherwise fallback to checking whether info.getText() returns more than a single token (abbr)
        if (typeof info.getText === 'function') {
            try {
                const txt = String(info.getText() || '');
                if (!txt) return false;
                // if tooltip contains newline or 'EV' or '%' or 'vote' or 'Called' it's likely detailed
                if (txt.indexOf('\n') >= 0) return true;
                const checkWords = ['EV', '%', 'vote', 'Called', 'Confidence', 'counted'];
                for (const w of checkWords) if (txt.indexOf(w) >= 0) return true;
            } catch (e) { }
        }
        return false;
    } catch (e) { return false; }
}

function _startActiveTipPoll(info) {
    try {
        _stopActiveTipPoll();
        if (!info) return;
        _activeTipPollAttempts = 0;
        // If info already looks detailed, do nothing
        if (_isInfoDetailed(info)) return;
        _activeTipPoll = setInterval(() => {
            _activeTipPollAttempts++;
            // Stop if tip cleared
            if (!_activeTipState.info) return _stopActiveTipPoll();
            // If info replaced, stop (will be restarted by new set)
            if (_activeTipState.info !== info) return _stopActiveTipPoll();
            // If data now available, refresh and stop polling
            try {
                if (_isInfoDetailed(info)) {
                    try { refreshActiveMapTip(); } catch (e) { }
                    return _stopActiveTipPoll();
                }
            } catch (e) { }
            // Safety cap to avoid infinite polling; if reached, keep polling but reset attempts counter
            if (_activeTipPollAttempts >= _ACTIVE_TIP_POLL_MAX) {
                // Do one final refresh attempt and then reset attempts (don't permanently stop)
                try { refreshActiveMapTip(); } catch (e) { }
                _activeTipPollAttempts = 0;
            }
        }, _ACTIVE_TIP_POLL_INTERVAL);
    } catch (e) { }
}


// Expose helper to get candidate last names for a unit (D, R, top third-party O)
// Candidate name helpers moved to docs/utils/candidateNames.js

// Helper for tooltip: given a unit abbr (state or district), return {ev, margin, marginStr}
export function getAdjustedInfo(unit) {
    try {
        const year = window._curYear;
        const pv = window._curPv || 0;
        if (!year) return null;
        const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
        const snapshot = (window._electionNightActive && window._electionNightSnapshot && window._electionNightSnapshot.size)
            ? window._electionNightSnapshot
            : null;
        if (snapshot) {
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
                let evVal = snap.ev;
                if (evVal == null) {
                    try { if (typeof window.getEvFor === 'function') evVal = window.getEvFor(year, keyUnit); } catch (e) { }
                }
                const hasMargin = snap.margin != null && isFinite(snap.margin);
                const marginVal = hasMargin ? snap.margin : null;
                let marginStrVal = snap.marginStr;
                if (marginStrVal == null || marginStrVal === '') {
                    if (!hasMargin) marginStrVal = 'None';
                    else if (typeof leanStr === 'function') marginStrVal = leanStr(marginVal);
                    else {
                        const pct = (Math.abs(marginVal) * 100).toFixed(1);
                        marginStrVal = `${marginVal >= 0 ? 'D' : 'R'}+${pct}`;
                    }
                }
                const calledVal = !!snap.called;
                const reportingVal = (snap.reporting != null && isFinite(snap.reporting)) ? Math.max(0, Math.min(1, snap.reporting)) : 0;
                const confidenceVal = (snap.confidence != null && isFinite(snap.confidence)) ? Math.max(0, Math.min(1, snap.confidence)) : 0;
                // Normalize candidate info: prefer a candidates object with D/R/O entries when possible,
                // but also expose dCandidate/rCandidate and thirdPartyResults for backward compatibility.
                const outCandidates = {};
                try {
                    if (snap.candidates && Array.isArray(snap.candidates)) {
                        // Try to map array into D/R/O keys if elements include party/id hints
                        snap.candidates.forEach(c => {
                            try {
                                if (!c) return;
                                // party id may be at c.party, c.id, or c.abbr
                                const pid = (c.party || c.id || c.abbr || '').toString();
                                if (pid === 'D' || pid === 'Dem' || /D/i.test(pid)) outCandidates.D = c;
                                else if (pid === 'R' || pid === 'GOP' || /R/i.test(pid)) outCandidates.R = c;
                                else {
                                    // fallback: register as a third-party candidate under O if not set
                                    if (!outCandidates.O) outCandidates.O = c;
                                }
                            } catch (e) { }
                        });
                    } else if (snap.candidates && typeof snap.candidates === 'object') {
                        // If already an object, copy over
                        Object.assign(outCandidates, snap.candidates);
                    }
                } catch (e) { }
                // Expose simple name fields if present on snap
                const dCand = (snap.dCandidate || snap.D_candidate || (outCandidates.D && outCandidates.D.name) || null);
                const rCand = (snap.rCandidate || snap.R_candidate || (outCandidates.R && outCandidates.R.name) || null);
                const thirdPartyResults = (snap.thirdPartyResults || snap.third_party_results || null);
                return {
                    ev: evVal,
                    margin: marginVal,
                    marginStr: marginStrVal,
                    called: calledVal,
                    reporting: reportingVal,
                    confidence: confidenceVal,
                    candidates: (Object.keys(outCandidates).length ? outCandidates : (Array.isArray(snap.candidates) ? snap.candidates.slice() : [])),
                    dCandidate: dCand,
                    rCandidate: rCand,
                    thirdPartyResults: thirdPartyResults
                };
            }
        }
        const rows = (function () {
            // byYear lives inside the IIFE; expose via window if available
            if (typeof window.getRowsForYear === 'function') return window.getRowsForYear(year);
            return null;
        })();
        // Fallback: reconstruct from CSV already parsed via closure if not exposed
        let r = null;
        if (rows && rows.length) {
            r = rows.find(x => x.unit === keyUnit);
        }
        // If closure isn't exposed, try reading from the DOM colors map via evByUnit
        // but we did store evByUnit in closure as well; we mirror EV lookup by re-reading electoral_college.csv not feasible here.
        // Instead, rely on title info for EV not available; return margin only if needed.
        let ev = null;
        try { if (typeof window.getEvFor === 'function') ev = window.getEvFor(year, keyUnit); } catch (e) { }
        if ((ev == null || isNaN(ev)) && r && isFinite(+r.ev)) ev = +r.ev;
        if (!r) return { ev, margin: null, marginStr: '', called: false, reporting: 0, confidence: 0 };
        // Default margin from row
        let m = (+r.rm || 0) + (pv || 0);
        // Special case: For ME/NE statewide tooltips, recompute at-large margin from districts when available
        try {
            const isAL = (keyUnit === 'ME-AL' || keyUnit === 'NE-AL');
            if (isAL && Array.isArray(rows) && rows.length) {
                const st = keyUnit.slice(0, 2);
                const districtUnits = (st === 'ME') ? ['ME-01', 'ME-02'] : ['NE-01', 'NE-02', 'NE-03'];
                const haveAll = districtUnits.every(u => rows.some(rr => rr && rr.unit === u));
                if (haveAll) {
                    // Build a map of votes_to_flip for active scenario
                    const f = window._activeFlip;
                    const vtByUnit = new Map();
                    if (f && f.year === year && Array.isArray(f.units)) {
                        f.units.forEach(u => vtByUnit.set(u.unit, Math.max(0, +u.votes_to_flip || 0)));
                    }
                    let dSum = 0, rSum = 0;
                    for (const du of districtUnits) {
                        const row = rows.find(x => x && x.unit === du);
                        if (!row) continue;
                        let d0 = +row.dVotes || 0;
                        let r0 = +row.rVotes || 0;
                        const vt = vtByUnit.get(du) || 0;
                        const flipped = (!!vt) || (f && f._set && f._set.has(du));
                        if (flipped) {
                            if (d0 >= r0) { d0 = Math.max(0, d0 - vt); r0 = r0 + vt; }
                            else { d0 = d0 + vt; r0 = Math.max(0, r0 - vt); }
                        }
                        dSum += d0; rSum += r0;
                    }
                    const twoTot = dSum + rSum;
                    if (twoTot > 0) {
                        m = (dSum - rSum) / twoTot; // recomputed two-party margin
                        // If at-large itself is flipped, force sign to opposite side
                        const alFlipped = (f && f.year === year && f._set && f._set.has(keyUnit));
                        if (alFlipped) m = (m > 0 ? -1e-6 : 1e-6);
                    }
                    // For ME/NE state hover, prefer showing total state EV instead of AL-only EV
                    if (unit === st) {
                        try {
                            const parts = rows.filter(x => x && (x.unit === `${st}-AL` || x.unit.startsWith(`${st}-`)));
                            const sumEv = parts.reduce((s, x) => s + (+x.ev || 0), 0);
                            if (isFinite(sumEv) && sumEv > 0) ev = sumEv;
                        } catch (e) { }
                    }
                }
            }
        } catch (e) { console.error('Error recomputing ME/NE at-large margin:', e); }
        // Check if this unit is flipped in the current scenario
        const flipped = (typeof isUnitFlipped === 'function') ? isUnitFlipped(year, keyUnit) : (typeof window.isUnitFlipped === 'function' ? window.isUnitFlipped(year, keyUnit) : false);
        if (flipped) {
            // If flipped, reverse the winner by nudging margin to opposite side
            m = (m > 0 ? -0.000001 : 0.000001); // Use small epsilon like in updateAll
            console.log('getAdjustedInfo: unit flipped', { unit, keyUnit, originalMargin: (+r.rm || 0) + (pv || 0), flippedMargin: m });
        }
        // Build candidate info from the CSV row for tooltip consumers
        const candMap = {};
        try {
            if (r.dCandidate) candMap.D = { name: String(r.dCandidate) };
            if (r.rCandidate) candMap.R = { name: String(r.rCandidate) };
            // derive top third-party candidate name if present in parsed thirdPartyResults
            if (r.thirdPartyResults && typeof r.thirdPartyResults === 'object') {
                const entries = Object.entries(r.thirdPartyResults).map(([nm, v]) => ({ name: nm, votes: Number(v) || 0 }));
                if (entries.length) {
                    entries.sort((a, b) => b.votes - a.votes);
                    candMap.O = { name: String(entries[0].name) };
                }
            } else if (r.thirdPartyResults && typeof r.thirdPartyResults === 'string') {
                // if still serialized string, leave as-is and parsing elsewhere will handle it
            }

        } catch (e) { console.error('Error building candidate map in getAdjustedInfo:', e); }

        return {
            ev,
            margin: m,
            marginStr: (function () {
                if (!isFinite(m)) return '';
                //if (Math.abs(m) < 0.000005) return 'EVEN';

                // Check for third-party scenario (yellow window) for any year
                {
                    const t = +r.tp || 0;
                    const a = 3 * t - 1;
                    if (a > 0) {
                        const rVal = +(r.rm || 0);
                        const pv = window._curPv || 0;
                        const nD = -rVal + a;
                        const nR = -rVal - a;
                        const EPS = 1e-9;
                        // If current PV places this unit in the yellow window, show T+ margin
                        if (pv > nR + EPS && pv < nD - EPS) {
                            const windowCenter = -rVal; // Center of yellow window
                            const windowHalfWidth = a; // Half-width of yellow window
                            const distanceFromCenter = Math.abs(pv - windowCenter);
                            const relativePosition = distanceFromCenter / windowHalfWidth; // 0 to 1
                            const thirdPartyStrength = (1 - relativePosition) * windowHalfWidth;
                            const s = (thirdPartyStrength * 100).toFixed(1);
                            return 'T+' + s; // Third-party win
                        }
                    }
                }

                const s = (Math.abs(m) * 100).toFixed(1);
                //console.log('getAdjustedInfo: marginStr computed', { unit, keyUnit, margin: m, marginStr: (m > 0 ? 'D+' : 'R+') + s });
                return (m > 0 ? 'D+' : 'R+') + s;
            })(),
            called: false,
            reporting: 0,
            confidence: 0,
            // attach candidate metadata for tooltips and other UI consumers
            candidates: (Object.keys(candMap).length ? candMap : undefined),
            dCandidate: r.dCandidate || null,
            rCandidate: r.rCandidate || null,
            thirdPartyResults: r.thirdPartyResults || null
        };
    } catch (e) { return null; }
}
// Backwards compatibility: expose main tooltip helpers to window
try {
    if (typeof window !== 'undefined') {
        try { window.showMapTip = showMapTip; } catch (e) { }
        try { window.hideMapTip = hideMapTip; } catch (e) { }
        try { window.moveMapTip = moveMapTip; } catch (e) { }
        try { window.createUnitTipInfo = createUnitTipInfo; } catch (e) { }
        try { window._setActiveTip = _setActiveTip; } catch (e) { }
        try { window._activeTipState = _activeTipState; } catch (e) { }
        try { window.getAdjustedInfo = getAdjustedInfo; } catch (e) { }
    }
} catch (e) { }
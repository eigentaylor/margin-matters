'use strict';

export function fmtLean(x) {
    if (!isFinite(x)) return '';
    if (Math.abs(x) < 0.000005) return 'EVEN';
    const s = (Math.abs(x) * 100).toFixed(1);
    return (x > 0 ? 'D+' : 'R+') + s;
}
export const formatter = (x) => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '0';


export function leanStr(x) {
    if (!isFinite(x)) return '';
    if (Math.abs(x) < 0.000005) return 'EVEN';
    const s = (Math.abs(x) * 100).toFixed(1);
    return (x > 0 ? 'D+' : 'R+') + s;
}

import { getStateName } from './constants.js';

export function formatLeader(code) {
    if (code === 'D') return 'Democrats';
    if (code === 'R') return 'Republicans';
    if (code === 'O') return 'Other';
    console.warn('Unknown leader code', code);
    return 'No call';
}

export function formatLeaderShort(code) {
    if (code === 'D') return 'D';
    if (code === 'R') return 'R';
    if (code === 'O') return 'Other';
    return 'No call';
}

export function formatMarginText(marginStr, leader, voteMargin) {
    if (marginStr === 'None') return 'None';
    if (!marginStr) return leader === 'O' ? 'Other lead' : 'EVEN';
    if (leader !== 'O' && isFinite(voteMargin) && Math.round(voteMargin) !== 0) {
        const rawSign = voteMargin > 0 ? 'D' : 'R';
        return `${marginStr} (${rawSign}+${Math.abs(Math.round(voteMargin)).toLocaleString('en-US')})`;
    }
    return marginStr;
}

export function formatReportingText(reporting, remainingVotes) {
    if (reporting == null || reporting <= 0) return '0% reporting';
    const value = Number(reporting);
    if (!isFinite(value) || value < 0) return '0% reporting';
    const pct = Math.max(0, Math.min(100, value * 100));
    // If remainingVotes provided and is numeric, use it to decide 100% and append votes-left
    const rem = (remainingVotes != null && isFinite(remainingVotes)) ? Math.max(0, Math.round(remainingVotes)) : null;
    // pct.toFixed(1) rounds anything >= 99.95% up to "100.0" on its own,
    // which - whenever ballots are actually still left (rem > 0) - produced
    // a contradictory "100.0% counted (N votes left)" line. Cap the
    // displayed percentage just below 100 until rem is known to be exactly
    // zero, so "100.0%" only ever appears once every ballot is counted.
    const displayPct = (rem != null && rem > 0) ? Math.min(99.9, pct) : pct;
    const base = (rem === 0) ? '100.0% counted' : `${displayPct.toFixed(1)}% counted`;
    if (rem != null && rem > 0) return `${base} (${rem.toLocaleString('en-US')} votes left)`;
    return base;
}

// Raw confidence (from calculateConfidence) is a worst-case-remaining-ballots
// ratio: historically, calls made at raw confidence >= the call threshold
// have essentially always matched the eventual result (see
// docs/utils/electionNight/validateConfidence.mjs's historical miscall-rate
// check, run at the default threshold of 0.3), so displaying that raw value
// directly reads as far shakier than it is. This remaps the raw [0,1] value
// to a display-only [0,1] value for percentage formatting: the caller's own
// call-threshold setting -> display 0.99, and raw values above it get
// squished into display 0.99-1.0. Tying the junction to the actual
// threshold (instead of a hardcoded 0.3) keeps this honest if someone sets
// a very different threshold - a race called "early" at a threshold of 0.05
// still shows ~99% once it clears THAT bar, and a threshold of 0.9 doesn't
// pretend a call was locked in long before it actually would have been.
// This must never be used anywhere that affects call decisions or
// exported/raw data — display only.
const DEFAULT_CONFIDENCE_JUNCTION_RAW = 0.5;
const CONFIDENCE_JUNCTION_DISPLAY = 0.99;

export function rescaleConfidenceForDisplay(rawConfidence, junctionRaw = DEFAULT_CONFIDENCE_JUNCTION_RAW) {
    if (!isFinite(rawConfidence)) return NaN;
    const raw = Math.max(0, Math.min(1, rawConfidence));
    const junction = Math.max(1e-6, Math.min(1 - 1e-6, isFinite(junctionRaw) ? junctionRaw : DEFAULT_CONFIDENCE_JUNCTION_RAW));
    if (raw >= 1 - 1e-9) return 1;
    if (raw <= junction) {
        return (raw / junction) * CONFIDENCE_JUNCTION_DISPLAY;
    }
    const t = (raw - junction) / (1 - junction);
    return CONFIDENCE_JUNCTION_DISPLAY + t * (1 - CONFIDENCE_JUNCTION_DISPLAY);
}

export function formatConfidenceText(confidence, junctionRaw = DEFAULT_CONFIDENCE_JUNCTION_RAW) {
    if (!isFinite(confidence)) return 'Confidence —';
    const display = rescaleConfidenceForDisplay(confidence, junctionRaw);
    if (display >= 1 - 1e-9) return 'Confidence 100%';
    const pct = display * 100;
    // Never let a sub-certainty value round up to a false "100%".
    return `Confidence ${pct >= 99.95 ? '99.9' : pct.toFixed(0)}%`;
}

export function formatWinProbText(winProb) {
    if (!isFinite(winProb)) return '';
    const pct = Math.max(0, Math.min(100, Math.round(winProb * 100)));
    return `Win prob ${pct}%`;
}

export function formatNpvCallText(record, junctionRaw) {
    const leaderText = record.candidateName || formatLeader(record.leader);
    const pvPct = record.countedVotes > 0.000005
        ? (Math.abs(record.dVotes - record.rVotes) / record.countedVotes * 100).toFixed(1)
        : '0.0';
    return `${formatTimeLabel(record.time)} – National popular vote called for ${leaderText} (${formatConfidenceText(record.confidence, junctionRaw)}, margin ${pvPct}%)`;
}

export function formatEvAllocationsForLog(callAlloc, finalAlloc) {
    const toParts = alloc => {
        if (!alloc) return [];
        const parts = [];
        if (alloc.D) parts.push(`D ${alloc.D}`);
        if (alloc.R) parts.push(`R ${alloc.R}`);
        if (alloc.O) parts.push(`O ${alloc.O}`);
        return parts;
    };
    const callParts = toParts(callAlloc);
    const finalParts = toParts(finalAlloc);
    if (!callParts.length && !finalParts.length) return '';
    const callText = callParts.length ? callParts.join(' | ') : '';
    const finalText = finalParts.length ? finalParts.join(' | ') : '';
    if (callText && finalText && callText !== finalText) {
        return `EV ${callText} → ${finalText}`;
    }
    const text = finalText || callText;
    return text ? `EV ${text}` : '';
}

export function formatUnitLabel(unit) {
    if (!unit) return unit;
    if (/^[A-Z]{2}$/.test(unit)) return getStateName(unit) || unit;
    if (/-AL$/.test(unit)) {
        const abbr = unit.slice(0, 2);
        const name = getStateName(abbr) || abbr;
        return `${name} at-large`;
    }
    if (/(ME|NE)-0[1-9]$/.test(unit)) {
        const abbr = unit.slice(0, 2);
        const district = unit.slice(3);
        const name = getStateName(abbr) || abbr;
        return `${name} ${district}`;
    }
    return unit;
}

export function formatTimeLabel(minutes) {
    const dayMinutes = 24 * 60;
    const minuteOfDay = ((minutes % dayMinutes) + dayMinutes) % dayMinutes;
    const hours = Math.floor(minuteOfDay / 60);
    const mins = Math.floor(minuteOfDay % 60);
    const h12 = ((hours + 11) % 12) + 1;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    return `${h12}:${mins.toString().padStart(2, '0')} ${ampm}`;
}
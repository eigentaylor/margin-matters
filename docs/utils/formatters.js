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
    const base = (rem === 0) ? '100.0% counted' : `${pct.toFixed(1)}% counted`;
    if (rem != null && rem > 0) return `${base} (${rem.toLocaleString('en-US')} votes left)`;
    return base;
}

// Raw confidence (from calculateConfidence) is a worst-case-remaining-ballots
// ratio: historically, calls made at raw confidence >= 0.3 have essentially
// always matched the eventual result, so displaying "30%" reads as far
// shakier than it is. This remaps the raw [0,1] value to a display-only
// [0,1] value for percentage formatting: raw 0.3 -> display 0.99, and
// raw 0.3-1.0 gets squished into display 0.99-1.0. The junction point was
// chosen to match the existing default call threshold; see
// docs/utils/electionNight/validateConfidence.mjs for the historical
// miscall-rate check that justified it. This must never be used anywhere
// that affects call decisions or exported/raw data — display only.
const CONFIDENCE_JUNCTION_RAW = 0.3;
const CONFIDENCE_JUNCTION_DISPLAY = 0.99;

export function rescaleConfidenceForDisplay(rawConfidence) {
    if (!isFinite(rawConfidence)) return NaN;
    const raw = Math.max(0, Math.min(1, rawConfidence));
    if (raw >= 1 - 1e-9) return 1;
    if (raw <= CONFIDENCE_JUNCTION_RAW) {
        return (raw / CONFIDENCE_JUNCTION_RAW) * CONFIDENCE_JUNCTION_DISPLAY;
    }
    const t = (raw - CONFIDENCE_JUNCTION_RAW) / (1 - CONFIDENCE_JUNCTION_RAW);
    return CONFIDENCE_JUNCTION_DISPLAY + t * (1 - CONFIDENCE_JUNCTION_DISPLAY);
}

export function formatConfidenceText(confidence) {
    if (!isFinite(confidence)) return 'Confidence —';
    const display = rescaleConfidenceForDisplay(confidence);
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

export function formatNpvCallText(record) {
    const leaderText = record.candidateName || formatLeader(record.leader);
    const pvPct = record.countedVotes > 0.000005
        ? (Math.abs(record.dVotes - record.rVotes) / record.countedVotes * 100).toFixed(1)
        : '0.0';
    return `${formatTimeLabel(record.time)} – National popular vote called for ${leaderText} (${formatConfidenceText(record.confidence)}, margin ${pvPct}%)`;
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
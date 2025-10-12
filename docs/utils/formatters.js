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

export function formatMarginText(marginStr, leader) {
    if (marginStr === 'None') return 'None';
    if (!marginStr) return leader === 'O' ? 'Other lead' : 'EVEN';
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

export function formatConfidenceText(confidence) {
    if (!isFinite(confidence)) return 'Confidence —';
    return `Confidence ${(confidence * 100).toFixed(0)}%`;
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
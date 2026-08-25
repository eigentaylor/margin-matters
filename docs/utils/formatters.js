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

// Analogue of leanStr() for the case where a third-party candidate is
// actually ahead: D and R margins are always measured against each other
// (dVotes - rVotes), so this measures the "O" leader the same way - against
// whichever of D/R is closer to catching them - rather than against the sum
// of every other candidate, which would understate how commanding the lead
// is whenever both major parties are also splitting votes between them.
export function formatOtherLean(oVotes, dVotes, rVotes, totalVotes) {
    if (!isFinite(oVotes) || !isFinite(dVotes) || !isFinite(rVotes) || !isFinite(totalVotes) || totalVotes <= 0) return 'ERROR';
    const lead = (oVotes - Math.max(dVotes, rVotes)) / totalVotes;
    if (Math.abs(lead) < 0.000005) return 'EVEN';
    return `O+${(Math.abs(lead) * 100).toFixed(1)}`;
}

/**
 * Margin string for whichever of D/R/O is actually AHEAD, measured against
 * the actual runner-up - not always D-vs-R. leanStr()/formatOtherLean()
 * above enshrined "D and R margins are always measured against each other"
 * as deliberate; that breaks down the moment a third-party candidate is
 * genuinely competitive: a state where R leads D by a lot but O is running a
 * much closer second reads as a blown-out "R+29" instead of the real R+14
 * race it actually is. This picks the real top two among D/R/O and measures
 * the gap between them, so a plain two-party count (oVotes 0/not finite)
 * produces the exact same output leanStr(dVotes - rVotes) / totalVotes did -
 * no behavior change for any race without a real third-party contender.
 * `dVotes`/`rVotes`/`oVotes`/`totalVotes` can be raw counts or shares -
 * the math is a plain ratio, so either works as long as all four use the
 * same units.
 */
export function formatRunnerUpLean(dVotes, rVotes, oVotes, totalVotes) {
    if (!isFinite(dVotes) || !isFinite(rVotes) || !isFinite(totalVotes) || totalVotes <= 0) return 'ERROR';
    const o = isFinite(oVotes) ? oVotes : 0;
    const ranked = [['D', dVotes], ['R', rVotes], ['O', o]].sort((a, b) => b[1] - a[1]);
    const [leader, leaderVotes] = ranked[0];
    const runnerUpVotes = ranked[1][1];
    const lead = (leaderVotes - runnerUpVotes) / totalVotes;
    if (Math.abs(lead) < 0.000005) return 'EVEN';
    const prefix = leader === 'O' ? 'O+' : (leader === 'D' ? 'D+' : 'R+');
    return `${prefix}${(Math.abs(lead) * 100).toFixed(1)}`;
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

// The "(D+11,003)"-style raw-vote-count suffix used both inline in
// formatMarginText() and standalone (e.g. the races-to-watch card's smaller
// sub-line under its colored margin badge, which wants just this part).
export function formatRawMarginText(leader, voteMargin) {
    if (leader === 'O' || !isFinite(voteMargin) || Math.round(voteMargin) === 0) return '';
    const rawSign = voteMargin > 0 ? 'D' : 'R';
    return `${rawSign}+${Math.abs(Math.round(voteMargin)).toLocaleString('en-US')}`;
}

// formatRawMarginText()'s O-lead analogue - voteMargin there is always a
// D-vs-R difference (meaningless once O is ahead), so this measures the raw
// vote count the same way formatOtherLean() measures the percentage: O's
// lead over whichever of D/R is closer to catching them.
export function formatOtherRawMarginText(oVotes, dVotes, rVotes) {
    if (!isFinite(oVotes) || !isFinite(dVotes) || !isFinite(rVotes)) return '';
    const raw = oVotes - Math.max(dVotes, rVotes);
    if (Math.round(raw) === 0) return '';
    return `O+${Math.abs(Math.round(raw)).toLocaleString('en-US')}`;
}

export function formatMarginText(marginStr, leader, voteMargin) {
    if (marginStr === 'None') return 'None';
    if (!marginStr) return leader === 'O' ? 'Other lead' : 'EVEN';
    const raw = formatRawMarginText(leader, voteMargin);
    return raw ? `${marginStr} (${raw})` : marginStr;
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

// Maine and Nebraska split their electoral votes by congressional district
// starting with the 1972 and 1992 elections respectively - before that,
// their CSV rows are still labeled "-AL" (a data-modeling artifact, not a
// historical fact), so calling a pre-split year's statewide result
// "at-large" is anachronistic. Year is optional so callers that don't have
// one handy still get the pre-existing (post-split) wording.
const DISTRICT_SPLIT_YEAR = { ME: 1972, NE: 1992 };

export function ordinalSuffix(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return `${n}th`;
    switch (n % 10) {
        case 1: return `${n}st`;
        case 2: return `${n}nd`;
        case 3: return `${n}rd`;
        default: return `${n}th`;
    }
}

export function formatUnitLabel(unit, year, opts) {
    if (!unit) return unit;
    const short = !!(opts && opts.short);
    if (/^[A-Z]{2}$/.test(unit)) return getStateName(unit) || unit;
    if (/-AL$/.test(unit)) {
        const abbr = unit.slice(0, 2);
        const name = getStateName(abbr) || abbr;
        const splitYear = DISTRICT_SPLIT_YEAR[abbr];
        if (splitYear != null && isFinite(year) && year < splitYear) return name;
        // Unlike the numbered-district case below, "at-large" is short
        // enough to keep spelled out even in the checkpoint popup's tight
        // header - only the raw unit key ("ME-AL") would be saved by
        // shortening it, which reads far worse than "Maine at-large".
        return `${name} at-large`;
    }
    if (/(ME|NE)-0[1-9]$/.test(unit)) {
        // "NE-03" reads fine on its own for the checkpoint popup's tight
        // header space - the verbose "Nebraska's 3rd Congressional
        // District" form is reserved for the call log, where there's room.
        if (short) return unit;
        const abbr = unit.slice(0, 2);
        const district = parseInt(unit.slice(3), 10);
        const name = getStateName(abbr) || abbr;
        return `${name}'s ${ordinalSuffix(district)} Congressional District`;
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
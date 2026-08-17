'use strict';

// Candidate name helpers extracted from tooltipManager.js
// Provides utilities to derive sensible last-name labels for D/R/O

export function lastNameFrom(full) {
  try {
    if (!full || typeof full !== 'string') return null;
    const s = full.trim(); if (!s) return null;
    // If name is in "Last, First" format, take the part before comma
    if (s.indexOf(',') !== -1) return s.split(',')[0].trim();
    const parts = s.split(/\s+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : s;
  } catch (e) { return null; }
}

export function getUnitCandidateLastNames(unit, opts) {
  try {
    const options = opts || {};
    let year = (options.year != null && isFinite(options.year)) ? Number(options.year) : (typeof window._curYear === 'number' ? window._curYear : null);
    if (!isFinite(year)) year = null;
    if (!unit) return { D: 'D', R: 'R', O: 'O' };
    const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
    const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
    const row = (rows && rows.length) ? rows.find(x => x.unit === keyUnit) : null;

    const names = { D: 'D', R: 'R', O: 'O' };
    if (row) {
      try {
        if (row.dCandidate) {
          const ln = lastNameFrom(String(row.dCandidate)); if (ln) names.D = ln;
        }
        if (row.rCandidate) {
          const ln = lastNameFrom(String(row.rCandidate)); if (ln) names.R = ln;
        }
        if (row.thirdPartyResults && typeof row.thirdPartyResults === 'object') {
          const entries = Object.entries(row.thirdPartyResults).map(([nm, v]) => ({ name: nm, votes: Number(v) || 0 }));
          if (entries.length) {
            entries.sort((a, b) => b.votes - a.votes);
            const top = entries[0]; if (top && top.name) { const ln = lastNameFrom(String(top.name)); if (ln) names.O = ln; }
          }
        }
      } catch (e) { }
    }
    return names;
  } catch (e) { return { D: 'D', R: 'R', O: 'O' }; }
}

// Same lookup as getUnitCandidateLastNames but returns the untouched full
// name string (e.g. "Robert M. La Follette") instead of just the last name -
// for displays that want the whole name rather than a call-log-style label.
export function getUnitCandidateFullNames(unit, opts) {
  try {
    const options = opts || {};
    let year = (options.year != null && isFinite(options.year)) ? Number(options.year) : (typeof window._curYear === 'number' ? window._curYear : null);
    if (!isFinite(year)) year = null;
    if (!unit) return { D: null, R: null, O: null };
    const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
    const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
    const row = (rows && rows.length) ? rows.find(x => x.unit === keyUnit) : null;

    const names = { D: null, R: null, O: null };
    if (row) {
      try {
        if (row.dCandidate) names.D = String(row.dCandidate);
        if (row.rCandidate) names.R = String(row.rCandidate);
        if (row.thirdPartyResults && typeof row.thirdPartyResults === 'object') {
          const entries = Object.entries(row.thirdPartyResults).map(([nm, v]) => ({ name: nm, votes: Number(v) || 0 }));
          if (entries.length) {
            entries.sort((a, b) => b.votes - a.votes);
            const top = entries[0]; if (top && top.name) names.O = String(top.name);
          }
        }
      } catch (e) { }
    }
    return names;
  } catch (e) { return { D: null, R: null, O: null }; }
}

// Derive candidate labels using available info (prefer snapshot/info over CSV rows)
export function deriveCandidateNames(info, unit, opts) {
  try {
    // Prefer explicit candidates object from info when present
    if (info && info.candidates && typeof info.candidates === 'object') {
      const candObj = info.candidates || {};
      const names = { D: 'D', R: 'R', O: 'Top O' };
      try {
        if (candObj.D && candObj.D.name) {
          const ln = lastNameFrom(String(candObj.D.name)); if (ln) names.D = ln;
        }
        if (candObj.R && candObj.R.name) {
          const ln = lastNameFrom(String(candObj.R.name)); if (ln) names.R = ln;
        }
        if (candObj.O && candObj.O.name) {
          const ln = lastNameFrom(String(candObj.O.name)); if (ln) names.O = ln;
        }
      } catch (e) { }
      return names;
    }

    // Fallback: prefer simple per-party name fields on info
    if (info) {
      const names = { D: 'D', R: 'R', O: 'Top O' };
      try {
        if (info.dCandidate) {
          const ln = lastNameFrom(String(info.dCandidate)); if (ln) names.D = ln;
        }
        if (info.rCandidate) {
          const ln = lastNameFrom(String(info.rCandidate)); if (ln) names.R = ln;
        }
        if (info.thirdPartyResults && typeof info.thirdPartyResults === 'object') {
          const entries = Object.entries(info.thirdPartyResults).map(([nm, v]) => ({ name: nm, votes: Number(v) || 0 }));
          if (entries.length) {
            entries.sort((a, b) => b.votes - a.votes);
            const top = entries[0]; if (top && top.name) { const ln = lastNameFrom(String(top.name)); if (ln) names.O = ln; }
          }
        }
      } catch (e) { }
      return names;
    }

    // Last fallback: read from CSV rows
    return getUnitCandidateLastNames(unit, opts);
  } catch (e) { return { D: 'D', R: 'R', O: 'Top O' }; }
}

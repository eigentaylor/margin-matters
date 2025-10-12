'use strict';
import { getAllEvAllocations } from "./evAllocation.js";
// Extracted from docs/tester.js: updateCandidateInfo
// Responsible for updating the candidate names and special notes sections
// for the selected year. Relies on global helpers (getRowsForYear, getAllEvAllocations)
// and DOM elements with ids `candidateNames` and `specialNotes`.
export function updateCandidateInfo(year) {
  const candidateNamesEl = document.getElementById('candidateNames');
  const specialNotesEl = document.getElementById('specialNotes');
  if (!candidateNamesEl || !specialNotesEl) return;

  // Get candidate names from national row for this year
  const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
  if (!rows || !rows.length) {
    candidateNamesEl.textContent = '';
    specialNotesEl.textContent = '';
    return;
  }

  const nationalRow = rows.find(r => r.unit === 'NATIONAL' || r.unit === 'NAT');
  if (!nationalRow) {
    candidateNamesEl.textContent = '';
    specialNotesEl.textContent = '';
    return;
  }

  // Update candidate names
  const dCandidate = nationalRow.dCandidate || '';
  const rCandidate = nationalRow.rCandidate || '';

  // Build base candidate line
  const isElectionNight = typeof window !== 'undefined' && window._electionNightActive;
  const formatEvCount = (value, liveMode) => {
    const suffix = liveMode ? (value === 1 ? 'EV called' : 'EVs called') : (value === 1 ? 'EV' : 'EVs');
    return `${value} ${suffix}`;
  };

  let totalDEv = 0;
  let totalREv = 0;
  let totalOtherEV = 0;
  const thirdPartyMap = new Map();

  if (isElectionNight) {
    try {
      const snapshot = (typeof window !== 'undefined') ? window._electionNightSnapshot : null;
      if (snapshot && typeof snapshot.forEach === 'function') {
        const seen = new WeakSet();
        snapshot.forEach(entry => {
          if (!entry || seen.has(entry)) return;
          seen.add(entry);
          const alloc = entry.evCalledAllocations || null;
          if (!alloc) return;
          totalDEv += alloc.D || 0;
          totalREv += alloc.R || 0;
          const other = alloc.O || 0;
          if (other > 0) {
            let label = 'Other';
            try {
              if (entry.candidates && entry.candidates.O && entry.candidates.O.name) {
                label = entry.candidates.O.name;
              } else if (entry.thirdPartyResults && typeof entry.thirdPartyResults === 'object') {
                const entries = Object.entries(entry.thirdPartyResults)
                  .filter(([, votes]) => (votes || 0) > 0)
                  .sort((a, b) => (b[1] || 0) - (a[1] || 0));
                if (entries.length && entries[0][0]) label = entries[0][0];
              }
            } catch (err) { /* ignore naming issues */ }
            thirdPartyMap.set(label, (thirdPartyMap.get(label) || 0) + other);
          }
        });
      }
      totalOtherEV = Array.from(thirdPartyMap.values()).reduce((sum, v) => sum + v, 0);
      if (totalOtherEV > 0 && thirdPartyMap.size === 0) {
        thirdPartyMap.set('Other', totalOtherEV);
      }
    } catch (err) {
      console.warn('Failed to compute live EV tallies for candidate info', err);
    }
  } else {
    try {
      let allocations = null;
      try {
        if (typeof getAllEvAllocations === 'function') allocations = getAllEvAllocations();
      } catch (e) { console.warn(e); }
      if (!allocations) {
        try { if (typeof window.getAllEvAllocations === 'function') allocations = window.getAllEvAllocations(); } catch (e) { console.warn(e); }
      }

      if (allocations && Array.isArray(allocations)) {
        allocations.forEach(a => {
          totalDEv += a.dEV || 0;
          totalREv += a.rEV || 0;
          const other = a.oEV || 0;
          totalOtherEV += other;
          if (a.thirdPartyEVs && typeof a.thirdPartyEVs === 'object') {
            Object.keys(a.thirdPartyEVs).forEach(name => {
              const v = a.thirdPartyEVs[name] || 0;
              if (v > 0) {
                thirdPartyMap.set(name, (thirdPartyMap.get(name) || 0) + v);
              }
            });
          }
        });
      }

      if ((thirdPartyMap.size === 0) && (!allocations || !Array.isArray(allocations) || allocations.length === 0)) {
        try {
          rows.forEach(r => {
            if (!r || !r.thirdPartyResults || typeof r.thirdPartyResults !== 'object') return;
            Object.keys(r.thirdPartyResults).forEach(name => {
              const v = r.thirdPartyResults[name] || 0;
              if (v > 0) thirdPartyMap.set(name, (thirdPartyMap.get(name) || 0));
            });
          });
        } catch (e) { /* ignore fallback failures */ }
      }

      if (totalOtherEV > 0 && thirdPartyMap.size === 0) {
        thirdPartyMap.set('Other', totalOtherEV);
      }
    } catch (err) {
      console.warn(err);
    }
  }

  try {
    const thirdPartyLines = Array.from(thirdPartyMap.entries())
      .filter(([, ev]) => ev > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, ev]) => `${name} (${formatEvCount(ev, isElectionNight)})`);

    let outputHtml = '';
    if (dCandidate || rCandidate) {
      const leftSegment = dCandidate
        ? `<span style="display:inline-block;min-width:260px;white-space:nowrap">${dCandidate} (D) <span style="font-variant-numeric:tabular-nums">(${formatEvCount(totalDEv, isElectionNight)})</span></span>`
        : '';
      const rightSegment = rCandidate
        ? `<span style="display:inline-block;min-width:260px;white-space:nowrap;text-align:right"><span style="font-variant-numeric:tabular-nums">(${formatEvCount(totalREv, isElectionNight)})</span> ${rCandidate} (R)</span>`
        : '';
      const middleSegment = (dCandidate && rCandidate) ? '<span style="display:inline-block;width:48px;text-align:center">vs</span>' : '';
      const segments = [leftSegment, middleSegment, rightSegment].filter(Boolean).join('');
      outputHtml = segments ? `${year}: ${segments}` : `${year}: ${dCandidate || rCandidate}`;
    }

    if (thirdPartyLines.length > 0) {
      if (outputHtml) outputHtml += '<br>' + thirdPartyLines.join(', ');
      else outputHtml = `${year}: ` + thirdPartyLines.join(', ');
    }

    if (outputHtml) {
      candidateNamesEl.innerHTML = outputHtml;
    } else {
      candidateNamesEl.textContent = '';
    }
  } catch (e) {
    console.warn(e);
    if (dCandidate || rCandidate) {
      candidateNamesEl.textContent = `${year}: ${dCandidate} (D) vs ${rCandidate} (R)`;
    } else {
      candidateNamesEl.textContent = '';
    }
  }

  // Update special notes: aggregate any specialCaseNotes present on any row for this year
  try {
    const rowsForYear = rows || [];
    // Map from note text -> Set of units that have that note
    const noteMap = new Map();
    rowsForYear.forEach(rr => {
      if (!rr) return;
      const raw = (rr.specialCaseNotes || '').toString().trim();
      if (!raw) return;
      const u = rr.unit || '';
      if (!noteMap.has(raw)) noteMap.set(raw, new Set());
      if (u) noteMap.get(raw).add(u);
    });

    // Build display lines. If a note applies to a single unit, prefix with unit. If it applies to multiple units (including all), show the note once without repeating.
    const lines = [];
    noteMap.forEach((unitsSet, noteText) => {
      const units = Array.from(unitsSet || []);
      if (units.length === 1) {
        lines.push(`${units[0]}: ${noteText}`);
      } else {
        // Show the note once; don't repeat across many states
        lines.push(noteText);
      }
    });

    if (lines.length > 0) {
      specialNotesEl.innerHTML = lines.join('<br>');
    } else {
      specialNotesEl.textContent = '';
    }
  } catch (e) {
    // fallback to national row note
    const specialNotes = nationalRow.specialCaseNotes || '';
    specialNotesEl.textContent = specialNotes;
  }
}

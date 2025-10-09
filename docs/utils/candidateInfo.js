'use strict';
import { getAllEvAllocations } from "./evAllocation";
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
  let candidateHtml = '';
  if (dCandidate || rCandidate) {
    candidateHtml = `${year}: ${dCandidate} (D) vs ${rCandidate} (R)`;
  }

  // Attempt to enumerate third parties that received EVs for this year.
  try {
    let allocations = null;
    try {
      if (typeof getAllEvAllocations === 'function') allocations = getAllEvAllocations();
      //console.log('allocations:', allocations);
    } catch (e) { console.warn(e); }
    if (!allocations) {
      try { if (typeof window.getAllEvAllocations === 'function') allocations = window.getAllEvAllocations(); } catch (e) { console.warn(e); }
    }
    const thirdPartiesWithEVs = new Map(); // Map of name -> total EV count
    let totalOtherEV = 0;
    if (allocations && Array.isArray(allocations)) {
      allocations.forEach(a => {
        //console.log('a:', a);
        totalOtherEV += (a.oEV || 0);
        // add any detailed third-party allocations
        if (a.thirdPartyEVs && typeof a.thirdPartyEVs === 'object') {
          //console.log('detailed third party EVs', a.thirdPartyEVs, 'a:', a);
          Object.keys(a.thirdPartyEVs).forEach(name => {
            const v = a.thirdPartyEVs[name] || 0;
            if (v > 0) {
              thirdPartiesWithEVs.set(name, (thirdPartiesWithEVs.get(name) || 0) + v);
            }
          });
        }
      });
    }

    // Fallback: if allocations weren't available or yielded nothing, scan rows for any
    // per-row thirdPartyResults (votes) to discover third-party names. This allows
    // candidate area to show names even if the allocation helper isn't ready yet.
    if ((thirdPartiesWithEVs.size === 0) && (!allocations || !Array.isArray(allocations) || allocations.length === 0)) {
      try {
        rows.forEach(r => {
          if (!r) return;
          // r.thirdPartyResults holds per-row third-party vote counts (if present)
          if (r.thirdPartyResults && typeof r.thirdPartyResults === 'object') {
            Object.keys(r.thirdPartyResults).forEach(name => {
              const v = r.thirdPartyResults[name] || 0;
              // We don't know EVs here, but presence of votes indicates the party existed in this unit
              if (v > 0) thirdPartiesWithEVs.set(name, (thirdPartiesWithEVs.get(name) || 0));
            });
          }
        });
      } catch (e) { /* ignore fallback failures */ }
    }

    // If there are Other EVs but no detailed names, track as generic "Other"
    if (totalOtherEV > 0 && thirdPartiesWithEVs.size === 0) {
      thirdPartiesWithEVs.set('Other', totalOtherEV);
    }

    if (candidateHtml) {
      // Compute major-party EV totals (if allocations are available)
      let totalDEv = 0, totalREv = 0;
      try {
        if (allocations && Array.isArray(allocations)) {
          totalDEv = allocations.reduce((s, a) => s + (a.dEV || 0), 0);
          totalREv = allocations.reduce((s, a) => s + (a.rEV || 0), 0);
        }
      } catch (e) { console.warn(e); }

      // If we have EV totals, render first line with fixed-space layout so names don't jump
      if ((totalDEv > 0 || totalREv > 0) && (dCandidate || rCandidate)) {
        // left and right columns use inline-blocks with a min-width so changing names don't reflow
        const left = `${dCandidate} (D) <span style="font-variant-numeric:tabular-nums">(${totalDEv} ${totalDEv === 1 ? 'EV' : 'EVs'})</span>`;
        const right = `<span style="font-variant-numeric:tabular-nums">(${totalREv} ${totalREv === 1 ? 'EV' : 'EVs'})</span> ${rCandidate} (R)`;
        candidateHtml = `${year}: <span style="display:inline-block;min-width:260px;white-space:nowrap">${left}</span><span style="display:inline-block;width:48px;text-align:center">vs</span><span style="display:inline-block;min-width:260px;white-space:nowrap;text-align:right">${right}</span>`;
      }

      if (thirdPartiesWithEVs.size > 0) {
        // Format: "Candidate Name (X EVs)"
        const thirdPartyLines = Array.from(thirdPartiesWithEVs.entries())
          .sort((a, b) => b[1] - a[1]) // Sort by EV count descending
          .map(([name, evCount]) => `${name} (${evCount} ${evCount === 1 ? 'EV' : 'EVs'})`);
        candidateHtml += '<br>' + thirdPartyLines.join(', ');
      }
      candidateNamesEl.innerHTML = candidateHtml;
    } else {
      // No major-party names available, but maybe show third parties only
      if (thirdPartiesWithEVs.size > 0) {
        const thirdPartyLines = Array.from(thirdPartiesWithEVs.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([name, evCount]) => `${name} (${evCount} ${evCount === 1 ? 'EV' : 'EVs'})`);
        candidateNamesEl.innerHTML = `${year}: ` + thirdPartyLines.join(', ');
      } else {
        candidateNamesEl.textContent = '';
      }
    }
  } catch (e) {
    console.warn(e);
    // Fallback to original simple text when something goes wrong
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

(function() {
  'use strict';

  /**
   * Candidate Information Manager
   * Handles displaying candidate names and electoral vote allocations
   */

  const CandidateInfo = {
    /**
     * Get candidate names for a given year from data rows
     * @param {number} year - The election year
     * @param {Array} rows - The data rows for the year
     * @returns {Object} - { D: string, R: string, O: string|null }
     */
    getCandidateNames(year, rows) {
      if (!rows || !rows.length) return { D: 'D', R: 'R', O: null };

      const nationalRow = rows.find(r => r && (r.unit === 'NATIONAL' || r.unit === 'NAT'));
      if (!nationalRow) return { D: 'D', R: 'R', O: null };

      const dCandidate = nationalRow.dCandidate || 'D';
      const rCandidate = nationalRow.rCandidate || 'R';
      
      // Try to find a third-party candidate name if available
      let oCandidate = null;
      if (nationalRow.topThirdCandidate) {
        oCandidate = nationalRow.topThirdCandidate;
      }

      return { D: dCandidate, R: rCandidate, O: oCandidate };
    },

    /**
     * Format candidate display text with optional EV counts
     * @param {Object} candidates - { D, R, O }
     * @param {Object} evCounts - { D, R, O } (optional)
     * @param {number} year - The election year
     * @returns {string} - HTML string for display
     */
    formatCandidateDisplay(candidates, evCounts, year) {
      const { D, R, O } = candidates;
      
      if (!D && !R) return '';

      let html = '';
      
      if (evCounts && (evCounts.D > 0 || evCounts.R > 0)) {
        // Desktop format with EV counts
        const left = `${D} (D) <span style="font-variant-numeric:tabular-nums">(${evCounts.D} ${evCounts.D === 1 ? 'EV' : 'EVs'})</span>`;
        const right = `<span style="font-variant-numeric:tabular-nums">(${evCounts.R} ${evCounts.R === 1 ? 'EV' : 'EVs'})</span> ${R} (R)`;
        html = `${year}: <span class="candidate-left">${left}</span><span class="candidate-vs">vs</span><span class="candidate-right">${right}</span>`;
        
        // Add third-party line if present
        if (O && evCounts.O > 0) {
          html += `<br><span class="candidate-third">${O} (${evCounts.O} ${evCounts.O === 1 ? 'EV' : 'EVs'})</span>`;
        }
      } else {
        // Simple format without EV counts
        html = `${year}: ${D} (D) vs ${R} (R)`;
        if (O) {
          html += `<br>${O}`;
        }
      }

      return html;
    },

    /**
     * Update the candidate info display element
     * @param {HTMLElement} element - The element to update
     * @param {number} year - The election year
     * @param {Array} rows - The data rows
     * @param {Object} evCounts - Optional EV counts { D, R, O }
     */
    updateDisplay(element, year, rows, evCounts) {
      if (!element) return;

      const candidates = this.getCandidateNames(year, rows);
      const html = this.formatCandidateDisplay(candidates, evCounts, year);
      
      if (html) {
        element.innerHTML = html;
      } else {
        element.textContent = '';
      }
    }
  };

  // Export to window
  try {
    window.CandidateInfo = CandidateInfo;
  } catch (e) {
    console.warn('[CandidateInfo] Failed to export to window:', e);
  }
})();

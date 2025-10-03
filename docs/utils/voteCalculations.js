(function() {
  'use strict';

  // Shared vote calculation and PV adjustment utilities

  /**
   * Get total votes from a data row
   * @param {object} row - Data row with vote information
   * @returns {number} Total votes
   */
  function totalVotesFromRow(row) {
    const direct = +row.total;
    if (isFinite(direct) && direct > 0) return direct;
    const fallback = (+row.dVotes || 0) + (+row.rVotes || 0) + (+row.tVotes || 0);
    return fallback > 0 ? fallback : 0;
  }

  /**
   * Compute PV-adjusted vote breakdown for a unit
   * @param {object} row - Data row with vote information
   * @param {number} pvShift - Popular vote shift to apply
   * @param {number} natActualMargin - National actual margin
   * @returns {object} Breakdown with dVotes, rVotes, topThirdVotes, totalThirdVotes, etc.
   */
  function computePvAdjustedBreakdown(row, pvShift = 0, natActualMargin = 0) {
    if (!row) return { dVotes: 0, rVotes: 0, topThirdVotes: 0, totalThirdVotes: 0, totalVotes: 0 };

    const totalVotes = totalVotesFromRow(row);
    if (!isFinite(totalVotes) || totalVotes <= 0) {
      return { dVotes: 0, rVotes: 0, topThirdVotes: 0, totalThirdVotes: 0, totalVotes: 0 };
    }

    // Base vote shares
    let dVotesBase = Math.max(0, +row.dVotes || 0);
    let rVotesBase = Math.max(0, +row.rVotes || 0);
    let tVotesBase = Math.max(0, +row.tVotes || 0);

    // Apply PV shift to major party votes
    const majorBase = dVotesBase + rVotesBase;
    if (majorBase > 0 && Math.abs(pvShift) > 1e-10) {
      const dShareBase = dVotesBase / majorBase;
      const rShareBase = rVotesBase / majorBase;
      
      // Calculate current margin
      const currentMargin = dShareBase - rShareBase;
      
      // Apply shift
      const targetMargin = currentMargin + pvShift;
      
      // Clamp margin
      const EPS = window.ElectionConstants ? window.ElectionConstants.EPS : 1e-8;
      const LIMIT = 1 - EPS;
      const clampedMargin = Math.max(-LIMIT, Math.min(LIMIT, targetMargin));
      
      // Convert back to shares
      const dShareNew = (1 + clampedMargin) / 2;
      const rShareNew = (1 - clampedMargin) / 2;
      
      // Scale back to votes
      dVotesBase = dShareNew * majorBase;
      rVotesBase = rShareNew * majorBase;
    }

    // Third party vote handling
    const topThirdVotes = Math.max(0, +row.topThirdVotes || 0);
    let totalThirdVotes = Math.max(0, tVotesBase);
    if (totalThirdVotes < topThirdVotes) totalThirdVotes = topThirdVotes;

    const topThirdShareOfTotal = totalVotes > 0 ? (topThirdVotes / totalVotes) : 0;
    const totalThirdShareOfTotal = totalVotes > 0 ? (totalThirdVotes / totalVotes) : 0;

    return {
      dVotes: dVotesBase,
      rVotes: rVotesBase,
      topThirdVotes: topThirdVotes,
      totalThirdVotes: totalThirdVotes,
      topThirdShareOfTotal: topThirdShareOfTotal,
      totalThirdShareOfTotal: totalThirdShareOfTotal,
      totalVotes: dVotesBase + rVotesBase + totalThirdVotes
    };
  }

  // Export to global scope
  const VoteCalculations = {
    totalVotesFromRow,
    computePvAdjustedBreakdown
  };

  try {
    window.VoteCalculations = VoteCalculations;
  } catch(e) {
    console.error('[VoteCalculations] Failed to export to window:', e);
  }
})();

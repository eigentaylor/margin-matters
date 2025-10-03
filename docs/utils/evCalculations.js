(function() {
  'use strict';

  // Shared EV allocation and calculation utilities

  /**
   * Allocate EVs proportionally using the largest remainder method
   * Supports multiple third parties via thirdPartyResults object
   * @param {number} dVotes - Democratic votes
   * @param {number} rVotes - Republican votes
   * @param {number} oVotes - Other/third party votes (total)
   * @param {number} totalEVs - Total EVs to allocate
   * @param {number} topThirdPartyShare - Share of top third party (0-1)
   * @param {object} thirdPartyResults - Object mapping party names to vote counts
   * @returns {object} { D, R, O, thirdParties: {} }
   */
  function allocateProportionalEVs(dVotes, rVotes, oVotes, totalEVs, topThirdPartyShare, thirdPartyResults) {
    const total = dVotes + rVotes + oVotes;
    if (total <= 0 || totalEVs <= 0) return { D: 0, R: 0, O: 0, thirdParties: {} };

    // When thirdPartyResults is provided and has multiple parties, split third party votes proportionally
    const thirdParties = {};
    let hasMultipleThirdParties = false;

    if (thirdPartyResults && typeof thirdPartyResults === 'object') {
      const thirdPartyEntries = Object.entries(thirdPartyResults).filter(([name, votes]) => {
        // Filter out "Other(s)"
        return name !== 'Other' && name !== 'Others';
      });
      
      if (thirdPartyEntries.length > 0) {
        hasMultipleThirdParties = thirdPartyEntries.length > 1;

        // Calculate quotas for each party including third parties
        const parties = [
          { name: 'D', votes: dVotes },
          { name: 'R', votes: rVotes }
        ];

        // Add each third party
        thirdPartyEntries.forEach(([name, votes]) => {
          parties.push({ name: name, votes: +votes || 0, isThirdParty: true });
        });

        // Calculate quotas using largest remainder method
        const allocated = {};
        let totalAllocated = 0;
        const remainders = [];

        parties.forEach(p => {
          const share = p.votes / total;
          const quota = Math.floor(share * totalEVs);
          const remainder = (share * totalEVs) - quota;

          if (p.isThirdParty) {
            thirdParties[p.name] = quota;
          } else {
            allocated[p.name] = quota;
          }
          totalAllocated += quota;
          remainders.push({ name: p.name, remainder, isThirdParty: p.isThirdParty });
        });

        // Allocate remaining EVs
        let remaining = totalEVs - totalAllocated;
        remainders.sort((a, b) => b.remainder - a.remainder);

        for (let i = 0; i < remaining && i < remainders.length; i++) {
          const r = remainders[i];
          if (r.isThirdParty) {
            thirdParties[r.name] = (thirdParties[r.name] || 0) + 1;
          } else {
            allocated[r.name] = (allocated[r.name] || 0) + 1;
          }
        }

        return {
          D: allocated.D || 0,
          R: allocated.R || 0,
          O: 0, // Not used when we have detailed third parties
          thirdParties: thirdParties
        };
      }
    }

    // Fallback to simple D/R/O allocation when no detailed third party data
    const dShare = dVotes / total;
    const rShare = rVotes / total;
    const oShare = oVotes / total;

    const dQuota = Math.floor(dShare * totalEVs);
    const rQuota = Math.floor(rShare * totalEVs);
    const oQuota = Math.floor(oShare * totalEVs);

    let allocated = { D: dQuota, R: rQuota, O: oQuota };
    let remaining = totalEVs - (dQuota + rQuota + oQuota);

    if (remaining > 0) {
      const remainders = [
        { party: 'D', remainder: (dShare * totalEVs) - dQuota },
        { party: 'R', remainder: (rShare * totalEVs) - rQuota },
        { party: 'O', remainder: (oShare * totalEVs) - oQuota }
      ];

      remainders.sort((a, b) => b.remainder - a.remainder);

      for (let i = 0; i < remaining; i++) {
        allocated[remainders[i].party]++;
      }
    }

    return { ...allocated, thirdParties: {} };
  }

  // Export to global scope
  const EvCalculations = {
    allocateProportionalEVs
  };

  try {
    window.EvCalculations = EvCalculations;
  } catch(e) {
    console.error('[EvCalculations] Failed to export to window:', e);
  }
})();

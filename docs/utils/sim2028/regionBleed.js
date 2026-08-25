'use strict';

/**
 * Shared "region bleed" tiering for candidate home-state bonuses.
 *
 * Used by both homeStateAdvantage.js (D/R's existing zero-sum home-state lean
 * bump) and thirdParty.js (the third-party candidate's own regional-strength
 * bump) so the tier constants and the unit/multiplier lookup live in exactly
 * one place, instead of each caller re-deriving it. Lives in its own file
 * rather than inside either caller: regions.js stays pure geography data, and
 * homeStateAdvantage.js is a D/R-specific concept that thirdParty.js
 * shouldn't need to import from.
 */

import { AT_LARGE_COMPONENTS } from './baseline.js';
import { regionOf, REGION_ADJACENCY } from './regions.js';

/**
 * home = the candidate's own state, sameRegion = the rest of that REGIONS
 * bucket, adjacentRegion = REGION_ADJACENCY's neighboring buckets, else 0.
 */
export const REGION_BLEED_TIERS = {
  home: 1.0,
  sameRegion: 0.35,
  adjacentRegion: 0.12,
};

/**
 * Resolve a chosen home state to the sim unit(s) it actually affects. ME/NE
 * only carry electoral votes through their district units + a derived
 * at-large unit, so "home state" (a statewide concept) bumps both districts,
 * not a unit that isn't independently simulated.
 */
export function homeStateUnits(stateAbbr, baseline) {
  if (!stateAbbr || !baseline) return [];
  const alUnit = `${stateAbbr}-AL`;
  const components = AT_LARGE_COMPONENTS[alUnit];
  if (components) return components.slice();
  return baseline.simUnits && baseline.simUnits.includes(stateAbbr) ? [stateAbbr] : [];
}

/**
 * @param {string}  stateAbbr
 * @param {object}  baseline
 * @param {boolean} bleedEnabled  false => returns ONLY the home unit(s) at
 *        1.0 (byte-identical to the pre-region-bleed homeStateUnits()-only
 *        behavior)
 * @param {object}  [tiers=REGION_BLEED_TIERS]
 * @returns {Map<string, number>} unit -> multiplier, over baseline.simUnits
 *          only (at-large units are derived downstream by each caller, same
 *          convention truthRel/base already use)
 */
export function bleedUnitsFor(stateAbbr, baseline, bleedEnabled, tiers = REGION_BLEED_TIERS) {
  const out = new Map();
  const homeUnits = homeStateUnits(stateAbbr, baseline);
  for (const u of homeUnits) out.set(u, tiers.home);
  if (!bleedEnabled || !homeUnits.length) return out;

  const homeRegion = regionOf(stateAbbr);
  if (!homeRegion) return out;
  const adjacent = new Set(REGION_ADJACENCY[homeRegion] || []);

  for (const unit of baseline.simUnits) {
    if (out.has(unit)) continue; // never downgrade the home state's own units below tier 'home'
    const r = regionOf(unit);
    if (r === homeRegion) out.set(unit, tiers.sameRegion);
    else if (adjacent.has(r)) out.set(unit, tiers.adjacentRegion);
  }
  return out;
}

export default { homeStateUnits, bleedUnitsFor, REGION_BLEED_TIERS };

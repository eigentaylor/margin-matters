'use strict';

/**
 * Hand-defined regional buckets for the 2028 simulator's correlated error model.
 *
 * This is the file you edit when a run "feels wrong". Every state in a region
 * shares one regional shock draw, so states grouped here move together — that's
 * what produces WI/MI/PA missing as a bloc rather than independently.
 *
 * Buckets are political-geography groupings, not Census divisions. ME/NE
 * districts inherit their parent state's region.
 */

export const REGIONS = {
  newEngland: ['ME-AL', 'ME-01', 'ME-02', 'NH', 'VT', 'RI', 'CT', 'MA'],
  midAtlantic: ['NY', 'NJ', 'DE', 'MD', 'DC', 'VA'],
  rustBelt: ['PA', 'OH', 'MI', 'WI', 'IA', 'IN', 'MN'],
  plains: ['ND', 'SD', 'NE-AL', 'NE-01', 'NE-02', 'NE-03', 'KS', 'MO', 'OK'],
  // Alaska (correlation w/ south bucket) and South Carolina (real early-90s break from VA/GA)
  south: ['WV', 'KY', 'TN', 'AR', 'MS', 'AL', 'LA', 'AK', 'SC', 'FL'],
  sunBelt: ['TX', 'AZ', 'GA', 'NC'], 
  southwest: ['NM', 'NV', 'CO'], 
  mountain: ['MT', 'ID', 'WY', 'UT'],
  pacific: ['WA', 'OR', 'CA', 'IL'], // IL is included here due to its fairly high correlation with the Pacific region
  hawaii: ['HI'] // Hawaii is its own region. It has very low correlation with other regions
};

export const REGION_KEYS = Object.keys(REGIONS);

/** Display labels for UI/debug output. */
export const REGION_LABELS = {
  newEngland: 'New England',
  midAtlantic: 'Mid-Atlantic',
  rustBelt: 'Rust Belt',
  plains: 'Plains',
  south: 'South',
  southeast: 'Southeast',
  southwest: 'Southwest',
  suburbanRealignment: 'Suburban Realignment',
  mountain: 'Mountain West',
  pacific: 'Pacific',
  hawaii: 'Hawaii',
};

const UNIT_TO_REGION = new Map();
for (const key of REGION_KEYS) {
  for (const unit of REGIONS[key]) UNIT_TO_REGION.set(unit, key);
}

/** All units covered by the region map (50 states + DC + ME/NE splits). */
export const ALL_UNITS = Array.from(UNIT_TO_REGION.keys());

/**
 * Region key for a unit. Falls back to the parent state's region for any
 * district-style unit not listed explicitly, then to null.
 */
export function regionOf(unit) {
  if (!unit) return null;
  if (UNIT_TO_REGION.has(unit)) return UNIT_TO_REGION.get(unit);
  const parent = String(unit).slice(0, 2);
  return UNIT_TO_REGION.has(parent) ? UNIT_TO_REGION.get(parent) : null;
}

export default { REGIONS, REGION_KEYS, REGION_LABELS, ALL_UNITS, regionOf };

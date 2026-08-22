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
  // Minnesota correlates strongly with New England, MA doesn't fit clearly here
  newEngland: ['ME-AL', 'ME-01', 'ME-02', 'NH', 'VT', 'RI', 'CT', 'MN'],
  // Florida is included in the Mid-Atlantic due to its correlation with that region in recent cycles.
  midAtlantic: ['NY', 'NJ', 'DE', 'MD', 'DC', 'FL'],
  rustBelt: ['PA', 'OH', 'MI', 'WI', 'IA', 'IN'],
  plains: ['ND', 'SD', 'NE-AL', 'NE-01', 'NE-02', 'NE-03', 'KS', 'MO', 'OK'],
  // Alaska (correlation w/ south bucket) and South Carolina (real early-90s break from VA/GA,
  // and a clean fit — adding it raises south's own internal coherence at every window tested)
  south: ['WV', 'KY', 'TN', 'AR', 'MS', 'AL', 'LA', 'AK', 'SC'],
  southeast: ['VA', 'NC', 'GA'], // SC split out — see south, above
  southwest: ['NM', 'NV', 'CO'], // AZ split out — see arizona, below
  // MA has very negative correlation with basically all other regions since 2000, maxes out at +0.31 with the south
  // MA and AZ correlate at +0.96 (2000-2024) / +0.79 (1980-2024) despite having
  // nothing geographically in common -- both driven by the same college-educated
  // suburban realignment (Boston suburbs, Maricopa County), just from very
  // different baseline leans, which is exactly what a relative-margin-swing
  // metric picks up on.
  suburbanRealignment: ['MA', 'AZ'],
  // Texas is included in the Mountain region due to its correlation with that bloc in recent cycles.
  mountain: ['MT', 'ID', 'WY', 'UT', 'TX'],
  pacific: ['WA', 'OR', 'CA', 'IL'], // IL is included here due to its fairly high correlation with the Pacific region
  hawaii: ['HI'] // Hawaii is its own region. like Massachusetts, it has very low correlation with other regions (caps out at ~0.4 with the rust belt)
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

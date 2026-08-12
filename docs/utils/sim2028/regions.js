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
  newEngland: ['ME-AL', 'ME-01', 'ME-02', 'NH', 'VT', 'MA', 'RI', 'CT'],
  midAtlantic: ['NY', 'NJ', 'DE', 'MD', 'DC'],
  // PA belongs here, not with the Mid-Atlantic: it moves with WI/MI far more
  // than with NY/NJ, and those three deciding together is the defining feature
  // of a modern cycle.
  rustBelt: ['PA', 'OH', 'MI', 'WI', 'MN', 'IA', 'IN', 'IL'],
  plains: ['ND', 'SD', 'NE-AL', 'NE-01', 'NE-02', 'NE-03', 'KS', 'MO', 'OK'],
  south: ['WV', 'KY', 'TN', 'AR', 'MS', 'AL', 'LA'],
  southeast: ['VA', 'NC', 'SC', 'GA', 'FL'],
  southwest: ['AZ', 'NM', 'NV', 'TX', 'CO'],
  mountain: ['MT', 'ID', 'WY', 'UT'],
  pacific: ['WA', 'OR', 'CA', 'HI', 'AK'],
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
  mountain: 'Mountain West',
  pacific: 'Pacific',
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

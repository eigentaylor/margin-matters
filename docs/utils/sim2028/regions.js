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
  newEngland: ['VT', 'NH', 'ME-01', 'ME-AL', 'RI', 'DE', 'CT'],
  midAtlantic: ['NY', 'NJ', 'MD', 'FL', 'MA'],
  south: ['MS', 'AL', 'SC', 'LA', 'AR', 'OK'],
  // CO/OR/WA/NV/KS/NE cluster on correlation, not contiguity -- OR/WA/NV form
  // one real Pacific/Mountain pocket and CO/KS/NE another Great Plains one.
  northwest: ['CO', 'OR', 'WA', 'KS', 'NE-01', 'NE-AL', 'NE-02', 'NV'],
  // NE-03 is grouped here on correlation (Nebraska's 2nd district behaves like
  // border-south turf), not real geography -- it isn't near WV/KY/TN/MO.
  appalachia: ['WV', 'KY', 'MO', 'NE-03', 'TN'],
  // ME-02 is grouped here on correlation (it behaves like a Rust Belt seat),
  // not real geography -- it isn't near OH/IN/MI/etc.
  rustBelt: ['OH', 'IA', 'MN', 'IN', 'PA', 'MI', 'WI', 'ME-02'],
  // IL and DC are grouped here on correlation, not real geography -- neither
  // borders NM/UT/TX/CA/AZ. See REGION_ADJACENCY's note on why their real
  // borders (IL's to the Midwest, DC's to MD/VA) don't get projected onto
  // this bucket.
  southwest: ['NM', 'UT', 'TX', 'CA', 'AZ', 'IL', 'DC'],
  alaska: ['AK'], // Its own region -- no land border with any other unit here.
  hawaii: ['HI'], // Its own region -- very low correlation with the mainland.
  plains: ['MT', 'ID', 'SD', 'ND', 'WY'],
  southeast: ['VA', 'GA', 'NC'],
};

export const REGION_KEYS = Object.keys(REGIONS);

/**
 * Which region buckets border/relate to which others, for the region-bleed
 * home-state mechanic (candidatePicker/homeStateAdvantage): a candidate's
 * home-state bump extends at reduced strength into their own bucket and,
 * fainter still, into adjacent buckets here.
 *
 * Hand-authored from each region's real-world geographic/cultural identity,
 * like REGIONS itself -- NOT mechanically derived from every member state's
 * literal borders. Several members are grouped by voting-correlation rather
 * than geography (IL and DC in `southwest`, ME-02 in `rustBelt`, the NE
 * districts split across `northwest`/`appalachia`; see REGIONS above), and
 * letting those outliers project their own real borders onto their bucket
 * would produce nonsense -- e.g. IL's real Midwest borders would wrongly
 * make `southwest` adjacent to `rustBelt`, and DC's real MD/VA borders would
 * wrongly make `southwest` adjacent to `midAtlantic`/`southeast` (both of
 * which are already legitimately adjacent to other buckets on their own
 * merits, without DC's help). Symmetric by construction; edit freely, same
 * as REGIONS.
 */
export const REGION_ADJACENCY = {
  newEngland: ['midAtlantic'],
  midAtlantic: ['newEngland', 'rustBelt', 'appalachia', 'southeast'],
  south: ['southeast', 'appalachia', 'southwest', 'northwest'],
  northwest: ['southwest', 'plains', 'south', 'appalachia'],
  appalachia: ['rustBelt', 'southeast', 'south', 'northwest'],
  rustBelt: ['midAtlantic', 'appalachia', 'plains'],
  southwest: ['south', 'northwest', 'plains'],
  alaska: [],
  hawaii: [],
  plains: ['rustBelt', 'northwest', 'southwest', 'appalachia'],
  southeast: ['midAtlantic', 'appalachia', 'south'],
};

/** Display labels for UI/debug output. */
export const REGION_LABELS = {
  newEngland: 'New England',
  midAtlantic: 'Mid-Atlantic',
  south: 'South',
  northwest: 'Northwest',
  appalachia: 'Appalachia',
  rustBelt: 'Rust Belt',
  southwest: 'Southwest',
  alaska: 'Alaska',
  hawaii: 'Hawaii',
  plains: 'Plains',
  southeast: 'Southeast',
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

export default { REGIONS, REGION_KEYS, REGION_LABELS, REGION_ADJACENCY, ALL_UNITS, regionOf };

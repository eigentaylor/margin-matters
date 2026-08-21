'use strict';

/**
 * Candidate-specific home-state lean bump for sim2028.
 *
 * Three sources feed it: the 7 preset 2028 candidates (candidatePicker.js's
 * PRESET_CANDIDATES) get a fixed home state (PRESET_HOME_STATES below) with a
 * user-adjustable strength; custom-typed candidates and historical search picks (from
 * candidateSearch.js's ~150-year portrait index) both get a user-picked home state AND
 * strength -- there's no principled way to guess a home state for either (a typed name
 * could be anyone, and there's no ranking of real historical candidates' crossover appeal
 * against each other), so the user sets it themselves rather than the sim imposing one.
 *
 * The literature on "favorite son" effects (a running mate or nominee tied to a state)
 * finds close to nothing. Real crossover appeal (a governor/senator who runs well ahead of
 * their party at home -- Beshear in KY, Ossoff in GA) is a different and stronger signal,
 * but it's measured in low-turnout, low-polarization state races and shouldn't port 1:1
 * into a maximally nationalized presidential contest. So every preset candidate gets the
 * SAME flat bump at full strength (no ranking whose crossover appeal is "real"), scaled
 * per-state by baseline.betaFitted -- the same historically-fitted elasticity baseline.js
 * uses to describe how much of a national swing a state absorbs, reused here as a proxy for
 * how persuadable/movable that state's electorate is. A state baseline.js's own fit treats
 * as locked-in (low beta) responds less to a home-state bump than a genuinely elastic one,
 * even at the same nominal tier -- which is exactly why Beshear can't meaningfully dent
 * KY's partisan lean here even at the wackiest setting, while Ossoff moves GA more.
 */

import { AT_LARGE_COMPONENTS, deriveAtLarge } from './baseline.js';

/** Home state for each of the 7 preset 2028 candidates (candidatePicker.js's PRESET_CANDIDATES). */
export const PRESET_HOME_STATES = {
  'Jon Ossoff': 'GA',
  'Andy Beshear': 'KY',
  'Pete Buttigieg': 'IN',
  'Alexandria Ocasio-Cortez': 'NY',
  'Gavin Newsom': 'CA',
  'JD Vance': 'OH',
  'Marco Rubio': 'FL',
};

/**
 * Four tiers on a single "realism" dial. `presetMagnitude` is the flat bump every preset
 * candidate gets (before beta scaling); `customCap` is the bump a custom candidate gets at
 * strength=1 (also before beta scaling) -- both in margin FRACTIONS (0.01 = 1pt).
 */
export const REALISM_TIERS = {
  off: { presetMagnitude: 0, customCap: 0 },
  subtle: { presetMagnitude: 0.010, customCap: 0.03 },
  noticeable: { presetMagnitude: 0.025, customCap: 0.07 },
  wacky: { presetMagnitude: 0.05, customCap: 0.15 },
};

export const DEFAULT_REALISM_TIER = 'subtle';

/**
 * Resolve a chosen home state to the sim unit(s) it actually affects. ME/NE only carry
 * electoral votes through their district units + a derived at-large unit (see
 * AT_LARGE_COMPONENTS) -- "home state" is a statewide concept, so picking Maine bumps both
 * ME-01 and ME-02, not a unit that isn't independently simulated.
 */
export function homeStateUnits(stateAbbr, baseline) {
  if (!stateAbbr || !baseline) return [];
  const alUnit = `${stateAbbr}-AL`;
  const components = AT_LARGE_COMPONENTS[alUnit];
  if (components) return components.slice();
  return baseline.simUnits && baseline.simUnits.includes(stateAbbr) ? [stateAbbr] : [];
}

/** One party's contribution to the bonus map, mutating `bonus` in place. */
function addPartyBonus(bonus, baseline, choice, tier, sign) {
  if (!choice) return;
  let stateAbbr = null;
  let magnitude = 0;
  if ((choice.mode === 'custom' || choice.mode === 'historical') && choice.homeState) {
    stateAbbr = choice.homeState;
    const strength = Math.max(0, Math.min(1, choice.strength ?? 0));
    magnitude = strength * tier.customCap;
  } else if (choice.mode === 'preset' && PRESET_HOME_STATES[choice.name]) {
    stateAbbr = PRESET_HOME_STATES[choice.name];
    const strength = Math.max(0, Math.min(1, choice.strength ?? 1));
    magnitude = strength * tier.presetMagnitude;
  }
  if (!stateAbbr || magnitude === 0) return;
  const units = homeStateUnits(stateAbbr, baseline);
  for (const unit of units) {
    const beta = (baseline.betaFitted && baseline.betaFitted.get(unit)) ?? 1;
    bonus.set(unit, (bonus.get(unit) || 0) + sign * magnitude * beta);
  }
}

/**
 * Recomputes baseline.base as baseline.baseOriginal plus each party's home-state bonus,
 * re-centered so the vote-weighted mean stays 0 (matching buildBaseline's own centering --
 * a home-state bump should reshape the map, not sneak in a hidden national tilt), then
 * re-derives the ME/NE at-large units from their (possibly bumped) districts.
 *
 * Always recomputes from baseOriginal, so calling this repeatedly (candidate swap, realism
 * tier change, re-running "Start campaign") never accumulates a bonus on top of itself.
 */
export function applyHomeStateAdvantage(baseline, candidates, realismKey) {
  if (!baseline || !baseline.baseOriginal) return;
  const tier = REALISM_TIERS[realismKey] || REALISM_TIERS[DEFAULT_REALISM_TIER];

  const bonus = new Map();
  addPartyBonus(bonus, baseline, candidates && candidates.d, tier, 1);
  addPartyBonus(bonus, baseline, candidates && candidates.r, tier, -1);

  const newBase = new Map();
  let weightedSum = 0;
  for (const unit of baseline.simUnits) {
    const v = (baseline.baseOriginal.get(unit) || 0) + (bonus.get(unit) || 0);
    newBase.set(unit, v);
    weightedSum += v * (baseline.weights.get(unit) || 0);
  }
  for (const unit of baseline.simUnits) {
    newBase.set(unit, newBase.get(unit) - weightedSum);
  }

  baseline.base = newBase;
  deriveAtLarge(baseline.base, baseline);
}

export default {
  PRESET_HOME_STATES, REALISM_TIERS, DEFAULT_REALISM_TIER,
  homeStateUnits, applyHomeStateAdvantage,
};

'use strict';

/**
 * The analytic (not Monte Carlo) tipping-point state, matching the definition
 * the rest of the site already uses (see build_stop_colors.py / build_tipping_points.py,
 * which drive tipping_points.csv): the one state whose own flip is what pushes the
 * winning coalition's electoral vote total past the majority threshold, as the
 * national environment sweeps from a Republican landslide to a Democratic one.
 *
 * This is a fixed property of the LEANS alone (margin = rel + beta*npv for every
 * unit) — it does not depend on which national popular vote you currently assume.
 * Evaluating it "at the current NPV" (e.g. by running Monte Carlo forecasts and
 * seeing which state comes up as the closest race most often) is a different,
 * legitimately NPV-dependent question — that's what forecast.js's tippingPoint
 * answers, and both are worth showing, but they mean different things.
 *
 * Each unit flips from R to D exactly once, at the popular vote where its own
 * margin crosses zero: rel + beta*npv = 0  =>  npv = -rel/beta. Sorting units by
 * that crossing point orders them from safest-Democratic to safest-Republican —
 * that IS the order they flip in as npv sweeps upward. Walking that order from
 * the Democratic end and accumulating EV, the state whose addition first reaches
 * the majority is the tipping-point state, and its own crossing point is exactly
 * the national popular vote at which the electoral college outcome flips.
 */

/**
 * @param {object} o
 * @param {string[]}            o.units
 * @param {Map<string,number>}  o.rel    relative margin per unit
 * @param {Map<string,number>}  o.beta   elasticity per unit
 * @param {Map<string,number>}  o.ev     electoral votes per unit
 * @param {number}              o.totalEv
 * @returns {{unit:string, npvThreshold:number, demEvAtThreshold:number, order: Array}|null}
 */
export function analyticTippingPoint({ units, rel, beta, ev, totalEv }) {
  const needed = Math.floor(totalEv / 2) + 1;

  const crossings = units
    .map(unit => ({
      unit,
      // The NPV at which this unit's own margin hits exactly zero.
      npvCrossing: -(rel.get(unit) || 0) / (beta.get(unit) || 1),
      ev: ev.get(unit) || 0,
    }))
    .filter(c => c.ev > 0)
    .sort((a, b) => a.npvCrossing - b.npvCrossing); // safest-D first

  let acc = 0;
  for (const c of crossings) {
    acc += c.ev;
    if (acc >= needed) {
      return { unit: c.unit, npvThreshold: c.npvCrossing, demEvAtThreshold: acc, order: crossings };
    }
  }
  return null;
}

export default { analyticTippingPoint };

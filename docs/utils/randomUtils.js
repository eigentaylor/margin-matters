"use strict";
// Small randomness and hash helpers used in simulations
export function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randn(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Student's t with `df` degrees of freedom (df >= 1, integer). Fatter tails at low df.
 * NOT variance-normalized: Var(t_df) = df/(df-2) for df>2 (e.g. 1.5 at df=6), not 1.
 * Callers building an inference (not just a draw) around this must scale their
 * assumed sigma by sqrt(df/(df-2)) to match the realized draw distribution, or
 * normalize the draw itself (z * sqrt((df-2)/df)) - don't assume Var=1 silently.
 */
export function randStudentT(rng, df) {
  const z = randn(rng);
  let v = 0;
  for (let i = 0; i < df; i++) {
    const g = randn(rng);
    v += g * g;
  }
  return z / Math.sqrt(v / df);
}

export function randStudentT4(rng) {
  return randStudentT(rng, 4);
}

/**
 * n iid draws from a categorical distribution over `probs` (need not be
 * normalized), tallied into per-category counts. A literal "poll of n
 * respondents" rather than a closed-form noise draw.
 * @returns {number[]} counts, same length/order as probs, summing to n
 */
export function randMultinomial(rng, n, probs) {
  const k = probs.length;
  const counts = new Array(k).fill(0);
  const cum = new Array(k);
  let acc = 0;
  for (let i = 0; i < k; i++) { acc += Math.max(0, probs[i]); cum[i] = acc; }
  const total = cum[k - 1] || 1;
  for (let i = 0; i < n; i++) {
    const u = rng() * total;
    let idx = 0;
    while (idx < k - 1 && u > cum[idx]) idx++;
    counts[idx]++;
  }
  return counts;
}

// Backwards compatibility on window (some legacy code expects globals)
try {
  if (typeof window !== 'undefined') {
    try { window.hashCode = hashCode; } catch (e) { }
    try { window.mulberry32 = mulberry32; } catch (e) { }
    try { window.randn = randn; } catch (e) { }
    try { window.randStudentT4 = randStudentT4; } catch (e) { }
    try { window.randStudentT = randStudentT; } catch (e) { }
    try { window.randMultinomial = randMultinomial; } catch (e) { }
  }
} catch (e) { }

export default {
  hashCode,
  mulberry32,
  randn,
  randStudentT,
  randStudentT4,
  randMultinomial
};

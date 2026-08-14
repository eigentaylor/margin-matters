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

/** Student's t with `df` degrees of freedom (df >= 1, integer). Fatter tails at low df. */
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

// Backwards compatibility on window (some legacy code expects globals)
try {
  if (typeof window !== 'undefined') {
    try { window.hashCode = hashCode; } catch (e) { }
    try { window.mulberry32 = mulberry32; } catch (e) { }
    try { window.randn = randn; } catch (e) { }
    try { window.randStudentT4 = randStudentT4; } catch (e) { }
    try { window.randStudentT = randStudentT; } catch (e) { }
  }
} catch (e) { }

export default {
  hashCode,
  mulberry32,
  randn,
  randStudentT,
  randStudentT4
};

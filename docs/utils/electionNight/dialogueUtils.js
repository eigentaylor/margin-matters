'use strict';

// Small shared helpers for pundit dialogue template pools (Aleck Lickman's
// lickmanDialogue.js, Nathaniel Sliver's sliverDialogue.js). Deliberately
// tiny and dependency-free.

/** Picks a pseudo-random entry from `arr` using an already-seeded rng() -> [0,1) function. */
export function pick(arr, rng) {
  if (!arr || !arr.length) return '';
  const i = Math.min(arr.length - 1, Math.floor((rng ? rng() : Math.random()) * arr.length));
  return arr[i];
}

/** Fills {winner}/{loser}/{beets}/... placeholders in a template string. */
export function fillTemplate(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] : m));
}

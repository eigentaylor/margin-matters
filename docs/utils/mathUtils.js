/**
 * Shared math utilities for margin-matters
 *
 * Provides reusable helpers for margin clamping, percentage normalization,
 * and byte-safe color manipulation. Exports ES module bindings while keeping
 * global assignments for legacy consumers.
 */
'use strict';

function clampMargin(value) {
  if (!isFinite(value)) return 0;
  const LIMIT = 1 - 1e-9;
  if (value > LIMIT) return LIMIT;
  if (value < -LIMIT) return -LIMIT;
  return value;
}

function clamp01(x) {
  if (!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function clampShare(value) {
  const v = Number(value);
  if (!isFinite(v) || v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function clampByte(v) {
  return Math.max(0, Math.min(255, v | 0));
}

function clamp(value, min, max) {
  if (!isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

const MathUtils = {
  clampMargin,
  clamp01,
  clampShare,
  clampByte,
  clamp
};

const globalScope = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
if (globalScope) {
  if (!globalScope.MathUtils) {
    globalScope.MathUtils = { ...MathUtils };
  } else {
    Object.assign(globalScope.MathUtils, MathUtils);
  }
  if (!globalScope.clampMargin) {
    globalScope.clampMargin = clampMargin;
  }
}

export default MathUtils;
export {
  clampMargin,
  clamp01,
  clampShare,
  clampByte,
  clamp
};

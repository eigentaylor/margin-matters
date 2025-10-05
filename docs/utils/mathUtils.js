/**
 * Shared math utilities for margin-matters
 * 
 * This module provides common mathematical functions used across
 * tester.js and election-night.js to ensure consistent behavior.
 * 
 * @module mathUtils
 */
(function(global) {
  'use strict';

  /**
   * Clamp a margin value to valid range [-1 + epsilon, 1 - epsilon]
   * Used for Democratic-Republican margin calculations where -1 is 100% R and +1 is 100% D
   * 
   * @param {number} value - The margin value to clamp
   * @returns {number} Clamped value in range [-1 + epsilon, 1 - epsilon]
   */
  function clampMargin(value) {
    if (!isFinite(value)) return 0;
    const LIMIT = 1 - 1e-9;
    if (value > LIMIT) return LIMIT;
    if (value < -LIMIT) return -LIMIT;
    return value;
  }

  /**
   * Clamp a value to the range [0, 1]
   * Used for percentages, shares, and other normalized values
   * 
   * @param {number} x - The value to clamp
   * @returns {number} Clamped value in range [0, 1]
   */
  function clamp01(x) {
    if (!isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  /**
   * Clamp a share value to the range (0, 1]
   * Returns 0 if value is not finite or <= 0, returns 1 if >= 1
   * Used for vote share calculations
   * 
   * @param {number} value - The share value to clamp
   * @returns {number} Clamped value in range [0, 1]
   */
  function clampShare(value) {
    const v = Number(value);
    if (!isFinite(v) || v <= 0) return 0;
    if (v >= 1) return 1;
    return v;
  }

  /**
   * Clamp an integer value to byte range [0, 255]
   * Used for RGB color component values
   * 
   * @param {number} v - The value to clamp
   * @returns {number} Clamped integer in range [0, 255]
   */
  function clampByte(v) {
    return Math.max(0, Math.min(255, v | 0));
  }

  /**
   * Clamp a value to a specified range [min, max]
   * Generic clamping function for any range
   * 
   * @param {number} value - The value to clamp
   * @param {number} min - Minimum allowed value
   * @param {number} max - Maximum allowed value
   * @returns {number} Clamped value in range [min, max]
   */
  function clamp(value, min, max) {
    if (!isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }

  // Export to global scope
  global.MathUtils = {
    clampMargin,
    clamp01,
    clampShare,
    clampByte,
    clamp
  };

  // Also export individual functions for backward compatibility
  // This allows existing code to work without changes during migration
  if (!global.clampMargin) {
    global.clampMargin = clampMargin;
  }

})(window);

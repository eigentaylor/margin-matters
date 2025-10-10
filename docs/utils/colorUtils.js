"use strict";
import { clampByte } from './mathUtils.js';

export function hexToRgb(hex) {
  if (!hex) return [47, 47, 47];
  let cleaned = hex.replace('#', '');
  if (cleaned.length === 8) cleaned = cleaned.slice(0, 6);
  if (cleaned.length === 3) cleaned = cleaned.split('').map(c => c + c).join('');
  if (cleaned.length !== 6) return [47, 47, 47];
  const num = parseInt(cleaned, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => clampByte(v).toString(16).padStart(2, '0')).join('');
}

export function blendColors(a, b, t) {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  const blended = [
    Math.round(rgbA[0] + (rgbB[0] - rgbA[0]) * t),
    Math.round(rgbA[1] + (rgbB[1] - rgbA[1]) * t),
    Math.round(rgbA[2] + (rgbB[2] - rgbA[2]) * t)
  ];
  return rgbToHex(blended[0], blended[1], blended[2]);
}

export function safeMarginToColor(margin, isThird, thirdColor = '#C9A400') {
  if (isThird) return thirdColor;
  if (typeof window.marginToColor === 'function') return window.marginToColor(margin, false);
  if (margin <= -0.20) return '#8B0000';
  if (margin <= -0.10) return '#B22222';
  if (margin <= -0.05) return '#CD5C5C';
  if (margin < 0) return '#F08080';
  if (margin < 0.05) return '#87CEFA';
  if (margin < 0.10) return '#6495ED';
  if (margin < 0.20) return '#4169E1';
  return '#00008B';
}

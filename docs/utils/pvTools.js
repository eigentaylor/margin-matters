"use strict";
import { PV_CAP } from './constants.js';

export function parsePvText(txt) {
  if (!txt) return null;
  txt = String(txt).trim().toUpperCase();
  if (txt === 'EVEN' || txt === '0' || txt === 'D+0' || txt === 'R+0') return 0;
  let m = txt.match(/^([DR])\s*\+\s*([0-9]*\.?[0-9]+)$/);
  if (m) { const sign = (m[1] === 'D') ? 1 : -1; return sign * (parseFloat(m[2]) / 100); }
  if (!isNaN(parseFloat(txt))) return parseFloat(txt);
  return null;
}

export function clampPv(x) {
  if (!isFinite(x)) return 0;
  const CAP = (typeof PV_CAP === 'number' && isFinite(PV_CAP)) ? PV_CAP : 0.5;
  return Math.max(-CAP, Math.min(CAP, x));
}

export function applyPvOverride(val) {
  try {
    const yearEl = document.getElementById('yearSlider');
    const y = yearEl ? parseInt(yearEl.value) : 2024;
    window._pvOverride = clampPv(val);
    if (typeof window.updateAll === 'function') window.updateAll();
    try {
      const stops = (window._stopsByYear && window._stopsByYear.get(y)) || [0];
      let best = 0, bestD = 1e9;
      stops.forEach((s, idx) => { const d = Math.abs(s - window._pvOverride); if (d < bestD) { bestD = d; best = idx; } });
      const sEl = document.getElementById('pvSlider'); if (sEl) sEl.value = String(best);
    } catch (e) { /* ignore */ }
  } catch (e) { /* ignore */ }
}

// Backwards compatibility: expose on window for inline scripts/pages
try { window.applyPvOverride = applyPvOverride; } catch (e) { }
try { window.parsePvText = parsePvText; } catch (e) { }
try { window.clampPv = clampPv; } catch (e) { }

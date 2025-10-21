'use strict';

import { PV_CAP, EPS, STOP_KEY_PREC } from './constants.js';
import { leanStr } from './formatters.js';
import { clearFlips } from './flipScenarios.js';

const stopToEff = new Map();
const stopToUnits = new Map();
const stopsByYear = new Map();

export function buildPvStops(year, { container, datalist, getNatMargin, updateAll, extraPresets = [], injectNegativePresets = false, tippingIndex = null, tippingTitle = '' } = {}) {
  const cap = PV_CAP;
  stopToEff.clear();
  stopToUnits.clear();

  const hasWindow = typeof window !== 'undefined';
  const hasDocument = typeof document !== 'undefined';
  const doc = hasDocument ? document : null;
  const isFutureMode = !!(hasWindow && window._futureMode);
  const natMarginFn = (typeof getNatMargin === 'function') ? getNatMargin : (() => 0);
  const nat = (isFutureMode && year > 2024) ? 0 : natMarginFn(year);
  const tipIdx = (typeof tippingIndex === 'number' && tippingIndex >= 0) ? Math.floor(tippingIndex) : null;
  const tipTitle = tippingTitle ? String(tippingTitle) : '';

  const byYearStops = (hasWindow && window._stopColorsByYear && window._stopColorsByYear.get(year)) || null;
  const effByYearStops = (hasWindow && window._stopEffByYear && window._stopEffByYear.get(year)) || null;

  try {
    if (byYearStops) {
      const sampleKeys = Array.from(byYearStops.keys()).slice(0, 12);
      // console.log('[stops] raw stop keys (sample)', sampleKeys);
    }
  } catch (e) { console.warn(e); }

  const baseStopsSet = new Set([0]);
  stopToEff.set(0, 0 + EPS);
  if (!(isFutureMode && year > 2024) && isFinite(nat) && Math.abs(nat) <= cap) {
    baseStopsSet.add(nat);
    stopToEff.set(nat, nat);
  }

  if (byYearStops && effByYearStops && byYearStops.size > 0) {
    for (const k of byYearStops.keys()) {
      const v = parseFloat(k);
      if (!isFinite(v) || Math.abs(v) > cap) continue;
      baseStopsSet.add(v);
      const eff = effByYearStops.has(k) ? effByYearStops.get(k) : (v + EPS);
      stopToEff.set(v, eff);
      const unitsMap = byYearStops.get(k);
      if (unitsMap && typeof unitsMap.forEach === 'function') {
        const list = [];
        unitsMap.forEach((_, unit) => list.push(unit));
        if (list.length) stopToUnits.set(v, list);
      }
    }
  }

  const keyFor = (val) => Number(val).toFixed(9);
  const baseStops = Array.from(baseStopsSet).sort((a, b) => a - b);
  const baseKeys = new Set(baseStops.map(keyFor));
  const sliderStopsSet = new Set(baseStops);
  const presetKeys = new Set();
  const presetStops = [];

  const registerPreset = (val, name) => {
    const key = keyFor(val);
    if (!isFinite(val) || Math.abs(val) > cap) return false;
    if (baseKeys.has(key) || presetKeys.has(key)) return false;
    sliderStopsSet.add(val);
    const displayName = name || String(val);
    const pvUnits = stopToUnits.get(val) || [];
    pvUnits.push(`PRESET:${displayName}`);
    stopToUnits.set(val, pvUnits);
    if (!stopToEff.has(val)) stopToEff.set(val, val + EPS);
    presetStops.push({ val, name: displayName });
    presetKeys.add(key);
    return true;
  };

  try {
    const presetEl = doc && doc.getElementById && doc.getElementById('pvPreset');
    if (presetEl && presetEl.options && presetEl.options.length) {
      for (const opt of Array.from(presetEl.options)) {
        try {
          const raw = (opt.value != null) ? String(opt.value).trim() : '';
          if (!raw) continue;
          const val = parseFloat(raw);
          if (!isFinite(val)) continue;
          const name = (opt.text || opt.label || '').split(':')[0].trim();
          const optYear = (opt.dataset && opt.dataset.year) ? Number(opt.dataset.year) : null;
          const yearMatch = (optYear != null && isFinite(optYear) && optYear === year);
          if (!yearMatch) registerPreset(val, name);
          if (injectNegativePresets) registerPreset(-val, name ? `-${name}` : String(-val));
        } catch (err) { console.warn(err); }
      }
    }

    if (Array.isArray(extraPresets) && extraPresets.length) {
      for (const p of extraPresets) {
        try {
          if (!p) continue;
          const val = Number(p.val);
          if (!isFinite(val) || Math.abs(val) > cap) continue;
          const name = (p.name || '').toString();
          const presetYear = (p.year != null && isFinite(Number(p.year))) ? Number(p.year) : null;
          if (presetYear !== year) registerPreset(val, name);
          if (injectNegativePresets) registerPreset(-val, name ? `-${name}` : String(-val));
        } catch (err) { console.warn(err); }
      }
    }
  } catch (err) { console.warn(err); }

  const sliderStops = Array.from(sliderStopsSet).sort((a, b) => a - b);
  for (let i = 0; i < sliderStops.length; i++) {
    const s = sliderStops[i];
    if (!stopToEff.has(s)) stopToEff.set(s, s + EPS);
  }

  const sliderIndexByKey = new Map();
  sliderStops.forEach((val, idx) => { sliderIndexByKey.set(keyFor(val), idx); });

  stopsByYear.set(year, sliderStops);
  if (datalist) {
    datalist.innerHTML = sliderStops.map(v => `<option value="${(v * 100).toFixed(1)}"></option>`).join('');
    const sliderEl = doc && doc.getElementById ? doc.getElementById('pvSlider') : null;
    if (sliderEl) sliderEl.setAttribute('list', 'pvStopsList');
  }

  if (container) {
    const natForRender = (isFutureMode && year > 2024) ? 0 : nat;
    // Only render base stops in the visible list; presets stay slider-only.
    const mainHtml = baseStops.map((v) => {
      const sliderIdx = sliderIndexByKey.get(keyFor(v));
      const isEven = Math.abs(v) < 1e-12;
      const isNat = ((!(isFutureMode && year > 2024)) && Math.abs(v - natForRender) < 1e-12);
      const unitsRaw = (stopToUnits.get(v) || []).filter(u => u !== 'NATIONAL' && u !== 'NAT');
      // Replace PRESET: prefix and preserve full preset names; for non-preset
      // units keep the short (5-char) abbreviation to avoid overflowing the bar.
      for (let j = 0; j < unitsRaw.length; j++) {
        if (!unitsRaw[j]) continue;
        if (unitsRaw[j].startsWith('PRESET:')) {
          unitsRaw[j] = unitsRaw[j].replace(/^PRESET:/, '');
        }
      }
      const units = (isEven || isNat) ? '' : unitsRaw.slice(0, 3).map(u => (u && u && u.indexOf('-') === -1 && u.length > 5 && !u.startsWith('PRESET:')) ? u.slice(0, 5) : u).join(',');
      const base = isEven ? 'EVEN' : (isNat ? (leanStr(v) + ' Actual') : leanStr(v));
      const label = units ? `${base} <small style="margin-left:6px;color:var(--muted)">${units}</small>` : base;
      let bgColor = '#0d0d0dff';
      const CANON = { BLUE: '#1e4bd1', RED: '#b22222', YELLOW: '#C9A400' };
      // helper to find the closest CSV key when numeric rounding differs
      const findKeyForValue = (map, val) => {
        if (!map || typeof map.keys !== 'function') return null;
        let best = null; let bestDiff = Infinity;
        for (const k of map.keys()) {
          const num = Number(k);
          if (!isFinite(num)) continue;
          const diff = Math.abs(num - val);
          if (diff < bestDiff) { bestDiff = diff; best = k; }
        }
        // allow small tolerance for matching (covers small nudge/effective pv differences)
        const TOL = 0.00025; // 0.025% absolute margin
        return (bestDiff <= TOL) ? best : null;
      };
      if (!isEven) {
        const key = Number(v).toFixed(STOP_KEY_PREC);
        let byStopCsv = byYearStops && byYearStops.get(key);
        // if exact key lookup failed, try fuzzy-match on numeric keys
        if (!byStopCsv && byYearStops) {
          const alt = findKeyForValue(byYearStops, v);
          if (alt) {
            byStopCsv = byYearStops.get(alt);
            // override key for better debug messages
            // (keep original key variable for deterministic output where needed)
          }
        }
        if (byStopCsv) {
          // Prefer canonical color by winner if present in CSV entries. This
          // avoids inconsistent light/dark shades and ensures a uniform palette.
          try {
            let hasT = false, hasD = false, hasR = false;
            let firstCss = null;
            byStopCsv.forEach((info) => {
              if (!firstCss && info && info.color_css) firstCss = info.color_css;
              if (info && info.winner) {
                const w = String(info.winner).toUpperCase();
                if (w === 'T' || w === 'O') hasT = true;
                else if (w === 'D') hasD = true;
                else if (w === 'R') hasR = true;
              }
            });
            if (hasT) bgColor = CANON.YELLOW;
            else if (hasD) bgColor = CANON.BLUE;
            else if (hasR) bgColor = CANON.RED;
            else if (firstCss) {
              // Fallback: try to infer canonical color from CSS string
              const s = String(firstCss).toLowerCase();
              if (s.includes('blue')) bgColor = CANON.BLUE;
              else if (s.includes('red')) bgColor = CANON.RED;
              else if (s.includes('yel') || s.includes('gold')) bgColor = CANON.YELLOW;
              else bgColor = firstCss;
            } else {
              try {
                const entries = [];
                if (byStopCsv && typeof byStopCsv.forEach === 'function') {
                  byStopCsv.forEach((val, k) => entries.push([k, val]));
                }
                //console.debug('[stops][debug] no CSV color/winner for stop', { year, stop: v, key, unitsRaw, csvEntries: entries, stopToUnits: (stopToUnits.get(v) || []), stopToEff: stopToEff.get(v) });
              } catch (e2) { console.warn('[stops][debug] error preparing CSV debug', e2); }
            }
          } catch (e) { console.warn(e); }
        }
      }
      // If this stop represents the Actual (nat) and is not EVEN, prefer red/blue
      // based on national margin for clearer
      const isYellowish = (bgColor && bgColor.toLowerCase && (bgColor.toLowerCase() === '#c9a400' || bgColor.toLowerCase() === '#ffd700' || bgColor.toLowerCase() === 'yellow'));
      // If we've fallen back to the default color, log context to help debugging
      if (bgColor === '#0d0d0dff') {
        try {
          //console.debug('[stops][debug] final bgColor is default', { year, stop: v, key: Number(v).toFixed(STOP_KEY_PREC), unitsRaw, stopToUnits: (stopToUnits.get(v) || []), stopToEff: stopToEff.get(v) });
        } catch (e) { console.warn('[stops][debug] error preparing final default color debug', e); }
      }
      const textColor = (bgColor === '#FFFFFF' || isYellowish) ? '#000' : '#fff';
      const smallColor = isYellowish ? '#000' : 'var(--muted)';
      const idxAttr = (sliderIdx != null && Number.isFinite(sliderIdx)) ? String(sliderIdx) : '';
      const displayLabel = label.replace('<small', `<small style="color:${smallColor}"`);
      const isTipping = (tipIdx !== null && sliderIdx === tipIdx);
      const tipBadge = isTipping ? '<span class="tip-badge" style="margin-right:4px;font-size:0.75em;font-weight:700;color:#f2c94c">TIP</span>' : '';
      let btnStyle = `padding:4px 6px;margin:2px;background-color:${bgColor};color:${textColor}`;
      if (isTipping) btnStyle += ';box-shadow:0 0 0 2px #f2c94c inset';
      const titleText = isTipping ? (tipTitle || 'Tipping point stop') : '';
      const titleAttr = titleText ? ` title="${titleText.replace(/"/g, '&quot;')}"` : '';
      const ariaAttr = isTipping ? ' aria-label="Tipping point stop"' : '';
      return `<span class="btn" style="${btnStyle}" data-idx="${idxAttr}"${ariaAttr}${titleAttr}>${tipBadge}${displayLabel}</span>`;
    }).join('');

    // Sort preset stops by numeric value so preset chips render in deterministic order
    presetStops.sort((a, b) => a.val - b.val);

    const presetHtml = presetStops.map((ps, pi) => {
      const v = ps.val;
      const sign = (v > 0) ? 'D' : (v < 0 ? 'R' : 'EVEN');
      const label = (sign === 'EVEN') ? 'EVEN' : ((v > 0 ? 'D+' : 'R+') + (Math.abs(v) * 100).toFixed(1));
      const bg = (v > 0) ? '#4169E1' : (v < 0 ? '#B22222' : '#888888');
      const txt = (bg === '#FFFFFF') ? '#000' : '#fff';
      // Preserve leading '-' in the name so negative presets render as "(-Gore)"
      const name = ps.name || '';
      const text = name ? `${label} (${name})` : label;
      // For data-name, keep the original provided name if meaningful, otherwise blank
      const dataName = name || '';
      return `<span class="btn preset-chip" style="padding:4px 6px;margin:2px;background-color:${bg};color:${txt}" data-pv="${v}" data-name="${dataName}">${text}</span>`;
    }).join('');

    container.innerHTML = 'Stops: ' + mainHtml + '<div style="margin-top:6px">Presets: ' + (presetHtml || '<span class="muted">None</span>') + '</div>';
    container.querySelectorAll('span.btn').forEach((el) => {
      el.addEventListener('click', () => {
        try { clearFlips(); } catch (e) { console.warn(e); }
        const pvValAttr = el.getAttribute('data-pv');
        if (pvValAttr != null) {
          const val = parseFloat(pvValAttr);
          if (!isNaN(val)) {
            try { window._pvOverride = val; window._pvPresetName = el.getAttribute('data-name') || null; } catch (e) { console.warn(e); }
            try {
              if (typeof updateAll === 'function') updateAll();
              else if (typeof window.updateAll === 'function') window.updateAll();
            } catch (e) { console.warn(e); }
          }
        } else {
          const idxAttr = el.getAttribute('data-idx');
          const slider = doc && doc.getElementById ? doc.getElementById('pvSlider') : null;
          try { window._pvOverride = null; } catch (e) { console.warn(e); }
          if (slider && idxAttr != null && idxAttr !== '') {
            const i = Number(idxAttr);
            if (!Number.isNaN(i)) {
              slider.value = String(i);
              try {
                if (typeof updateAll === 'function') updateAll();
                else if (typeof window.updateAll === 'function') window.updateAll();
              } catch (e) { console.warn(e); }
            }
          }
        }
      });
    });
  }
}

export { stopToEff, stopToUnits, stopsByYear };

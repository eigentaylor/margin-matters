'use strict';

import { PV_CAP, EPS, STOP_KEY_PREC } from './constants.js';
import { leanStr } from './formatters.js';
import { clearFlips } from './flipScenarios.js';

const stopToEff = new Map();
const stopToUnits = new Map();
const stopsByYear = new Map();

export function buildPvStops(year, { container, datalist, getNatMargin, updateAll } = {}) {
  const cap = PV_CAP;
  stopToEff.clear();
  stopToUnits.clear();

  const hasWindow = typeof window !== 'undefined';
  const hasDocument = typeof document !== 'undefined';
  const doc = hasDocument ? document : null;
  const isFutureMode = !!(hasWindow && window._futureMode);
  const natMarginFn = (typeof getNatMargin === 'function') ? getNatMargin : (() => 0);
  const nat = (isFutureMode && year > 2024) ? 0 : natMarginFn(year);

  const byYearStops = (hasWindow && window._stopColorsByYear && window._stopColorsByYear.get(year)) || null;
  const effByYearStops = (hasWindow && window._stopEffByYear && window._stopEffByYear.get(year)) || null;

  try {
    if (byYearStops) {
      const sampleKeys = Array.from(byYearStops.keys()).slice(0, 12);
      // console.log('[stops] raw stop keys (sample)', sampleKeys);
    }
  } catch (e) { console.warn(e); }

  const stopsSet = new Set([0]);
  stopToEff.set(0, 0 + EPS);
  if (!(isFutureMode && year > 2024) && isFinite(nat) && Math.abs(nat) <= cap) {
    stopsSet.add(nat);
    stopToEff.set(nat, nat);
  }

  if (byYearStops && effByYearStops && byYearStops.size > 0) {
    const keys = Array.from(byYearStops.keys());
    for (const k of keys) {
      const v = parseFloat(k);
      if (!isFinite(v) || Math.abs(v) > cap) continue;
      stopsSet.add(v);
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

  const stops = Array.from(stopsSet).sort((a, b) => a - b);
  const presetStops = [];
  try {
  const presetEl = doc && doc.getElementById && doc.getElementById('pvPreset');
    if (presetEl && presetEl.options && presetEl.options.length) {
      const existing = stops.slice();
      const almostEqual = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
      for (const opt of Array.from(presetEl.options)) {
        try {
          const val = parseFloat(opt.value);
          if (isFinite(val)) {
            if (!opt.value || String(opt.value).trim() === '') continue;
            let found = false;
            for (const s of existing) { if (almostEqual(s, val)) { found = true; break; } }
            for (const s of presetStops) { if (almostEqual(s, val)) { found = true; break; } }
            if (!found && Math.abs(val) <= cap) {
              presetStops.push(val);
              const name = (opt.text || opt.label || '').split(':')[0].trim();
              const pvUnits = stopToUnits.get(val) || [];
              pvUnits.push(`PRESET:${name || String(val)}`);
              stopToUnits.set(val, pvUnits);
              if (!stopToEff.has(val)) stopToEff.set(val, val + EPS);
            }
          }
        } catch (e) { console.warn(e); }
      }
    }
  } catch (e) { console.warn(e); }

  const allStops = stops.slice();
  try {
    const effPreview = allStops.slice(0, 25).map(s => ({ s, eff: stopToEff.get(s), units: (stopToUnits.get(s) || []).length }));
    // console.log('[stops] finalized stops', { year, count: allStops.length, preview: effPreview });
  } catch (e) { console.warn(e); }

  for (let i = 0; i < allStops.length; i++) {
    const s = allStops[i];
    if (!stopToEff.has(s)) stopToEff.set(s, s + EPS);
  }

  stopsByYear.set(year, allStops);
  if (datalist) {
    datalist.innerHTML = allStops.map(v => `<option value="${(v * 100).toFixed(1)}"></option>`).join('');
  const sliderEl = doc && doc.getElementById ? doc.getElementById('pvSlider') : null;
  if (sliderEl) sliderEl.setAttribute('list', 'pvStopsList');
  }

  if (container) {
    const natForRender = (isFutureMode && year > 2024) ? 0 : nat;
    const mainHtml = stops.map((v, i) => {
      const isEven = Math.abs(v) < 1e-12;
      const isNat = ((!(isFutureMode && year > 2024)) && Math.abs(v - natForRender) < 1e-12);
      const unitsRaw = (stopToUnits.get(v) || []).filter(u => u !== 'NATIONAL' && u !== 'NAT');
      for (let j = 0; j < unitsRaw.length; j++) { if (unitsRaw[j] && unitsRaw[j].startsWith('PRESET:')) unitsRaw[j] = unitsRaw[j].replace(/^PRESET:/, ''); }
      const units = (isEven || isNat) ? '' : unitsRaw.slice(0, 3).map(u => u.slice(0, 5)).join(',');
      const base = isEven ? 'EVEN' : (isNat ? (leanStr(v) + ' Actual') : leanStr(v));
      const label = units ? `${base} <small style="margin-left:6px;color:var(--muted)">${units}</small>` : base;
      let bgColor = '#0d0d0dff';
      if (!isEven) {
        const key = Number(v).toFixed(STOP_KEY_PREC);
        const byStopCsv = byYearStops && byYearStops.get(key);
        if (byStopCsv) {
          const winners = [];
          const colors = [];
          const unitsList = unitsRaw && unitsRaw.length ? unitsRaw : Array.from(byStopCsv.keys());
          unitsList.forEach(u => { const info = byStopCsv.get(u); if (info) { winners.push(info.winner); colors.push(info.color_css || ''); } });
          if (winners.includes('T')) bgColor = (colors[winners.indexOf('T')] || 'yellow');
          else if (winners.includes('D')) bgColor = (colors[winners.indexOf('D')] || 'deepskyblue');
          else if (winners.includes('R')) bgColor = (colors[winners.indexOf('R')] || 'red');
          else if (colors.length) bgColor = colors[0];
        }
      }
      const isYellowish = (bgColor && bgColor.toLowerCase && (bgColor.toLowerCase() === '#c9a400' || bgColor.toLowerCase() === '#ffd700' || bgColor.toLowerCase() === 'yellow'));
      const textColor = (bgColor === '#FFFFFF' || isYellowish) ? '#000' : '#fff';
      const smallColor = isYellowish ? '#000' : 'var(--muted)';
      return `<span class="btn" style="padding:4px 6px;margin:2px;background-color:${bgColor};color:${textColor}" data-idx="${i}">${label.replace('<small', `<small style=\"color:${smallColor}\"`)}</span>`;
    }).join('');

    const presetHtml = presetStops.map((v, pi) => {
      const sign = (v > 0) ? 'D' : (v < 0 ? 'R' : 'EVEN');
      const label = (sign === 'EVEN') ? 'EVEN' : ((v > 0 ? 'D+' : 'R+') + (Math.abs(v) * 100).toFixed(1));
      const bg = (v > 0) ? '#4169E1' : (v < 0 ? '#B22222' : '#888888');
      const txt = (bg === '#FFFFFF') ? '#000' : '#fff';
      const name = null;
      return `<span class="btn preset-chip" style="padding:4px 6px;margin:2px;background-color:${bg};color:${txt}" data-pv="${v}" data-name="${name || ''}">${label}</span>`;
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
          const i = Number(el.getAttribute('data-idx'));
          const slider = doc && doc.getElementById ? doc.getElementById('pvSlider') : null;
          try { window._pvOverride = null; } catch (e) { console.warn(e); }
          if (slider) {
            slider.value = String(i);
            try {
              if (typeof updateAll === 'function') updateAll();
              else if (typeof window.updateAll === 'function') window.updateAll();
            } catch (e) { console.warn(e); }
          }
        }
      });
    });
  }
}

export { stopToEff, stopToUnits, stopsByYear };

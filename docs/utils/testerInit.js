'use strict';

export function createTesterInitializer(deps) {
  if (!deps || typeof deps !== 'object') throw new Error('createTesterInitializer expects a dependencies object');
  const {
    byYear,
    buildPvStops,
    stopsByYear,
    stopToEff,
    STOP_EPS,
    EPS,
    leanStr,
    getNatMargin,
    getUrlParams,
    updateAll,
    clearFlips,
    updateFlipMetricOptionsForYear,
    updateUrl,
    applyFlip,
    updateFlipButtons,
    applyPvOverride
  } = deps;

  if (!byYear || typeof byYear.keys !== 'function') {
    throw new Error('createTesterInitializer requires a byYear Map');
  }
  if (typeof buildPvStops !== 'function') {
    throw new Error('createTesterInitializer requires buildPvStops');
  }
  if (typeof getNatMargin !== 'function') {
    throw new Error('createTesterInitializer requires getNatMargin');
  }
  if (typeof getUrlParams !== 'function') {
    throw new Error('createTesterInitializer requires getUrlParams');
  }
  if (typeof updateAll !== 'function') {
    throw new Error('createTesterInitializer requires updateAll');
  }
  if (typeof clearFlips !== 'function') {
    throw new Error('createTesterInitializer requires clearFlips');
  }
  if (typeof updateFlipMetricOptionsForYear !== 'function') {
    throw new Error('createTesterInitializer requires updateFlipMetricOptionsForYear');
  }
  if (typeof updateUrl !== 'function') {
    throw new Error('createTesterInitializer requires updateUrl');
  }
  if (typeof applyFlip !== 'function') {
    throw new Error('createTesterInitializer requires applyFlip');
  }
  if (typeof updateFlipButtons !== 'function') {
    throw new Error('createTesterInitializer requires updateFlipButtons');
  }
  if (typeof applyPvOverride !== 'function') {
    throw new Error('createTesterInitializer requires applyPvOverride');
  }

  return function init() {
    const yearSlider = document.getElementById('yearSlider');
    const pvSlider = document.getElementById('pvSlider');
    const flipMetricSel = document.getElementById('flipMetric');
    const yearVal = document.getElementById('yearVal');
    const pvVal = document.getElementById('pvVal');
    const pvStops = document.getElementById('pvStops');
    const pvStopsList = document.getElementById('pvStopsList');
    const pvResetBtn = document.getElementById('pvReset');
    if (!yearSlider || !pvSlider) return;

    const resolveDefaultPv = (year) => {
      const stops = stopsByYear.get(year) || [0];
      const nat = getNatMargin(year);
      const hasActual = !(window._futureMode && year > 2024);
      let idx = hasActual ? stops.findIndex(v => Math.abs(v - nat) <= STOP_EPS) : -1;
      if (idx < 0) idx = stops.findIndex(v => Math.abs(v) <= STOP_EPS);
      if (idx < 0) idx = 0;
      return { stops, nat, idx };
    };

    window.addEventListener('mapReady', () => updateAll());
    yearSlider.addEventListener('input', () => {
      clearFlips();
      updateAll();
      updateFlipMetricOptionsForYear();
      const pvEl = document.getElementById('pvSlider');
      const year = parseInt(yearSlider.value);
      const pvIndex = pvEl ? parseInt(pvEl.value) : 0;
      updateUrl(year, pvIndex, null);
    });
    if (flipMetricSel) {
      flipMetricSel.addEventListener('change', () => {
        const yEl = document.getElementById('yearSlider');
        const pvEl = document.getElementById('pvSlider');
        const yNow = yEl ? parseInt(yEl.value) : null;
        const pvIdx = pvEl ? parseInt(pvEl.value) : null;
        const hadActive = !!(window._activeFlip && window._activeFlip.year === yNow);
        const prevMode = hadActive ? window._activeFlip.mode : null;
        if (!hadActive) {
          try { clearFlips(); } catch (err) { console.warn(err); }
        }
        updateFlipMetricOptionsForYear();
        if (hadActive && prevMode) {
          try { applyFlip(prevMode); } catch (err) { updateAll(); }
        } else {
          updateAll();
        }
        try {
          const flipMode = (window._activeFlip && window._activeFlip.mode) ? window._activeFlip.mode : null;
          updateUrl(yNow, pvIdx, flipMode);
        } catch (err) { console.warn(err); }
      });
    }
    pvSlider.addEventListener('input', () => {
      if (!window._applyingFlip) clearFlips();
      try { window._pvOverride = null; window._pvPresetName = null; } catch (err) { console.warn(err); }
      updateAll();
      const yearEl = document.getElementById('yearSlider');
      const year = yearEl ? parseInt(yearEl.value) : null;
      const pvIndex = parseInt(pvSlider.value);
      const flipMode = window._activeFlip ? window._activeFlip.mode : null;
      updateUrl(year, pvIndex, flipMode);
    });

    let y = 0;
    for (const k of byYear.keys()) y = Math.max(y, k);
    if (window._futureMode) {
      if (byYear.has(2028)) y = 2028;
      else if (y === 0) y = 2024;
    } else if (y === 0) {
      y = 2024;
    }

    const urlParams = getUrlParams();
    if (urlParams.year && byYear.has(urlParams.year)) {
      y = urlParams.year;
    }
    if (flipMetricSel && urlParams.metric && (urlParams.metric === 'votes' || urlParams.metric === 'margin')) {
      flipMetricSel.value = urlParams.metric;
    }
    try {
      const propEvToggle = document.getElementById('propEvToggle');
      if (propEvToggle && urlParams.propEv) {
        propEvToggle.checked = true;
      }
    } catch (e) { console.warn(e); }

    yearSlider.value = String(y);
    if (yearVal) yearVal.textContent = y;

    // Ensure presets (including negative mirrors) are injected before we
    // compute slider bounds. Pages can expose window._pvExtraPresets and
    // window._injectNegativePresets; respect those here.
    const extraPresets = (typeof window !== 'undefined' && Array.isArray(window._pvExtraPresets)) ? window._pvExtraPresets : [];
    const injectNegativePresets = (typeof window !== 'undefined') ? !!window._injectNegativePresets : false;
    // Populate stopsByYear and render the container now so subsequent logic
    // that reads stopsByYear sees the full list (including negatives).
    try {
      buildPvStops(y, { container: pvStops, datalist: pvStopsList, getNatMargin, updateAll, extraPresets, injectNegativePresets });
    } catch (e) { console.warn(e); }

  const defaultInfo = resolveDefaultPv(y);
  const stops = defaultInfo.stops;
  const nat = defaultInfo.nat;
  let defaultIdx = defaultInfo.idx;
  pvSlider.min = 0;
  pvSlider.max = Math.max(0, stops.length - 1);
  pvSlider.step = 1;

    if (urlParams.pv !== null && Number.isInteger(urlParams.pv) && urlParams.pv >= 0 && urlParams.pv < stops.length) {
      defaultIdx = Math.floor(urlParams.pv);
    } else if (urlParams.pvValue != null && isFinite(urlParams.pvValue)) {
      try {
        window._pvOverride = parseFloat(urlParams.pvValue);
        window._pvPresetName = null;
      } catch (err) { console.warn(err); }
    } else if (urlParams.pvPreset != null) {
      const pvPresetEl = document.getElementById('pvPreset');
      if (pvPresetEl) {
        const want = String(urlParams.pvPreset).toLowerCase();
        let foundVal = null;
        let foundName = null;
        for (const opt of Array.from(pvPresetEl.options)) {
          const rawLabel = (opt.text || '').split(':')[0].trim();
          const labelLower = rawLabel.toLowerCase();
          const valueLower = (opt.value || '').toLowerCase();
          if (labelLower === want || (opt.text || '').toLowerCase().includes(want) || valueLower === want) {
            foundVal = parseFloat(opt.value);
            foundName = rawLabel || opt.value || null;
            pvPresetEl.value = opt.value;
            break;
          }
        }
        if (foundVal != null && !isNaN(foundVal)) {
          try {
            window._pvOverride = foundVal;
            window._pvPresetName = foundName;
          } catch (err) { console.warn(err); }
        }
      }
    }

    if (!(typeof window._pvOverride === 'number' && isFinite(window._pvOverride))) {
      try { window._pvPresetName = null; } catch (err) { console.warn(err); }
    }

    pvSlider.value = String(defaultIdx);
    const curStop = stops[defaultIdx] || 0;
    const curEff = stopToEff.get(curStop) || (curStop + EPS * (curStop === 0 ? 1 : Math.sign(curStop - nat)));
    const showNatInit = ((!(window._futureMode && y > 2024)) && Math.abs(curStop - nat) < STOP_EPS);
    if (pvVal) pvVal.textContent = (showNatInit ? 'Actual ' : '') + leanStr(curEff);

    // buildPvStops was already invoked above to populate stops and render the UI
    updateFlipMetricOptionsForYear();

    const btnClassic = document.getElementById('flipClassic');
    const btnNoMaj = document.getElementById('flipNoMaj');
    const btnTie = document.getElementById('flipTie');
    const btnReset = document.getElementById('flipReset');
    if (btnClassic) btnClassic.addEventListener('click', () => applyFlip('classic'));
    if (btnNoMaj) btnNoMaj.addEventListener('click', () => applyFlip('no_majority'));
    if (btnTie) btnTie.addEventListener('click', () => applyFlip('tie'));
    if (btnReset) btnReset.addEventListener('click', () => { clearFlips(); updateAll(); });
    updateFlipButtons();

    if (pvResetBtn) {
      pvResetBtn.addEventListener('click', () => {
        const year = parseInt(yearSlider.value, 10);
  const { stops: curStops, idx } = resolveDefaultPv(year);
        pvSlider.min = 0;
        pvSlider.max = Math.max(0, curStops.length - 1);
        pvSlider.step = 1;
        pvSlider.value = String(idx);
        try { window._pvOverride = null; window._pvPresetName = null; } catch (err) { console.warn(err); }
        if (!window._applyingFlip) {
          try { clearFlips(); } catch (err) { console.warn(err); }
        }
        updateAll();
        try {
          const flipMode = (window._activeFlip && window._activeFlip.mode) ? window._activeFlip.mode : null;
          updateUrl(year, idx, flipMode);
        } catch (err) { console.warn(err); }
      });
    }

    const propEvToggle = document.getElementById('propEvToggle');
    const propEvFooter = document.getElementById('propEvFooter');
    if (propEvToggle && propEvFooter) {
      propEvFooter.style.display = 'flex';
      document.body.classList.add('has-prop-ev-toggle');

      propEvToggle.addEventListener('change', () => {
        clearFlips();
        updateAll();

        const yearEl = document.getElementById('yearSlider');
        const pvEl = document.getElementById('pvSlider');
        const year = yearEl ? parseInt(yearEl.value) : null;
        const pvIndex = pvEl ? parseInt(pvEl.value) : null;
        updateUrl(year, pvIndex, null);
      });
    }

    updateAll();

    const pvFlipBtn = document.getElementById('pvFlip');
    if (pvFlipBtn) {
      pvFlipBtn.addEventListener('click', () => {
        if (typeof window._pvFlipInProgress !== 'undefined' && window._pvFlipInProgress) {
          // try { console.log('pvFlip: ignored (already in progress)'); } catch (e) { }
          return;
        }
        window._pvFlipInProgress = true;
        let cur = 0;
        try {
          // Prefer explicit pvText if available (user-entered value)
          const pvTextEl = document.getElementById('pvText');
          const parsed = (pvTextEl && typeof pvTextEl.value === 'string') ? (typeof parsePvText === 'function' ? parsePvText(pvTextEl.value) : null) : null;
          if (parsed != null && isFinite(parsed)) {
            cur = parsed;
          } else if (typeof window._pvOverride === 'number' && isFinite(window._pvOverride)) {
            cur = window._pvOverride;
          } else {
            const yearEl = document.getElementById('yearSlider'); const y = yearEl ? parseInt(yearEl.value) : 2024;
            const pvEl = document.getElementById('pvSlider');
            const stops = (stopsByYear && stopsByYear.get(y)) || [0];
            const idx = pvEl ? parseInt(pvEl.value) : 0; const stopVal = stops[idx] || 0; cur = stopVal;
          }
        } catch (e) { console.warn(e); }
        const flipped = -cur;
        try {
          const pvTextRaw = (typeof document !== 'undefined' && document.getElementById('pvText')) ? document.getElementById('pvText').value : null;
          // console.log('pvFlip clicked (testerInit)', { pvTextRaw, cur, flipped });
        } catch (e) { /* ignore */ }
        finally {
          setTimeout(() => { try { window._pvFlipInProgress = false; } catch (e) { } }, 0);
        }
        try { window._pvPresetName = null; } catch (e) { /* ignore */ }
        try { applyPvOverride(flipped); } catch (e) { console.warn(e); }

        // Update the PV text input so the UI reflects the flipped value immediately
        try {
          const pvText = document.getElementById('pvText');
          if (pvText) {
            if (Math.abs(flipped) < 1e-12) pvText.value = 'EVEN';
            else if (flipped >= 0) pvText.value = `D+${(flipped * 100).toFixed(1)}`;
            else pvText.value = `R+${(Math.abs(flipped) * 100).toFixed(1)}`;
          }
        } catch (e) { /* ignore */ }

        const yearEl = document.getElementById('yearSlider');
        const year = yearEl ? parseInt(yearEl.value) : null;
        const pvIndex = document.getElementById('pvSlider') ? parseInt(document.getElementById('pvSlider').value) : null;
        const flipMode = window._activeFlip ? window._activeFlip.mode : null;
        try { updateUrl(year, pvIndex, flipMode); } catch (e) { console.warn(e); }
      });
    }

    if (urlParams.flip && window._flipByYear && window._flipByYear.get(y)) {
      setTimeout(() => {
        if (urlParams.flip === 'classic' || urlParams.flip === 'no_majority' || urlParams.flip === 'tie') {
          applyFlip(urlParams.flip);
        }
      }, 100);
    }
  };
}

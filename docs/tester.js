(function () {
  'use strict';

  // Compact tester.js - Core orchestration for election results viewer
  // Complex logic delegated to utility modules

  // Use shared modules
  const allocateProportionalEVs = window.EvCalculations?.allocateProportionalEVs || (() => ({ D: 0, R: 0, O: 0, thirdParties: {} }));
  const totalVotesFromRow = window.VoteCalculations?.totalVotesFromRow || ((row) => +row.total || 0);
  const leanStr = window.FormattingUtils?.leanStr || ((x) => `${x > 0 ? 'D' : 'R'}+${(Math.abs(x) * 100).toFixed(1)}`);
  const marginToColor = window.ColorUtils?.marginToColor || ((m) => m > 0 ? '#4169E1' : '#B22222');
  const getUrlParams = window.UrlUtils?.getUrlParams || (() => ({ year: null, pv: null, flip: null }));
  const updateUrl = window.UrlUtils?.updateUrl || (() => {});

  // State
  const byYear = new Map();
  const evByUnit = new Map();
  const stopsByYear = new Map();
  const stopToEff = new Map();
  const stopToUnits = new Map();

  window._byYearMap = byYear;
  window._evByUnitMap = evByUnit;
  window._stopsByYear = stopsByYear;
  window._activeFlip = null;

  // Data loading
  async function loadData() {
    try {
      const response = await fetch('presidential_margins.csv');
      const text = await response.text();
      const lines = text.split('\n').filter(l => l.trim());
      
      lines.slice(1).forEach(line => {
        const parts = line.split(',');
        if (parts.length < 4) return;
        
        const year = +parts[0];
        const unit = parts[1];
        const margin = parseFloat(parts[2]);
        const ev = +parts[3];
        
        if (!isFinite(year) || !unit || !isFinite(margin)) return;
        
        const row = { year, unit, margin, ev, dVotes: 0, rVotes: 0, tVotes: 0 };
        
        if (!byYear.has(year)) byYear.set(year, []);
        byYear.get(year).push(row);
        
        if (isFinite(ev) && ev > 0) {
          evByUnit.set(`${year}:${unit}`, ev);
        }
      });
      
      console.log(`[tester] Loaded data for ${byYear.size} years`);
    } catch (e) {
      console.error('[tester] Error loading data:', e);
    }
  }

  // Build PV stops for a year
  function buildPvStops(year) {
    const rows = byYear.get(year) || [];
    if (!rows.length) return;
    
    const stops = new Set([0]);
    rows.forEach(r => {
      if (r.unit && r.unit !== 'NATIONAL' && isFinite(r.margin)) {
        stops.add(Number(r.margin.toFixed(6)));
      }
    });
    
    const sorted = Array.from(stops).sort((a, b) => a - b);
    stopsByYear.set(year, sorted);
    
    // Map stops to units
    sorted.forEach(stop => {
      const key = stop.toFixed(6);
      const units = rows.filter(r => r.unit && r.unit !== 'NATIONAL' && 
        Math.abs(r.margin - stop) < 0.000005).map(r => r.unit);
      if (units.length) stopToUnits.set(key, units);
    });
  }

  // Get national margin for a year
  function getNatMargin(year) {
    const rows = byYear.get(year);
    if (!rows) return 0;
    const nat = rows.find(r => r.unit === 'NATIONAL');
    return nat ? nat.margin : 0;
  }
  window._getNatMargin = getNatMargin;

  // Calculate adjusted margin for a unit
  function getAdjustedMargin(year, unit, pvShift) {
    const rows = byYear.get(year);
    if (!rows) return null;
    
    const row = rows.find(r => r.unit === unit);
    if (!row) return null;
    
    const natMargin = getNatMargin(year);
    const pv = pvShift - natMargin;
    const adjusted = row.margin + pv;
    
    return {
      margin: adjusted,
      marginStr: leanStr(adjusted),
      ev: row.ev || 0,
      color: marginToColor(adjusted)
    };
  }
  window.getAdjustedInfo = getAdjustedMargin;

  // Update map colors
  function updateMapColors(year, pvShift = 0) {
    const rows = byYear.get(year) || [];
    
    rows.forEach(r => {
      if (!r.unit || r.unit === 'NATIONAL') return;
      
      const info = getAdjustedMargin(year, r.unit, pvShift);
      if (!info) return;
      
      // Update state or district color
      if (window.ElectionMap) {
        if (/-0[123]|-AL$/.test(r.unit)) {
          window.ElectionMap.setDistrictFill(r.unit, info.color);
        } else {
          window.ElectionMap.setStateFill(r.unit, info.color);
        }
      }
    });
    
    // Update EV labels
    if (window.ElectionMap?.refreshDecorations) {
      const evLookup = (abbr) => evByUnit.get(`${year}:${abbr}`) || null;
      const abbrColors = new Map();
      const unitColors = new Map();
      
      rows.forEach(r => {
        if (!r.unit || r.unit === 'NATIONAL') return;
        const info = getAdjustedMargin(year, r.unit, pvShift);
        if (!info) return;
        
        if (/-0[123]|-AL$/.test(r.unit)) {
          unitColors.set(r.unit, info.color);
        } else {
          abbrColors.set(r.unit, { color: info.color });
        }
      });
      
      window.ElectionMap.refreshDecorations(year, evLookup, abbrColors, unitColors);
    }
  }

  // Calculate EV totals
  function calculateEvTotals(year, pvShift = 0) {
    const rows = byYear.get(year) || [];
    let dEV = 0, rEV = 0, oEV = 0;
    
    rows.forEach(r => {
      if (!r.unit || r.unit === 'NATIONAL' || !isFinite(r.ev)) return;
      
      const info = getAdjustedMargin(year, r.unit, pvShift);
      if (!info) return;
      
      if (info.margin > 0) dEV += r.ev;
      else if (info.margin < 0) rEV += r.ev;
      else oEV += r.ev;
    });
    
    return { dEV, rEV, oEV };
  }

  // Update EV display
  function updateEvDisplay(year, pvShift = 0) {
    const totals = calculateEvTotals(year, pvShift);
    
    const dEl = document.getElementById('demEV');
    const rEl = document.getElementById('repEV');
    const uEl = document.getElementById('uncalledEV');
    
    if (dEl) dEl.textContent = totals.dEV;
    if (rEl) rEl.textContent = totals.rEV;
    if (uEl) uEl.textContent = totals.oEV;
  }

  // Main update function
  function updateAll() {
    const yearEl = document.getElementById('yearSlider');
    const pvEl = document.getElementById('pvSlider');
    const pvValEl = document.getElementById('pvVal');
    const yearValEl = document.getElementById('yearVal');
    
    if (!yearEl) return;
    
    const year = +yearEl.value;
    const pvIndex = pvEl ? +pvEl.value : 0;
    const stops = stopsByYear.get(year) || [0];
    const pvShift = window._pvOverride ?? stops[pvIndex] ?? 0;
    
    window._curYear = year;
    window._curPv = pvShift;
    
    if (yearValEl) yearValEl.textContent = year;
    if (pvValEl) pvValEl.textContent = leanStr(pvShift);
    
    updateMapColors(year, pvShift);
    updateEvDisplay(year, pvShift);
    updateUrl(year, pvIndex, null);
  }
  window.updateAll = updateAll;

  // Initialize
  async function init() {
    await loadData();
    
    // Build map
    if (window.ElectionMap) {
      await window.ElectionMap.build({
        svgSelector: '#map',
        topoUrl: 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json',
        districtGeoUrl: 'me_ne_districts.geojson',
        stateHandlers: {
          click: (evt, abbr) => {
            const year = window._curYear || 2024;
            window.location.href = `state_pages/${abbr}.html`;
          },
          mouseenter: (evt, abbr) => {
            const year = window._curYear || 2024;
            const pv = window._curPv || 0;
            const info = getAdjustedMargin(year, abbr, pv);
            if (!info || !window.MapInteraction) return;
            window.MapInteraction.showMapTip(evt, `${abbr} · ${info.ev} EV · ${info.marginStr}`);
          },
          mousemove: (evt) => window.MapInteraction?.moveMapTip(evt),
          mouseleave: () => window.MapInteraction?.hideMapTip()
        },
        districtHandlers: {
          mouseenter: (evt, unit) => {
            const year = window._curYear || 2024;
            const pv = window._curPv || 0;
            const info = getAdjustedMargin(year, unit, pv);
            if (!info || !window.MapInteraction) return;
            window.MapInteraction.showMapTip(evt, `${unit} · ${info.ev} EV · ${info.marginStr}`);
          },
          mousemove: (evt) => window.MapInteraction?.moveMapTip(evt),
          mouseleave: () => window.MapInteraction?.hideMapTip()
        }
      });
    }
    
    // Build PV stops for all years
    byYear.forEach((rows, year) => buildPvStops(year));
    
    // Setup year slider
    const yearEl = document.getElementById('yearSlider');
    if (yearEl) {
      yearEl.addEventListener('input', updateAll);
      
      // Set from URL or default
      const params = getUrlParams();
      if (params.year && byYear.has(params.year)) {
        yearEl.value = params.year;
      }
    }
    
    // Setup PV slider
    const pvEl = document.getElementById('pvSlider');
    if (pvEl) {
      pvEl.addEventListener('input', () => {
        window._pvOverride = null;
        updateAll();
      });
    }
    
    // Initial render
    updateAll();
  }

  // Stub functions for compatibility
  window.getRowsForYear = (year) => byYear.get(year) || [];
  window.getEvFor = (year, unit) => evByUnit.get(`${year}:${unit}`) || null;
  window.allocateProportionalEVs = allocateProportionalEVs;
  window.updateEvBreakdownTable = () => {}; // Stub
  window._STOP_EPS = 0.000005;

  // Start when ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

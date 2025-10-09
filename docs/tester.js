'use strict';
import {
  EPS, STOP_EPS, ID_TO_ABBR, SMALL_STATES,
  getStateName, idToAbbr
} from './utils/constants.js';
import {
  allocateProportionalEVs, isProportionalEvMode,
  getAllEvAllocations,
} from './utils/evAllocation.js';
import {
  _ensureTip, _placeTipAt, showMapTip, hideMapTip, moveMapTip,
  refreshActiveMapTip, createUnitTipInfo, _setActiveTip, _activeTipState
} from './utils/tooltipManager.js';
import {
  fmtLean, formatter, leanStr
} from './utils/formatters.js';
import './utils/evBreakdownModal.js';
import ElectionMap from './utils/electionMap.js';
import { colorForMargin as siteColorForMargin } from './utils/siteState.js';
import DataLoader, { loadPresidentialMargins as loadPresidentialMarginsData, loadCsv as loadCsvData } from './utils/dataLoader.js';
import {
  getUnitFinalVoteTotals,
  calculateUnitVoteTallies,
  clampMargin
} from './utils/unitInfo.js';
import {
  setFlipDependencies,
  buildFlipScenarioMaps,
  updateFlipMetricOptionsForYear,
  updateFlipButtons,
  isUnitFlipped,
  clearFlips,
  applyFlip
} from './utils/flipScenarios.js';
import { parsePvText, clampPv, applyPvOverride } from './utils/pvTools.js';
import { updateCandidateInfo } from './utils/candidateInfo.js';
import { buildPvStops, stopToEff, stopToUnits, stopsByYear } from './utils/pvStops.js';

(function () {
  // Check if proportional EV mode is enabled
  try { window.isProportionalEvMode = isProportionalEvMode; } catch (e) { console.warn(e); }

  // Expose PV helper utilities for legacy inline scripts/pages that expect globals
  try { window.applyPvOverride = applyPvOverride; } catch (e) { }
  try { window.parsePvText = parsePvText; } catch (e) { }
  try { window.clampPv = clampPv; } catch (e) { }

  // Make the active-tip state exportable so callers can check/update it
  const _activeTipState = window._activeTipState || { info: null };

  function syncSmallBoxesConfigRef() {
    try { window.smallBoxesConfig = ElectionMap._smallBoxesConfig; } catch (e) { console.warn(e); }
  }
  syncSmallBoxesConfigRef();
  function setSmallBoxesConfig(patch) {
    try {
      ElectionMap.setSmallBoxesConfig(patch);
      syncSmallBoxesConfigRef();
    } catch (e) { console.warn('[smallBoxes] setSmallBoxesConfig error', e); }
  }
  function nudgeSmallBoxes(dx, dy) {
    try {
      ElectionMap.nudgeSmallBoxes(dx, dy);
      syncSmallBoxesConfigRef();
    } catch (e) { console.warn('[smallBoxes] nudgeSmallBoxes error', e); }
  }
  try {
    window.setSmallBoxesConfig = setSmallBoxesConfig;
    window.nudgeSmallBoxes = nudgeSmallBoxes;
  } catch (e) { console.warn(e); }

  function getTotalEvForState(year, abbrOrUnit) {
    try {
      const unitStr = (abbrOrUnit != null) ? String(abbrOrUnit) : '';
      const abbr = unitStr.includes('-') ? unitStr.slice(0, 2) : unitStr;
      if (!abbr) return null;
      if (typeof window.getRowsForYear !== 'function') return null;
      const rows = window.getRowsForYear(year) || [];
      let sum = 0; let found = false;
      for (const r of rows) {
        if (!r || !r.unit || r.unit === 'NATIONAL') continue;
        const unit = String(r.unit);
        if (unit === abbr || unit.startsWith(abbr + '-')) {
          const ev = Number(r.ev);
          if (isFinite(ev)) { sum += ev; found = true; }
        }
      }
      if (found) return sum;
      if (window._evByUnitMap && typeof window._evByUnitMap.get === 'function') {
        const ev = window._evByUnitMap.get(`${year}:${abbr}`);
        if (isFinite(ev)) return Number(ev);
      }
      return null;
    } catch (e) {
      console.warn(e);
      return null;
    }
  }

  function getEvLookupForYear(year) {
    const y = (typeof year === 'number' && isFinite(year)) ? Number(year) : (window._curYear || 2024);
    return function lookup(unitOrAbbr) {
      if (!unitOrAbbr) return null;
      const unit = String(unitOrAbbr);
      try {
        if (typeof window.getEvFor === 'function') {
          const direct = window.getEvFor(y, unit);
          if (direct != null && isFinite(direct)) return Number(direct);
        }
      } catch (e) { console.warn(e); }
      const abbr = unit.includes('-') ? unit.slice(0, 2) : unit;
      const total = getTotalEvForState(y, abbr);
      return (total != null && isFinite(total)) ? Number(total) : null;
    };
  }

  function updateStateLabels(year, evLookupOverride) {
    const y = (typeof year === 'number' && isFinite(year)) ? Number(year) : (window._curYear || 2024);
    const evLookup = evLookupOverride || getEvLookupForYear(y);
    ElectionMap.updateStateLabels(y, evLookup);
  }

  function renderSmallStateBoxes(year, abbrColors, unitColors, evLookupOverride) {
    const y = (typeof year === 'number' && isFinite(year)) ? Number(year) : (window._curYear || 2024);
    const evLookup = evLookupOverride || getEvLookupForYear(y);
    ElectionMap._evLookup = evLookup;
    ElectionMap.renderSmallStateBoxes(y, abbrColors || window._lastAbbrColors || new Map(), unitColors || window._lastUnitColors || new Map());
  }

  function refreshMapDecorations(year, abbrColors, unitColors) {
    const y = (typeof year === 'number' && isFinite(year)) ? Number(year) : (window._curYear || 2024);
    const evLookup = getEvLookupForYear(y);
    ElectionMap.refreshDecorations(y, evLookup, abbrColors || window._lastAbbrColors || new Map(), unitColors || window._lastUnitColors || new Map());
  }

  try {
    window.updateStateLabels = updateStateLabels;
    window.renderSmallStateBoxes = renderSmallStateBoxes;
    window.refreshMapDecorations = refreshMapDecorations;
  } catch (e) { console.warn(e); }

  try {
    window.addEventListener('resize', () => {
      try { if (ElectionMap._visualCenterCache) ElectionMap._visualCenterCache.clear(); } catch (err) { console.warn(err); }
      try { updateStateLabels(window._curYear || 2024); } catch (err) { console.warn(err); }
    });
    window.addEventListener('mapReady', () => {
      try { if (ElectionMap._visualCenterCache) ElectionMap._visualCenterCache.clear(); } catch (err) { console.warn(err); }
    });
  } catch (e) { console.warn(e); }

  function _updateActiveTipCoords(evt) {
    if (!_activeTipState.info || !evt) return;
    _activeTipState.info.clientX = evt.clientX;
    _activeTipState.info.clientY = evt.clientY;
  }

  try {
    window.showMapTip = function (evt, text, info) {
      if (info) {
        _setActiveTip(info);
        _updateActiveTipCoords(evt);
      } else {
        _setActiveTip(null);
      }
      showMapTip(evt, text);
    };
    window.moveMapTip = function (evt) {
      _updateActiveTipCoords(evt);
      moveMapTip(evt);
    };
    window.hideMapTip = hideMapTip;
    window.refreshActiveMapTip = refreshActiveMapTip;
  } catch (e) { console.warn(e); }

  try {
    window.addEventListener('mapReady', function () {
      try {
        const yearEl = document.getElementById('yearSlider');
        const y = yearEl ? parseInt(yearEl.value) : (window._curYear || 2024);
        // TX-only debug: confirm TX path is present when map is ready
        //   try {
        //     const hasTx = !!document.getElementById('state-TX');
        //     console.log('[labels] mapReady TX path present?', hasTx);
        //   } catch(e) {}
        //   try { console.log('[labels] mapReady calling updateStateLabels', { y }); } catch(e) {}
        //   updateStateLabels(y);
      } catch (e) { console.warn(e); }
      try {
        // Rebind hover to use centralized tooltip logic
        const idToAbbr = ID_TO_ABBR;
        d3.selectAll('path.state')
          .on('mouseover', function (evt, d) {
            const sel = d3.select(this);
            const cur = sel.attr('fill') || '#2f2f2f';
            sel.attr('data-orig-fill', cur);
            try {
              const isYellow = (cur.toLowerCase && cur.toLowerCase() === '#ffd700');
              // Use a neutral highlight color to avoid party-color confusion
              let highlight = '#A0A0A0';
              sel.attr('fill', highlight);
            } catch (e) { sel.attr('fill', '#A0A0A0'); }
            try {
              // Determine state abbreviation robustly: prefer bound datum, fall back to element id (e.g., 'state-TX')
              let abbr = null;
              try {
                if (d && d.id != null) abbr = idToAbbr[String(d.id).padStart(2, '0')];
              } catch (e) { /* ignore */ }
              if (!abbr) {
                try {
                  const elId = (this && this.id) ? this.id : (this && this.getAttribute ? this.getAttribute('id') : null);
                  if (elId && elId.startsWith && elId.startsWith('state-')) abbr = elId.slice('state-'.length);
                  else if (elId && elId.length === 2) abbr = elId.toUpperCase();
                } catch (e) { /* ignore */ }
              }
              if (abbr) {
                try {
                  const curYear = (window._curYear != null) ? window._curYear : (document.getElementById('yearSlider') ? +document.getElementById('yearSlider').value : null);
                  const tipInfoOpts = {};
                  if (abbr === 'CO' && curYear === 1876) {
                    tipInfoOpts.staticText = 'CO · 3 EV - R';
                  } else if (abbr === 'FL' && curYear === 1868) {
                    tipInfoOpts.staticText = 'FL · 3 EV - R';
                  } else if (abbr === 'LA' && curYear === 1864) {
                    tipInfoOpts.staticText = 'LA · 7 EV - R';
                  } else {
                    tipInfoOpts.label = abbr;
                  }
                  const tipInfo = createUnitTipInfo(abbr, tipInfoOpts);
                  if (typeof window.showMapTip === 'function') window.showMapTip(evt, tipInfo.getText(), tipInfo);
                } catch (e) { /* ignore tooltip errors */ }
              }
            } catch (e) { console.warn(e); }
          })
          .on('mousemove', function (evt) { try { if (typeof window.moveMapTip === 'function') window.moveMapTip(evt); } catch (e) { console.warn(e); } })
          .on('mouseout', function () {
            const sel = d3.select(this);
            const orig = sel.attr('data-orig-fill') || '#2f2f2f';
            sel.attr('fill', orig);
            sel.attr('data-orig-fill', null);
            try { if (typeof window.hideMapTip === 'function') window.hideMapTip(); } catch (e) { console.warn(e); }
          });
      } catch (e) { console.warn(e); }
    });
  } catch (e) { console.warn(e); }

  // Expose for manual testing: you can call window.updateStateLabels(2024) in console
  try { window.updateStateLabels = updateStateLabels; } catch (e) { console.warn(e); }

  // URL parameter management for sharing
  // Support: pv can be an integer index (slider index), a numeric PV (e.g. 0.045),
  // or a preset name (e.g. Gore). We also support `flipped` which negates a PV preset/value.
  function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const out = {
      year: params.get('year') ? parseInt(params.get('year')) : null,
      // legacy: pv as slider index
      pv: null,
      // explicit numeric PV override (fractional, e.g. 0.045)
      pvValue: null,
      // named preset from pv select (e.g., 'Gore')
      pvPreset: null,
      // flip scenario (classic/no_majority)
      flip: params.get('flip') || null,
      // metric selection (votes|margin)
      metric: (params.get('metric') || '').toLowerCase() || null,
      // proportional EV mode
      propEv: params.get('propEv') === 'true' || params.get('propEv') === '1',
      // (no flipped flag anymore)
    };
    const pvRaw = params.get('pv');
    if (pvRaw != null) {
      // integer index (slider index)
      if (/^\d+$/.test(pvRaw)) out.pv = parseInt(pvRaw);
      else if (!isNaN(parseFloat(pvRaw))) out.pvValue = parseFloat(pvRaw);
      else out.pvPreset = pvRaw;
    }
    // no flipped flag parsing; numeric pvValue encodes sign when present
    return out;
  }

  function updateUrl(year, pvIndex, flipMode) {
    const url = new URL(window.location);
    if (year) url.searchParams.set('year', year);
    else url.searchParams.delete('year');

    // Prefer to write an explicit pvValue when a numeric override is active (window._pvOverride)
    if (typeof window._pvOverride === 'number' && isFinite(window._pvOverride)) {
      url.searchParams.set('pv', String(window._pvOverride));
    } else if (pvIndex !== null && pvIndex !== undefined) {
      url.searchParams.set('pv', pvIndex);
    } else {
      url.searchParams.delete('pv');
    }

    if (flipMode) url.searchParams.set('flip', flipMode);
    else url.searchParams.delete('flip');

    // Persist metric selection
    try {
      const sel = document.getElementById('flipMetric');
      const m = sel ? String(sel.value || '').toLowerCase() : '';
      if (m) url.searchParams.set('metric', m);
      else url.searchParams.delete('metric');
    } catch (e) { console.warn(e); }

    // Persist proportional EV mode
    try {
      const propEvToggle = document.getElementById('propEvToggle');
      if (propEvToggle && propEvToggle.checked) {
        url.searchParams.set('propEv', 'true');
      } else {
        url.searchParams.delete('propEv');
      }
    } catch (e) { console.warn(e); }

    // No flipped URL param: we store PV overrides directly as numeric values (possibly negative)

    window.history.replaceState({}, '', url);
  }

  try { window.leanStr = leanStr; } catch (e) { console.warn(e); }

  function marginToColor(m, isThirdParty = false) {
    if (isThirdParty) return '#C9A400';
    const val = Number(m);
    if (!isFinite(val)) return '#999';
    if (val < 0 && val > -0.01) return '#b67d86ff';
    return siteColorForMargin(val, true);
  }
  try { window.marginToColor = marginToColor; } catch (e) { console.warn(e); }

  const byYear = new Map();
  const evByUnit = new Map();
  // expose for tooltip/helper access outside closure
  window._byYearMap = byYear;
  window._evByUnitMap = evByUnit;
  // Mapping of stops maintained via pvStops module
  // Remap for known label mismatches between GeoJSON and CSV keys
  const UNIT_REMAP = {};

  function clampShare(value) {
    const v = Number(value);
    if (!isFinite(v) || v <= 0) return 0;
    if (v >= 1) return 1;
    return v;
  }

  function dbg() {//console.log('[tester]', ...arguments); 
  }

  const moduleDataLoader = (DataLoader && typeof DataLoader.loadCsv === 'function')
    ? DataLoader
    : ((typeof loadCsvData === 'function' || typeof loadPresidentialMarginsData === 'function')
      ? {
          loadCsv: loadCsvData,
          loadPresidentialMargins: loadPresidentialMarginsData
        }
      : null);

  function getActiveDataLoader() {
    if (moduleDataLoader) return moduleDataLoader;
    if (typeof window !== 'undefined' && window.DataLoader && typeof window.DataLoader.loadCsv === 'function') {
      return window.DataLoader;
    }
    return null;
  }

  function loadOptionalCsv(loader, path) {
    const basePromise = (loader && typeof loader.loadCsv === 'function')
      ? loader.loadCsv(path)
      : d3.csv(path);
    return basePromise.catch(() => []);
  }

  function loadTesterData() {
    const loader = getActiveDataLoader();
    const marginsPromise = (loader && typeof loader.loadPresidentialMargins === 'function')
      ? loader.loadPresidentialMargins()
      : d3.csv('presidential_margins.csv');

    return Promise.all([
      marginsPromise,
      loadOptionalCsv(loader, 'electoral_college.csv'),
      loadOptionalCsv(loader, 'flip_results.csv'),
      loadOptionalCsv(loader, 'flip_details.csv'),
      loadOptionalCsv(loader, 'stop_colors.csv')
    ]);
  }

  loadTesterData().then(([margins, ec, flipResults, flipDetails, stopColors]) => {
    (margins || []).forEach(r => {
      const year = +r.year;
      const unit = r.abbr;
      const rm = +r.relative_margin || 0;
      const nm = +r.national_margin || 0;
      const ev = +r.electoral_votes || 0;
      // include vote totals for adjusted PV calculations
      const dVotes = +r.D_votes || 0;
      const rVotes = +r.R_votes || 0;
      const tVotes = +r.third_party_votes || 0;
      const totalVotes = +r.total_votes || (dVotes + rVotes + tVotes) || 0;
      const topThirdVotes = +r.T_votes || 0;
      const topThirdShareRaw = (r.top_third_party_share !== undefined && r.top_third_party_share !== null)
        ? +r.top_third_party_share
        : (totalVotes > 0 ? topThirdVotes / totalVotes : 0);
      const totalThirdShareRaw = (r.third_party_share !== undefined && r.third_party_share !== null)
        ? +r.third_party_share
        : (totalVotes > 0 ? tVotes / totalVotes : 0);
      const topThirdShare = clampShare(topThirdShareRaw);
      const thirdShare = clampShare(totalThirdShareRaw);

      // Capture candidate names
      const dCandidate = r.D_candidate || '';
      const rCandidate = r.R_candidate || '';
      const specialCaseNotes = r.special_case_notes || '';
      const color = r.color || ''; // Capture color to identify third party winners

      // Parse third_party_results JSON field
      let thirdPartyResults = {};
      try {
        if (r.third_party_results) {
          thirdPartyResults = JSON.parse(r.third_party_results);
        }
      } catch (e) {
        // If parsing fails, leave as empty object
      }

      const row = {
        year, unit, rm, nm, ev, tp: topThirdShare, thirdShare,
        dVotes, rVotes, tVotes, total: totalVotes, topThirdVotes,
        dCandidate, rCandidate, thirdPartyResults, specialCaseNotes, color
      };
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(row);
      if (ev > 0) evByUnit.set(`${year}:${unit}`, ev);
    });
    (ec || []).forEach(e => {
      const year = +e.year;
      const unit = e.abbr;
      const ev = +e.electoral_votes;
      if (year && unit && ev) evByUnit.set(`${year}:${unit}`, ev);
    });

    // Build flip scenarios (metric-aware) and associated metadata
    buildFlipScenarioMaps(flipDetails, flipResults);

    // Index stop colors CSV: year -> stop_key -> unit -> { winner, color_css, result_color_name }
    // Also capture effective PV per stop so the slider uses the precomputed nudge/average.
    window._stopColorsByYear = new Map();
    window._stopEffByYear = new Map(); // year -> stop_key -> effective_pv (number)
    try {
      (stopColors || []).forEach(r => {
        const y = +r.year; if (!y) return;
        const key = String(r.stop_key != null ? r.stop_key : (r.stop != null ? r.stop : ''));
        if (!key) return;
        const unit = r.unit;
        const winner = r.winner;
        const color_css = r.color_css || '';
        const color_name = r.result_color_name || '';
        const eff = (r.effective_pv != null && r.effective_pv !== '') ? +r.effective_pv : null;
        if (!window._stopColorsByYear.has(y)) window._stopColorsByYear.set(y, new Map());
        if (!window._stopEffByYear.has(y)) window._stopEffByYear.set(y, new Map());
        const byStop = window._stopColorsByYear.get(y);
        const effByStop = window._stopEffByYear.get(y);
        if (!byStop.has(key)) byStop.set(key, new Map());
        byStop.get(key).set(unit, { winner, color_css, color_name });
        // Record effective once per stop key
        if (!effByStop.has(key) && eff != null && isFinite(eff)) effByStop.set(key, eff);
      });
    } catch (e) { console.warn(e); }

    // expose simple accessors
    window.getRowsForYear = function (y) { try { return byYear.get(y) || []; } catch (e) { return []; } };
    window.getEvFor = function (y, u) { try { return evByUnit.get(`${y}:${u}`); } catch (e) { return null; } };

    init();
    // attempt to load ME/NE district geometries for per-district coloring
    fetch('me_ne_districts.geojson').then(r => r.json()).then(geo => {
      try {
        // Create clipPaths for ME and NE using the state paths already on the map
        const svgEl = d3.select('#map');
        const defs = svgEl.select('defs').empty() ? svgEl.append('defs') : svgEl.select('defs');
        const mePath = d3.select('#state-ME');
        const nePath = d3.select('#state-NE');
        // Build clip paths by cloning the state path 'd' for maximum compatibility
        if (!mePath.empty()) {
          const meD = mePath.attr('d');
          const meClip = defs.select('#clip-ME').empty() ? defs.append('clipPath').attr('id', 'clip-ME') : defs.select('#clip-ME');
          meClip.selectAll('*').remove();
          meClip.append('path').attr('d', meD);
        }
        if (!nePath.empty()) {
          const neD = nePath.attr('d');
          const neClip = defs.select('#clip-NE').empty() ? defs.append('clipPath').attr('id', 'clip-NE') : defs.select('#clip-NE');
          neClip.selectAll('*').remove();
          neClip.append('path').attr('d', neD);
        }
        // Render districts above states so they are visible; enable pointer events for hover/tooltips
        const dg = window.mapG.append('g').attr('class', 'districts').attr('pointer-events', 'auto');
        window._districtPaths = new Map();
        const districtDByUnit = new Map();
        const feats = (geo && geo.features) ? geo.features.slice() : [];
        // Custom order: For Maine, sort by descending area so smaller ME-02 renders on top of larger ME-01.
        // For Nebraska, sort by ascending area so NE-02 is smallest and renders on top.
        try {
          feats.sort((a, b) => {
            const getUnit = (f) => {
              if (!f.properties) return null;
              return f.properties.unit || f.properties.abbr || f.properties.GEOID || null;
            };
            const au = getUnit(a);
            const bu = getUnit(b);
            const aState = au ? au.slice(0, 2) : null;
            const bState = bu ? bu.slice(0, 2) : null;

            // Handle ME districts - sort by descending area (largest first)
            if (aState === 'ME' && bState === 'ME') {
              try { return window.mapPath.area(b) - window.mapPath.area(a); } catch (e) { return 0; }
            }
            // Handle NE districts - sort by ascending area (smallest first) 
            if (aState === 'NE' && bState === 'NE') {
              try { return window.mapPath.area(a) - window.mapPath.area(b); } catch (e) { return 0; }
            }
            // Default sort by area descending
            try { return window.mapPath.area(b) - window.mapPath.area(a); } catch (e) { return 0; }
          });
        } catch (e) { console.warn(e); }

        feats.forEach(f => {
          // prefer an explicit 'unit' property (e.g. 'ME-01'/'NE-02'), fall back to abbr or GEOID
          let unit = null;
          if (f.properties) {
            unit = f.properties.unit || f.properties.abbr || f.properties.GEOID || null;
          }
          if (!unit) return;

          // Use original unit name directly when it matches expected patterns
          const useUnit = (unit.match(/^(ME|NE)-0[123]$/)) ? unit : (UNIT_REMAP[unit] || unit);
          const st = useUnit.slice(0, 2);
          const clip = st === 'ME' ? 'url(#clip-ME)' : (st === 'NE' ? 'url(#clip-NE)' : null);

          let dStr = window.mapPath(f);
          // Remove problematic bounding box rectangles that cover the entire canvas
          if (dStr && dStr.startsWith('M-104,-4.4L1079,-4.4L1079,614.4L-104,614.4Z')) {
            dStr = dStr.replace(/^M-104,-4\.4L1079,-4\.4L1079,614\.4L-104,614\.4Z/, '');
          }

          if (useUnit && dStr) districtDByUnit.set(useUnit, dStr);
          // halo underlay to make small districts more visible (e.g., NE-02)
          dg.append('path')
            .attr('class', 'district-halo')
            .attr('id', `halo-${useUnit}`)
            .attr('d', dStr)
            .attr('clip-path', clip)
            .attr('fill', 'none')
            .attr('stroke', '#000')
            .attr('stroke-opacity', 0.35)
            .attr('stroke-width', 2.2)
            .attr('data-unit', useUnit)
            .attr('data-st', st)
            .attr('pointer-events', 'none');
          const p = dg.append('path')
            .attr('class', 'district')
            .attr('id', `district-${useUnit}`)
            .attr('d', dStr)
            .attr('clip-path', clip)
            .attr('fill', 'transparent')
            .attr('stroke', '#BBBBBB')
            .attr('stroke-width', 1.2)
            .attr('stroke-linejoin', 'round')
            .attr('stroke-linecap', 'round')
            .attr('data-unit', useUnit)
            .attr('data-st', st)
            .attr('pointer-events', 'auto')
            // District hover interactions
            .on('mouseover', function (evt) {
              try {
                const sel = d3.select(this);
                const cur = sel.attr('fill') || 'transparent';
                sel.attr('data-orig-fill', cur);
                // Use a neutral highlight color to avoid party-color confusion
                let highlight = '#A0A0A0';
                // Preserve bright yellow for third-party highlight when the fill is already yellow
                try { if (cur && cur.toLowerCase && cur.toLowerCase() === '#ffd700') highlight = '#FFD700'; } catch (e) { console.warn(e); }
                sel.attr('fill', highlight);
                const unit = sel.attr('data-unit');
                const tipInfo = createUnitTipInfo(unit, { label: unit });
                if (typeof window.showMapTip === 'function') window.showMapTip(evt, tipInfo.getText(), tipInfo);
              } catch (e) { console.warn(e); }
            })
            .on('mousemove', function (evt) { try { if (typeof window.moveMapTip === 'function') window.moveMapTip(evt); } catch (e) { console.warn(e); } })
            .on('mouseout', function () {
              try {
                const sel = d3.select(this);
                const orig = sel.attr('data-orig-fill') || 'transparent';
                sel.attr('fill', orig);
                sel.attr('data-orig-fill', null);
                if (typeof window.hideMapTip === 'function') window.hideMapTip();
              } catch (e) { console.warn(e); }
            })
            .on('click', function () {
              if (window._futureMode) return; // disable navigation in future mode
              try {
                const unit = this.getAttribute('data-unit');
                if (unit) window.open(`unit/${unit}.html`, '_blank');
              } catch (e) { console.warn(e); }
            });
          window._districtPaths.set(useUnit, p);
        });
        // Build an SVG mask to stop NE-03 from painting over NE-02/NE-01 if geometries overlap
        try {
          const ne03 = districtDByUnit.get('NE-03');
          if (ne03) {
            const m = defs.select('#mask-NE-03').empty() ? defs.append('mask').attr('id', 'mask-NE-03') : defs.select('#mask-NE-03');
            m.attr('maskUnits', 'userSpaceOnUse')
              .attr('x', 0).attr('y', 0)
              .attr('width', 975).attr('height', 610);
            m.selectAll('*').remove();
            m.append('rect').attr('x', 0).attr('y', 0).attr('width', 975).attr('height', 610).attr('fill', '#fff');
            const cut02 = districtDByUnit.get('NE-02');
            const cut01 = districtDByUnit.get('NE-01');
            if (cut02) m.append('path').attr('d', cut02).attr('fill', '#000');
            if (cut01) m.append('path').attr('d', cut01).attr('fill', '#000');
            // apply mask to NE-03 district and halo
            const p03 = window._districtPaths.get('NE-03');
            if (p03) p03.attr('mask', 'url(#mask-NE-03)');
            const h03 = d3.select(`#halo-NE-03`);
            if (!h03.empty()) h03.attr('mask', 'url(#mask-NE-03)');
          }
        } catch (e) { /* masking optional */ }
        // Bring state boundary mesh to front so white seams remain visible above district fills
        try { d3.select('svg#map').select('g').select('.state-boundaries').raise(); } catch (e) { console.warn(e); }
        // apply initial colors now that district paths exist
        try { updateAll(); } catch (e) { console.warn(e); }
      } catch (e) {
        console.warn(`Couldn't render ME/NE districts: ${e && e.message ? e.message : e}`);
      }
    }).catch(() => {/* no district overlay available */ });
  });

  function getNatMargin(year) {
    const arr = byYear.get(year) || [];
    for (const r of arr) {
      if (r.unit === 'NATIONAL' || r.unit === 'NAT') return r.nm || 0;
    }
    let sum = 0, n = 0;
    arr.forEach(r => { if (isFinite(r.nm)) { sum += r.nm; n++; } });
    return n ? sum / n : 0;
  }

  function init() {
    const yearSlider = document.getElementById('yearSlider');
    const pvSlider = document.getElementById('pvSlider');
    const flipMetricSel = document.getElementById('flipMetric');
    const yearVal = document.getElementById('yearVal');
    const pvVal = document.getElementById('pvVal');
    const pvStops = document.getElementById('pvStops');
    const pvStopsList = document.getElementById('pvStopsList');
    if (!yearSlider || !pvSlider) return;

    window.addEventListener('mapReady', () => updateAll());
    yearSlider.addEventListener('input', () => {
      clearFlips();
      updateAll();
      updateFlipMetricOptionsForYear();
      // Update URL with new year
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

    // Populate stop maps for the default year before configuring the slider UI
    buildPvStops(y);
    const stops = stopsByYear.get(y) || [0];
    pvSlider.min = 0;
    pvSlider.max = Math.max(0, stops.length - 1);
    pvSlider.step = 1;
    const nat = getNatMargin(y);
    let defaultIdx = stops.findIndex(v => Math.abs(v - nat) <= STOP_EPS);
    if (defaultIdx < 0) defaultIdx = stops.findIndex(v => Math.abs(v) <= STOP_EPS);
    if (defaultIdx < 0) defaultIdx = 0;

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

    // Render stop chips and datalist now that slider/default are aligned
    buildPvStops(y, {
      container: pvStops,
      datalist: pvStopsList,
      getNatMargin,
      updateAll
    });
    // Initialize metric select with available metrics for current year
    updateFlipMetricOptionsForYear();

    // buttons
    const btnClassic = document.getElementById('flipClassic');
    const btnNoMaj = document.getElementById('flipNoMaj');
    const btnTie = document.getElementById('flipTie');
    const btnReset = document.getElementById('flipReset');
    if (btnClassic) btnClassic.addEventListener('click', () => applyFlip('classic'));
    if (btnNoMaj) btnNoMaj.addEventListener('click', () => applyFlip('no_majority'));
    if (btnTie) btnTie.addEventListener('click', () => applyFlip('tie'));
    if (btnReset) btnReset.addEventListener('click', () => { clearFlips(); updateAll(); });
    // Initial button visibility update
    updateFlipButtons();

    // Initialize proportional EV mode toggle
    const propEvToggle = document.getElementById('propEvToggle');
    const propEvFooter = document.getElementById('propEvFooter');
    if (propEvToggle && propEvFooter) {
      // Show the footer and add body class for padding
      propEvFooter.style.display = 'flex';
      document.body.classList.add('has-prop-ev-toggle');

      // Add event listener for toggle changes
      propEvToggle.addEventListener('change', () => {
        // Clear any active flip scenarios when toggling proportional mode
        clearFlips();
        updateAll();

        // Update URL to preserve state
        const yearEl = document.getElementById('yearSlider');
        const pvEl = document.getElementById('pvSlider');
        const year = yearEl ? parseInt(yearEl.value) : null;
        const pvIndex = pvEl ? parseInt(pvEl.value) : null;
        updateUrl(year, pvIndex, null);
      });
    }

    updateAll();

    // Wire the PV Flip button to also toggle a flipped flag and update the URL so shares can preserve a flipped PV
    const pvFlipBtn = document.getElementById('pvFlip');
    if (pvFlipBtn) {
      pvFlipBtn.addEventListener('click', () => {
        // Determine current PV (override takes precedence)
        let cur = 0;
        try {
          if (typeof window._pvOverride === 'number' && isFinite(window._pvOverride)) cur = window._pvOverride;
          else {
            const yearEl = document.getElementById('yearSlider'); const y = yearEl ? parseInt(yearEl.value) : 2024;
            const pvEl = document.getElementById('pvSlider');
            const stops = (stopsByYear && stopsByYear.get(y)) || [0];
            const idx = pvEl ? parseInt(pvEl.value) : 0; const stopVal = stops[idx] || 0; cur = stopVal;
          }
        } catch (e) { console.warn(e); }
        // Apply numeric negation of current PV (flip)
        applyPvOverride(-cur);
        // push the new state to URL
        const yearEl = document.getElementById('yearSlider');
        const year = yearEl ? parseInt(yearEl.value) : null;
        const pvIndex = document.getElementById('pvSlider') ? parseInt(document.getElementById('pvSlider').value) : null;
        const flipMode = window._activeFlip ? window._activeFlip.mode : null;
        updateUrl(year, pvIndex, flipMode);
      });
    }

    // Apply flip scenario from URL if specified
    if (urlParams.flip && window._flipByYear && window._flipByYear.get(y)) {
      setTimeout(() => {
        if (urlParams.flip === 'classic' || urlParams.flip === 'no_majority' || urlParams.flip === 'tie') {
          applyFlip(urlParams.flip);
        }
      }, 100);
    }
  }

  function updateAll() {
    dbg('updateAll: starting...');
    const yearEl = document.getElementById('yearSlider');
    const pvEl = document.getElementById('pvSlider');
    if (!yearEl || !pvEl) return;
    const year = +yearEl.value;
    document.getElementById('yearVal').textContent = year;
    // If the year changed since last render, rebuild stops and default PV to national stop
    try {
      if (window._prevYear !== year) {
        const pvStops = document.getElementById('pvStops');
        const pvStopsList = document.getElementById('pvStopsList');
        buildPvStops(year, {
          container: pvStops,
          datalist: pvStopsList,
          getNatMargin,
          updateAll
        });
        const stopsNow = stopsByYear.get(year) || [0];
        const natNow = getNatMargin(year);
        let idx = stopsNow.findIndex(v => Math.abs(v - natNow) <= STOP_EPS);
        if (idx < 0) idx = stopsNow.findIndex(v => Math.abs(v) <= STOP_EPS);
        if (idx < 0) idx = 0;
        pvEl.min = 0; pvEl.max = Math.max(0, stopsNow.length - 1); pvEl.step = 1; pvEl.value = String(idx);
        window._prevYear = year;
      }
    } catch (e) { console.warn(e); }
    // pvSlider is now an index into the stops array
    const nat = getNatMargin(year);
    // expose current for tooltip helper
    window._curYear = year;
    const pvIndex = +pvEl.value;
    const stops = stopsByYear.get(year) || [0];
    //try { console.log('[stops] updateAll current stops set', { year, count: stops.length, sample: stops.slice(0,25) }); } catch(e) {}
    const stopVal = (stops && stops.length > 0 && stops[pvIndex] !== undefined) ? stops[pvIndex] : 0;
    // Allow a custom PV override (e.g., user-entered PV) to take precedence over stops
    const override = (typeof window._pvOverride === 'number' && isFinite(window._pvOverride)) ? window._pvOverride : null;
    const pv = (override != null) ? override : (stopToEff.get(stopVal) || (stopVal + EPS * (stopVal === 0 ? 1 : Math.sign(stopVal - nat))));
    window._curPv = pv;
    //try { console.log('updateAll', {year, pvIndex, stopVal, pv, flips: (window._activeFlip && window._activeFlip.year===year) ? window._activeFlip.units.length : 0}); } catch(e){}
    // Add debug for active flip state
    if (window._activeFlip && window._activeFlip.year === year) {
      console.log('Active flip debug:', {
        flipUnits: window._activeFlip.units.map(u => u.unit),
        flipSet: Array.from(window._activeFlip._set || [])
      });
    }
    // Update flip buttons visibility based on year and scenario equality
    updateFlipButtons();
    // show only the unit(s) whose exact flip stop equals the current pv (not cumulative flips)
    const matches = [];
    if (override == null) {
      const eff = stopToEff.get(stopVal);
      if (eff != null && isFinite(eff) && Math.abs(pv - eff) <= STOP_EPS) {
        const list = stopToUnits.get(stopVal) || [];
        list.forEach(u => { if (u && u !== 'NATIONAL' && u !== 'NAT') matches.push(String(u).slice(0, 5)); });
      }
    }
    const showNat = ((!(window._futureMode && year > 2024)) && override == null && Math.abs(stopVal - nat) <= STOP_EPS);
    const matchLabel = (Math.abs(stopVal) < STOP_EPS) ? '' : (matches.length ? ' (' + (matches.slice(0, 6).join(',') + (matches.length > 6 ? '…' : '')) + ')' : '');
    (function () {
      const el = document.getElementById('pvVal'); if (!el) return;
      const base = (showNat ? 'Actual ' : '') + leanStr(pv) + matchLabel;
      // If a preset override is active (window._pvOverride set AND we have a name), append name in parentheses
      let out = base;
      try {
        if (typeof window._pvOverride === 'number' && isFinite(window._pvOverride) && window._pvPresetName) {
          // Avoid duplicating if already present
          if (!base.includes('(' + window._pvPresetName + ')')) out = base + ' (' + window._pvPresetName + ')';
        }
      } catch (e) { console.warn(e); }
      el.textContent = out;
    })();

    buildPvStops(year, {
      container: document.getElementById('pvStops'),
      datalist: document.getElementById('pvStopsList'),
      getNatMargin,
      updateAll
    });

    const arr = byYear.get(year) || [];
    const abbrColors = new Map();
    const unitColors = new Map();
    const unitParties = new Map(); // unit -> 'Blue'|'Red'|'Even'|'Other'
    let dEV = 0, rEV = 0, oEV = 0;
    // Build a quick lookup of votes_to_flip for active scenario
    const activeFlip = window._activeFlip && window._activeFlip.year === year ? window._activeFlip : null;
    const vtByUnit = new Map();
    if (activeFlip && Array.isArray(activeFlip.units)) {
      activeFlip.units.forEach(u => vtByUnit.set(u.unit, Math.max(0, +u.votes_to_flip || 0)));
    }
    arr.forEach(r => {
      const unit = r.unit;
      // Historical anomaly: Colorado (CO) in 1876 had no popular returns but its electors voted for Hayes (R).
      // Force a tiny Republican tilt so the map colors CO red and the EVs count for R.
      // try {
      //   if (year === 1876 && unit === 'CO') {
      //     // Push relative margin slightly negative so all sign checks treat CO as R
      //     r.rm = (typeof r.rm === 'number') ? (r.rm > 0 ? -Math.abs(EPS) : -Math.abs(EPS)) : -Math.abs(EPS);
      //     // Ensure the per-year/unit EV lookup contains 3 EVs for CO:1876
      //     try { if (window._evByUnitMap && typeof window._evByUnitMap.set === 'function') window._evByUnitMap.set(`${year}:CO`, 3); } catch(e) {}
      //   }
      // } catch(e) {}
      if (!unit || unit === 'NATIONAL') return;
      // If a flip scenario is active, flip the sign (winner reverses) by nudging margin to opposite winner by tiny epsilon
      const flipped = isUnitFlipped(year, unit);
      // Historical static: CO in 1876 should ignore national PV (treat as static Republican)
      let m = (year === 1876 && unit === 'CO') ? (+r.rm || 0) : ((+r.rm || 0) + pv);
      if (flipped) {
        // If third-party yellow window (1968) we still want to switch from R/D to the other major party; push margin beyond 0 by EPS
        m = (m > 0 ? -EPS : EPS);
      }
      // Prefer explicit checks rather than mixing ?? and || which can parse oddly
      let ev = evByUnit.get(`${year}:${unit}`);
      if (ev == null || isNaN(ev)) {
        ev = (+r.ev);
        if (!isFinite(ev)) ev = 0;
      }

      const tallies = calculateUnitVoteTallies(unit);
      let voteLeader = null;
      let voteRunner = null;
      let votesColor = null;
      let votesMargin = null;
      if (tallies && isFinite(tallies.total) && tallies.total > 0) {
        const breakdown = [
          { code: 'D', votes: Math.max(0, tallies.D || 0) },
          { code: 'R', votes: Math.max(0, tallies.R || 0) },
          { code: 'O', votes: Math.max(0, tallies.O || 0) }
        ].filter(p => p.votes > 0);
        breakdown.sort((a, b) => b.votes - a.votes);
        voteLeader = breakdown[0] || null;
        voteRunner = breakdown[1] || null;
        if (voteLeader && voteLeader.votes > 0) {
          if (voteLeader.code === 'O') {
            votesColor = '#FFD700';
            votesMargin = 0;
          } else {
            const runnerVotes = voteRunner ? voteRunner.votes : 0;
            const totalVotes = Math.max(voteLeader.votes + runnerVotes, tallies.total);
            let mv = (voteLeader.votes - runnerVotes) / Math.max(EPS, totalVotes);
            if (!isFinite(mv)) mv = 0;
            mv = clampMargin(mv);
            if (voteLeader.code === 'R') mv = -mv;
            votesMargin = mv;
            votesColor = marginToColor(mv);
          }
        }
      }
      // Special case: Alabama 1960 and Mississippi 1960 - always use fixed allocation when not R
      let counted = false;
      if (!counted && year === 1960 && (unit === 'AL' || unit === 'MS')) {
        // Determine winner using PV-adjusted margin to match other code paths
        const margin = +r.rm || 0;
        const pv = window._curPv || 0;
        const adjMargin = margin + pv;
        const winner = adjMargin >= 0 ? 'D' : 'R';

        if (winner !== 'R') {
          if (unit === 'AL') {
            // Alabama: 5 D, 6 O
            dEV += 5;
            oEV += 6;
          } else {
            // Mississippi: 0 D, all O
            dEV += 0;
            oEV += ev;
          }
        } else {
          // Republicans win: normal winner-take-all
          rEV += ev;
        }
        counted = true;
      }

      // Count EVs, ensuring the tipping-point state is included (no black sliver)
      // Third-party EV handling: classify as Other when PV is strictly within the yellow window
      if (!counted) {
        // Check if proportional EV mode is enabled
        if (isProportionalEvMode()) {
          // Proportional EV allocation using PV-adjusted vote totals so the PV slider affects allocations
          const total = +r.total || (+r.dVotes || 0) + (+r.rVotes || 0) + (+r.tVotes || 0) || 0;
          // third-party share (use thirdShare if present, else tp)
          const tp = Math.max(0, Math.min(1, (r.thirdShare != null ? +r.thirdShare : +r.tp) || 0));
          // Adjust two-party split by current PV and flips
          let rmAdj = (+r.rm || 0) + pv;
          if (flipped) rmAdj = -rmAdj;
          let twoD = 0.5 + rmAdj / 2;
          if (!isFinite(twoD)) twoD = 0.5;
          twoD = Math.max(0, Math.min(1, twoD));
          const dShare = (1 - tp) * twoD;
          const rShare = (1 - tp) * (1 - twoD);
          const tShare = tp;
          const dVotesAdj = total * dShare;
          const rVotesAdj = total * rShare;
          const tVotesAdj = total * tShare;
          const topThirdShare = +r.tp || 0;
          const allocation = allocateProportionalEVs(dVotesAdj, rVotesAdj, tVotesAdj, ev, topThirdShare, r.thirdPartyResults);
          // try {
          //   if (year === 1960) {
          //     console.log('[EV-TRACE] evBar proportional allocation', { year, unit, ev, dVotesAdj, rVotesAdj, tVotesAdj, thirdPartyResults: r.thirdPartyResults, allocation });
          //   }
          // } catch(e) {}
          dEV += allocation.D;
          rEV += allocation.R;
          oEV += allocation.O;
          // Also add any third party EVs
          if (allocation.thirdParties) {
            Object.values(allocation.thirdParties).forEach(tpEV => oEV += tpEV);
          }
          counted = true;
        } else {
          if (voteLeader && voteLeader.votes > 0) {
            if (!isNaN(ev)) {
              if (voteLeader.code === 'D') dEV += ev;
              else if (voteLeader.code === 'R') rEV += ev;
              else oEV += ev;
            }
            counted = true;
          } else {
            // Original winner-take-all fallback using PV margins
            const t = +r.tp || 0;
            const a = 3 * t - 1;
            if (a > 0) {
              const rVal = +(r.rm || 0);
              const nD = -rVal + a;
              const nR = -rVal - a;
              if (pv > nR + EPS && pv < nD - EPS) {
                if (!isNaN(ev)) oEV += ev; // Other wins here
                counted = true;
              }
            }
          }
        }
      }
      if (!counted) {
        if (m > 0) {
          dEV += ev;
        } else if (m < 0) {
          rEV += ev;
        } else {
          // On an exact stop, classify by the sign of (stopVal - nat): if stop is to D side, include as D, else as R
          const side = Math.sign((stopVal || 0) - (nat || 0));
          if (side >= 0) dEV += ev; else rEV += ev;
        }
      }
      const st = unit.slice(0, 2);
      const prev = abbrColors.get(st);

      // Special pluralities / fallback logic when vote tallies are unavailable
      const rVal = +(r.rm || 0);
      const tShare = +r.tp || 0;
      const thirdWindow = 3 * tShare - 1;
      let fallbackColor;
      if (year === 1948 && r.unit === 'AL') {
        fallbackColor = (pv < -rVal) ? marginToColor(m) : '#FFD700';
      } else {
        fallbackColor = marginToColor(m);
      }

      const color = votesColor || fallbackColor;
      const marginForState = (votesMargin != null) ? votesMargin : m;
      const isStateAggregate = unit.length === 2 || unit.endsWith('-AL');
      const isThirdPartyColor = color === '#FFD700';
      const shouldOverrideStateColor = !prev || isStateAggregate || isThirdPartyColor || Math.abs(marginForState) > Math.abs(prev.m);
      if (shouldOverrideStateColor) {
        abbrColors.set(st, { m: marginForState, color });
      }
      // store per-unit color and party label so district polygons can be filled individually
      unitColors.set(unit, color);
      if (voteLeader && voteLeader.code === 'O') {
        unitParties.set(unit, 'Other');
      } else {
        unitParties.set(unit, (marginForState > EPS) ? 'Blue' : ((marginForState < -EPS) ? 'Red' : 'Even'));
      }
    });

    // After per-unit colors are computed, adjust ME-AL/NE-AL statewide color to account for district flips
    (function adjustAtLargeFromDistricts() {
      const states = ['ME', 'NE'];
      for (const st of states) {
        // determine if this year has district data for this state
        const districtUnits = (st === 'ME') ? ['ME-01', 'ME-02'] : ['NE-01', 'NE-02', 'NE-03'];
        const haveAll = districtUnits.every(u => arr.some(r => r && r.unit === u));
        if (!haveAll) continue; // nothing to recompute
        // Sum D/R votes across districts, applying flips where applicable
        let dSum = 0, rSum = 0;
        for (const du of districtUnits) {
          const row = arr.find(x => x && x.unit === du);
          if (!row) continue;
          let d0 = +row.dVotes || 0;
          let r0 = +row.rVotes || 0;
          const vt = vtByUnit.get(du) || 0;
          const baseRm = (+row.rm || 0) + (window._curPv || 0);
          const flipped = isUnitFlipped(year, du);
          if (flipped) {
            // move vt votes from the original winner to the loser
            if (d0 >= r0) { d0 = Math.max(0, d0 - vt); r0 = r0 + vt; }
            else { d0 = d0 + vt; r0 = Math.max(0, r0 - vt); }
          }
          dSum += d0; rSum += r0;
        }
        const twoTot = dSum + rSum;
        if (twoTot <= 0) continue;
        let m = (dSum - rSum) / twoTot; // two-party margin D-R
        // If at-large itself is flipped, force sign to opposite side
        const alUnit = st + '-AL';
        if (isUnitFlipped(year, alUnit)) {
          m = (m > 0 ? -1e-6 : 1e-6);
        }
        const color = marginToColor(m);
        unitColors.set(alUnit, color);
        // If the state fill uses at-large color as representative, update abbrColors when |m| is stronger
        const prev = abbrColors.get(st);
        if (!prev || Math.abs(m) >= Math.abs(prev.m)) {
          abbrColors.set(st, { m, color });
        }
      }
    })();

    // Use smooth transitions for state fills
    (function () {
      if (window._electionNightActive) {
        window._electionNightLastAbbrColors = abbrColors;
        return;
      }
      d3.selectAll('path.state').each(function (d) {
        const id = String(d.id).padStart(2, '0');
        const abbr = idToAbbr[id];
        const entry = abbrColors.get(abbr);
        const fill = entry ? entry.color : '#2f2f2f';
        try {
          d3.select(this)
            .transition()
            .duration(450)
            .attrTween('fill', function () {
              const current = d3.select(this).attr('fill') || '#2f2f2f';
              return d3.interpolateRgb(current, fill);
            });
        } catch (e) {
          console.warn(e);
          d3.select(this).attr('fill', fill);
        }
      });
    })();

    // color district polygons (ME/NE) if overlay loaded
    if (window._districtPaths) {
      if (window._electionNightActive) {
        window._electionNightLastUnitColors = unitColors;
      } else {
        try {
          // Show/hide districts based on year availability
          const showME = year >= 1972;
          const showNE = year >= 1992;
          // Update both fill and visibility
          window._districtPaths.forEach((pSel, unit) => {
            // unit is expected like 'ME-01' or 'NE-02'
            const stateAbbr = unit.slice(0, 2);
            const atLargeEntry = abbrColors.get(stateAbbr);
            const atLargeColor = atLargeEntry ? atLargeEntry.color : '#2f2f2f';
            const ucolor = unitColors.get(unit) || atLargeColor || 'transparent';
            const st = stateAbbr;
            const visible = (st === 'ME' ? showME : (st === 'NE' ? showNE : true));
            try {
              // transition fill color for district polygons
              try {
                pSel.transition().duration(400).attrTween('fill', function () {
                  const cur = d3.select(this).attr('fill') || 'transparent';
                  return d3.interpolateRgb(cur, ucolor);
                });
              } catch (e) {
                pSel.attr('fill', ucolor);
              }
              pSel.attr('display', visible ? null : 'none');
              // also toggle the matching halo
              const halo = pSel.node && pSel.node().previousSibling;
              if (halo && halo.setAttribute) halo.setAttribute('display', visible ? null : 'none');

            } catch (e) { console.warn(e); }
          });
          // after districts update, keep labels above them
        } catch (e) { /* ignore */ }
      }
    }

    // Use actual total EV for the selected year (fallback to 538)
    let totalEV = 538;
    try {
      const t = window._totalEvByYear && window._totalEvByYear.get(year);
      if (isFinite(t) && t > 0) totalEV = t;
    } catch (e) { console.warn(e); }

    const otherEV = oEV || 0;
    const uEV = Math.max(0, totalEV - (dEV + rEV + otherEV));
    const dPct = totalEV ? (dEV / totalEV) * 100 : 0;
    const uPct = totalEV ? (uEV / totalEV) * 100 : 0;
    const oPct = totalEV ? (otherEV / totalEV) * 100 : 0;
    const rPct = totalEV ? (rEV / totalEV) * 100 : 0;

    const dEl = document.getElementById('evFillD');
    const uEl = document.getElementById('evFillU');
    const oEl = document.getElementById('evFillO');
    const rEl = document.getElementById('evFillR');

    const segments = [
      { el: dEl, pct: dPct, value: dEV },
      { el: uEl, pct: uPct, value: uEV },
      { el: oEl, pct: oPct, value: otherEV },
      { el: rEl, pct: rPct, value: rEV }
    ];
    let offset = 0;
    const activeSegs = [];
    // Animate bar changes smoothly by applying CSS transitions to left/right/width
    const TRANS_MS = 360;
    const TRANS_EASE = 'cubic-bezier(0.22,0.61,0.36,1)';
    segments.forEach(seg => {
      if (!seg.el) return;
      const visible = seg.value > EPS;
      seg.el.style.borderRadius = '0';
      if (!visible) {
        // hide immediately (no transition) to avoid flicker when value is zero
        try { seg.el.style.transition = 'none'; seg.el.style.willChange = 'auto'; } catch (e) { console.warn(e); }
        seg.el.style.width = '0%';
        seg.el.style.display = 'none';
        return;
      }

      // ensure element is visible before animating
      try { seg.el.style.display = ''; } catch (e) { console.warn(e); }
      try {
        seg.el.style.transition = `left ${TRANS_MS}ms ${TRANS_EASE}, right ${TRANS_MS}ms ${TRANS_EASE}, width ${TRANS_MS}ms ${TRANS_EASE}`;
        seg.el.style.willChange = 'left, right, width';
      } catch (e) { console.warn(e); }

      const anchor = (seg.el.dataset && seg.el.dataset.anchor) || '';
      const widthPct = `${Math.max(0, seg.pct).toFixed(3)}%`;
      if (anchor === 'right') {
        seg.el.style.left = 'auto';
        seg.el.style.right = `${offset.toFixed(3)}%`;
        seg.el.style.width = widthPct;
      } else {
        seg.el.style.left = `${offset.toFixed(3)}%`;
        seg.el.style.right = 'auto';
        seg.el.style.width = widthPct;
      }
      offset += Math.max(0, seg.pct);
      activeSegs.push(seg.el);
    });
    if (activeSegs.length) {
      const first = activeSegs[0];
      const last = activeSegs[activeSegs.length - 1];
      first.style.borderTopLeftRadius = first.style.borderBottomLeftRadius = '9px';
      if (activeSegs.length === 1) {
        first.style.borderTopRightRadius = first.style.borderBottomRightRadius = '9px';
      } else {
        last.style.borderTopRightRadius = last.style.borderBottomRightRadius = '9px';
      }
    }

    const evText = document.getElementById('evText');
    if (evText) {
      const parts = [`D ${dEV}`];
      if (uEV > 0) parts.push(`U ${uEV}`);
      if (otherEV > 0) parts.push(`O ${otherEV}`);
      parts.push(`R ${rEV}`);
      evText.textContent = (uEV > 0 || otherEV > 0) ? parts.join(' | ') : `${dEV} - ${rEV}`;
    }
    const flipEC = document.getElementById('flipEC');
    if (flipEC) {
      const parts = [`D ${dEV}`];
      if (uEV > 0) parts.push(`U ${uEV}`);
      if (otherEV > 0) parts.push(`O ${otherEV}`);
      parts.push(`R ${rEV}`);
      flipEC.textContent = (uEV > 0 || otherEV > 0) ? parts.join(' | ') : `${dEV} - ${rEV}`;
    }

    // Dynamic "Close states" panel (if present): list units with |margin| < 1.0 pp
    try {
      const closeWrap = document.getElementById('closeStates');
      if (closeWrap) {
        const THRESH = 0.01; // 1 percentage point
        // consider only at-large or standard states (avoid district rows to prevent double counting)
        const isALorState = (u) => (u && (u.length === 2 || u === 'DC' || u.endsWith('-AL')));
        const rows = byYear.get(year) || [];
        const list = [];
        rows.forEach(r => {
          if (!r || r.unit === 'NATIONAL') return;
          if (!isALorState(r.unit)) return;
          let m = (+r.rm || 0) + pv;
          const t = +r.tp || 0; const a = 3 * t - 1; const rVal = +(r.rm || 0);
          // If inside third-party (yellow) window, exclude from close list of D/R
          if (a > 0) {
            const nD = -rVal + a; const nR = -rVal - a;
            if (pv > nR + EPS && pv < nD - EPS) return; // Other wins here, not a close D/R
          }
          if (Math.abs(m) < THRESH) {
            list.push({ unit: r.unit, ev: (+r.ev || 0), m });
          }
        });
        list.sort((a, b) => Math.abs(a.m) - Math.abs(b.m));
        const fmt = (x) => {
          if (!isFinite(x)) return '';
          if (Math.abs(x) < 0.000005) return 'EVEN';
          const s = (Math.abs(x) * 100).toFixed(1);
          return (x > 0 ? 'D+' : 'R+') + s;
        };
        // Also compute 'Bellwether' states: within 5.0 percentage points of the national margin
        const BELLWETHER_THRESHOLD = 0.05; // 5 percentage points
        const bellwetherList = [];
        rows.forEach(r => {
          if (!r || r.unit === 'NATIONAL') return;
          if (!isALorState(r.unit)) return;
          const t = +r.tp || 0; const a = 3 * t - 1; const rVal = +(r.rm || 0);
          // Exclude third-party winners from Bellwether classification
          if (a > 0) {
            const nD = -rVal + a; const nR = -rVal - a;
            if (pv > nR + EPS && pv < nD - EPS) return; // Other wins here
          }
          // margin relative is just rm
          const relToNat = (+r.rm || 0);
          if (Math.abs(r.rm) < BELLWETHER_THRESHOLD) bellwetherList.push({ unit: r.unit, ev: (+r.ev || 0), relToNat });
        });
        bellwetherList.sort((a, b) => Math.abs(rows.find(r => r.unit === a.unit)?.rm || 0) - Math.abs(rows.find(r => r.unit === b.unit)?.rm || 0));

        // helpers to pick readable text colors for chip backgrounds
        function _textColorFor(bg) { try { if (!bg || bg[0] !== '#') return '#fff'; const c = bg.slice(1); const val = parseInt(c, 16); const rr = (val >> 16) & 255; const gg = (val >> 8) & 255; const bb = val & 255; const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb; return lum > 186 ? '#000' : '#fff'; } catch (e) { return '#fff'; } }
        function _smallColorFor(textCol) { return textCol === '#fff' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)'; }

        const closeChips = list.map(r => {
          const mval = r.m; const bg = marginToColor(mval); const txt = _textColorFor(bg); const small = _smallColorFor(txt);
          return `<span class="btn" style="padding:4px 6px;background-color:${bg};color:${txt}">${r.unit} · <small style=\"color:${small}\">${fmt(r.m)}</small> · ${r.ev} EV</span>`;
        }).join('');

        const bellwetherChips = (bellwetherList.length === 0) ? '<span class="muted">No bellwether states within 5.0 pp.</span>' : bellwetherList.map(r => {
          // Use display margin (rm + pv) for coloring so blue/red intensity reflects raw tilt
          const rowsMap = new Map(rows.map(rr => [rr.unit, rr]));
          const row = rowsMap.get(r.unit) || {};
          const displayM = (row && isFinite(+row.rm)) ? (+row.rm || 0) + pv : r.relToNat + nat; // fallback
          const bg = marginToColor(displayM);
          const txt = _textColorFor(bg);
          const small = _smallColorFor(txt);
          const relTxt = ((r.relToNat > 0) ? 'D+' : 'R+') + (Math.abs(r.relToNat) * 100).toFixed(1);
          return `<span class="btn" style="padding:4px 6px;background-color:${bg};color:${txt}">${r.unit} · <small style=\"color:${small}\">${relTxt}</small> · ${r.ev} EV</span>`;
        }).join('');

        // Render bellwethers (swing) first, then close states. Show helpful messages when either list is empty.
        let bellwetherStateLegend = '<div class="legend" style="margin-bottom:6px">Bellwether states (within 5.0 pp of national margin — i.e. close to the national popular vote, not necessarily close to flipping)</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:8px">' + bellwetherChips + '</div>';

        let closeSection = '';
        if (closeChips.length === 0) {
          closeSection = '<div class="legend" style="margin-top:12px">Close states (|raw margin| < 1.0 pp)</div><div class="legend">No close states within 1.0 pp.</div>';
        } else {
          closeSection = '<div class="legend" style="margin-top:12px">Close states (|raw margin| < 1.0 pp)</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:8px">' + closeChips + '</div>';
        }

        closeWrap.innerHTML = bellwetherStateLegend + closeSection;
      }
    } catch (e) { console.warn(e); }

    // Adjusted national PV totals at current PV stop
    try {
      let dSum = 0, rSum = 0, tSum = 0, totSum = 0;
      const rows = byYear.get(year) || [];
      const isActual = Math.abs((stopsByYear.get(year) || [0])[pvIndex] - nat) <= STOP_EPS;
      if (isActual) {
        // At Actual, if a flip scenario is active, adjust per flipped unit by moving votes_to_flip
        const f = window._activeFlip;
        const active = (f && f.year === year && Array.isArray(f.units) && f.units.length > 0);
        if (active) {
          const vtByUnit = new Map();
          f.units.forEach(u => vtByUnit.set(u.unit, Math.max(0, +u.votes_to_flip || 0)));
          for (const r of rows) {
            if (!r || !r.unit || r.unit === 'NATIONAL') continue;
            // Skip district rows to avoid double counting; include -AL and normal states only
            if (r.unit.includes('-') && !r.unit.endsWith('-AL')) continue;
            let d = +r.dVotes || 0;
            let rv = +r.rVotes || 0;
            const t = +r.tVotes || 0;
            const total = +r.total || (d + rv + t) || 0;
            const vt = vtByUnit.get(r.unit) || 0;
            if (vt > 0) {
              if (d >= rv) { d = Math.max(0, d - vt); rv = rv + vt; }
              else { d = d + vt; rv = Math.max(0, rv - vt); }
            }
            dSum += d; rSum += rv; tSum += t; totSum += total;
          }
          const fmt = (x) => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '0';
          const elD = document.getElementById('pvDem');
          const elR = document.getElementById('pvRep');
          const elO = document.getElementById('pvOth');
          const elT = document.getElementById('pvTot');
          if (elD) elD.textContent = fmt(dSum);
          if (elR) elR.textContent = fmt(rSum);
          if (elO) elO.textContent = fmt(tSum);
          if (elT) elT.textContent = fmt(totSum);
        } else {
          // Use NATIONAL row exactly when no flips are applied
          const natRow = rows.find(rr => rr.unit === 'NATIONAL' || rr.unit === 'NAT');
          if (natRow) {
            const fmt = (x) => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '0';
            const elD = document.getElementById('pvDem');
            const elR = document.getElementById('pvRep');
            const elO = document.getElementById('pvOth');
            const elT = document.getElementById('pvTot');
            if (elD) elD.textContent = fmt(+natRow.dVotes || 0);
            if (elR) elR.textContent = fmt(+natRow.rVotes || 0);
            if (elO) elO.textContent = fmt(+natRow.tVotes || 0);
            if (elT) elT.textContent = fmt(+natRow.total || 0);
          }
        }
      } else {
        for (const r of rows) {
          if (!r || !r.unit || r.unit === 'NATIONAL') continue;
          // Skip district rows to avoid double counting; include -AL and normal states only
          if (r.unit.includes('-') && !r.unit.endsWith('-AL')) continue;
          const total = +r.total || (+r.dVotes + +r.rVotes + +r.tVotes) || 0;
          if (!isFinite(total) || total <= 0) continue;
          const tp = Math.max(0, Math.min(1, (r.thirdShare != null ? +r.thirdShare : +r.tp) || 0));
          const flipped = isUnitFlipped(year, r.unit);
          let rmAdj = (+r.rm || 0) + pv;
          if (flipped) rmAdj = -rmAdj; // swap two-party shares
          let twoD = 0.5 + rmAdj / 2;
          if (!isFinite(twoD)) twoD = 0.5;
          twoD = Math.max(0, Math.min(1, twoD));
          const dShare = (1 - tp) * twoD;
          const rShare = (1 - tp) * (1 - twoD);
          const tShare = tp;
          dSum += total * dShare;
          rSum += total * rShare;
          tSum += total * tShare;
          totSum += total;
        }
        const fmt = (x) => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '0';
        const elD = document.getElementById('pvDem');
        const elR = document.getElementById('pvRep');
        const elO = document.getElementById('pvOth');
        const elT = document.getElementById('pvTot');
        if (elD) elD.textContent = fmt(dSum);
        if (elR) elR.textContent = fmt(rSum);
        if (elO) elO.textContent = fmt(tSum);
        if (elT) elT.textContent = fmt(totSum);
      }
    } catch (e) { /* non-fatal */ }

    // Refresh map decorations (state labels + small-state overlay)
    try {
      window._lastAbbrColors = abbrColors;
      window._lastUnitColors = unitColors;
      refreshMapDecorations(year, abbrColors, unitColors);
    } catch (e) { console.warn('[smallBoxes] error rendering side boxes', e); }

    // Render relative margin deltas panel when container exists
    try {
      const wrap = document.getElementById('relDeltas');
      const listEl = document.getElementById('relDeltasList');
      const titleEl = document.getElementById('relDeltasTitle');
      if (wrap && listEl) {
        // Adjust baseline select options before computing the baseline year.
        // If the previous election doesn't exist (e.g. first year like 1916),
        // disable the 'Previous election' option and auto-select 2024 so the
        // panel can still be shown by comparing to 2024. Conversely, when the
        // selected year is 2024, disable the explicit 2024 option and force
        // selection to 'prev' to avoid meaningless 2024 vs 2024 comparison.
        const baselineEl = document.getElementById('relBaseline');
        if (baselineEl) {
          const optPrev = Array.from(baselineEl.options).find(o => String(o.value) === 'prev');
          const opt2024 = Array.from(baselineEl.options).find(o => String(o.value) === '2024');
          const prevYear = year - 4;
          const hasPrev = (prevYear >= 1916) && byYear.has(prevYear);
          // Disable or enable previous-election option
          if (optPrev) optPrev.disabled = !hasPrev;
          // If no previous election data, prefer comparing to 2024 (if available)
          if (!hasPrev) {
            if (opt2024) { opt2024.disabled = false; baselineEl.value = '2024'; }
          }
          // Special-case: when inspecting year 2024, comparing to 2024 is meaningless
          if (opt2024) {
            if (year === 2024) {
              opt2024.disabled = true;
              if (baselineEl.value === '2024') baselineEl.value = 'prev';
            } else {
              // ensure enabled for other years (unless explicitly forced above)
              if (!(!hasPrev && opt2024)) opt2024.disabled = false;
            }
          }
        }

        // Now determine baseline selection and year
        const baselineMode = baselineEl ? baselineEl.value : 'prev';
        const baselineYear = (baselineMode === '2024') ? 2024 : (year - 4);
        // Show panel only if baseline year is within historical bounds (1916+) and present in data
        const showPanel = (baselineYear >= 1916) && byYear.has(baselineYear);
        if (!showPanel) {
          wrap.style.display = 'none';
        } else {
          wrap.style.display = '';
          if (titleEl) titleEl.textContent = `Relative margin change in ${year} vs ${baselineYear}`;
          const curRows = byYear.get(year) || [];
          const baseRows = byYear.get(baselineYear) || [];
          const baseMap = new Map();
          baseRows.forEach(r => {
            if (!r || !r.unit || r.unit === 'NATIONAL') return;
            const val = +r.rm || 0;
            baseMap.set(r.unit, val);
            // Add ME/NE synonyms so 'ME' <-> 'ME-AL' and 'NE' <-> 'NE-AL' both resolve
            if (r.unit === 'ME') baseMap.set('ME-AL', val);
            if (r.unit === 'ME-AL') baseMap.set('ME', val);
            if (r.unit === 'NE') baseMap.set('NE-AL', val);
            if (r.unit === 'NE-AL') baseMap.set('NE', val);
          });
          const items = [];
          curRows.forEach(r => {
            if (!r || r.unit === 'NATIONAL') return;
            let b = baseMap.get(r.unit);
            if (!isFinite(b)) return;
            const curRel = +r.rm || 0; // relative margin by definition
            const prevRel = b;
            let delta = curRel - b;
            if (year < 2024 && baselineYear === 2024) {
              delta = -delta; // invert delta when comparing historical year to future 2024
            }
            items.push({ unit: r.unit, delta, prevRel, curRel });
          });
          // Sort ascending by delta (more R shift first, more D shift last)
          items.sort((a, b) => a.delta - b.delta);

          function textColor(bg) { try { if (!bg || bg[0] !== '#') return '#fff'; const c = bg.slice(1); const val = parseInt(c, 16); const rr = (val >> 16) & 255, gg = (val >> 8) & 255, bb = val & 255; const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb; return lum > 186 ? '#000' : '#fff'; } catch (e) { console.warn(e); return '#fff'; } }
          const html = items.map(it => {
            const bg = marginToColor(it.curRel);
            const txt = textColor(bg);
            const small = (txt === '#fff') ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)';
            const prevStr = (year < 2024 && baselineYear === 2024) ? fmtLean(it.curRel) : fmtLean(it.prevRel);
            const curStr = (year < 2024 && baselineYear === 2024) ? fmtLean(it.prevRel) : fmtLean(it.curRel);
            return `<div class="btn" style="padding:6px 8px;background:${bg};color:${txt};display:flex;flex-direction:column;align-items:flex-start;min-width:110px">
            <div style="font-weight:600">${it.unit}</div>
            <div style="font-size:0.86rem;color:${small}">Δ ${fmtLean(it.delta)}</div>
            <div style="font-size:0.86rem;color:${small}">${prevStr} → ${curStr}</div>
          </div>`;
          }).join('');
          listEl.innerHTML = html || '<span class="legend">No data.</span>';
        }
      }
    } catch (e) { console.warn(e); }

    // If the baseline select is present, ensure changing it reruns updateAll
    try {
      const sel = document.getElementById('relBaseline');
      if (sel) {
        sel.addEventListener('change', () => { try { if (typeof window.updateAll === 'function') window.updateAll(); } catch (e) { console.warn(e); } });
      }
    } catch (e) { console.warn(e); }

    // Ensure 2024 baseline option is disabled when viewing year 2024 and
    // if user had 2024 selected while year == 2024, switch it to 'prev'.
    try {
      const baselineSel = document.getElementById('relBaseline');
      const yearEl = document.getElementById('yearSlider');
      if (baselineSel && yearEl) {
        const y = +yearEl.value;
        const opt2024 = Array.from(baselineSel.options).find(o => String(o.value) === '2024');
        if (opt2024) {
          if (y === 2024) {
            // disable the explicit 2024 comparison when the selected year is 2024
            opt2024.disabled = true;
            // if currently selected, move to previous election to keep panel meaningful
            if (baselineSel.value === '2024') {
              baselineSel.value = 'prev';
            }
          } else {
            // re-enable when year is not 2024
            opt2024.disabled = false;
          }
        }
      }
    } catch (e) { console.warn(e); }

    dbg('updateAll: ending successfully');
    // Update candidate names and special notes
    try { updateCandidateInfo(year); } catch (e) { console.warn(e); }
    // Update on-map labels last so they sit on top and have current EV totals
    try { updateStateLabels(year); } catch (e) { console.warn(e); }
  }

  setFlipDependencies({ updateAll, updateUrl });

  // Expose updateAll to global scope for applyFlip
  window.updateAll = updateAll;
  // Expose small-state boxes renderer for manual testing
  try { window.renderSmallStateBoxes = renderSmallStateBoxes; } catch (e) { console.warn(e); }

  // Expose scope variables needed by external functions
  window._stopsByYear = stopsByYear;
  window._getNatMargin = getNatMargin;
  window._STOP_EPS = STOP_EPS;
  window.updateUrl = updateUrl;

  // Expose proportional EV allocation for use in modal
  window.allocateProportionalEVs = allocateProportionalEVs;
})();


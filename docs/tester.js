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
  clampMargin,
  getNatMargin
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
import { createTesterInitializer } from './utils/testerInit.js';
import { createUpdateAll } from './utils/testerUpdate.js';
import { prepareAtLargeData, shouldAggregateAtLarge, getAtLargeAdjustedTotals } from './utils/atLargeAggregator.js';

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
        // Preserve CSV metadata including tipping/tie flags so client code can
        // rely on precomputed annotations.
        byStop.get(key).set(unit, {
          winner,
          color_css,
          color_name,
          IS_TIE_STOP: (r.IS_TIE_STOP !== undefined) ? r.IS_TIE_STOP : (r.is_tie_stop !== undefined ? r.is_tie_stop : null),
          IS_TIPPING_POINT: (r.IS_TIPPING_POINT !== undefined) ? r.IS_TIPPING_POINT : (r.is_tipping_point !== undefined ? r.is_tipping_point : null),
          ELECTORAL_VOTE_TOTALS: (r.ELECTORAL_VOTE_TOTALS !== undefined) ? r.ELECTORAL_VOTE_TOTALS : (r.electoral_vote_totals !== undefined ? r.electoral_vote_totals : '')
        });
        // Record effective once per stop key
        if (!effByStop.has(key) && eff != null && isFinite(eff)) effByStop.set(key, eff);
      });
    } catch (e) { console.warn(e); }

    prepareAtLargeData({
      byYear,
      stopColorsByYear: window._stopColorsByYear,
      stopEffByYear: window._stopEffByYear,
      colorForMargin: marginToColor
    });

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

  const updateAll = createUpdateAll({
    byYear,
    evByUnit,
    stopToEff,
    stopToUnits,
    stopsByYear,
    buildPvStops,
    STOP_EPS,
    EPS,
    leanStr,
    fmtLean,
    marginToColor,
    calculateUnitVoteTallies,
    clampMargin,
    getNatMargin,
    isUnitFlipped,
    allocateProportionalEVs,
    isProportionalEvMode,
    updateFlipButtons,
    updateCandidateInfo,
    updateStateLabels,
    refreshMapDecorations,
    dbg,
    idToAbbr,
    shouldAggregateAtLarge,
    getAtLargeAdjustedTotals,
    d3: (typeof d3 !== 'undefined') ? d3 : null
  });

  const init = createTesterInitializer({
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
  });

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


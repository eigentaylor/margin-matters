'use strict';
import { createUnitTipInfo } from './tooltipManager.js';

// Lightweight, reusable US election map renderer with optional ME/NE district overlay.
// Exposes a global ElectionMap with:
// - build({ svgSelector, topoUrl, districtGeoUrl, stateHandlers, districtHandlers })
// - setStateFill(abbr, color)
// - setDistrictFill(unit, color)
// - statePaths (Map abbr -> d3 selection)
// - districtPaths (Map unit -> d3 selection)

if (!window.d3 || !window.topojson) {
  console.warn('[ElectionMap] Requires d3 and topojson on the page before this script.');
}

const ID_TO_ABBR = { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY" };

const ElectionMap = {
  statePaths: new Map(),
  districtPaths: new Map(),
  _handlers: { state: {}, district: {} },
  // Label + overlay caches
  _labelLayer: null,
  _labelCache: new Map(),
  _visualCenterCache: new Map(),
  _visualCenterStates: new Set(['MI', 'FL', 'LA']),
  _smallBoxesConfig: { x: null, right: 8, y: 240, boxW: 75, boxH: 25, gapY: 4 },
  setSmallBoxesConfig(patch) {
    if (!patch || typeof patch !== 'object') return;
    Object.assign(this._smallBoxesConfig, patch);
    if (this._lastAbbrColors && this._lastUnitColors) this.renderSmallStateBoxes(this._lastYear || 2024, this._lastAbbrColors, this._lastUnitColors);
  },
  nudgeSmallBoxes(dx = 0, dy = 0) {
    const cfg = this._smallBoxesConfig;
    let x = cfg.x;
    if (!Number.isFinite(x)) {
      try {
        const svg = d3.select('svg#map');
        const vb = svg.empty() ? [0, 0, 975, 610] : (svg.attr('viewBox') ? svg.attr('viewBox').split(/\s+/).map(Number) : [0, 0, 975, 610]);
        const width = vb[2] || 975;
        x = width - (cfg.right || 8) - (cfg.boxW || 86);
      } catch (e) {
        x = 860;
      }
    }
    const nextX = x + (Number(dx) || 0);
    const nextY = (cfg.y || 0) + (Number(dy) || 0);
    cfg.x = nextX;
    cfg.y = nextY;
    this.setSmallBoxesConfig({});
  },
  setVisualCenterStates(list) {
    if (Array.isArray(list)) this._visualCenterStates = new Set(list.map(s => String(s).toUpperCase()));
    else if (list instanceof Set) this._visualCenterStates = new Set(Array.from(list).map(s => String(s).toUpperCase()));
    this._visualCenterCache.clear();
    this.updateStateLabels(this._lastYear || 2024, this._evLookup || (() => null));
  },
  setStateFill(abbr, color) {
    try {
      const sel = this.statePaths.get(abbr);
      if (!sel) return;
      try {
        sel.transition().duration(250).attrTween('fill', function () {
          const cur = d3.select(this).attr('fill') || '#2f2f2f';
          return d3.interpolateRgb(cur, color || '#2f2f2f');
        });
      } catch (e) { sel.attr('fill', color || '#2f2f2f'); }
    } catch (e) { }
  },
  setDistrictFill(unit, color) {
    try {
      const sel = this.districtPaths.get(unit);
      if (!sel) return;
      try {
        sel.transition().duration(250).attrTween('fill', function () {
          const cur = d3.select(this).attr('fill') || 'transparent';
          return d3.interpolateRgb(cur, color || 'transparent');
        });
      } catch (e) { sel.attr('fill', color || 'transparent'); }
    } catch (e) { }
  },
  async build(opts) {
    const svgSelector = (opts && opts.svgSelector) || '#map';
    const topoUrl = (opts && opts.topoUrl) || 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';
    const districtGeoUrl = opts && opts.districtGeoUrl; // optional
    this._handlers.state = (opts && opts.stateHandlers) || {};
    this._handlers.district = (opts && opts.districtHandlers) || {};

    try {
      // Debug: report whether callers provided handlers or defaults will be used
      try { console.debug('[ElectionMap] build handlers state:', Object.keys(this._handlers.state || {}), 'district:', Object.keys(this._handlers.district || {})); } catch (e) { }
    } catch (e) { }

    // Provide safe default handlers so small-state boxes (and other
    // consumers) can show/move/hide tooltips even when the caller
    // didn't supply explicit handlers. These default to the global
    // helpers (showMapTip/moveMapTip/hideMapTip) if present.
    try {
      if (!this._handlers.state.mouseenter || typeof this._handlers.state.mouseenter !== 'function') {
        this._handlers.state.mouseenter = function (evt, abbr) {
          try {
            console.debug('[ElectionMap] default state.mouseenter', { abbr, evt });
            // Build a rich tooltip identical to the main map handler
            const tipInfo = (typeof createUnitTipInfo === 'function') ? createUnitTipInfo(abbr, { label: abbr }) : null;
            if (tipInfo) {
              tipInfo.clientX = evt && evt.clientX != null ? evt.clientX : null;
              tipInfo.clientY = evt && evt.clientY != null ? evt.clientY : null;
              const txt = tipInfo.getText();
              console.debug('[ElectionMap] showMapTip from default state handler', { abbr, textSnippet: (txt ? txt.slice(0, 120) : txt) });
              if (typeof window.showMapTip === 'function') window.showMapTip(evt, txt, tipInfo);
            } else {
              console.debug('[ElectionMap] showMapTip fallback (string) for', abbr);
              if (typeof window.showMapTip === 'function') window.showMapTip(evt, String(abbr));
            }
          } catch (e) { console.warn('[ElectionMap] default state.mouseenter error', e); }
        };
      }
      if (!this._handlers.state.mousemove || typeof this._handlers.state.mousemove !== 'function') {
        this._handlers.state.mousemove = function (evt) {
          try { if (typeof window.moveMapTip === 'function') window.moveMapTip(evt); } catch (e) { }
        };
      }
      if (!this._handlers.state.mouseleave || typeof this._handlers.state.mouseleave !== 'function') {
        this._handlers.state.mouseleave = function () {
          try { if (typeof window.hideMapTip === 'function') window.hideMapTip(); } catch (e) { }
        };
      }

      if (!this._handlers.district.mouseenter || typeof this._handlers.district.mouseenter !== 'function') {
        this._handlers.district.mouseenter = function (evt, unit) {
          try {
            console.debug('[ElectionMap] default district.mouseenter', { unit, evt });
            const tipInfo = (typeof createUnitTipInfo === 'function') ? createUnitTipInfo(unit, { label: unit }) : null;
            if (tipInfo) {
              tipInfo.clientX = evt && evt.clientX != null ? evt.clientX : null;
              tipInfo.clientY = evt && evt.clientY != null ? evt.clientY : null;
              const txt = tipInfo.getText();
              console.debug('[ElectionMap] showMapTip from default district handler', { unit, textSnippet: (txt ? txt.slice(0, 120) : txt) });
              if (typeof window.showMapTip === 'function') window.showMapTip(evt, txt, tipInfo);
            } else {
              console.debug('[ElectionMap] showMapTip fallback (string) for district', unit);
              if (typeof window.showMapTip === 'function') window.showMapTip(evt, String(unit));
            }
          } catch (e) { console.warn('[ElectionMap] default district.mouseenter error', e); }
        };
      }
      if (!this._handlers.district.mousemove || typeof this._handlers.district.mousemove !== 'function') {
        this._handlers.district.mousemove = function (evt) {
          try { if (typeof window.moveMapTip === 'function') window.moveMapTip(evt); } catch (e) { }
        };
      }
      if (!this._handlers.district.mouseleave || typeof this._handlers.district.mouseleave !== 'function') {
        this._handlers.district.mouseleave = function () {
          try { if (typeof window.hideMapTip === 'function') window.hideMapTip(); } catch (e) { }
        };
      }
    } catch (e) { /* non-fatal */ }

    const svg = d3.select(svgSelector);
    if (svg.empty()) { console.warn('[ElectionMap] svg not found:', svgSelector); return; }
    svg.selectAll('*').remove();
    // main group for layers
    const g = svg.append('g');
    // expose for other modules for maximum compatibility
    window.mapG = g;
    const projection = d3.geoAlbersUsa().scale(1300).translate([975 / 2, 610 / 2]);
    const geoPath = d3.geoPath().projection(projection);
    window.mapPath = geoPath;

    const us = await d3.json(topoUrl);
    const states = topojson.feature(us, us.objects.states).features;

    const self = ElectionMap;
    g.selectAll('path.state')
      .data(states)
      .join('path')
      .attr('class', 'state')
      .attr('id', d => {
        const abbr = ID_TO_ABBR[String(d.id).padStart(2, '0')];
        return abbr ? `state-${abbr}` : null;
      })
      .attr('d', geoPath)
      .attr('fill', '#2f2f2f')
      .attr('stroke', '#1f1f1f')
      .attr('stroke-width', 0.6)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .on('click', function (evt, d) {
        try {
          const abbr = ID_TO_ABBR[String(d.id).padStart(2, '0')];
          if (self._handlers.state && typeof self._handlers.state.click === 'function') self._handlers.state.click(evt, abbr);
        } catch (e) { }
      })
      .on('mouseenter', function (evt, d) {
        try {
          const abbr = ID_TO_ABBR[String(d.id).padStart(2, '0')];
          if (self._handlers.state && typeof self._handlers.state.mouseenter === 'function') self._handlers.state.mouseenter(evt, abbr);
        } catch (e) { }
      })
      .on('mousemove', function (evt) { try { if (self._handlers.state && typeof self._handlers.state.mousemove === 'function') self._handlers.state.mousemove(evt); } catch (e) { } })
      .on('mouseleave', function (evt) { try { if (self._handlers.state && typeof self._handlers.state.mouseleave === 'function') self._handlers.state.mouseleave(evt); } catch (e) { } });

    // boundary mesh
    try {
      const mesh = topojson.mesh(us, us.objects.states, (a, b) => a !== b);
      g.append('path')
        .datum(mesh)
        .attr('fill', 'none')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 1.0)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('pointer-events', 'none')
        .attr('class', 'state-boundaries')
        .attr('d', geoPath);
    } catch (e) { }

    // cache state path selections
    g.selectAll('path.state').each(function (d) {
      try {
        const abbr = ID_TO_ABBR[String(d.id).padStart(2, '0')];
        if (abbr) self.statePaths.set(abbr, d3.select(this));
      } catch (e) { }
    });

    // Dispatch mapReady for consumers relying on this hook
    try { window.dispatchEvent(new Event('mapReady')); } catch (e) { }

    // Load optional district overlay for ME/NE
    if (districtGeoUrl) {
      try { await this._loadDistricts(districtGeoUrl); } catch (e) { console.warn('[ElectionMap] district overlay failed:', e); }
    }
    // ensure label layer ready
    this._ensureLabelLayer();
  },
  _ensureLabelLayer() {
    if (this._labelLayer && !this._labelLayer.empty()) return this._labelLayer;
    const svg = d3.select('svg#map'); if (svg.empty()) return null;
    this._labelLayer = svg.append('g').attr('class', 'state-labels').attr('pointer-events', 'none');
    return this._labelLayer;
  },
  _computeVisualCenter(feature, abbr) {
    try {
      if (!feature) return null;
      const proj = window.mapPath && window.mapPath.projection && window.mapPath.projection();
      if (typeof proj !== 'function') return null;
      const projectRings = (rings) => { const out = []; for (const ring of rings) { const pr = []; for (const c of ring) { const p = proj(c); if (p && isFinite(p[0]) && isFinite(p[1])) pr.push([p[0], p[1]]); } if (pr.length >= 3) out.push(pr); } return out; };
      const polygons = [];
      if (feature.type === 'Polygon') { const r = projectRings(feature.coordinates || []); if (r.length) polygons.push(r); } else if (feature.type === 'MultiPolygon') { for (const poly of (feature.coordinates || [])) { const r = projectRings(poly || []); if (r.length) polygons.push(r); } } else if (feature.geometry) return this._computeVisualCenter(feature.geometry, abbr);
      if (!polygons.length) return null;
      const pointInRing = (pt, ring) => { let x = pt[0], y = pt[1], inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i][0], yi = ring[i][1]; const xj = ring[j][0], yj = ring[j][1]; const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi); if (intersect) inside = !inside; } return inside; };
      const pointInPoly = (pt, rings) => { if (!rings.length) return false; if (!pointInRing(pt, rings[0])) return false; for (let i = 1; i < rings.length; i++) { if (pointInRing(pt, rings[i])) return false; } return true; };
      const distToSegment = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay); let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy); t = Math.max(0, Math.min(1, t)); const cx = ax + t * dx, cy = ay + t * dy; return Math.hypot(px - cx, py - cy); };
      const distToRing = (pt, ring) => { let min = Infinity; for (let i = 0; i < ring.length; i++) { const a = ring[i]; const b = ring[(i + 1) % ring.length]; const d = distToSegment(pt[0], pt[1], a[0], a[1], b[0], b[1]); if (d < min) min = d; } return min; };
      const distToPoly = (pt, rings) => { let d = distToRing(pt, rings[0]); for (let i = 1; i < rings.length; i++) { const dd = distToRing(pt, rings[i]); if (dd < d) d = dd; } return d; };
      const searchPoly = (rings) => { let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; for (const p of rings[0]) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; } let step = Math.max(2, Math.max(maxX - minX, maxY - minY) / 8); let best = null, bestD = -1; let left = minX, right = maxX, top = minY, bottom = maxY; for (let round = 0; round < 5; round++) { for (let x = left; x <= right; x += step) { for (let y = top; y <= bottom; y += step) { const cx = x + step / 2, cy = y + step / 2; const pt = [cx, cy]; if (!pointInPoly(pt, rings)) continue; const d = distToPoly(pt, rings); if (d > bestD) { bestD = d; best = pt; } } } if (!best) break; left = best[0] - step * 1.5; right = best[0] + step * 1.5; top = best[1] - step * 1.5; bottom = best[1] + step * 1.5; step /= 3; if (step < 1) break; } return { point: best, score: bestD }; };
      let bestGlobal = null, bestScore = -1; for (const rings of polygons) { const res = searchPoly(rings); if (res && res.point && res.score > bestScore) { bestScore = res.score; bestGlobal = res.point; } }
      if (bestGlobal) { const pt = { x: bestGlobal[0], y: bestGlobal[1] }; if (abbr) this._visualCenterCache.set(abbr, pt); return pt; }
      return null;
    } catch (e) { return null; }
  },
  updateStateLabels(year, evLookup) {
    this._lastYear = year;
    const layer = this._ensureLabelLayer(); if (!layer) return;
    const states = d3.selectAll('path.state');
    if (states.empty()) { setTimeout(() => this.updateStateLabels(year, evLookup), 120); return; }
    const SKIP = new Set(['MA', 'RI', 'CT', 'NJ', 'DE', 'MD', 'DC', 'NH', 'VT']);
    states.each((d, i, nodes) => {
      try {
        const node = nodes[i];
        const id = (d && d.id != null) ? String(d.id).padStart(2, '0') : null; if (!id || !(id in ID_TO_ABBR)) return; const abbr = ID_TO_ABBR[id];
        if (SKIP.has(abbr)) return;
        let cx = null, cy = null;
        const useVC = (this._visualCenterStates.size === 0 || this._visualCenterStates.has(abbr));
        if (useVC) { const cached = this._visualCenterCache.get(abbr); if (cached) { cx = cached.x; cy = cached.y; } else { const geom = (d.type && d.coordinates) ? d : (d.geometry || null); const vc = this._computeVisualCenter(geom, abbr); if (vc) { cx = vc.x; cy = vc.y; } } }
        if (cx == null || cy == null) { if (window.mapPath && typeof window.mapPath.centroid === 'function') { const c = window.mapPath.centroid(d); if (Array.isArray(c)) { cx = c[0]; cy = c[1]; } } }
        if (cx == null || cy == null) { const bb = node.getBBox(); cx = bb.x + bb.width / 2; cy = bb.y + bb.height / 2; }
        const ev = evLookup ? evLookup(abbr) : null;
        let t = this._labelCache.get(abbr);
        if (!t || t.empty()) { t = layer.append('text').attr('class', 'state-label').attr('text-anchor', 'middle').attr('dominant-baseline', 'middle'); this._labelCache.set(abbr, t); }
        const parts = (ev != null && ev !== '' && isFinite(ev)) ? [abbr, String(ev)] : [abbr];
        t.attr('x', cx).attr('y', cy);
        t.selectAll('tspan').remove();
        if (parts.length === 1) { t.append('tspan').attr('x', cx).attr('dy', '0').text(parts[0]); }
        else { t.append('tspan').attr('x', cx).attr('dy', '-0.45em').text(parts[0]); t.append('tspan').attr('x', cx).attr('dy', '1.3em').text(parts[1]); }
      } catch (e) { }
    });
    try { layer.raise(); } catch (e) { }
  },
  renderSmallStateBoxes(year, abbrColors, unitColors) {
    this._lastYear = year; this._lastAbbrColors = abbrColors; this._lastUnitColors = unitColors;
    const svg = d3.select('svg#map'); if (svg.empty()) return;
    let layer = svg.select('g.small-state-overlay'); if (layer.empty()) layer = svg.append('g').attr('class', 'small-state-overlay');
    const tiny = ['ME-AL', 'NE-AL', 'NH', 'VT', 'MA', 'RI', 'CT', 'NJ', 'DE', 'MD', 'DC'];
    const data = tiny.map(u => {
      let color = null; const unitEntry = unitColors && unitColors.get(u); if (unitEntry) color = unitEntry; else { const st = u.slice(0, 2); const e = abbrColors && abbrColors.get(st); color = e ? (e.color || e) : '#2f2f2f'; }
      const ev = this._evLookup ? this._evLookup(u) : null; return { unit: u, label: u, color, ev };
    });
    const cfg = this._smallBoxesConfig; const vb = svg.attr('viewBox') ? svg.attr('viewBox').split(/\s+/).map(Number) : [0, 0, 975, 610];
    const width = vb[2] || 975; const boxW = Math.max(40, +(cfg.boxW || 86)); const boxH = Math.max(14, +(cfg.boxH || 20)); const gapY = Math.max(0, +(cfg.gapY || 4));
    const x = (typeof cfg.x === 'number' && isFinite(cfg.x)) ? cfg.x : (width - (cfg.right || 8) - boxW); const startY = +(cfg.y || 240);
    layer.selectAll('g.small-box').remove();
    const groups = layer.selectAll('g.small-box').data(data, d => d.unit).join('g').attr('class', 'small-box');
    const self = ElectionMap;
    groups.each(function (d, i) {
      const g = d3.select(this); const gx = x; const gy = startY + i * (boxH + gapY); g.attr('transform', `translate(${gx},${gy})`);
      //try { console.debug('[ElectionMap] creating small box', { unit: d.unit, color: d.color, ev: d.ev, index: i }); } catch (e) { }
      const isY = d.color && /ffd700|c9a400|yellow/i.test(d.color); const txtColor = isY ? '#000' : '#fff'; const smallColor = isY ? '#000' : 'rgba(255,255,255,0.85)';
      g.append('rect')
        .attr('rx', 5).attr('ry', 5).attr('width', boxW).attr('height', boxH)
        .attr('fill', d.color || '#2f2f2f')
        .attr('stroke', 'rgba(0,0,0,0.4)')
        .attr('stroke-width', 1)
        .attr('pointer-events', 'all');
      const pad = 6, mid = Math.floor(boxH / 2) + 1;
      g.append('text')
        .attr('x', pad).attr('y', mid)
        .attr('dominant-baseline', 'middle')
        .attr('fill', txtColor)
        .attr('font-weight', 800).attr('font-size', 11)
        .attr('paint-order', 'stroke').attr('stroke', 'rgba(0,0,0,0.65)')
        .attr('stroke-width', 2).attr('stroke-linejoin', 'round')
        .text(d.label);
      if (d.ev != null && isFinite(d.ev)) {
        g.append('text')
          .attr('x', boxW - pad).attr('y', mid)
          .attr('text-anchor', 'end')
          .attr('dominant-baseline', 'middle')
          .attr('fill', smallColor)
          .attr('font-weight', 700)
          .attr('font-size', 10)
          .attr('paint-order', 'stroke')
          .attr('stroke', 'rgba(0,0,0,0.6)')
          .attr('stroke-width', 1.6)
          .attr('stroke-linejoin', 'round')
          .text(`${d.ev} EV`);
      }
      const isDistrict = /-0[123]|-AL$/.test(d.unit); // treat ME/NE at-large & districts as district-level for handler selection
      g.style('cursor', 'pointer')
        .on('click', function (evt) {
          try {
            try { console.debug('[ElectionMap] small-box click', { unit: d.unit, isDistrict, hasStateClick: !!(self._handlers.state && typeof self._handlers.state.click === 'function'), hasDistrictClick: !!(self._handlers.district && typeof self._handlers.district.click === 'function') }); } catch (e) { }
            if (isDistrict && self._handlers.district && typeof self._handlers.district.click === 'function') self._handlers.district.click(evt, d.unit);
            else if (self._handlers.state && typeof self._handlers.state.click === 'function') self._handlers.state.click(evt, d.unit.replace(/-AL$/, ''));
          } catch (e) { console.warn('[ElectionMap] small-box click handler error', e); }
        })
        .on('mouseenter', function (evt) {
          try {
            //try { console.debug('[ElectionMap] small-box mouseenter', { unit: d.unit, isDistrict, hasStateMouseenter: !!(self._handlers.state && typeof self._handlers.state.mouseenter === 'function'), hasDistrictMouseenter: !!(self._handlers.district && typeof self._handlers.district.mouseenter === 'function'), showMapTipAvailable: typeof window.showMapTip === 'function' }); } catch (e) { }
            if (isDistrict && self._handlers.district && typeof self._handlers.district.mouseenter === 'function') {
              self._handlers.district.mouseenter(evt, d.unit);
            } else if (self._handlers.state && typeof self._handlers.state.mouseenter === 'function') {
              self._handlers.state.mouseenter(evt, d.unit.replace(/-AL$/, ''));
            } else {
              // Fallback: directly build and show a tooltip so small boxes work even when no handlers were registered
              try {
                const unitOrAbbr = isDistrict ? d.unit : d.unit.replace(/-AL$/, '');
                //console.debug('[ElectionMap] small-box fallback mouseenter building tip for', unitOrAbbr);
                const tipInfo = (typeof createUnitTipInfo === 'function') ? createUnitTipInfo(unitOrAbbr, { label: unitOrAbbr }) : null;
                if (tipInfo) {
                  tipInfo.clientX = evt && evt.clientX != null ? evt.clientX : null;
                  tipInfo.clientY = evt && evt.clientY != null ? evt.clientY : null;
                  const txt = tipInfo.getText();
                  //console.debug('[ElectionMap] small-box fallback showMapTip', { unit: unitOrAbbr, textSnippet: (txt ? txt.slice(0, 120) : txt) });
                  if (typeof window.showMapTip === 'function') window.showMapTip(evt, txt, tipInfo);
                } else {
                  if (typeof window.showMapTip === 'function') window.showMapTip(evt, String(unitOrAbbr));
                }
              } catch (ee) { console.warn('[ElectionMap] small-box fallback mouseenter error', ee); }
            }
          } catch (e) { console.warn('[ElectionMap] small-box mouseenter handler error', e); }
        })
          .on('mousemove', function (evt) {
            try {
              try { /* lightweight debug */ } catch (e) { }
              if (self._handlers.state && typeof self._handlers.state.mousemove === 'function') {
                self._handlers.state.mousemove(evt);
              } else {
                // fallback to global manager
                try { if (typeof window.moveMapTip === 'function') window.moveMapTip(evt); } catch (ee) { }
              }
            } catch (e) { console.warn('[ElectionMap] small-box mousemove handler error', e); }
          })
          .on('mouseleave', function (evt) {
            try {
              //try { console.debug('[ElectionMap] small-box mouseleave', { unit: d.unit, hasStateMouseleave: !!(self._handlers.state && typeof self._handlers.state.mouseleave === 'function') }); } catch (e) { }
              if (self._handlers.state && typeof self._handlers.state.mouseleave === 'function') {
                self._handlers.state.mouseleave(evt);
              } else {
                try { if (typeof window.hideMapTip === 'function') window.hideMapTip(); } catch (ee) { }
              }
            } catch (e) { console.warn('[ElectionMap] small-box mouseleave handler error', e); }
          });
    });
    try { if (this._labelLayer) this._labelLayer.raise(); } catch (e) { }
  },
  refreshDecorations(year, evLookup, abbrColorsMap, unitColorsMap) {
    this._evLookup = evLookup;
    this.updateStateLabels(year, evLookup);
    this.renderSmallStateBoxes(year, abbrColorsMap, unitColorsMap);
  },
  async _loadDistricts(geoUrl) {
    const svg = d3.select('#map');
    const defs = svg.select('defs').empty() ? svg.append('defs') : svg.select('defs');
    const mePath = d3.select('#state-ME');
    const nePath = d3.select('#state-NE');
    if (!mePath.empty()) {
      const d = mePath.attr('d');
      const cp = defs.select('#clip-ME').empty() ? defs.append('clipPath').attr('id', 'clip-ME') : defs.select('#clip-ME');
      cp.selectAll('*').remove();
      cp.append('path').attr('d', d);
    }
    if (!nePath.empty()) {
      const d = nePath.attr('d');
      const cp = defs.select('#clip-NE').empty() ? defs.append('clipPath').attr('id', 'clip-NE') : defs.select('#clip-NE');
      cp.selectAll('*').remove();
      cp.append('path').attr('d', d);
    }

    const geo = await d3.json(geoUrl);
    const dg = window.mapG.append('g').attr('class', 'districts').attr('pointer-events', 'auto');
    const feats = (geo && geo.features) ? geo.features.slice() : [];
    try {
      feats.sort((a, b) => {
        const getUnit = (f) => (f.properties && (f.properties.unit || f.properties.abbr || f.properties.GEOID)) || null;
        const au = getUnit(a); const bu = getUnit(b);
        const aState = au ? au.slice(0, 2) : null; const bState = bu ? bu.slice(0, 2) : null;
        if (aState === 'ME' && bState === 'ME') { try { return window.mapPath.area(b) - window.mapPath.area(a); } catch (e) { return 0; } }
        if (aState === 'NE' && bState === 'NE') { try { return window.mapPath.area(a) - window.mapPath.area(b); } catch (e) { return 0; } }
        try { return window.mapPath.area(b) - window.mapPath.area(a); } catch (e) { return 0; }
      });
    } catch (e) { }

    const UNIT_REMAP = {};
    const districtDByUnit = new Map();
    const self = ElectionMap;
    feats.forEach(f => {
      let unit = null; if (f.properties) unit = f.properties.unit || f.properties.abbr || f.properties.GEOID || null; if (!unit) return;
      const useUnit = (unit.match(/^(ME|NE)-0[123]$/)) ? unit : (UNIT_REMAP[unit] || unit);
      const st = useUnit.slice(0, 2);
      const clip = st === 'ME' ? 'url(#clip-ME)' : (st === 'NE' ? 'url(#clip-NE)' : null);
      let dStr = window.mapPath(f);
      if (dStr && dStr.startsWith('M-104,-4.4L1079,-4.4L1079,614.4L-104,614.4Z')) {
        dStr = dStr.replace(/^M-104,-4\.4L1079,-4\.4L1079,614\.4L-104,614\.4Z/, '');
      }
      if (useUnit && dStr) districtDByUnit.set(useUnit, dStr);

      // halo
      dg.append('path')
        .attr('class', 'district-halo')
        .attr('id', `halo-${useUnit}`)
        .attr('d', dStr)
        .attr('clip-path', clip)
        .attr('fill', 'none')
        .attr('stroke', '#000')
        .attr('stroke-opacity', 0.35)
        .attr('stroke-width', 2.2)
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
        .on('click', function (evt) { try { if (self._handlers.district && typeof self._handlers.district.click === 'function') self._handlers.district.click(evt, useUnit); } catch (e) { } })
        .on('mouseenter', function (evt) { try { if (self._handlers.district && typeof self._handlers.district.mouseenter === 'function') self._handlers.district.mouseenter(evt, useUnit); } catch (e) { } })
        .on('mousemove', function (evt) { try { if (self._handlers.district && typeof self._handlers.district.mousemove === 'function') self._handlers.district.mousemove(evt); } catch (e) { } })
        .on('mouseleave', function (evt) { try { if (self._handlers.district && typeof self._handlers.district.mouseleave === 'function') self._handlers.district.mouseleave(evt); } catch (e) { } });

      self.districtPaths.set(useUnit, p);
    });

    // Mask to avoid NE-03 overlapping smaller districts
    try {
      const svg = d3.select('#map');
      const defs = svg.select('defs');
      const ne03 = districtDByUnit.get('NE-03');
      if (ne03 && !defs.empty()) {
        const m = defs.select('#mask-NE-03').empty() ? defs.append('mask').attr('id', 'mask-NE-03') : defs.select('#mask-NE-03');
        m.attr('maskUnits', 'userSpaceOnUse').attr('x', 0).attr('y', 0).attr('width', 975).attr('height', 610);
        m.selectAll('*').remove();
        m.append('rect').attr('x', 0).attr('y', 0).attr('width', 975).attr('height', 610).attr('fill', '#fff');
        const cut02 = districtDByUnit.get('NE-02');
        const cut01 = districtDByUnit.get('NE-01');
        if (cut02) m.append('path').attr('d', cut02).attr('fill', '#000');
        if (cut01) m.append('path').attr('d', cut01).attr('fill', '#000');
        const p03 = this.districtPaths.get('NE-03');
        if (p03) p03.attr('mask', 'url(#mask-NE-03)');
        const h03 = d3.select('#halo-NE-03');
        if (!h03.empty()) h03.attr('mask', 'url(#mask-NE-03)');
      }
    } catch (e) { }

    try { d3.select('svg#map').select('g').select('.state-boundaries').raise(); } catch (e) { }
  }
};

if (typeof window !== 'undefined') {
  try { window.ElectionMap = ElectionMap; } catch (e) { /* noop */ }
}

export default ElectionMap;

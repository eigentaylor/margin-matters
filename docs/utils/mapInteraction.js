(function() {
  'use strict';

  // Map interaction and tooltip utilities for election maps
  // This module handles map rendering, tooltips, visual centers, and small state boxes

  // Tunable config for small-state overlay placement and sizing
  const _defaultSmallBoxesConfig = {
    x: null, // auto-computed if null
    right: 8,
    y: 240,
    boxW: 75,
    boxH: 25,
    gapY: 4
  };

  // Helper to update config at runtime and re-render quickly
  function setSmallBoxesConfig(patch) {
    if (!patch || typeof patch !== 'object') return;
    Object.assign(_defaultSmallBoxesConfig, patch);
  }

  // Helper to nudge all small boxes by dx, dy
  function nudgeSmallBoxes(dx, dy) {
    const cur = _defaultSmallBoxesConfig;
    if (typeof cur.x === 'number' && isFinite(dx)) cur.x = (cur.x || 0) + dx;
    if (typeof cur.y === 'number' && isFinite(dy)) cur.y = (cur.y || 0) + dy;
  }

  // Lazily created layer for state labels
  const _labelCache = new Map(); // abbr -> d3 selection for text

  // Cache for computed visual centers (screen coords) per state abbr
  const _visualCenterCache = new Map(); // abbr -> {x,y}

  // Configurable whitelist for which states should use visual-center placement
  let _visualCenterStates = new Set(['MI', 'FL', 'LA']);

  function setVisualCenterStates(list) {
    if (Array.isArray(list)) {
      _visualCenterStates = new Set(list.map(s => String(s).toUpperCase()));
    } else if (list instanceof Set) {
      _visualCenterStates = new Set(Array.from(list).map(s => String(s).toUpperCase()));
    }
    _visualCenterCache.clear();
  }

  // Centralized tooltip helpers
  function _getMapWrap() { return document.getElementById('map-wrap'); }

  function _ensureTip() { return document.getElementById('mapTip'); }

  function _placeTipAt(evt) {
    const tip = _ensureTip();
    if (!tip) return;
    const wrap = _getMapWrap();
    if (!wrap) return;
    const box = wrap.getBoundingClientRect();
    const x = evt.clientX - box.left;
    const y = evt.clientY - box.top;
    const W = box.width;
    const H = box.height;
    const tw = tip.offsetWidth || 180;
    const th = tip.offsetHeight || 60;
    let finalX = x + 12;
    let finalY = y - th - 12;
    if (finalX + tw > W - 8) finalX = x - tw - 12;
    if (finalY < 8) finalY = y + 12;
    if (finalX < 8) finalX = 8;
    if (finalY < 8) finalY = 8;
    tip.style.left = finalX + 'px';
    tip.style.top = finalY + 'px';
  }

  function showMapTip(evt, text) {
    const tip = _ensureTip();
    if (!tip) return;
    tip.textContent = text;
    tip.style.display = 'block';
    _placeTipAt(evt);
  }

  function moveMapTip(evt) { try { _placeTipAt(evt); } catch (e) { } }

  const _activeTipState = { info: null };

  function _setActiveTip(info) { _activeTipState.info = info || null; }

  function _updateActiveTipCoords(evt) {
    try { if (_activeTipState.info) _placeTipAt(evt); } catch (e) { }
  }

  function refreshActiveMapTip() {
    if (!_activeTipState.info) return;
    const tip = _ensureTip();
    if (!tip) return;
    const text = _activeTipState.info;
    tip.textContent = text;
    tip.style.display = 'block';
  }

  function hideMapTip() {
    const tip = _ensureTip();
    if (tip) {
      tip.style.display = 'none';
      tip.textContent = '';
    }
    _setActiveTip(null);
  }

  // Compute a "visual center" for a GeoJSON Polygon/MultiPolygon feature
  function _computeVisualCenter(feature, abbr) {
    try {
      if (!feature) return null;
      const proj = window.mapPath && window.mapPath.projection && window.mapPath.projection();
      if (typeof proj !== 'function') return null;

      const projectRings = (rings) => {
        const out = [];
        for (const ring of rings) {
          const pr = [];
          for (const c of ring) {
            const p = proj(c);
            if (p && isFinite(p[0]) && isFinite(p[1])) pr.push([p[0], p[1]]);
          }
          if (pr.length >= 3) out.push(pr);
        }
        return out;
      };

      const polygons = [];
      if (feature.type === 'Polygon') {
        const r = projectRings(feature.coordinates || []);
        if (r.length) polygons.push(r);
      } else if (feature.type === 'MultiPolygon') {
        for (const poly of (feature.coordinates || [])) {
          const r = projectRings(poly || []);
          if (r.length) polygons.push(r);
        }
      } else if (feature.geometry) {
        return _computeVisualCenter(feature.geometry, abbr);
      }

      if (!polygons.length) return null;

      const pointInRing = (pt, ring) => {
        let x = pt[0], y = pt[1], inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const xi = ring[i][0], yi = ring[i][1];
          const xj = ring[j][0], yj = ring[j][1];
          const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
          if (intersect) inside = !inside;
        }
        return inside;
      };

      const pointInPoly = (pt, rings) => {
        if (!rings.length) return false;
        if (!pointInRing(pt, rings[0])) return false;
        for (let i = 1; i < rings.length; i++) {
          if (pointInRing(pt, rings[i])) return false;
        }
        return true;
      };

      const distToSegment = (px, py, ax, ay, bx, by) => {
        const dx = bx - ax, dy = by - ay;
        if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
        let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx, cy = ay + t * dy;
        return Math.hypot(px - cx, py - cy);
      };

      const distToRing = (pt, ring) => {
        let min = Infinity;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          const d = distToSegment(pt[0], pt[1], a[0], a[1], b[0], b[1]);
          if (d < min) min = d;
        }
        return min;
      };

      const distToPoly = (pt, rings) => {
        let d = distToRing(pt, rings[0]);
        for (let i = 1; i < rings.length; i++) {
          const dd = distToRing(pt, rings[i]);
          if (dd < d) d = dd;
        }
        return d;
      };

      const searchPoly = (rings) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of rings[0]) {
          if (p[0] < minX) minX = p[0];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        }

        let step = Math.max(2, Math.max(maxX - minX, maxY - minY) / 8);
        let best = null, bestD = -1;
        let left = minX, right = maxX, top = minY, bottom = maxY;

        for (let round = 0; round < 5; round++) {
          for (let x = left; x <= right; x += step) {
            for (let y = top; y <= bottom; y += step) {
              const cx = x + step / 2, cy = y + step / 2;
              const pt = [cx, cy];
              if (!pointInPoly(pt, rings)) continue;
              const d = distToPoly(pt, rings);
              if (d > bestD) {
                bestD = d;
                best = pt;
              }
            }
          }
          if (!best) break;
          left = best[0] - step * 1.5;
          right = best[0] + step * 1.5;
          top = best[1] - step * 1.5;
          bottom = best[1] + step * 1.5;
          step /= 3;
          if (step < 1) break;
        }

        return { point: best, score: bestD };
      };

      let bestGlobal = null, bestScore = -1;
      for (const rings of polygons) {
        const res = searchPoly(rings);
        if (res && res.point && res.score > bestScore) {
          bestScore = res.score;
          bestGlobal = res.point;
        }
      }

      if (bestGlobal) {
        const pt = { x: bestGlobal[0], y: bestGlobal[1] };
        if (abbr) _visualCenterCache.set(abbr, pt);
        return pt;
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  // Export to global scope
  const MapInteraction = {
    setSmallBoxesConfig,
    nudgeSmallBoxes,
    setVisualCenterStates,
    showMapTip,
    moveMapTip,
    refreshActiveMapTip,
    hideMapTip,
    _getMapWrap,
    _ensureTip,
    _computeVisualCenter,
    _visualCenterCache,
    _visualCenterStates,
    _labelCache,
    _defaultSmallBoxesConfig,
    _setActiveTip,
    _updateActiveTipCoords
  };

  try {
    window.MapInteraction = MapInteraction;
  } catch (e) {
    console.error('[MapInteraction] Failed to export to window:', e);
  }
})();

(function(){
  const PV_CAP = 0.5;
  const EPS = 1e-8;
  const STOP_EPS = 0.000005; // tolerance when matching slider to exact flip stops
  const STOP_KEY_PREC = 6;   // rounding precision for matching stops to CSV
  // FIPS -> USPS state abbreviation map (contiguous plus AK, HI, DC)
  const ID_TO_ABBR = {"01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY"};
  // Very small states to skip labeling on the map
  const SMALL_STATES = new Set(["MA","RI","CT","NJ","DE","MD","DC","NH","VT"]);

  // Tunable config for small-state overlay placement and sizing (exposed via window.smallBoxesConfig)
  const _defaultSmallBoxesConfig = {
    // If x is a number, use absolute x. Otherwise, compute from right margin.
    x: null,
    right: 8,      // px from right edge of SVG
    y: 240,        // starting y (moved down to avoid covering ME/upper NE)
    boxW: 75,      // minimal width to fit widest label + EV
    boxH: 25,      // compact height
    gapY: 4        // vertical gap between boxes
  };
  let _smallBoxesConfig = { ..._defaultSmallBoxesConfig };
  try { window.smallBoxesConfig = _smallBoxesConfig; } catch(e) {}
  // Helper to update config at runtime and re-render quickly
  function setSmallBoxesConfig(patch){
    try {
      if (patch && typeof patch === 'object') Object.assign(_smallBoxesConfig, patch);
      // Keep the exported reference updated too
      try { window.smallBoxesConfig = _smallBoxesConfig; } catch(e) {}
      // Re-render using last known colors if available
      const year = window._curYear || (document.getElementById('yearSlider') ? +document.getElementById('yearSlider').value : 2024);
      const ac = window._lastAbbrColors || null;
      const uc = window._lastUnitColors || null;
      if (typeof renderSmallStateBoxes === 'function' && ac && uc) renderSmallStateBoxes(year, ac, uc);
      else if (typeof window.updateAll === 'function') window.updateAll();
    } catch(e) { console.warn('[smallBoxes] setSmallBoxesConfig error', e); }
  }
  function nudgeSmallBoxes(dx, dy){
    const curX = (typeof _smallBoxesConfig.x === 'number') ? _smallBoxesConfig.x : null;
    if (curX == null) {
      // Convert from right-anchored to absolute x based on current SVG width
      try {
        const svg = d3.select('svg#map');
        const vb = svg.empty() ? [0,0,975,610] : (svg.attr('viewBox') ? svg.attr('viewBox').split(/\s+/).map(Number) : [0,0,975,610]);
        const width = vb[2] || 975;
        _smallBoxesConfig.x = width - (_smallBoxesConfig.right || 8) - (_smallBoxesConfig.boxW || 86);
      } catch(e) { _smallBoxesConfig.x = 860; }
    }
    _smallBoxesConfig.x += (+dx || 0);
    _smallBoxesConfig.y = (_smallBoxesConfig.y || 0) + (+dy || 0);
    setSmallBoxesConfig({});
  }
  try { window.setSmallBoxesConfig = setSmallBoxesConfig; window.nudgeSmallBoxes = nudgeSmallBoxes; } catch(e) {}

  // Lazily created layer for state labels
  let stateLabelsLayer = null; // d3 selection of g.state-labels
  const _labelCache = new Map(); // abbr -> d3 selection for text
  // Cache for computed visual centers (screen coords) per state abbr
  const _visualCenterCache = new Map(); // abbr -> {x,y}
  // Configurable whitelist for which states should use visual-center placement.
  // Default to a focused set; if emptied, we treat as ALL states using visual center.
  let _visualCenterStates = new Set(['MI','FL','LA']);
  try { window.visualCenterStates = _visualCenterStates; } catch(e) {}
  function setVisualCenterStates(list){
    try {
      if (Array.isArray(list)) _visualCenterStates = new Set(list.map(s=>String(s||'').toUpperCase()));
      else if (list instanceof Set) _visualCenterStates = new Set(Array.from(list).map(s=>String(s||'').toUpperCase()));
      // publish reference for quick tweaking in console
      try { window.visualCenterStates = _visualCenterStates; } catch(e) {}
      // centers depend on geometry, so clear cache
      try { _visualCenterCache.clear(); } catch(e) {}
      // re-render labels
      try { updateStateLabels(window._curYear || 2024); } catch(e) {}
    } catch(e) { /* ignore */ }
  }
  try { window.setVisualCenterStates = setVisualCenterStates; } catch(e) {}

  // Centralized tooltip helpers (consistent positioning; fixes offset glitches)
  function _getMapWrap(){
    return document.getElementById('map-wrap') || document.body;
  }
  function _ensureTip(){
    return document.getElementById('mapTip') || null;
  }
  function _placeTipAt(evt){
    const tip = _ensureTip(); if (!tip) return;
    const wrap = _getMapWrap();
    const wr = wrap.getBoundingClientRect();
    const offsetX = 12, offsetY = 12;
    let x = evt.clientX - wr.left + offsetX;
    let y = evt.clientY - wr.top + offsetY;
    // Clamp within container
    const prev = tip.style.display;
    if (prev === 'none') tip.style.display = 'block';
    const tr = tip.getBoundingClientRect();
    if (prev === 'none') tip.style.display = 'none';
    const pad = 6;
    x = Math.max(pad, Math.min(wr.width - pad, x));
    y = Math.max(pad, Math.min(wr.height - pad, y));
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  function showMapTip(evt, text){
    try {
      const tip = _ensureTip(); if (!tip) return;
      tip.textContent = text != null ? String(text) : '';
      tip.style.display = 'block';
      _placeTipAt(evt);
    } catch(e) {}
  }
  function moveMapTip(evt){ try { _placeTipAt(evt); } catch(e) {} }
  function hideMapTip(){ try { const tip = _ensureTip(); if (tip) tip.style.display = 'none'; } catch(e) {} }
  try { window.showMapTip = showMapTip; window.moveMapTip = moveMapTip; window.hideMapTip = hideMapTip; } catch(e) {}

  // Compute a "visual center" for a GeoJSON Polygon/MultiPolygon feature using
  // projected screen coordinates and a lightweight polylabel-like search.
  // Returns {x, y} in SVG coordinate space.
  function _computeVisualCenter(feature, abbr){
    try {
      if (!feature || !feature.type) return null;
      if (!window.mapPath || typeof window.mapPath.projection !== 'function') return null;
      const proj = window.mapPath.projection && window.mapPath.projection();
      if (typeof proj !== 'function') return null;

      // Project lon/lat ring coordinates to screen coords
      const projectRings = (rings) => {
        const out = [];
        for (const ring of rings) {
          const pr = [];
          for (let i=0;i<ring.length;i++){
            const c = ring[i];
            const p = proj(c);
            if (p && isFinite(p[0]) && isFinite(p[1])) pr.push([p[0], p[1]]);
          }
          if (pr.length >= 3) out.push(pr);
        }
        return out;
      };

      // Flatten to array of polygons, each as [outer, hole1, hole2, ...]
      const polygons = [];
      if (feature.type === 'Polygon') {
        const rings = projectRings(feature.coordinates || []);
        if (rings.length) polygons.push(rings);
      } else if (feature.type === 'MultiPolygon') {
        const polys = feature.coordinates || [];
        for (const poly of polys){
          const rings = projectRings(poly || []);
          if (rings.length) polygons.push(rings);
        }
      } else if (feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')) {
        return _computeVisualCenter(feature.geometry, abbr);
      } else {
        return null;
      }
      if (!polygons.length) return null;

      // Helpers: point-in-ring and point-in-polygon (holes subtract)
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
        if (!rings || !rings.length) return false;
        if (!pointInRing(pt, rings[0])) return false; // outside outer
        for (let i=1;i<rings.length;i++){
          if (pointInRing(pt, rings[i])) return false; // in a hole
        }
        return true;
      };
      // Distance from point to poly edges (min over outer and holes)
      const distToSegment = (px, py, ax, ay, bx, by) => {
        const dx = bx - ax, dy = by - ay;
        if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
        let t = ((px - ax) * dx + (py - ay) * dy) / (dx*dx + dy*dy);
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx, cy = ay + t * dy;
        return Math.hypot(px - cx, py - cy);
      };
      const distToRing = (pt, ring) => {
        let min = Infinity;
        for (let i=0;i<ring.length;i++){
          const a = ring[i];
          const b = ring[(i+1)%ring.length];
          const d = distToSegment(pt[0], pt[1], a[0], a[1], b[0], b[1]);
          if (d < min) min = d;
        }
        return min;
      };
      const distToPoly = (pt, rings) => {
        let d = distToRing(pt, rings[0]);
        for (let i=1;i<rings.length;i++){
          const dd = distToRing(pt, rings[i]);
          if (dd < d) d = dd;
        }
        return d;
      };

      // Lightweight grid-refinement search per polygon
      const searchPoly = (rings) => {
        // bbox of outer ring
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of rings[0]){ if (p[0]<minX) minX=p[0]; if (p[0]>maxX) maxX=p[0]; if (p[1]<minY) minY=p[1]; if (p[1]>maxY) maxY=p[1]; }
        // start with coarse step; 5 rounds
        let step = Math.max(2, Math.max(maxX - minX, maxY - minY) / 8);
        let best = null, bestD = -1;
        let left = minX, right = maxX, top = minY, bottom = maxY;
        for (let round=0; round<5; round++){
          for (let x = left; x <= right; x += step){
            for (let y = top; y <= bottom; y += step){
              const cx = x + step/2, cy = y + step/2;
              const pt = [cx, cy];
              if (!pointInPoly(pt, rings)) continue;
              const d = distToPoly(pt, rings);
              if (d > bestD) { bestD = d; best = pt; }
            }
          }
          if (!best) break;
          // refine around best
          left = best[0] - step * 1.5;
          right = best[0] + step * 1.5;
          top = best[1] - step * 1.5;
          bottom = best[1] + step * 1.5;
          step = step / 3;
          if (step < 1.0) break; // pixel precision is good enough
        }
        return { point: best, score: bestD };
      };

      let bestGlobal = null, bestScore = -1;
      for (const rings of polygons){
        const res = searchPoly(rings);
        if (res && res.point && res.score > bestScore){ bestScore = res.score; bestGlobal = res.point; }
      }
      if (bestGlobal && isFinite(bestGlobal[0]) && isFinite(bestGlobal[1])) {
        const pt = { x: bestGlobal[0], y: bestGlobal[1] };
        if (abbr) _visualCenterCache.set(abbr, pt);
        return pt;
      }
      return null;
    } catch(e) { return null; }
  }

  // Ensure an overlay group inside the map for small-state boxes
  function ensureSmallBoxesLayer(){
    try {
      const svg = d3.select('svg#map');
      if (svg.empty()) return null;
      let layer = svg.select('g.small-state-overlay');
      if (layer.empty()) {
        // Insert the overlay above the state paths but below labels
        layer = svg.append('g').attr('class','small-state-overlay');
        // Give it a pointer cursor for clicks
        layer.attr('pointer-events','auto');
      }
      return layer;
    } catch(e) { return null; }
  }

  // Render equal-width boxes along the east coast within the map SVG
  function renderSmallStateBoxes(year, abbrColors, unitColors){
    try {
      const svg = d3.select('svg#map');
      const layer = ensureSmallBoxesLayer();
      if (!layer || svg.empty()) return;
      //console.log('[smallBoxes] render start (svg overlay)', { year, config: _smallBoxesConfig });

      // Requested order
      const tiny = [
        { unit: 'ME-AL', label: 'ME-AL' },
        { unit: 'NE-AL', label: 'NE-AL' },
        { unit: 'NH', label: 'NH' },
        { unit: 'VT', label: 'VT' },
        { unit: 'MA', label: 'MA' },
        { unit: 'RI', label: 'RI' },
        { unit: 'CT', label: 'CT' },
        { unit: 'NJ', label: 'NJ' },
        { unit: 'DE', label: 'DE' },
        { unit: 'MD', label: 'MD' },
        { unit: 'DC', label: 'DC' }
      ];

      // Resolve color and EV for each box
      const data = tiny.map(({unit, label}) => {
        let color = unitColors.get(unit);
        if (!color) {
          const st = unit.slice(0,2);
          const entry = abbrColors.get(st);
          color = entry ? entry.color : '#2f2f2f';
        }
        let ev = null;
        try { if (typeof window.getEvFor === 'function') ev = window.getEvFor(year, unit); } catch(e) {}
        if ((ev == null || isNaN(ev)) && typeof window.getRowsForYear === 'function') {
          const rows = window.getRowsForYear(year) || [];
          const row = rows.find(r => r.unit === unit || r.unit === label);
          if (row && isFinite(+row.ev)) ev = +row.ev;
        }
        const info = (typeof window.getAdjustedInfo === 'function') ? window.getAdjustedInfo(unit) : null;
        const marginStr = info && info.marginStr ? info.marginStr : '';
        return { unit, label, color, ev, marginStr };
      });

      // Layout: a single column aligned just off the Atlantic coast, between NY/NJ/MD and the right margin.
      // We place the boxes at a fixed x near the east coast and step y downward. Keep sizes minimal and equal.
      const vb = svg.attr('viewBox') ? svg.attr('viewBox').split(/\s+/).map(Number) : [0,0,975,610];
      const width = vb[2] || 975;
      const height = vb[3] || 610;
      const boxW = Math.max(40, +(_smallBoxesConfig.boxW || 86));
      const boxH = Math.max(12, +(_smallBoxesConfig.boxH || 20));
      const gapY = Math.max(0, +(_smallBoxesConfig.gapY || 4));
      // Absolute x wins. Otherwise, derive from right margin.
      const right = +(_smallBoxesConfig.right || 8);
      const x = (typeof _smallBoxesConfig.x === 'number' && isFinite(_smallBoxesConfig.x))
        ? _smallBoxesConfig.x
        : (width - right - boxW);
      // Start y (tunable)
      const startY = +(_smallBoxesConfig.y || 120);

      // Clear and re-render
      layer.selectAll('g.small-box').remove();
      const groups = layer.selectAll('g.small-box')
        .data(data, d => d.unit)
        .join('g')
        .attr('class','small-box');

      groups.each(function(d, i){
        const g = d3.select(this);
        const gx = x;
        const gy = startY + i*(boxH + gapY);
        g.attr('transform', `translate(${gx},${gy})`);

        // draw rounded rect with the computed color
        const isYellowish = d.color && (String(d.color).toLowerCase() === '#c9a400' || String(d.color).toLowerCase() === '#ffd700' || String(d.color).toLowerCase() === 'yellow');
        const txtColor = isYellowish ? '#000' : '#fff';
        const smallColor = isYellowish ? '#000' : 'rgba(255,255,255,0.85)';

        g.append('rect')
          .attr('rx', 5).attr('ry', 5)
          .attr('width', boxW).attr('height', boxH)
          .attr('fill', d.color || '#2f2f2f')
          .attr('stroke', 'rgba(0,0,0,0.4)')
          .attr('stroke-width', 1);

        // Label and EV inside box
        const padX = 6, midY = Math.floor(boxH/2) + 1;
        g.append('text')
          .attr('x', padX).attr('y', midY)
          .attr('dominant-baseline', 'middle')
          .attr('fill', txtColor)
          .attr('font-weight', 800)
          .attr('font-size', 11)
          .attr('paint-order', 'stroke')
          .attr('stroke', 'rgba(0,0,0,0.65)')
          .attr('stroke-width', 2)
          .attr('stroke-linejoin', 'round')
          .text(d.label);
        if (d.ev != null && isFinite(d.ev)){
          const evTxt = `${d.ev} EV`;
          g.append('text')
            .attr('x', boxW - padX)
            .attr('y', midY)
            .attr('text-anchor', 'end')
            .attr('dominant-baseline', 'middle')
            .attr('fill', smallColor)
            .attr('font-weight', 700)
            .attr('font-size', 10)
            .attr('paint-order', 'stroke')
            .attr('stroke', 'rgba(0,0,0,0.6)')
            .attr('stroke-width', 1.6)
            .attr('stroke-linejoin', 'round')
            .text(evTxt);
        }

        // Tooltip via centralized map tip (works even if boxes move later)
        const hoverHandler = function(evt){
          try {
            const unit = d.unit;
            const info = (window.getAdjustedInfo ? window.getAdjustedInfo(unit) : null) || {};
            const ev = (info && info.ev != null) ? info.ev : d.ev;
            const marginStr = (info && info.marginStr) ? info.marginStr : (d.marginStr || '');
            const text = d.label + (ev!=null?` · ${ev} EV`:``) + (marginStr?` · ${marginStr}`:``);
            if (typeof window.showMapTip === 'function') window.showMapTip(evt, text);
          } catch(e) {}
        };
        g.on('mouseenter', hoverHandler)
         .on('mousemove', function(evt){ try { if (typeof window.moveMapTip === 'function') window.moveMapTip(evt); } catch(e){} })
         .on('mouseleave', function(){ try { if (typeof window.hideMapTip === 'function') window.hideMapTip(); } catch(e){} });

        // Click-through
        g.style('cursor','pointer')
         .on('click', ()=>{
            let abbr = d.unit;
            if (abbr.endsWith('-AL')) abbr = abbr.slice(0,2);
            window.open(`state/${abbr}.html`, '_blank');
         });
      });

      // Keep label layer on top of overlay if exists
      try { raiseStateLabelsLayer(); } catch(e) {}
      //console.log('[smallBoxes] render done (svg overlay). count:', data.length);
    } catch(e) { console.warn('[smallBoxes] svg overlay render error', e); }
  }

  function raiseStateLabelsLayer(){
    try {
      if (stateLabelsLayer && !stateLabelsLayer.empty()) stateLabelsLayer.raise();
      else {
        const sel = d3.select('svg#map').select('g.state-labels');
        if (!sel.empty()) sel.raise();
      }
    } catch(e) {}
  }

  // Recompute visual centers if layout/projection likely changed
  try {
    window.addEventListener('resize', function(){
      try { _visualCenterCache.clear(); } catch(e) {}
      try { updateStateLabels(window._curYear || 2024); } catch(e) {}
    });
    window.addEventListener('mapReady', function(){
      try { _visualCenterCache.clear(); } catch(e) {}
    });
  } catch(e) {}

  function ensureStateLabelsLayer(){
    try {
      try {
        const svgSel = d3.select('svg#map');
        //console.log('[labels] ensureStateLabelsLayer enter', { svgExists: !svgSel.empty(), mapGExists: !!window.mapG });
      } catch(e) {}
      if (stateLabelsLayer && !stateLabelsLayer.empty()) return stateLabelsLayer;
      // Prefer to attach to main map group if exposed; otherwise, to the svg root
      const svg = d3.select('svg#map');
      if (svg.empty()) { try { console.warn('[labels] svg#map not found'); } catch(e) {}; return null; }
      // Normalize mapG to a proper D3 selection if available
      let parent = null;
      try {
        if (window.mapG) {
          if (typeof window.mapG.node === 'function') {
            parent = window.mapG; // already a selection
          } else if (window.mapG instanceof Element || (window.mapG.nodeType === 1)) {
            parent = d3.select(window.mapG);
          }
        }
      } catch(e) { parent = null; }
      if (!parent || parent.empty()) parent = svg;
      try {
        //console.log('[labels] parent resolved', { tag: parent.node() && parent.node().tagName, id: parent.attr('id') || '', class: parent.attr('class') || '' });
      } catch(e) {}
      let layer = parent.select('g.state-labels');
      if (layer.empty()) {
        layer = parent.append('g').attr('class','state-labels').attr('pointer-events','none');
        //try { console.log('[labels] created state-labels layer under', parent.node() === svg.node() ? 'svg#map' : 'mapG'); } catch(e) {}
      }
      // keep labels above states/districts
      try { layer.raise(); } catch(e) {}
      stateLabelsLayer = layer;
      try {
        const countNow = svg.selectAll('g.state-labels').nodes().length;
        //console.log('[labels] ensureStateLabelsLayer exit', { layersInSvg: countNow });
      } catch(e) {}
      return layer;
    } catch(e) { return null; }
  }

  // Compute total EV for a state abbreviation, summing district/at-large rows as needed
  function getTotalEvForState(year, abbr){
    try {
      if (typeof window.getRowsForYear !== 'function') return null;
      const rows = window.getRowsForYear(year) || [];
      let sum = 0; let found = false;
      for (const r of rows){
        if (!r || !r.unit || r.unit === 'NATIONAL') continue;
        const u = String(r.unit);
        if (u === abbr || u.startsWith(abbr + '-')) {
          const ev = +r.ev || 0;
          if (isFinite(ev)) { sum += ev; found = true; }
        }
      }
      if (found) return sum;
      // fallback to single lookup if present in ev map
      try {
        const ev = window._evByUnitMap && window._evByUnitMap.get(`${year}:${abbr}`);
        if (isFinite(ev)) return ev;
      } catch(e) {}
      return null;
    } catch(e) { return null; }
  }

  // Create/update text labels for states for the current year
  function updateStateLabels(year){
    const layer = ensureStateLabelsLayer();
    if (!layer) return;
    // Build or update labels for each state path
    const states = d3.selectAll('path.state');
    //try { console.log('[labels] updateStateLabels start', { year, stateCount: states.size ? states.size() : states.nodes().length }); } catch(e) {}
    if (states.empty()) {
      // Map may not be ready yet; try again shortly
      try { setTimeout(() => { try { updateStateLabels(year); } catch(e){} }, 100); } catch(e) {}
      return;
    }
    // Extra guard: if the label layer somehow isn't attached, create under svg directly
    try {
      if (!stateLabelsLayer || stateLabelsLayer.empty()) {
        const svg = d3.select('svg#map');
        stateLabelsLayer = svg.append('g').attr('class','state-labels').attr('pointer-events','none');
        console.log('[labels] fallback created state-labels under svg');
      }
    } catch(e) {}
    states.each(function(d){
      try {
        const node = this;
        // derive abbr from FIPS id
        const id = (d && d.id != null) ? String(d.id).padStart(2,'0') : (node && node.__data__ && node.__data__.id != null ? String(node.__data__.id).padStart(2,'0') : null);
        if (!id || !(id in ID_TO_ABBR)) return;
        const abbr = ID_TO_ABBR[id];
        if (SMALL_STATES.has(abbr)) return; // skip tiny states

        // Compute visual center (polylabel-like) conditionally.
        // If whitelist is empty -> treat as ALL states using visual center.
        let cx = null, cy = null;
        const useVC = (!_visualCenterStates || _visualCenterStates.size === 0 || _visualCenterStates.has(abbr));
        if (useVC) {
          try {
            const cached = _visualCenterCache.get(abbr);
            if (cached) { cx = cached.x; cy = cached.y; }
            else if (d && (d.type || (d.geometry && d.geometry.type))) {
              const geom = (d.type && d.coordinates) ? d : (d.geometry || null);
              const vc = _computeVisualCenter(geom, abbr);
              if (vc) { cx = vc.x; cy = vc.y; }
            }
          } catch(e) {}
        }
        // Fallbacks: centroid, then bbox center
        if (cx == null || cy == null) {
          try {
            if (window.mapPath && typeof window.mapPath.centroid === 'function' && d) {
              const c = window.mapPath.centroid(d);
              if (Array.isArray(c) && c.length === 2 && isFinite(c[0]) && isFinite(c[1])) { cx = c[0]; cy = c[1]; }
            }
          } catch(e) {}
        }
        if (cx == null || cy == null) {
          let bbox;
          try { bbox = node.getBBox(); } catch(e) { bbox = null; }
          if (!bbox) return;
          cx = bbox.x + bbox.width/2;
          cy = bbox.y + bbox.height/2;
        }

        // Resolve EV
        let ev = null;
        try {
          ev = (typeof window.getEvFor === 'function') ? window.getEvFor(year, abbr) : null;
        } catch(e) {}
        if (ev == null || !isFinite(ev)) {
          ev = getTotalEvForState(year, abbr);
        }
        if (ev == null || !isFinite(ev)) ev = '';

        // Create or update the label
        let t = _labelCache.get(abbr);
        const isNew = (!t || t.empty());
        if (isNew) {
          t = layer.append('text')
            .attr('class','state-label')
            .attr('text-anchor','middle')
            .attr('dominant-baseline','middle')
            .attr('dy','0');
          _labelCache.set(abbr, t);
        }
        // Two-line label: abbreviation on top, EV on second line
        const lines = (ev === '' || ev == null) ? [abbr] : [abbr, String(ev)];
        // Ensure numeric coordinates
        const fx = (isFinite(cx) ? cx : 0);
        const fy = (isFinite(cy) ? cy : 0);
        t.attr('x', fx).attr('y', fy);
        try {
          // Clear existing tspans and recreate for predictable layout
          t.selectAll('tspan').remove();
          if (lines.length === 1) {
            t.append('tspan').attr('x', fx).attr('dy', '0').text(lines[0]);
          } else {
            // Slight negative dy on first tspan so the pair is visually centered at (x,y)
            t.append('tspan').attr('x', fx).attr('dy', '-0.45em').text(lines[0]);
            t.append('tspan').attr('x', fx).attr('dy', '1.3em').text(lines[1]);
          }
        } catch (e) {
          // Fallback: single-line fallback if tspans fail
          t.text(lines.join(' '));
        }
        // TX-only debug logs to verify label creation/update
        if (abbr === 'TX') {
          // try {
          //   console.log('[labels] TX', { created: isNew, cx: Math.round(cx), cy: Math.round(cy), ev: ev });
          // } catch(e) {}
          // Optional debug dot at centroid when window._labelDebug is truthy
          try {
            if (window._labelDebug) {
              const dotSel = stateLabelsLayer.selectAll('circle.tx-debug-dot').data([0]);
              dotSel.join(
                enter => enter.append('circle').attr('class','tx-debug-dot').attr('r',4).attr('fill','#ff0').attr('stroke','#000').attr('stroke-width',1).attr('cx', fx).attr('cy', fy),
                update => update.attr('cx', fx).attr('cy', fy),
                exit => exit.remove()
              );
            }
          } catch(e) {}
        }
      } catch(e) {}
    });
    // keep labels above boundaries and districts
    try { stateLabelsLayer.raise(); } catch(e) {}
    // Post-update: quick presence check without spamming
    // try {
    //   const tx = _labelCache.get('TX');
    //   console.log('[labels] updateStateLabels done', { labelsCount: stateLabelsLayer.selectAll('text.state-label').nodes().length, hasTXLabel: !!tx && !tx.empty() });
    // } catch(e) {}
  }

  // Ensure we react immediately when the map signals it's ready, even if data loads later/earlier
  try {
    window.addEventListener('mapReady', function(){
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
       } catch(e) {}
      try {
        // Rebind hover to use centralized tooltip logic
        const idToAbbr = ID_TO_ABBR;
        d3.selectAll('path.state')
          .on('mouseover', function(evt, d){
            const sel = d3.select(this);
            const cur = sel.attr('fill') || '#2f2f2f';
            sel.attr('data-orig-fill', cur);
            try {
              const isYellow = (cur.toLowerCase && cur.toLowerCase() === '#ffd700');
              // Use a neutral highlight color to avoid party-color confusion
              let highlight = '#A0A0A0';
              sel.attr('fill', highlight);
            } catch(e){ sel.attr('fill', '#A0A0A0'); }
            try {
              const id = d && d.id != null ? String(d.id).padStart(2,'0') : null;
              const abbr = id ? idToAbbr[id] : null;
              if (abbr){
                const info = (window.getAdjustedInfo ? window.getAdjustedInfo(abbr) : null) || {};
                const ev = (info && info.ev != null) ? info.ev : '';
                const marginStr = (info && info.marginStr) ? info.marginStr : '';
                const label = abbr + (ev!=='' ? ` · ${ev} EV` : '') + (marginStr ? ` · ${marginStr}` : '');
                if (typeof window.showMapTip === 'function') window.showMapTip(evt, label);
              }
            } catch(e){}
          })
          .on('mousemove', function(evt){ try { if (typeof window.moveMapTip === 'function') window.moveMapTip(evt); } catch(e){} })
          .on('mouseout', function(){
            const sel = d3.select(this);
            const orig = sel.attr('data-orig-fill') || '#2f2f2f';
            sel.attr('fill', orig);
            sel.attr('data-orig-fill', null);
            try { if (typeof window.hideMapTip === 'function') window.hideMapTip(); } catch(e){}
          });
      } catch(e) {}
    });
  } catch(e) {}

  // Expose for manual testing: you can call window.updateStateLabels(2024) in console
  try { window.updateStateLabels = updateStateLabels; } catch(e) {}

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

  // No flipped URL param: we store PV overrides directly as numeric values (possibly negative)

    window.history.replaceState({}, '', url);
  }

  function leanStr(x){
    if (!isFinite(x)) return '';
    if (Math.abs(x) < 0.000005) return 'EVEN';
    const s = (Math.abs(x) * 100).toFixed(1);
    return (x > 0 ? 'D+' : 'R+') + s;
  }

  function marginToColor(m, isThirdParty = false){
    if (isThirdParty) return '#C9A400'; // Yellow for third-party
    if (m <= -0.20) return '#8B0000';
    if (m <= -0.10) return '#B22222';
    if (m <= -0.05) return '#CD5C5C';
    if (m < -0.01) return '#F08080';
    if (m < 0) return '#b67d86ff';
    if (m < 0.01) return '#8aa7baff';
    if (m < 0.05) return '#87CEFA';
    if (m < 0.10) return '#6495ED';
    if (m < 0.20) return '#4169E1';
    return '#00008B';
  }

  const byYear = new Map();
  const evByUnit = new Map();
  // expose for tooltip/helper access outside closure
  window._byYearMap = byYear;
  window._evByUnitMap = evByUnit;
  // Mapping of stop -> effective test value (average of adjacent stops)
  const stopToEff = new Map();
  // Mapping of stop -> array of units that share that stop
  const stopToUnits = new Map();
  // Per-year stops array
  const stopsByYear = new Map();
  // Remap for known label mismatches between GeoJSON and CSV keys
  const UNIT_REMAP = {};

  function dbg(){ 
  //console.log('[tester]', ...arguments); 
  }

  Promise.all([
    d3.csv('presidential_margins.csv'),
    d3.csv('electoral_college.csv').catch(() => []),
    d3.csv('flip_results.csv').catch(() => []),
    d3.csv('flip_details.csv').catch(() => []),
    d3.csv('stop_colors.csv').catch(() => [])
  ]).then(([margins, ec, flipResults, flipDetails, stopColors]) => {
    (margins || []).forEach(r => {
      const year = +r.year;
      const unit = r.abbr;
      const rm = +r.relative_margin || 0;
      const nm = +r.national_margin || 0;
      const ev = +r.electoral_votes || 0;
      const tp = +r.third_party_share || 0;
      // include vote totals for adjusted PV calculations
      const dVotes = +r.D_votes || 0;
      const rVotes = +r.R_votes || 0;
      const tVotes = +r.T_votes || 0;
      const total = +r.total_votes || (dVotes + rVotes + tVotes) || 0;
      const row = { year, unit, rm, nm, ev, tp, dVotes, rVotes, tVotes, total };
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

  // Build flip scenarios
    window._flipByYear = new Map(); // year -> { classic: [rows], no_majority: [rows] }
    const groupFD = new Map();
    (flipDetails || []).forEach(r => {
      const y = +r.year; const mode = String(r.mode || '').toLowerCase();
      if (!y || !mode) return;
      const arr = groupFD.get(`${y}:${mode}`) || [];
      // support units like ME-AL/NE-02
      arr.push({ unit: r.abbr, ev: +r.ev||0, votes_to_flip: +r.votes_to_flip||0 });
      groupFD.set(`${y}:${mode}`, arr);
    });
    // sort states by votes_to_flip ascending for determinism
    groupFD.forEach(arr => arr.sort((a,b) => (a.votes_to_flip||0) - (b.votes_to_flip||0)));
  // store
  const modes = ['classic','no_majority'];
  // derive years from flipDetails to ensure availability even if results file is absent
  const years = new Set((flipDetails||[]).map(r=>+r.year));
    years.forEach(y => {
      const o = {};
      modes.forEach(m => o[m] = groupFD.get(`${y}:${m}`) || []);
      window._flipByYear.set(y, o);
    });

    // Capture per-year total EV from flip_results.csv for accurate EV bar scaling
    window._totalEvByYear = new Map();
    try {
      (flipResults || []).forEach(r => {
        const y = +r.year;
        const tot = +r.total_ev || 0;
        if (y && isFinite(tot) && tot > 0) window._totalEvByYear.set(y, tot);
      });
    } catch(e) { /* optional */ }

    // Index stop colors CSV: year -> stop_key -> unit -> { winner, color_css, result_color_name }
    window._stopColorsByYear = new Map();
    try {
      (stopColors || []).forEach(r => {
        const y = +r.year; if (!y) return;
        const key = String(r.stop_key != null ? r.stop_key : (r.stop != null ? r.stop : ''));
        if (!key) return;
        const unit = r.unit;
        const winner = r.winner;
        const color_css = r.color_css || '';
        const color_name = r.result_color_name || '';
        if (!window._stopColorsByYear.has(y)) window._stopColorsByYear.set(y, new Map());
        const byStop = window._stopColorsByYear.get(y);
        if (!byStop.has(key)) byStop.set(key, new Map());
        byStop.get(key).set(unit, { winner, color_css, color_name });
      });
    } catch(e) { /* optional */ }

  // expose simple accessors
  window.getRowsForYear = function(y){ try { return byYear.get(y) || []; } catch(e){ return []; } };
  window.getEvFor = function(y, u){ try { return evByUnit.get(`${y}:${u}`); } catch(e){ return null; } };

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
          const meClip = defs.select('#clip-ME').empty() ? defs.append('clipPath').attr('id','clip-ME') : defs.select('#clip-ME');
          meClip.selectAll('*').remove();
          meClip.append('path').attr('d', meD);
        }
        if (!nePath.empty()) {
          const neD = nePath.attr('d');
          const neClip = defs.select('#clip-NE').empty() ? defs.append('clipPath').attr('id','clip-NE') : defs.select('#clip-NE');
          neClip.selectAll('*').remove();
          neClip.append('path').attr('d', neD);
        }
  // Render districts above states so they are visible; enable pointer events for hover/tooltips
  const dg = window.mapG.append('g').attr('class','districts').attr('pointer-events','auto');
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
      const aState = au ? au.slice(0,2) : null;
      const bState = bu ? bu.slice(0,2) : null;
      
      // Handle ME districts - sort by descending area (largest first)
      if (aState === 'ME' && bState === 'ME') {
        try { return window.mapPath.area(b) - window.mapPath.area(a); } catch(e) { return 0; }
      }
      // Handle NE districts - sort by ascending area (smallest first) 
      if (aState === 'NE' && bState === 'NE') {
        try { return window.mapPath.area(a) - window.mapPath.area(b); } catch(e) { return 0; }
      }
      // Default sort by area descending
      try { return window.mapPath.area(b) - window.mapPath.area(a); } catch(e) { return 0; }
    });
  } catch(e) {}

    feats.forEach(f => {
          // prefer an explicit 'unit' property (e.g. 'ME-01'/'NE-02'), fall back to abbr or GEOID
          let unit = null;
          if (f.properties) {
            unit = f.properties.unit || f.properties.abbr || f.properties.GEOID || null;
          }
          if (!unit) return;
          
          // Use original unit name directly when it matches expected patterns
          const useUnit = (unit.match(/^(ME|NE)-0[123]$/)) ? unit : (UNIT_REMAP[unit] || unit);
          const st = useUnit.slice(0,2);
          const clip = st === 'ME' ? 'url(#clip-ME)' : (st === 'NE' ? 'url(#clip-NE)' : null);
          
          let dStr = window.mapPath(f);
          // Remove problematic bounding box rectangles that cover the entire canvas
          if (dStr && dStr.startsWith('M-104,-4.4L1079,-4.4L1079,614.4L-104,614.4Z')) {
            dStr = dStr.replace(/^M-104,-4\.4L1079,-4\.4L1079,614\.4L-104,614\.4Z/, '');
          }
          
          if (useUnit && dStr) districtDByUnit.set(useUnit, dStr);
          // halo underlay to make small districts more visible (e.g., NE-02)
          dg.append('path')
            .attr('class','district-halo')
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
            .attr('class','district')
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
            .on('mouseover', function(evt){
              try {
                const sel = d3.select(this);
                const cur = sel.attr('fill') || 'transparent';
                sel.attr('data-orig-fill', cur);
                // Use a neutral highlight color to avoid party-color confusion
                let highlight = '#A0A0A0';
                // Preserve bright yellow for third-party highlight when the fill is already yellow
                try { if (cur && cur.toLowerCase && cur.toLowerCase() === '#ffd700') highlight = '#FFD700'; } catch(e) {}
                sel.attr('fill', highlight);
                const unit = sel.attr('data-unit');
                const info = (window.getAdjustedInfo ? window.getAdjustedInfo(unit) : null) || {};
                const ev = (info && info.ev != null) ? info.ev : '';
                const marginStr = (info && info.marginStr) ? info.marginStr : '';
                const text = unit + (ev!=='' ? ` · ${ev} EV` : '') + (marginStr ? ` · ${marginStr}` : '');
                if (typeof window.showMapTip === 'function') window.showMapTip(evt, text);
              } catch(e) {}
            })
            .on('mousemove', function(evt){ try { if (typeof window.moveMapTip === 'function') window.moveMapTip(evt); } catch(e){} })
            .on('mouseout', function(){
              try {
                const sel = d3.select(this);
                const orig = sel.attr('data-orig-fill') || 'transparent';
                sel.attr('fill', orig);
                sel.attr('data-orig-fill', null);
                if (typeof window.hideMapTip === 'function') window.hideMapTip();
              } catch(e) {}
            })
            .on('click', function(){
              try { const unit = this.getAttribute('data-unit'); if (unit) window.open(`unit/${unit}.html`, '_blank'); } catch(e) {}
            });
          window._districtPaths.set(useUnit, p);
        });
        // Build an SVG mask to stop NE-03 from painting over NE-02/NE-01 if geometries overlap
        try {
          const ne03 = districtDByUnit.get('NE-03');
          if (ne03) {
            const m = defs.select('#mask-NE-03').empty() ? defs.append('mask').attr('id','mask-NE-03') : defs.select('#mask-NE-03');
            m.attr('maskUnits','userSpaceOnUse')
             .attr('x', 0).attr('y', 0)
             .attr('width', 975).attr('height', 610);
            m.selectAll('*').remove();
            m.append('rect').attr('x',0).attr('y',0).attr('width',975).attr('height',610).attr('fill','#fff');
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
        } catch(e) { /* masking optional */ }
    // Bring state boundary mesh to front so white seams remain visible above district fills
    try { d3.select('svg#map').select('g').select('.state-boundaries').raise(); } catch(e) {}
    // apply initial colors now that district paths exist
    try { updateAll(); } catch(e) {}
      } catch (e) {
        console.warn(`Couldn't render ME/NE districts: ${e && e.message ? e.message : e}`);
      }
    }).catch(()=>{/* no district overlay available */});
  });

  function getNatMargin(year){
    const arr = byYear.get(year) || [];
    for (const r of arr){
      if (r.unit === 'NATIONAL' || r.unit === 'NAT') return r.nm || 0;
    }
    let sum = 0, n = 0;
    arr.forEach(r => { if (isFinite(r.nm)) { sum += r.nm; n++; } });
    return n ? sum / n : 0;
  }

  function buildPvStops(year, container, datalist){
    const cap = PV_CAP;
    const arr = byYear.get(year) || [];
    // quick lookup by unit for dynamic chip coloring and other helpers
    const rowByUnit = new Map();
    arr.forEach(r => { if (r && r.unit) rowByUnit.set(r.unit, r); });
    const stopsSet = new Set([0]);
    // include the national margin as a stop
  let nat = getNatMargin(year);
  // In future mode, force nat=0 and omit an 'Actual' stop for years after 2024; keep Actual for 2024.
  if (window._futureMode && year > 2024) {
    nat = 0;
  } else {
    if (isFinite(nat) && Math.abs(nat) <= cap) stopsSet.add(nat);
  }
    // clear any prior mappings
    stopToEff.clear();
    stopToUnits.clear();
  // Predefine effective values for EVEN and Actual stops
    stopToEff.set(0, 0 + EPS); // EVEN nudges to D side to break ties deterministically
  if (!(window._futureMode && year > 2024) && isFinite(nat)) stopToEff.set(nat, nat); // Actual = exactly national (historical or 2024 on Future)
  arr.forEach(r => {
      const val = -(+r.rm || 0);
      // ignore national rows in per-state stop derivation to avoid 'NATIONAL' showing beside EVEN
      if ((r.unit === 'NATIONAL' || r.unit === 'NAT')) return;
      const t = +r.tp || 0;
      a = 3*t - 1; // half-width of third-party window
      if (year === 1948 && r.unit === 'AL') {
        a = 0.0;
      }
      if (a > 0 && isFinite(a)) {
        // Add third-party tipping thresholds (upper/lower bounds of yellow window)
        const rVal = +(r.rm || 0);
        const nD = -rVal + a;
        const nD_EPS_SGN = Math.sign(nD - nat);
        const nR = -rVal - a;
        const nR_EPS_SGN = Math.sign(nR - nat);
        if (isFinite(nD) && Math.abs(nD) <= cap) {
          stopsSet.add(nD);
          const pv = stopToUnits.get(nD) || [];
          pv.push(r.unit);
          stopToUnits.set(nD, pv);
      // Upper boundary: nudge inside the yellow window (toward center -rVal)
      if (!stopToEff.has(nD)) stopToEff.set(nD, nD + nD_EPS_SGN * EPS);
        }
        if (isFinite(nR) && Math.abs(nR) <= cap) {
          stopsSet.add(nR);
          const pv = stopToUnits.get(nR) || [];
          pv.push(r.unit);
          stopToUnits.set(nR, pv);
      // Lower boundary: nudge inside the yellow window (toward center -rVal)
      if (!stopToEff.has(nR)) stopToEff.set(nR, nR + nR_EPS_SGN * EPS);
        }
        // Skip adding naive stop for this unit to avoid duplicate-ish stops
      } else {
        if (isFinite(val) && Math.abs(val) <= cap) {
          stopsSet.add(val);
          const prev = stopToUnits.get(val) || [];
          prev.push(r.unit);
          stopToUnits.set(val, prev);
          // For naive flip stops, nudge to side opposite national margin so clicking the stop flips the state
      const sgn = Math.sign(val - nat);
          if (!stopToEff.has(val)) stopToEff.set(val, val + sgn * EPS);
        }
      }
    });
    const stops = Array.from(stopsSet).sort((a,b)=>a-b);
    // Append PV presets (if any) as extra discrete stops at the end so each preset
    // becomes an integer slider index. We keep original numeric stops sorted, then
    // add presets in the order they appear in the preset select.
    const presetStops = [];
    try {
      const presetEl = document.getElementById && document.getElementById('pvPreset');
      if (presetEl && presetEl.options && presetEl.options.length) {
        const existing = stops.slice();
        const almostEqual = (a,b,eps=1e-9) => Math.abs(a-b) <= eps;
        for (const opt of Array.from(presetEl.options)) {
          try {
            const val = parseFloat(opt.value);
            if (isFinite(val)) {
              // skip blank/default options
              if (!opt.value || String(opt.value).trim() === '') continue;
              // skip duplicates already in stops
              let found = false;
              for (const s of existing) { if (almostEqual(s, val)) { found = true; break; } }
              for (const s of presetStops) { if (almostEqual(s, val)) { found = true; break; } }
              if (!found && Math.abs(val) <= cap) {
                presetStops.push(val);
                // annotate stopToUnits so UI can show preset label
                const name = (opt.text || opt.label || '').split(':')[0].trim();
                const pvUnits = stopToUnits.get(val) || [];
                pvUnits.push(`PRESET:${name || String(val)}`);
                stopToUnits.set(val, pvUnits);
                // set effective mapping
                if (!stopToEff.has(val)) stopToEff.set(val, val + EPS);
              }
            }
          } catch(e){}
        }
      }
    } catch(e) {}
    // Combine sorted stops with preset stops appended at the end (preserve ordinal indices)
  const allStops = stops.concat(presetStops);
    try {
      if (year === 2024) {
        const arrDbg = byYear.get(year) || [];
        const nonNatDbg = arrDbg.filter(r=>r && r.unit !== 'NATIONAL');
        const rmStats = {
          count: nonNatDbg.length,
          undefinedRm: nonNatDbg.filter(r=> !isFinite(r.rm)).length,
          zeroRm: nonNatDbg.filter(r=> isFinite(r.rm) && Math.abs(r.rm) < 1e-12).length
        };
        // console.log('[tester] year=2024 stops:', stops.length, stops);
        // console.log('[tester] year=2024 rm stats:', rmStats);
      }
    } catch(e) {}
    // Ensure every stop has an effective value (keep any precomputed ones)
    for (let i=0;i<allStops.length;i++){
      const s = allStops[i];
      if (!stopToEff.has(s)) {
        // default: nudge toward D side
        stopToEff.set(s, s + EPS);
      }
    }
    // store combined stops (original sorted stops + appended presets) for the year so the slider can index into them
    stopsByYear.set(year, allStops);
    if (datalist){
      // Show combined list including presets; for numeric readability keep percent formatting
      datalist.innerHTML = allStops.map(v => `<option value="${(v*100).toFixed(1)}"></option>`).join('');
      const s = document.getElementById('pvSlider');
      if (s) s.setAttribute('list', 'pvStopsList');
    }
    if (container){
      const nat = (window._futureMode && year > 2024) ? 0 : getNatMargin(year);
      // Render main stops and presets on a separate line. Main stops first (sorted),
      // then presets on a new line so they visually stand apart. Preset chips colored
      // blue for positive (D) and red for negative (R).
      const mainHtml = stops.map((v,i) => {
        const isEven = Math.abs(v) < 1e-12;
        const isNat = ((!(window._futureMode && year > 2024)) && Math.abs(v - nat) < 1e-12);
        const unitsRaw = (stopToUnits.get(v) || []).filter(u => u !== 'NATIONAL' && u !== 'NAT');
        for (let j=0;j<unitsRaw.length;j++){ if (unitsRaw[j] && unitsRaw[j].startsWith('PRESET:')) unitsRaw[j] = unitsRaw[j].replace(/^PRESET:/,''); }
        const units = (isEven || isNat) ? '' : unitsRaw.slice(0,3).map(u=>u.slice(0,5)).join(',');
        const base = isEven ? 'EVEN' : (isNat ? (leanStr(v) + ' Actual') : leanStr(v));
        const label = units ? `${base} <small style="margin-left:6px;color:var(--muted)">${units}</small>` : base;
        // Determine color same as before
        let bgColor = '#0d0d0dff';
        if (!isEven) {
          const key = Number(v).toFixed(STOP_KEY_PREC);
          const byYearStops = window._stopColorsByYear && window._stopColorsByYear.get(year);
          const byStop = byYearStops && byYearStops.get(key);
          if (byStop) {
            const winners = [];
            const colors = [];
            const unitsList = unitsRaw && unitsRaw.length ? unitsRaw : Array.from(byStop.keys());
            unitsList.forEach(u => { const info = byStop.get(u); if (info) { winners.push(info.winner); colors.push(info.color_css || ''); } });
            if (winners.includes('T')) bgColor = (colors[winners.indexOf('T')] || 'yellow');
            else if (winners.includes('D')) bgColor = (colors[winners.indexOf('D')] || 'deepskyblue');
            else if (winners.includes('R')) bgColor = (colors[winners.indexOf('R')] || 'red');
            else if (colors.length) bgColor = colors[0];
          } else {
            const eff = stopToEff.get(v);
            const unitsList = (unitsRaw && unitsRaw.length) ? unitsRaw : (arr.filter(r => r && r.unit && r.unit !== 'NATIONAL').map(r => r.unit));
            const winners = [];
            unitsList.forEach(u => { const r = rowByUnit.get(u); if (!r) return; const t = +r.tp || 0; const a = 3*t - 1; const rVal = +(r.rm || 0); if (a > 0) { const nD = -rVal + a; const nR = -rVal - a; if (eff > nR + EPS && eff < nD - EPS) { winners.push('T'); return; } } const m = rVal + eff; if (m > 0) winners.push('D'); else if (m < 0) winners.push('R'); });
            if (winners.includes('T')) bgColor = '#C9A400';
            else if (winners.includes('D')) bgColor = '#4169E1';
            else if (winners.includes('R')) bgColor = '#B22222';
          }
        }
        const isYellowish = (bgColor && bgColor.toLowerCase && (bgColor.toLowerCase() === '#c9a400' || bgColor.toLowerCase() === '#ffd700' || bgColor.toLowerCase() === 'yellow'));
        const textColor = (bgColor === '#FFFFFF' || isYellowish) ? '#000' : '#fff';
        const smallColor = isYellowish ? '#000' : 'var(--muted)';
        return `<span class="btn" style="padding:4px 6px;margin:2px;background-color:${bgColor};color:${textColor}" data-idx="${i}">${label.replace('<small', `<small style=\"color:${smallColor}\"`)}</span>`;
      }).join('');
      // Preset chips: render on their own line
      const presetHtml = presetStops.map((v, pi) => {
        const idx = stops.length + pi; // index into allStops
        const sign = (v > 0) ? 'D' : (v < 0 ? 'R' : 'EVEN');
        const label = (sign === 'EVEN') ? 'EVEN' : ((v>0?'D+':'R+') + (Math.abs(v)*100).toFixed(1));
        const bg = (v > 0) ? '#4169E1' : (v < 0 ? '#B22222' : '#888888');
        const txt = (bg === '#FFFFFF') ? '#000' : '#fff';
        return `<span class="btn preset-chip" style="padding:4px 6px;margin:2px;background-color:${bg};color:${txt}" data-idx="${idx}">${label}</span>`;
      }).join('');
      container.innerHTML = 'Stops: ' + mainHtml + '<div style="margin-top:6px">Presets: ' + (presetHtml || '<span class="muted">None</span>') + '</div>';
      container.querySelectorAll('span.btn, span.preset-chip').forEach((el) => {
        el.addEventListener('click', () => {
          const i = Number(el.getAttribute('data-idx'));
          const s = document.getElementById('pvSlider');
          // Changing PV stop should reset any active flips
          try { clearFlips(); } catch(e) {}
          // Clear any custom PV override so slider selection takes effect
          try { window._pvOverride = null; } catch(e) {}
          if (s){ s.value = String(i); updateAll(); }
        });
      });
    }
  }

  function init(){
    const yearSlider = document.getElementById('yearSlider');
    const pvSlider = document.getElementById('pvSlider');
    const yearVal = document.getElementById('yearVal');
    const pvVal = document.getElementById('pvVal');
    const pvStops = document.getElementById('pvStops');
    const pvStopsList = document.getElementById('pvStopsList');
  if (!yearSlider || !pvSlider) return;

    window.addEventListener('mapReady', () => updateAll());
  yearSlider.addEventListener('input', () => { 
    clearFlips(); 
    updateAll(); 
    // Update URL with new year
    const pvEl = document.getElementById('pvSlider');
    const year = parseInt(yearSlider.value);
    const pvIndex = pvEl ? parseInt(pvEl.value) : 0;
    updateUrl(year, pvIndex, null);
  });
    pvSlider.addEventListener('input', () => { 
      // Don't clear flips if we're in the middle of applying one
      if (!window._applyingFlip) clearFlips(); 
      // moving the slider cancels any PV override and flipped flag
      try { window._pvOverride = null; } catch(e) {}
  // no flipped flag; numeric overrides encode sign directly
      updateAll(); 
      // Update URL with new PV index
      const yearEl = document.getElementById('yearSlider');
      const year = yearEl ? parseInt(yearEl.value) : null;
      const pvIndex = parseInt(pvSlider.value);
      const flipMode = window._activeFlip ? window._activeFlip.mode : null;
      updateUrl(year, pvIndex, flipMode);
    });

    let y = 0; for (const k of byYear.keys()) y = Math.max(y, k);
    if (y === 0) y = 2024;
    
    // Load from URL parameters if available
    const urlParams = getUrlParams();
    if (urlParams.year && byYear.has(urlParams.year)) {
      y = urlParams.year;
    }
    
    yearSlider.value = String(y);
    yearVal.textContent = y;

  buildPvStops(y, pvStops, pvStopsList);
  // configure discrete slider bounds based on stops
  const stops = stopsByYear.get(y) || [0];
  pvSlider.min = 0;
  pvSlider.max = Math.max(0, stops.length - 1);
  pvSlider.step = 1;
  // default to national margin stop if present, otherwise center (0)
  let defaultIdx = stops.indexOf(getNatMargin(y));
  if (defaultIdx === -1) defaultIdx = Math.max(0, stops.indexOf(0));
  if (defaultIdx === -1) defaultIdx = 0;
  
  // Override with URL parameter if available
  // Support three flavors: pv (slider index), pvValue (explicit numeric PV), pvPreset (named preset)
  if (urlParams.pv !== null && Number.isInteger(urlParams.pv) && urlParams.pv >= 0 && urlParams.pv < stops.length) {
    defaultIdx = Math.floor(urlParams.pv);
  } else if (urlParams.pvValue != null && isFinite(urlParams.pvValue)) {
    // Apply numeric PV override
    try { window._pvOverride = parseFloat(urlParams.pvValue); } catch(e) { window._pvOverride = null; }
    // If flipped flag present, negate the override and mark flipped state
  if (urlParams.pvValue) { try { window._pvOverride = parseFloat(urlParams.pvValue); } catch(e) {} }
  } else if (urlParams.pvPreset != null) {
    // Look up preset by scanning pvPreset select options (match label/value)
    const pvPresetEl = document.getElementById('pvPreset');
    if (pvPresetEl) {
      const want = String(urlParams.pvPreset).toLowerCase();
      let foundVal = null;
      for (const opt of Array.from(pvPresetEl.options)) {
        const label = (opt.text || '').split(':')[0].trim().toLowerCase();
        if (label === want || (opt.text || '').toLowerCase().includes(want) || (opt.value || '').toLowerCase() === want) {
          foundVal = parseFloat(opt.value);
          pvPresetEl.value = opt.value;
          break;
        }
      }
      if (foundVal != null && !isNaN(foundVal)) {
        try { window._pvOverride = foundVal; } catch(e) { window._pvOverride = null; }
  if (urlParams.pvValue) { try { window._pvOverride = foundVal; } catch(e) {} }
      }
    }
  }
  
  pvSlider.value = String(defaultIdx);
  const curStop = stops[defaultIdx] || 0;
  const nat = getNatMargin(y);
  const curEff = stopToEff.get(curStop) || (curStop + EPS * (curStop === 0 ? 1 : Math.sign(curStop - nat)));
  const showNatInit = ((!(window._futureMode && y > 2024)) && Math.abs(curStop - nat) < STOP_EPS);
  pvVal.textContent = (showNatInit ? 'Actual ' : '') + leanStr(curEff);
  // set up datalist and stop chips
  buildPvStops(y, pvStops, pvStopsList);
  // buttons
  const btnClassic = document.getElementById('flipClassic');
  const btnNoMaj = document.getElementById('flipNoMaj');
  const btnReset = document.getElementById('flipReset');
  if (btnClassic) btnClassic.addEventListener('click', () => applyFlip('classic'));
  if (btnNoMaj) btnNoMaj.addEventListener('click', () => applyFlip('no_majority'));
  if (btnReset) btnReset.addEventListener('click', () => { clearFlips(); updateAll(); });
  // Initial button visibility update
  updateFlipButtons();
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
          const yearEl = document.getElementById('yearSlider'); const y = yearEl? parseInt(yearEl.value):2024;
          const pvEl = document.getElementById('pvSlider');
          const stops = (stopsByYear && stopsByYear.get(y)) || [0];
          const idx = pvEl? parseInt(pvEl.value):0; const stopVal = stops[idx] || 0; cur = stopVal;
        }
      } catch(e) {}
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
      if (urlParams.flip === 'classic' || urlParams.flip === 'no_majority') {
        applyFlip(urlParams.flip);
      }
    }, 100);
  }
  }

  function updateAll(){
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
      buildPvStops(year, pvStops, pvStopsList);
      const stopsNow = stopsByYear.get(year) || [0];
      const natNow = getNatMargin(year);
      let idx = stopsNow.findIndex(v => Math.abs(v - natNow) <= STOP_EPS);
      if (idx < 0) idx = stopsNow.findIndex(v => Math.abs(v) <= STOP_EPS);
      if (idx < 0) idx = 0;
      pvEl.min = 0; pvEl.max = Math.max(0, stopsNow.length - 1); pvEl.step = 1; pvEl.value = String(idx);
      window._prevYear = year;
    }
  } catch(e) {}
  // pvSlider is now an index into the stops array
  const nat = getNatMargin(year);
  // expose current for tooltip helper
  window._curYear = year;
  const pvIndex = +pvEl.value;
  const stops = stopsByYear.get(year) || [0];
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
    (byYear.get(year) || []).forEach(r => {
      const unit = r.unit; if (!unit || unit === 'NATIONAL') return;
      const stopsForUnit = [];
      const t = +r.tp || 0; const a = 3*t - 1; const rVal = +(r.rm || 0);
      if (a > 0) { stopsForUnit.push(-rVal - a, -rVal + a); }
      else { stopsForUnit.push(-(+r.rm || 0)); }
      for (const s of stopsForUnit) {
        const eff = stopToEff.get(s);
        if (eff != null && isFinite(eff) && Math.abs(pv - eff) <= STOP_EPS) {
          matches.push(unit.slice(0,5));
          break;
        }
      }
    });
  const showNat = ((!(window._futureMode && year > 2024)) && override == null && Math.abs(stopVal - nat) <= STOP_EPS);
  const matchLabel = (Math.abs(stopVal) < STOP_EPS) ? '' : (matches.length ? ' (' + (matches.slice(0,6).join(',') + (matches.length>6 ? '…' : '')) + ')' : '');
  document.getElementById('pvVal').textContent = (showNat ? 'Actual ' : '') + leanStr(pv) + matchLabel;

    buildPvStops(year, document.getElementById('pvStops'), document.getElementById('pvStopsList'));

  const arr = byYear.get(year) || [];
  const abbrColors = new Map();
  const unitColors = new Map();
  const unitParties = new Map(); // unit -> 'Blue'|'Red'|'Even'
  let dEV = 0, rEV = 0, oEV = 0;
  arr.forEach(r => {
      const unit = r.unit;
      if (!unit || unit === 'NATIONAL') return;
      // If a flip scenario is active, flip the sign (winner reverses) by nudging margin to opposite winner by tiny epsilon
      const flipped = isUnitFlipped(year, unit);
      let m = (+r.rm || 0) + pv;
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
  // Special case for Alabama 1960: if AL is not colored red (R wins), give 5 D EVs and 6 O EVs
  let counted = false;
  if (year === 1960 && unit === 'AL' && m >= 0) {
    // Alabama in 1960: if not Republican (m >= 0), split EVs as 5 D and 6 O
    dEV += 5;
    oEV += 6;
    counted = true;
  }
  
  // Count EVs, ensuring the tipping-point state is included (no black sliver)
  // Third-party EV handling: classify as Other when PV is strictly within the yellow window
  if (!counted) {
    const t = +r.tp || 0;
    const a = 3*t - 1;
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
      const st = unit.slice(0,2);
      const prev = abbrColors.get(st);
      // Special pluralities: dynamic yellow window using third-party share (any year)
      let color;
      const rVal = +(r.rm || 0);
      {
        const t = +r.tp || 0;
          a = 3*t - 1;
          if (year === 1948 && r.unit === 'AL') {
            a = 0.0;
            color = (pv < -rVal) ? marginToColor(m) : '#FFD700'; // Thurmond vs Dewey (no Truman here)
          }
          else if (a > 0) {
            // Use same boundaries as EV counting: strict inside (nR + EPS, nD - EPS)
            const nD = -rVal + a;
            const nR = -rVal - a;
            if (pv > nR + EPS && pv < nD - EPS) {
              color = '#FFD700'; // yellow within the window
            } else {
              color = marginToColor(m);
            }
          } else {
            color = marginToColor(m);
          }
      }
  if (!prev || Math.abs(m) > Math.abs(prev.m)) abbrColors.set(st, { m, color });
  // store per-unit color and party label so district polygons can be filled individually
  unitColors.set(unit, color);
  unitParties.set(unit, (m > EPS) ? 'Blue' : ((m < -EPS) ? 'Red' : 'Even'));
    });

    // Use smooth transitions for state fills
    (function(){
      const idToAbbr = {"01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY"};
      d3.selectAll('path.state').each(function(d){
        const id = String(d.id).padStart(2,'0');
        const abbr = idToAbbr[id];
        const entry = abbrColors.get(abbr);
        const fill = entry ? entry.color : '#2f2f2f';
        // transition to new color
        try {
          d3.select(this)
            .transition()
            .duration(450)
            .attrTween('fill', function(){
              const current = d3.select(this).attr('fill') || '#2f2f2f';
              return d3.interpolateRgb(current, fill);
            });
        } catch(e) {
          d3.select(this).attr('fill', fill);
        }
      });
      // after coloring states, keep labels on top
      try { raiseStateLabelsLayer(); } catch(e) {}
    })();

  // color district polygons (ME/NE) if overlay loaded
    if (window._districtPaths) {
      try {
        // Show/hide districts based on year availability
        const showME = year >= 1972;
        const showNE = year >= 1992;
        // Update both fill and visibility
        window._districtPaths.forEach((pSel, unit) => {
          // unit is expected like 'ME-01' or 'NE-02'
          const stateAbbr = unit.slice(0,2);
          const atLargeEntry = abbrColors.get(stateAbbr);
          const atLargeColor = atLargeEntry ? atLargeEntry.color : '#2f2f2f';
          const ucolor = unitColors.get(unit) || atLargeColor || 'transparent';
          const st = stateAbbr;
          const visible = (st === 'ME' ? showME : (st === 'NE' ? showNE : true));
          try {
            // transition fill color for district polygons
            try {
              pSel.transition().duration(400).attrTween('fill', function(){
                const cur = d3.select(this).attr('fill') || 'transparent';
                return d3.interpolateRgb(cur, ucolor);
              });
            } catch(e){
              pSel.attr('fill', ucolor);
            }
            pSel.attr('display', visible ? null : 'none');
            // also toggle the matching halo
            const halo = pSel.node && pSel.node().previousSibling;
            if (halo && halo.setAttribute) halo.setAttribute('display', visible ? null : 'none');

          } catch(e) {}
        });
        // after districts update, keep labels above them
        try { raiseStateLabelsLayer(); } catch(e) {}
      } catch (e) { /* ignore */ }
    }

  // Use actual total EV for the selected year (fallback to 538)
  let totalEV = 538;
  try {
    const t = window._totalEvByYear && window._totalEvByYear.get(year);
    if (isFinite(t) && t > 0) totalEV = t;
  } catch(e) {}
  // clamp and ensure sum displays correctly
  const dPct = totalEV ? Math.max(0, Math.min(100, (dEV/totalEV)*100)) : 0;
  const oPct = totalEV ? Math.max(0, Math.min(100, (oEV/totalEV)*100)) : 0;
  // Fill remainder to avoid black gaps from rounding
  const rPct = Math.max(0, Math.min(100, 100 - dPct - oPct));
  const dEl = document.getElementById('evFillD');
  const oEl = document.getElementById('evFillO');
  const rEl = document.getElementById('evFillR');
  if (dEl) dEl.style.width = `${dPct}%`;
  if (oEl) {
    oEl.style.left = `${dPct}%`;
    oEl.style.width = `${oPct}%`;
    oEl.style.display = (oPct > 0 ? '' : 'none');
  }
  if (rEl) rEl.style.width = `${rPct}%`;
  const evText = document.getElementById('evText');
  if (evText) evText.textContent = (oEV > 0) ? `D ${dEV} | O ${oEV} | R ${rEV}` : `${dEV} - ${rEV}`;
  // Also reflect the EV split in the flip summary badge
  const flipEC = document.getElementById('flipEC');
  if (flipEC) flipEC.textContent = (oEV > 0) ? `D ${dEV} | O ${oEV} | R ${rEV}` : `${dEV} - ${rEV}`;
  
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
        const t = +r.tp || 0; const a = 3*t - 1; const rVal = +(r.rm || 0);
        // If inside third-party (yellow) window, exclude from close list of D/R
        if (a > 0) {
          const nD = -rVal + a; const nR = -rVal - a;
          if (pv > nR + EPS && pv < nD - EPS) return; // Other wins here, not a close D/R
        }
        if (Math.abs(m) < THRESH) {
          list.push({ unit: r.unit, ev: (+r.ev || 0), m });
        }
      });
      list.sort((a,b) => Math.abs(a.m) - Math.abs(b.m));
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
          const t = +r.tp || 0; const a = 3*t - 1; const rVal = +(r.rm || 0);
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
        function _textColorFor(bg){ try { if(!bg || bg[0] !== '#') return '#fff'; const c = bg.slice(1); const val = parseInt(c,16); const rr = (val>>16)&255; const gg = (val>>8)&255; const bb = val&255; const lum = 0.299*rr + 0.587*gg + 0.114*bb; return lum > 186 ? '#000' : '#fff'; } catch(e){ return '#fff'; } }
        function _smallColorFor(textCol){ return textCol === '#fff' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)'; }

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
          const relTxt = ((r.relToNat>0)?'D+':'R+') + (Math.abs(r.relToNat)*100).toFixed(1);
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
  } catch(e) { /* optional */ }

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
        for (const r of rows){
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
      for (const r of rows){
      if (!r || !r.unit || r.unit === 'NATIONAL') continue;
      // Skip district rows to avoid double counting; include -AL and normal states only
      if (r.unit.includes('-') && !r.unit.endsWith('-AL')) continue;
      const total = +r.total || (+r.dVotes + +r.rVotes + +r.tVotes) || 0;
      if (!isFinite(total) || total <= 0) continue;
      const tp = Math.max(0, Math.min(1, +r.tp || 0));
      const flipped = isUnitFlipped(year, r.unit);
      let rmAdj = (+r.rm || 0) + pv;
      if (flipped) rmAdj = -rmAdj; // swap two-party shares
      let twoD = 0.5 + rmAdj/2;
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
  } catch(e) { /* non-fatal */ }

  // Render small-state side boxes (DC, ME-AL, NE-AL, and other tiny states)
  try {
    // Expose the latest color maps for console inspection
    window._lastAbbrColors = abbrColors;
    window._lastUnitColors = unitColors;
    //console.log('[smallBoxes] invoking renderSmallStateBoxes', {
    //  year,
    //  abbrColors: abbrColors ? abbrColors.size : 0,
    //  unitColors: unitColors ? unitColors.size : 0
    //});
    if (typeof renderSmallStateBoxes === 'function') {
      renderSmallStateBoxes(year, abbrColors, unitColors);
    } else if (typeof window.renderSmallStateBoxes === 'function') {
      window.renderSmallStateBoxes(year, abbrColors, unitColors);
    } else {
      console.warn('[smallBoxes] renderSmallStateBoxes not found in scope');
    }
  } catch(e) { console.warn('[smallBoxes] error rendering side boxes', e); }

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
          delta = curRel - b;
          if (year < 2024 && baselineYear === 2024) {
            delta = -delta; // invert delta when comparing historical year to future 2024
          }
          items.push({ unit: r.unit, delta, prevRel, curRel });
        });
        // Sort ascending by delta (more R shift first, more D shift last)
        items.sort((a,b) => a.delta - b.delta);
        function fmtLean(x){
          if (!isFinite(x)) return '';
          if (Math.abs(x) < 0.000005) return 'EVEN';
          const s = (Math.abs(x) * 100).toFixed(1);
          return (x > 0 ? 'D+' : 'R+') + s;
        }
        function textColor(bg){ try { if(!bg || bg[0] !== '#') return '#fff'; const c = bg.slice(1); const val = parseInt(c,16); const rr=(val>>16)&255, gg=(val>>8)&255, bb=val&255; const lum=0.299*rr+0.587*gg+0.114*bb; return lum>186?'#000':'#fff'; } catch(e){ return '#fff'; } }
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
  } catch(e) { /* optional */ }

  // If the baseline select is present, ensure changing it reruns updateAll
  try {
    const sel = document.getElementById('relBaseline');
    if (sel) {
      sel.addEventListener('change', () => { try { if (typeof window.updateAll === 'function') window.updateAll(); } catch(e){} });
    }
  } catch(e) {}

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
  } catch(e) {}

  dbg('updateAll: ending successfully');
  // Update on-map labels last so they sit on top and have current EV totals
  try { updateStateLabels(year); } catch(e) {}
  try { raiseStateLabelsLayer(); } catch(e) {}
  }
  
  // Expose updateAll to global scope for applyFlip
  window.updateAll = updateAll;
  // Expose small-state boxes renderer for manual testing
  try { window.renderSmallStateBoxes = renderSmallStateBoxes; } catch(e) {}
  
  // Expose scope variables needed by external functions
  window._stopsByYear = stopsByYear;
  window._getNatMargin = getNatMargin;
  window._STOP_EPS = STOP_EPS;
  window.updateUrl = updateUrl;
})();

// Helper for tooltip: given a unit abbr (state or district), return {ev, margin, marginStr}
window.getAdjustedInfo = function(unit){
  try {
    const year = window._curYear;
    const pv = window._curPv || 0;
    if (!year) return null;
    const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
    const rows = (function(){
      // byYear lives inside the IIFE; expose via window if available
      if (typeof window.getRowsForYear === 'function') return window.getRowsForYear(year);
      return null;
    })();
    // Fallback: reconstruct from CSV already parsed via closure if not exposed
    let r = null;
    if (rows && rows.length){
      r = rows.find(x => x.unit === keyUnit);
    }
    // If closure isn't exposed, try reading from the DOM colors map via evByUnit
    // but we did store evByUnit in closure as well; we mirror EV lookup by re-reading electoral_college.csv not feasible here.
    // Instead, rely on title info for EV not available; return margin only if needed.
  let ev = null;
  try { if (typeof window.getEvFor === 'function') ev = window.getEvFor(year, keyUnit); } catch(e) {}
  if ((ev == null || isNaN(ev)) && r && isFinite(+r.ev)) ev = +r.ev;
    if (!r) return { ev, margin: null, marginStr: '' };
    let m = (+r.rm || 0) + (pv || 0);
    // Check if this unit is flipped in the current scenario
    const flipped = isUnitFlipped(year, keyUnit);
    if (flipped) {
      // If flipped, reverse the winner by nudging margin to opposite side
      m = (m > 0 ? -0.000001 : 0.000001); // Use small epsilon like in updateAll
      console.log('getAdjustedInfo: unit flipped', {unit, keyUnit, originalMargin: (+r.rm || 0) + (pv || 0), flippedMargin: m});
    }
    return { ev, margin: m, marginStr: (function(){
      if (!isFinite(m)) return '';
      if (Math.abs(m) < 0.000005) return 'EVEN';
      
      // Check for third-party scenario (yellow window) for any year
      {
        const t = +r.tp || 0;
        const a = 3*t - 1;
        if (a > 0) {
          const rVal = +(r.rm || 0);
          const pv = window._curPv || 0;
          const nD = -rVal + a;
          const nR = -rVal - a;
          const EPS = 1e-9;
          // If current PV places this unit in the yellow window, show T+ margin
          if (pv > nR + EPS && pv < nD - EPS) {
            const windowCenter = -rVal; // Center of yellow window
            const windowHalfWidth = a; // Half-width of yellow window
            const distanceFromCenter = Math.abs(pv - windowCenter);
            const relativePosition = distanceFromCenter / windowHalfWidth; // 0 to 1
            const thirdPartyStrength = (1 - relativePosition) * windowHalfWidth;
            const s = (thirdPartyStrength * 100).toFixed(1);
            return 'T+' + s; // Third-party win
          }
        }
      }
      
      const s = (Math.abs(m) * 100).toFixed(1);
      return (m > 0 ? 'D+' : 'R+') + s;
    })() };
  } catch(e) { return null; }
}

// Update visibility of flip buttons based on year and scenario equality
function updateFlipButtons(){
  try {
    const yearEl = document.getElementById('yearSlider');
    const y = yearEl ? +yearEl.value : null;
    const btnNoMaj = document.getElementById('flipNoMaj');
    if (!btnNoMaj) return;
    const yearSc = (window._flipByYear && y) ? window._flipByYear.get(y) : null;
    if (!yearSc || !yearSc.classic || !yearSc.no_majority) { btnNoMaj.style.display = ''; return; }
    const a = (yearSc.classic||[]).map(r=>r.unit).join('|');
    const b = (yearSc.no_majority||[]).map(r=>r.unit).join('|');
    btnNoMaj.style.display = (a === b) ? 'none' : '';
  } catch(e) {}
}

// Flip application state and helpers
window._activeFlip = null; // { year, mode, units: [{unit, votes_to_flip, ev}], votesSum }
function isUnitFlipped(year, unit){
  const f = window._activeFlip; if (!f || f.year !== year) return false;
  // allow unit or at-large semantics
  if (unit === 'ME' || unit === 'NE') unit = unit + '-AL';
  const result = !!(f._set && f._set.has(unit));
  if (f._set && f._set.size > 0) {
    console.log('isUnitFlipped check', {unit, hasUnit: result, setContents: Array.from(f._set)});
  }
  return result;
}
function clearFlips(){
  window._activeFlip = null;
  const wrap = document.getElementById('flipDetailsWrap'); if (wrap) wrap.style.display = 'none';
  const t = document.getElementById('flipDetails'); if (t) t.innerHTML = '';
  const votes = document.getElementById('flipVotes'); if (votes) votes.textContent = '0';
  const cnt = document.getElementById('flipCount'); if (cnt) cnt.textContent = '0';
  const pct = document.getElementById('flipVotesPct'); if (pct) pct.textContent = '0%';
  
  // Clear flip parameter from URL
  const yearEl = document.getElementById('yearSlider');
  const pvEl = document.getElementById('pvSlider');
  if (yearEl && pvEl) {
    updateUrl(parseInt(yearEl.value), parseInt(pvEl.value), null);
  }
}
function applyFlip(mode){
  console.log('applyFlip', mode);
  try {
    window._applyingFlip = true; // Flag to prevent clearing during PV slider change
    const yearEl = document.getElementById('yearSlider');
    const year = +yearEl.value;
    const by = window._flipByYear && window._flipByYear.get(year);
    if (!by) { try { console.log('applyFlip: no scenarios for year', year); } catch(e){}; return; }
    const rows = by[mode] || [];
    try { console.log('applyFlip click', {mode, year, rows: rows.length, sample: rows.slice(0,3)}); } catch(e){}
    // Snap PV slider to the 'Actual' stop before applying flips
    try {
      const stopsNow = (window._stopsByYear) ? (window._stopsByYear.get(year) || [0]) : [0];
      const natNow = window._getNatMargin ? window._getNatMargin(year) : 0;
      const STOP_EPS = window._STOP_EPS || 0.00005;
      let idx = stopsNow.findIndex(v => Math.abs(v - natNow) <= STOP_EPS);
      if (idx < 0) idx = stopsNow.findIndex(v => Math.abs(v) <= STOP_EPS);
      if (idx < 0) idx = 0;
      const pvEl = document.getElementById('pvSlider');
      if (pvEl) {
        pvEl.value = String(idx);
        console.log('applyFlip: set PV slider to actual stop', {idx, natNow, stopsLength: stopsNow.length});
      }
    } catch(e) { 
      console.error('applyFlip: error setting PV to actual:', e);
    }
    const set = new Set(rows.map(r=>r.unit));
    const votesSum = rows.reduce((s,r)=>s + (r.votes_to_flip||0), 0);
    window._activeFlip = { year, mode, units: rows, votesSum, _set: set };
    try { console.log('applyFlip set state', {units: rows.map(r=>r.unit).slice(0,8), votesSum}); } catch(e){}
    console.log('applyFlip: rendering flip details');
    renderFlipDetails();
    console.log('applyFlip', window._activeFlip);
    console.log('applyFlip: calling updateAll...');
    updateAll();
    console.log('applyFlip: updateAll done');
    
    // Update URL parameters
    const pvEl = document.getElementById('pvSlider');
    if (pvEl) {
      updateUrl(year, parseInt(pvEl.value), mode);
    }
  } catch(e) { 
    console.error('applyFlip error:', e);
  } finally {
    window._applyingFlip = false; // Always clear the flag
  }
}
function renderFlipDetails(){
  try {
    const f = window._activeFlip; if (!f) return;
    const wrap = document.getElementById('flipDetailsWrap'); if (wrap) wrap.style.display = '';
    const t = document.getElementById('flipDetails'); if (!t) return;
    const year = f.year;
    const rows = (typeof window.getRowsForYear==='function') ? window.getRowsForYear(year) : [];
    const byUnit = new Map(); rows.forEach(r=>byUnit.set(r.unit, r));
    let html = '';
    let dEv=0,rEv=0;
    f.units.forEach(u => {
      const unit = u.unit;
      const row = byUnit.get(unit);
      if (!row) return;
      const ev = +u.ev || +row.ev || 0;
      // compute before/after using votes_to_flip: move voters from current winner to loser
      const d0 = +row.dVotes || 0;
      const r0 = +row.rVotes || 0;
      const vt = Math.max(0, +u.votes_to_flip || 0);
      let d1 = d0, r1 = r0;
      if (d0 >= r0) {
        // D originally won; flip to R by moving vt votes from D to R
        d1 = Math.max(0, d0 - vt);
        r1 = r0 + vt;
      } else {
        // R originally won; flip to D by moving vt votes from R to D
        d1 = d0 + vt;
        r1 = Math.max(0, r0 - vt);
      }
      html += `<tr><td>${unit}</td><td>${ev}</td><td>${d0.toLocaleString('en-US')}<br/>→ ${d1.toLocaleString('en-US')}</td>
      <td>${r0.toLocaleString('en-US')}<br/>→ ${r1.toLocaleString('en-US')}</td><td>${(+u.votes_to_flip||0).toLocaleString('en-US')}</td></tr>`;
    });
    t.innerHTML = html;
    const votes = document.getElementById('flipVotes'); if (votes) votes.textContent = (f.votesSum||0).toLocaleString('en-US');
    const cnt = document.getElementById('flipCount'); if (cnt) cnt.textContent = String(f.units.length);
    // Update percent of total votes changed badge
    try {
      const pctEl = document.getElementById('flipVotesPct');
      if (pctEl) {
        const natRow = rows.find(rr => rr && (rr.unit === 'NATIONAL' || rr.unit === 'NAT'));
        const total = natRow ? (+natRow.total || (+natRow.dVotes + +natRow.rVotes + +natRow.tVotes) || 0) : 0;
        let pct = (total > 0) ? ((f.votesSum || 0) / total * 100) : 0;
        let txt = '0%';
        if (isFinite(pct) && total > 0) {
          if (Math.abs(pct) < 0.01) txt = pct.toExponential(2) + '%';
          else txt = pct.toFixed(4) + '%';
        }
        pctEl.textContent = txt;
      }
    } catch(e) {}
    // EC badge is updated by updateAll; here we just ensure badge shows current numbers after next update
  } catch(e) {}
}

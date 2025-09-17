
(function(){
  const PV_CAP = 0.6;
  const EPS = 1e-5;
  const STOP_EPS = 0.00005; // tolerance when matching slider to exact flip stops
  const SPECIAL_1968 = ["MS", "AL", "GA", "AR", "LA"];

  // URL parameter management for sharing
  function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      year: params.get('year') ? parseInt(params.get('year')) : null,
      pv: params.get('pv') ? parseFloat(params.get('pv')) : null,
      flip: params.get('flip') || null
    };
  }

  function updateUrl(year, pvIndex, flipMode) {
    const url = new URL(window.location);
    if (year) url.searchParams.set('year', year);
    if (pvIndex !== null && pvIndex !== undefined) url.searchParams.set('pv', pvIndex);
    if (flipMode) url.searchParams.set('flip', flipMode);
    else url.searchParams.delete('flip');
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
    if (m <= -0.12) return '#B22222';
    if (m <= -0.06) return '#CD5C5C';
    if (m < -0.01) return '#F08080';
    if (m < 0) return '#FFC0CB';
    if (m < 0.01) return '#8aa7baff';
    if (m < 0.06) return '#87CEFA';
    if (m < 0.12) return '#6495ED';
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
    d3.csv('flip_details.csv').catch(() => [])
  ]).then(([margins, ec, flipResults, flipDetails]) => {
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
  // Render districts above states so they are visible but keep pointer-events off
  const dg = window.mapG.append('g').attr('class','districts').attr('pointer-events','none');
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
            .attr('pointer-events', 'none');
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
    const stopsSet = new Set([0]);
    // include the national margin as a stop
    const nat = getNatMargin(year);
    if (isFinite(nat) && Math.abs(nat) <= cap) stopsSet.add(nat);
    // clear any prior mappings
    stopToEff.clear();
    stopToUnits.clear();
    // Predefine effective values for EVEN and Actual stops
    stopToEff.set(0, 0 + EPS); // EVEN nudges to D side to break ties deterministically
    if (isFinite(nat)) stopToEff.set(nat, nat); // Actual = exactly national
    arr.forEach(r => {
      const val = -(+r.rm || 0);
      // ignore national rows in per-state stop derivation to avoid 'NATIONAL' showing beside EVEN
      if ((r.unit === 'NATIONAL' || r.unit === 'NAT')) return;
      // For 1968 third-party states (SPECIAL_1968 + TN), do not add the naive -relative_margin stop
      let allowNaive = true;
      if (year === 1968) {
        const st = (r.unit || '').slice(0,2);
        if (st && (st === 'TN' || (Array.isArray(SPECIAL_1968) && SPECIAL_1968.indexOf(st) !== -1))) {
          allowNaive = false;
        }
      }
      if (allowNaive && isFinite(val) && Math.abs(val) <= cap) {
        stopsSet.add(val);
        const prev = stopToUnits.get(val) || [];
        prev.push(r.unit);
        stopToUnits.set(val, prev);
        // For naive flip stops, nudge to side opposite national margin so clicking the stop flips the state
        sgn = Math.sign(val - nat);
        if (!stopToEff.has(val)) stopToEff.set(val, val + sgn * EPS);
      }
      // For 1968 only: add third-party tipping thresholds where applicable (t >= 1/3)
      if (year === 1968) {
        const t = +r.tp || 0;
        const a = 3*t - 1; // width from center to each threshold
        if (a > 0 && isFinite(a)) {
          const rVal = +(r.rm || 0);
          const nD = -rVal + a;
          const nR = -rVal - a;
          if (isFinite(nD) && Math.abs(nD) <= cap) {
            stopsSet.add(nD);
            const pv = stopToUnits.get(nD) || [];
            pv.push(r.unit);
            stopToUnits.set(nD, pv);
            // Upper boundary: nudge just inside the yellow window
            sgn = Math.sign(nD + nat);
            if (!stopToEff.has(nD)) stopToEff.set(nD, nD + 2 * sgn * EPS);
          }
          if (isFinite(nR) && Math.abs(nR) <= cap) {
            stopsSet.add(nR);
            const pv = stopToUnits.get(nR) || [];
            pv.push(r.unit);
            stopToUnits.set(nR, pv);
            // Lower boundary: nudge just inside the yellow window
            sgn = Math.sign(nR + nat);
            if (!stopToEff.has(nR)) stopToEff.set(nR, nR + 2 * sgn * EPS);
          }
        }
      }
    });
    const stops = Array.from(stopsSet).sort((a,b)=>a-b);
    // Ensure every stop has an effective value (keep any precomputed ones)
    for (let i=0;i<stops.length;i++){
      const s = stops[i];
      if (!stopToEff.has(s)) {
        // default: nudge toward D side
        stopToEff.set(s, s + EPS);
      }
    }
    // store stops for the year so the slider can index into them
    stopsByYear.set(year, stops);
    if (datalist){
      datalist.innerHTML = stops.map(v => `<option value="${(v*100).toFixed(1)}"></option>`).join('');
      const s = document.getElementById('pvSlider');
      if (s) s.setAttribute('list', 'pvStopsList');
    }
    if (container){
      const nat = getNatMargin(year);
      container.innerHTML = 'Stops: ' + stops.map((v,i) => {
        // label rules: 0 => EVEN (no units), nat => Actual (no units), others => leanStr + small unit list
        const isEven = Math.abs(v) < 1e-12;
        const isNat = Math.abs(v - nat) < 1e-12;
        const unitsRaw = (stopToUnits.get(v) || []).filter(u => u !== 'NATIONAL' && u !== 'NAT');
        const units = (isEven || isNat) ? '' : unitsRaw.slice(0,3).map(u=>u.slice(0,5)).join(',');
        const base = isEven ? 'EVEN' : (isNat ? (leanStr(v) + ' Actual') : leanStr(v));
        const label = units ? `${base} <small style="margin-left:6px;color:var(--muted)">${units}</small>` : base;
        
        // Determine button color based on margin and third-party scenarios
        let bgColor = '#0d0d0dff'; // Default Dark background
        if (!isEven) {
          // Check for 1968 third-party scenario
          let isThirdParty = false;
          if (year === 1968) {
            // Special case for TN in 1968: color the lower PV value stop yellow
            if (unitsRaw.includes('TN')) {
              // Find TN's data to calculate its yellow window
              const rows = byYear.get(year) || [];
              const tnRow = rows.find(r => r.unit === 'TN');
              if (tnRow) {
                const t = +tnRow.tp || 0;
                const a = 3*t - 1;
                if (a > 0) {
                  const rVal = +(tnRow.rm || 0);
                  const nD = -rVal + a;
                  const nR = -rVal - a;
                  // TN creates two stops: the lower one (nR) should be yellow
                  if (Math.abs(v - nR) < 1e-6) {
                    isThirdParty = true;
                  }
                }
              }
            } else {
              // Check if any other unit at this stop would be in third-party territory
              const rows = byYear.get(year) || [];
              for (const row of rows) {
                const t = +row.tp || 0;
                const a = 3*t - 1;
                if (a > 0) {
                  const rVal = +(row.rm || 0);
                  const pv = v;
                  const nD = -rVal + a;
                  const nR = -rVal - a;
                  const EPS = 1e-9;
                  
                  // Check if this PV would place this unit in the yellow window (third-party win)
                  if (pv > nR + EPS && pv < nD - EPS) {
                    if (unitsRaw.includes(row.unit)) {
                      isThirdParty = true;
                      break;
                    }
                  }
                }
              }
            }
          }
          
          if (isThirdParty) {
            bgColor = '#C9A400'; // Yellow for third-party
          } else {
            bgColor = marginToColor(v * 1000); // keep it dark for readability
          }
        }
        
        // Determine text color based on background for readability
        const textColor = (bgColor === '#FFFFFF' || bgColor === '#C9A400') ? '#000' : '#fff';
        // Determine small (muted) unit text color so it remains readable on yellow
        const smallColor = (bgColor === '#C9A400') ? '#000' : 'var(--muted)';
        
        return `<span class="btn" style="padding:4px 6px;margin:2px;background-color:${bgColor};color:${textColor}" data-idx="${i}">${label.replace('<small', `<small style=\"color:${smallColor}\"`)}</span>`; 
      }).join('');
      container.querySelectorAll('span.btn').forEach((el) => {
        el.addEventListener('click', () => {
          const i = Number(el.getAttribute('data-idx'));
          const s = document.getElementById('pvSlider');
          // Changing PV stop should reset any active flips
          try { clearFlips(); } catch(e) {}
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
  if (urlParams.pv !== null && urlParams.pv >= 0 && urlParams.pv < stops.length) {
    defaultIdx = Math.floor(urlParams.pv);
  }
  
  pvSlider.value = String(defaultIdx);
  const curStop = stops[defaultIdx] || 0;
  const nat = getNatMargin(y);
  const curEff = stopToEff.get(curStop) || (curStop + EPS * (curStop === 0 ? 1 : Math.sign(curStop - nat)));
  pvVal.textContent = (Math.abs(curStop - nat) < STOP_EPS ? 'Actual ' : '') + leanStr(curEff);
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
  const pv = stopToEff.get(stopVal) || (stopVal + EPS * (stopVal === 0 ? 1 : Math.sign(stopVal - nat)));
  window._curPv = pv;
  try { console.log('updateAll', {year, pvIndex, stopVal, pv, flips: (window._activeFlip && window._activeFlip.year===year) ? window._activeFlip.units.length : 0}); } catch(e){}
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
      if (year === 1968) {
        const t = +r.tp || 0; const a = 3*t - 1; const rVal = +(r.rm || 0);
        if (a > 0) { stopsForUnit.push(-rVal - a, -rVal + a); }
        else { stopsForUnit.push(-(+r.rm || 0)); }
      } else {
        stopsForUnit.push(-(+r.rm || 0));
      }
      for (const s of stopsForUnit) {
        const eff = stopToEff.get(s);
        if (eff != null && isFinite(eff) && Math.abs(pv - eff) <= STOP_EPS) {
          matches.push(unit.slice(0,5));
          break;
        }
      }
    });
  const showNat = Math.abs(stopVal - nat) <= STOP_EPS;
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
  // Count EVs, ensuring the tipping-point state is included (no black sliver)
  // Third-party EV handling for 1968: classify as Other when PV is strictly within the yellow window
  let counted = false;
  if (year === 1968) {
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
      // 1968 special pluralities: dynamic yellow window using third-party share
      let color;
      if (year === 1968) {
        const t = +r.tp || 0;
        const a = 3*t - 1;
        if (a > 0) {
          const rVal = +(r.rm || 0);
          const nD = -rVal + a - EPS;
          const nR = -rVal - a + EPS;
          if (pv > nR + EPS && pv < nD - EPS) {
            color = '#FFD700'; // yellow within the window
          } else {
            color = marginToColor(m);
          }
        } else {
          color = marginToColor(m);
        }
      } else {
        color = marginToColor(m);
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
      } catch (e) { /* ignore */ }
    }

  const totalEV = 538;
  // clamp and ensure sum displays correctly
  const dPct = Math.max(0, Math.min(100, dEV/totalEV*100));
  const oPct = Math.max(0, Math.min(100, oEV/totalEV*100));
  const rPct = Math.max(0, Math.min(100, rEV/totalEV*100));
  const dEl = document.getElementById('evFillD');
  const oEl = document.getElementById('evFillO');
  const rEl = document.getElementById('evFillR');
  if (dEl) dEl.style.width = `${dPct}%`;
  if (oEl) {
    if (year === 1968) {
      oEl.style.left = `${dPct}%`;
      oEl.style.width = `${oPct}%`;
      oEl.style.display = '';
    } else {
      oEl.style.width = '0%';
      oEl.style.display = 'none';
    }
  }
  if (rEl) rEl.style.width = `${rPct}%`;
  const evText = document.getElementById('evText');
  if (evText) evText.textContent = (year === 1968) ? `D ${dEV} | O ${oEV} | R ${rEV}` : `${dEV} - ${rEV}`;
  // Also reflect the EV split in the flip summary badge
  const flipEC = document.getElementById('flipEC');
  if (flipEC) flipEC.textContent = (year === 1968) ? `D ${dEV} | O ${oEV} | R ${rEV}` : `${dEV} - ${rEV}`;
  
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

  dbg('updateAll: ending successfully');
  }
  
  // Expose updateAll to global scope for applyFlip
  window.updateAll = updateAll;
  
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
      
      // Check for 1968 third-party scenario (yellow window)
      if (year === 1968) {
        const t = +r.tp || 0;
        const a = 3*t - 1;
        if (a > 0) {
          const rVal = +(r.rm || 0);
          const pv = window._curPv || 0;
          const currentMargin = rVal + pv;
          const nD = -rVal + a;
          const nR = -rVal - a;
          const EPS = 1e-9;
          
          // Check if current PV would place this unit in the yellow window (third-party win)
          if (pv > nR + EPS && pv < nD - EPS) {
            // Calculate third-party margin: how much third party leads by
            // In yellow window, third party has plurality. Need to calculate margin over second place.
            // The effective margin is how far into the yellow window we are
            const windowCenter = -rVal; // Center of yellow window
            const windowHalfWidth = a; // Half-width of yellow window
            const distanceFromCenter = Math.abs(pv - windowCenter);
            const relativePosition = distanceFromCenter / windowHalfWidth; // 0 to 1
            // Third party margin is strongest at center, weakest at edges
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
      html += `<tr><td>${unit}</td><td>${ev}</td><td>${d0.toLocaleString('en-US')}</td><td>${r0.toLocaleString('en-US')}</td><td>${d1.toLocaleString('en-US')}</td><td>${r1.toLocaleString('en-US')}</td><td>${(+u.votes_to_flip||0).toLocaleString('en-US')}</td></tr>`;
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

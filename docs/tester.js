
(function(){
  const PV_CAP = 0.6;
  const EPS = 1e-5;
  const STOP_EPS = 0.00005; // tolerance when matching slider to exact flip stops
  const SPECIAL_1968 = ["AL", "MS", "AR", "LA", "GA"];

  function leanStr(x){
    if (!isFinite(x)) return '';
    if (Math.abs(x) < 0.0005) return 'EVEN';
    const s = (Math.abs(x) * 100).toFixed(1);
    return (x > 0 ? 'D+' : 'R+') + s;
  }

  function marginToColor(m){
    if (m <= -0.20) return '#8B0000';
    if (m <= -0.12) return '#B22222';
    if (m <= -0.06) return '#CD5C5C';
    if (m < 0) return '#F08080';
    if (m === 0) return '#C3B1E1';
    if (m < 0.06) return '#87CEFA';
    if (m < 0.12) return '#6495ED';
    if (m < 0.20) return '#4169E1';
    return '#00008B';
  }

  const byYear = new Map();
  const evByUnit = new Map();
  // Mapping of stop -> effective test value (average of adjacent stops)
  const stopToEff = new Map();
  // Mapping of stop -> array of units that share that stop
  const stopToUnits = new Map();
  // Per-year stops array
  const stopsByYear = new Map();
  // Remap for known label mismatches between GeoJSON and CSV keys
  const UNIT_REMAP = {};

  Promise.all([
    d3.csv('presidential_margins.csv'),
    d3.csv('electoral_college.csv').catch(() => [])
  ]).then(([margins, ec]) => {
    (margins || []).forEach(r => {
      const year = +r.year;
      const unit = r.abbr;
      const rm = +r.relative_margin || 0;
      const nm = +r.national_margin || 0;
      const ev = +r.electoral_votes || 0;
      const tp = +r.third_party_share || 0;
      const row = { year, unit, rm, nm, ev, tp };
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
        return `<span class="btn" style="padding:4px 6px;margin:2px" data-idx="${i}">${label}</span>`;
      }).join('');
      container.querySelectorAll('span.btn').forEach((el) => {
        el.addEventListener('click', () => {
          const i = Number(el.getAttribute('data-idx'));
          const s = document.getElementById('pvSlider');
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
  yearSlider.addEventListener('input', () => { updateAll(); });
    pvSlider.addEventListener('input', () => updateAll());

    let y = 0; for (const k of byYear.keys()) y = Math.max(y, k);
    if (y === 0) y = 2024;
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
  pvSlider.value = String(defaultIdx);
  const curStop = stops[defaultIdx] || 0;
  const nat = getNatMargin(y);
  const curEff = stopToEff.get(curStop) || (curStop + EPS * (curStop === 0 ? 1 : Math.sign(curStop - nat)));
  pvVal.textContent = (Math.abs(curStop - nat) < STOP_EPS ? 'Actual ' : '') + leanStr(curEff);
  // set up datalist and stop chips
  buildPvStops(y, pvStops, pvStopsList);
    updateAll();
  }

  function updateAll(){
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
  const pvIndex = +pvEl.value;
  const stops = stopsByYear.get(year) || [0];
  const stopVal = (stops && stops.length > 0 && stops[pvIndex] !== undefined) ? stops[pvIndex] : 0;
  const pv = stopToEff.get(stopVal) || (stopVal + EPS * (stopVal === 0 ? 1 : Math.sign(stopVal - nat)));
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
      const m = (+r.rm || 0) + pv;
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

    d3.selectAll('path.state').each(function(d){
      const id = String(d.id).padStart(2,'0');
      const map = {"01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY"};
      const abbr = map[id];
      const entry = abbrColors.get(abbr);
      const fill = entry ? entry.color : '#2f2f2f';
      d3.select(this).attr('fill', fill);
    });

  // color district polygons (ME/NE) if overlay loaded
    if (window._districtPaths) {
      try {
        // Show/hide districts based on year availability
        const showME = year >= 1972;
        const showNE = year >= 1992;
        // Update both fill and visibility
        window._districtPaths.forEach((pSel, unit) => {
          // unit is expected like 'ME-01' or 'NE-02'
          const ucolor = unitColors.get(unit) || (abbrColors.get(unit.slice(0,2)) ? abbrColors.get(unit.slice(0,2)).color : 'transparent');
          const st = unit.slice(0,2);
          const visible = (st === 'ME' ? showME : (st === 'NE' ? showNE : true));
          try {
            pSel.attr('fill', ucolor)
                .attr('display', visible ? null : 'none');
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
  }
})();

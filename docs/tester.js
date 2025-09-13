
(function(){
  const PV_CAP = 0.25;
  const EPS = 1e-5;
  const STOP_EPS = 0.0005; // tolerance when matching slider to exact flip stops
  const SPECIAL_1968 = ["GA", "LA", "AL", "MS", "AR"];

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
      const row = { year, unit, rm, nm, ev };
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
        if (!mePath.empty()) {
          defs.append('clipPath').attr('id','clip-ME').append('use').attr('href','#state-ME');
        }
        if (!nePath.empty()) {
          defs.append('clipPath').attr('id','clip-NE').append('use').attr('href','#state-NE');
        }
        // Render districts above states so they are visible but keep pointer-events off
        const dg = window.mapG.append('g').attr('class','districts').attr('pointer-events','none');
        window._districtPaths = new Map();
        geo.features.forEach(f => {
          // prefer an explicit 'unit' property (e.g. 'ME-01'/'NE-02'), fall back to abbr or GEOID
          let unit = null;
          if (f.properties) {
            unit = f.properties.unit || f.properties.abbr || f.properties.GEOID || null;
          }
          if (!unit) return;
          const st = unit.slice(0,2);
          const clip = st === 'ME' ? 'url(#clip-ME)' : (st === 'NE' ? 'url(#clip-NE)' : null);
          const p = dg.append('path')
            .attr('class','district')
            .attr('d', window.mapPath(f))
            .attr('clip-path', clip)
            .attr('fill', 'transparent')
            .attr('stroke', '#444')
            .attr('stroke-width', 0.6)
            .attr('pointer-events', 'none');
          window._districtPaths.set(unit, p);
        });
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
    arr.forEach(r => {
      const val = -(+r.rm || 0);
      if (isFinite(val) && Math.abs(val) <= cap) {
        stopsSet.add(val);
        const prev = stopToUnits.get(val) || [];
        prev.push(r.unit);
        stopToUnits.set(val, prev);
      }
    });
    const stops = Array.from(stopsSet).sort((a,b)=>a-b);
    // compute effective test value for each stop as stop + EPS in the stop's direction
    for (let i=0;i<stops.length;i++){
      const s = stops[i];
      const sgn = (s === 0) ? 1 : Math.sign(s - nat);
      const eff = s + EPS * sgn;
      stopToEff.set(s, eff);
    }
    // store stops for the year so the slider can index into them
    stopsByYear.set(year, stops);
    if (datalist){
      datalist.innerHTML = stops.map(v => `<option value="${(v*100).toFixed(1)}"></option>`).join('');
      const s = document.getElementById('pvSlider');
      if (s) s.setAttribute('list', 'pvStopsList');
    }
    if (container){
      container.innerHTML = 'Stops: ' + stops.map((v,i) => {
        const units = (stopToUnits.get(v) || []).slice(0,3).map(u=>u.slice(0,5)).join(',');
        const label = units ? `${leanStr(v)} <small style="margin-left:6px;color:var(--muted)">${units}</small>` : leanStr(v);
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
  pvVal.textContent = leanStr(stopToEff.get(curStop) || curStop);
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
      const stop = -(+r.rm || 0);
      let eff = stopToEff.get(stop);
      if (eff == null || !isFinite(eff)) {
        const nat = getNatMargin(year);
        const sgn = (stop === 0) ? 1 : Math.sign(stop + nat);
        eff = stop - EPS * sgn;
      }
      if (isFinite(stop) && Math.abs(pv - eff) <= STOP_EPS) matches.push(unit.slice(0,2));
    });
    const matchLabel = matches.length ? ' (' + (matches.slice(0,6).join(',') + (matches.length>6 ? '…' : '')) + ')' : '';
    document.getElementById('pvVal').textContent = leanStr(pv) + matchLabel;

    buildPvStops(year, document.getElementById('pvStops'), document.getElementById('pvStopsList'));

  const arr = byYear.get(year) || [];
  const abbrColors = new Map();
  const unitColors = new Map();
  let dEV = 0, rEV = 0;
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
      if (m > EPS) dEV += ev; else if (m < -EPS) rEV += ev;
      const st = unit.slice(0,2);
      const prev = abbrColors.get(st);
      // Special handling for 1968 Wallace states: color them yellow by default
      let color = marginToColor(m);
      if (year === 1968 && Array.isArray(SPECIAL_1968) && SPECIAL_1968.indexOf(st) !== -1) {
        color = '#FFD700';
      }
  if (!prev || Math.abs(m) > Math.abs(prev.m)) abbrColors.set(st, { m, color });
  // store per-unit color so district polygons can be filled individually
  unitColors.set(unit, color);
    });

    d3.selectAll('path.state').each(function(d){
      const id = String(d.id).padStart(2,'0');
      const map = {"01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY"};
      const abbr = map[id];
      const entry = abbrColors.get(abbr);
      const fill = entry ? entry.color : '#2f2f2f';
      d3.select(this).attr('fill', fill);
    });

    // diagnostic: count how many state paths have each fill color
    try {
      const counts = {};
      d3.selectAll('path.state').each(function(){ const f = d3.select(this).attr('fill') || 'null'; counts[f] = (counts[f]||0)+1; });
      console.log('tester debug state fill counts:', counts);
    } catch (e) {}

    // color district polygons (ME/NE) if overlay loaded
    if (window._districtPaths) {
      try {
        // debug: log PV/stop and computed color maps to help trace fill leakage
        try { console.log('tester debug pv, stopVal', { pv, stopVal }); } catch(e){}
        try { console.log('tester debug abbrColors', Object.fromEntries(abbrColors.entries())); } catch(e){}
        try { console.log('tester debug unitColors', Object.fromEntries(unitColors.entries())); } catch(e){}

        // build a plain object of expected colors for districts
        try {
          const expected = {};
          window._districtPaths.forEach((pSel, unit) => { expected[unit] = unitColors.get(unit) || (abbrColors.get(unit.slice(0,2)) ? abbrColors.get(unit.slice(0,2)).color : null); });
          console.log('ME/NE expected district colors:', expected);
        } catch (e) { /* ignore logging errors */ }

        window._districtPaths.forEach((pSel, unit) => {
          // unit is expected like 'ME-01' or 'NE-02'
          const ucolor = unitColors.get(unit) || (abbrColors.get(unit.slice(0,2)) ? abbrColors.get(unit.slice(0,2)).color : 'transparent');
          try { pSel.attr('fill', ucolor); /* keep pointer-events disabled so districts don't intercept map hover/clicks */ } catch(e) {}
          // log the actual fill attribute after applying it and the path bbox for size debugging
          try {
            const real = pSel.node ? pSel.node().getAttribute('fill') : null;
            const bbox = (pSel.node && pSel.node().getBBox) ? pSel.node().getBBox() : null;
            console.log('tester debug applied district fill', unit, ucolor, real, bbox && {x:bbox.x,y:bbox.y,w:bbox.width,h:bbox.height});
          } catch(e) {}
        });
      } catch (e) { /* ignore */ }
    }

    const totalEV = 538;
    const dPct = Math.max(0, Math.min(100, dEV/totalEV*100));
    const rPct = Math.max(0, Math.min(100, rEV/totalEV*100));
    const dEl = document.getElementById('evFillD');
    const rEl = document.getElementById('evFillR');
    if (dEl) dEl.style.width = `${dPct}%`;
    if (rEl) rEl.style.width = `${rPct}%`;
    const evText = document.getElementById('evText');
    if (evText) evText.textContent = `${dEV} - ${rEV}`;
  }
})();

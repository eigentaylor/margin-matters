(function(){
  // This script generates future relative margins (2028–2048) client-side using
  // a Brownian-bridge around a 2048 target, derived from 2000–2024 trends.
  // It plugs into tester.js by writing to the same globals (byYear, evByUnit, etc.).

  const PV_CAP = 0.5;
  const EPS = 1e-8;

  // Soft clip like Python softclip(x, L)
  function softclip(x, L){ return L * Math.tanh(x / L); }
  function mean(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
  function wavg(values, weights){
    let s=0, w=0; for (let i=0;i<values.length;i++){ const vi=+values[i]||0; const wi=+weights[i]||0; s+=vi*wi; w+=wi; }
    return w ? s/w : 0;
  }
  function seedToRng(seed){
    // Simple mulberry32 PRNG for reproducibility
    let t = (seed>>>0) + 0x6D2B79F5;
    return function(){ t|=0; t = Math.imul(t ^ t>>>15, t | 1); t ^= t + Math.imul(t ^ t>>>7, t | 61); return ((t ^ t>>>14)>>>0) / 4294967296; };
  }
  function randn(rng){ // Box-Muller
    let u = 0, v = 0; while (u===0) u = rng(); while (v===0) v = rng(); return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
  }
  // Student-t with df using normal approx if df large; here df=4 in Python version
  function rand_t_df4(rng){
    // t(4) = Z / sqrt(V/4), V~ChiSq(4). ChiSq(4) = sum of 4 N(0,1)^2.
    const Z = randn(rng);
    let V=0; for (let i=0;i<4;i++){ const z = randn(rng); V += z*z; }
    return Z / Math.sqrt(V/4);
  }

  function computeSlopes(hist){
    // Ordinary least squares slope for year -> relative_margin per abbr
    const byAbbr = new Map();
    hist.forEach(r => {
      const a = r.abbr; if (!byAbbr.has(a)) byAbbr.set(a, []); byAbbr.get(a).push(r);
    });
    const out = new Map();
    byAbbr.forEach(rows => {
      rows.sort((a,b)=>a.year-b.year);
      const x = rows.map(r=>+r.year);
      const y = rows.map(r=>+r.relative_margin);
      if (new Set(x).size < 2){ out.set(rows[0].abbr, {intercept: y[y.length-1]||0, slope: 0}); return; }
      // simple polyfit via covariance
      const xbar = mean(x); const ybar = mean(y);
      let num=0, den=0; for (let i=0;i<x.length;i++){ const dx=x[i]-xbar; num += dx*(y[i]-ybar); den += dx*dx; }
      const slope = den ? num/den : 0; const intercept = ybar - slope*xbar;
      out.set(rows[0].abbr, {intercept, slope});
    });
    return out; // Map abbr -> {intercept, slope}
  }

  function buildTargets(dfAll, rng, yearsAhead=24, shrink=0.8, soft_delta_L=0.33){
    const hist = dfAll.filter(r => r.year>=2000 && r.year<=2024);
    const slopes = computeSlopes(hist);
    const base2024 = dfAll.filter(r => r.year===2024);
    const merged = base2024.map(r => ({ abbr: r.abbr, rel2024: +r.relative_margin, total_votes: +r.total_votes||0, slope: (slopes.get(r.abbr)||{slope:0}).slope||0 }));
    const drift = merged.map(()=> rand_t_df4(rng)*0.02);
    const proj_raw = merged.map((m,i)=> m.rel2024 + m.slope*yearsAhead*shrink + drift[i]);
    const center = wavg(proj_raw, merged.map(m=>m.total_votes||1));
    const proj_centered = proj_raw.map(v=> v - center);
    const delta = proj_centered.map((v,i)=> v - merged[i].rel2024);
    const delta_soft = delta.map(d=> softclip(d, soft_delta_L));
    return merged.map((m,i)=> ({ abbr: m.abbr, rel_2024: m.rel2024, rel_2048_target: m.rel2024 + delta_soft[i], total_votes: m.total_votes }));
  }

  function pcaLoadings(hist, k=3){
    // Build abbr x years matrix, mean-center rows, get U*s; normalize rows
    const byAbbr = new Map();
    const years = Array.from(new Set(hist.map(r=>r.year))).sort((a,b)=>a-b);
    hist.forEach(r => { if (!byAbbr.has(r.abbr)) byAbbr.set(r.abbr, new Map()); byAbbr.get(r.abbr).set(r.year, +r.relative_margin); });
    const abbrs = Array.from(byAbbr.keys()).filter(a => years.every(y => byAbbr.get(a).has(y)));
    const X = abbrs.map(a => years.map(y => byAbbr.get(a).get(y)));
    // mean-center rows
    X.forEach(row => { const m = mean(row); for (let i=0;i<row.length;i++) row[i] -= m; });
    if (!X.length){ return { loadMap: new Map(), k:0, abbrs:[] }; }
    const svd = numeric.svd(X);
    const U = svd.U; const S = svd.S; const L = U.map(row => row.map((v,j)=> v * (S[j]||0)).slice(0,k));
    // normalize rows
    for (let i=0;i<L.length;i++){
      let norm = Math.sqrt(L[i].reduce((s,v)=>s+v*v,0)) + 1e-12; for (let j=0;j<L[i].length;j++) L[i][j] /= norm;
    }
    const loadMap = new Map();
    for (let i=0;i<abbrs.length;i++) loadMap.set(abbrs[i], L[i]);
    return { loadMap, k: Math.min(k, (S||[]).length) };
  }

  function stateSigma(hist){
    // std dev of deltas per abbr
    const byAbbr = new Map();
    hist.sort((a,b)=> a.abbr.localeCompare(b.abbr) || a.year-b.year);
    hist.forEach(r => { if (!byAbbr.has(r.abbr)) byAbbr.set(r.abbr, []); byAbbr.get(r.abbr).push(+r.relative_margin); });
    const out = new Map();
    byAbbr.forEach((vals, a) => {
      let deltas = []; for (let i=1;i<vals.length;i++) deltas.push(vals[i]-vals[i-1]);
      const m = mean(deltas); const v = mean(deltas.map(x=> (x-m)*(x-m)));
      out.set(a, Math.sqrt(v||0) || 0.02);
    });
    return out;
  }

  function humpEarly(u){ return Math.exp(-Math.pow((u-0.35)/0.20, 2)); }

  function simulatePaths(dfAll, rng, opts){
    const { soft_delta_L=0.33, soft_value_L=0.95, years_ahead=24, shrink=0.8, n_steps=240, beta=0.8, alpha=0.45, kappa=0.25, global_scale=1.05, k_factors=3 } = (opts||{});
    const hist = dfAll.filter(r => r.year>=2000 && r.year<=2024);
    const merged = buildTargets(dfAll, rng, years_ahead, shrink, soft_delta_L);
    const base = new Map(merged.map(r => [r.abbr, r.rel_2024]));
    const { loadMap, k } = pcaLoadings(hist, k_factors);
    const sig = stateSigma(hist);
    const t_grid = Array.from({length:n_steps+1}, (_,i)=> Math.pow(i/n_steps, beta));
    const dt = t_grid.slice(1).map((v,i)=> v - t_grid[i]);
    const years = [2024,2028,2032,2036,2040,2044,2048];
    const coarse_u = years.map(y => (y-2024)/24);
    // common latent factors
    const Z = Array.from({length:n_steps}, ()=> Array.from({length:k}, ()=> randn(rng)));
    function dot(a,b){ let s=0; for (let i=0;i<a.length;i++) s+=a[i]*b[i]; return s; }
    const out = new Map(); // abbr -> { rel_2024, rel_2048_target, 2028: v, ... }
    merged.forEach(row => {
      const a = row.abbr; const y0 = row.rel_2024; const yT = row.rel_2048_target; const total = yT - y0;
      const sigma0 = sig.get(a) || 0.02; const sigma = global_scale * sigma0;
      const step_std = dt.map((d,i)=> Math.sqrt(d) * sigma * (1.0 + kappa*humpEarly(t_grid[i+1])));
      const Li = loadMap.get(a) || (k ? Array.from({length:k}, (_,j)=> j===0?1:0) : []);
      // project factors and add idio noise
      let W = 0; const Wseq = [];
      for (let i=0;i<n_steps;i++){
        const proj = k ? dot(Z[i], Li) : 0;
        const idio = randn(rng);
        const inc = step_std[i] * (alpha*proj + Math.sqrt(Math.max(1e-9, 1.0 - alpha*alpha))*idio);
        W += inc; Wseq.push(W);
      }
      const B = Wseq.map((w,i)=> w - t_grid[i+1]*Wseq[Wseq.length-1]);
      const straight = t_grid.slice(1).map(u => y0 + total*u);
      const path = straight.map((v,i)=> v + B[i]);
      const rec = { abbr: a, rel_2024: y0, rel_2048_target: yT };
      function nearestIdx(u){
        let bestI=1, bestD=1e9; for (let i=0;i<t_grid.length;i++){ const d=Math.abs(t_grid[i]-u); if (d<bestD){bestD=d; bestI=i;} }
        return Math.max(1, Math.min(bestI, n_steps))-1; // index for path[]
      }
      [2028,2032,2036,2040,2044].forEach((Y,ix)=>{
        const u = coarse_u[ix+1]; const i = nearestIdx(u); let v = path[i]; v = softclip(v, soft_value_L); rec[Y] = v;
      });
      rec[2048] = softclip(yT, soft_value_L);
      out.set(a, rec);
    });
    return out; // Map abbr -> record
  }

  async function loadHistorical(){
    const margins = await d3.csv('presidential_margins.csv');
    const ec = await d3.csv('electoral_college.csv').catch(()=>[]);
    // Filter out national rows for hist generation
    const filtered = margins.filter(r => r.abbr && !(r.abbr==='US'||r.abbr==='USA'||r.abbr==='National'||r.abbr==='NATIONAL'||r.unit==='NATIONAL'))
      .map(r => ({
        abbr: r.abbr,
        year: +r.year,
        relative_margin: +r.relative_margin || 0,
        total_votes: +r.total_votes || 0,
        // keep tp for color window reuse in tester.js
        third_party_share: +r.third_party_share || 0
      }));
    // EV by year/unit map; we will use 2024 EVs for future years
    const evByUnit = new Map();
    (ec||[]).forEach(e => { const y=+e.year; const u=e.abbr; const ev=+e.electoral_votes; if (y && u) evByUnit.set(`${y}:${u}`, ev); });
    // fallback: take 2024 from margins if present
    (margins||[]).forEach(r => { const y=+r.year; if (y!==2024) return; const u=r.abbr; const ev=+r.electoral_votes; if (u && ev && !evByUnit.has(`2024:${u}`)) evByUnit.set(`2024:${u}`, ev); });
    return { filtered, margins, evByUnit };
  }

  function applyAtLarge(outMap, totals2024){
    // Compute ME-AL/NE-AL as weighted avg of districts if districts exist
    function setAL(prefix){
      const dists = Array.from(outMap.keys()).filter(a => a.startsWith(prefix+'-') && a!==`${prefix}-AL`).sort();
      if (!dists.length) return;
      const wts = dists.map(d => totals2024.get(d) || 1);
      const rec = { abbr: `${prefix}-AL` };
      [2024,2028,2032,2036,2040,2044,2048].forEach(Y => {
        const vals = dists.map(d => {
          const rd = (outMap.get(d)||{});
          // For 2024, use rel_2024 from the simulated record; otherwise use the year key
          return (Y === 2024) ? rd.rel_2024 : rd[Y];
        });
        rec[Y] = wavg(vals, wts);
      });
      // Ensure rel_2024 and rel_2048_target fields are present on the AL record to match other records
      if (isFinite(rec[2024])) rec.rel_2024 = rec[2024];
      if (isFinite(rec[2048])) rec.rel_2048_target = rec[2048];
      // Debug: log district composition and computed at-large values for 2024
      try {
        const dbgVals = dists.map((d, i) => ({ dist: d, ev: (totals2024.get(d)||0), rel2024: (outMap.get(d)||{}).rel_2024 }));
        console.log(`[future] applyAtLarge ${prefix}: districts=`, dbgVals);
        console.log(`[future] applyAtLarge ${prefix}: computed AL rel_2024=`, rec[2024]);
      } catch(e) {}
      outMap.set(`${prefix}-AL`, rec);
    }
    setAL('ME'); setAL('NE');
  }

  function buildFutureDataset(histAll, paths, marginsAll, evMap){
    // Create rows for each future year with fields expected by tester.js: {year, unit, rm, nm, ev, tp, dVotes, rVotes, tVotes, total}
    const byYear = new Map();
  const years = [2024,2028,2032,2036,2040,2044,2048];
    const totals2024 = new Map();
  marginsAll.forEach(r => { if (+r.year===2024) totals2024.set(r.abbr, +r.total_votes||0); });
    // compute at-large from districts if needed
    applyAtLarge(paths, totals2024);
    // national margin for 2024 baseline
    function natMargin2024(){
      // Prefer explicit NATIONAL row if present
      const natRow = marginsAll.find(r => +r.year===2024 && (r.abbr==='NATIONAL' || r.unit==='NATIONAL' || r.abbr==='US' || r.abbr==='USA' || r.abbr==='National'));
      if (natRow && isFinite(+natRow.national_margin)) return +natRow.national_margin;
      // Fallback: compute from two-party votes if available; else weighted avg of per-row national_margin
      const rows = marginsAll.filter(r=>+r.year===2024 && r.abbr && r.abbr!=='NATIONAL');
      let d=0, r=0; rows.forEach(x=>{ d += (+x.D_votes||0); r += (+x.R_votes||0); });
      if ((d+r)>0){ return (d - r) / (d + r); }
      const w = rows.map(r=> +r.total_votes||0); const v = rows.map(r=> +r.national_margin || 0);
      return wavg(v, w) || 0;
    }
    const nat2024 = natMargin2024();
    years.forEach(Y => {
      const rows = [];
      // build national row as weighted avg of states with nat margin set to 0.0 in future mode
      let wts=[], vals=[];
      if (Y === 2024) {
        // Use actual 2024 rows from marginsAll
        const natRow = marginsAll.find(r => +r.year===2024 && (r.abbr==='NATIONAL' || r.unit==='NATIONAL'));
        const nat = (natRow && isFinite(+natRow.national_margin)) ? +natRow.national_margin : nat2024;
        const natD = +((natRow && natRow.D_votes) || 0);
        const natR = +((natRow && natRow.R_votes) || 0);
        const natT = +((natRow && natRow.T_votes) || 0);
        const natTot = +((natRow && natRow.total_votes) || (natD+natR+natT) || 0);
        rows.push({year:Y, unit:'NATIONAL', rm:0, nm:nat, ev:0, tp:0, dVotes:natD, rVotes:natR, tVotes:natT, total:natTot});
      } else {
        paths.forEach((rec, abbr) => { const tv = totals2024.get(abbr)||1; const val = rec[Y]; if (isFinite(val)) { wts.push(tv); vals.push(val + 0.0); } });
        const nat = 0.0; // explicitly set future national margin to 0.0
        rows.push({ year:Y, unit:'NATIONAL', rm:0, nm:nat, ev:0, tp:0, dVotes:0, rVotes:0, tVotes:0, total: wts.reduce((a,b)=>a+b,0) });
      }
      // make per-unit rows
      paths.forEach((rec, abbr) => {
        const rm = (Y === 2024) ? rec.rel_2024 : rec[Y]; // relative margin (use rel_2024 for 2024)
        const nm = (Y===2024 ? nat2024 : 0.0); // future national margin = 0.0; 2024 uses actual
        // keep third-party share from 2024 for color windows; fallback to 0
        const tpRow = marginsAll.find(r => +r.year===2024 && r.abbr===abbr);
        const tp = tpRow ? (+tpRow.third_party_share||0) : 0;
        // EV: reuse 2024 mapping
        const ev = evMap.get(`2024:${abbr}`) || 0;
        rows.push({ year:Y, unit:abbr, rm: rm, nm: nm, ev: ev, tp: tp, dVotes:0, rVotes:0, tVotes:0, total: totals2024.get(abbr)||0 });
      });
      byYear.set(Y, rows);
    });
    return byYear;
  }

  async function generate(seed){
    const { filtered, margins, evByUnit } = await loadHistorical();
    const rng = seedToRng(seed);
    const paths = simulatePaths(filtered, rng, {}); // Map abbr -> record with future years
    // plug into tester.js global maps
    const BY = buildFutureDataset(filtered, paths, margins, evByUnit);
    // Clear any previous future years then set
  const years = [2024,2028,2032,2036,2040,2044,2048];
  years.forEach(Y => { window._byYearMap && window._byYearMap.set(Y, BY.get(Y)); });
    // EV map for years (use 2024 values)
    years.forEach(Y => {
      const rows = BY.get(Y) || [];
      rows.forEach(r => { if (r.unit && r.ev!=null) window._evByUnitMap && window._evByUnitMap.set(`${Y}:${r.unit}`, r.ev); });
    });

    // Ensure ME-AL and NE-AL stops are present in the by-year rows (they should have been created by applyAtLarge)
    // If applyAtLarge produced ME-AL/NE-AL in paths, they will be included already by buildFutureDataset; however
    // when evMap originates from electoral_college.csv, make sure the window EV map includes these AL keys for 2024.
    ['ME-AL','NE-AL'].forEach(al => {
      const ev = evByUnit.get(`2024:${al}`);
      if (ev != null) {
        // ensure mapping exists for every year
        years.forEach(Y => { window._evByUnitMap && window._evByUnitMap.set(`${Y}:${al}`, ev); });
      }
    });
    // total EV per year
    if (!window._totalEvByYear) window._totalEvByYear = new Map();
    years.forEach(Y => {
      const rows = BY.get(Y) || []; const tot = rows.reduce((s,r)=> s + (+r.ev||0), 0);
      window._totalEvByYear.set(Y, tot || 538);
    });

    // Debug: inspect 2024 data loading and margins
    try {
      const rows2024 = BY.get(2024) || [];
      const nonNat = rows2024.filter(r => r && r.unit !== 'NATIONAL');
      const undefRm = nonNat.filter(r => !isFinite(r.rm)).length;
      const zeroRm = nonNat.filter(r => isFinite(r.rm) && Math.abs(r.rm) < 1e-12).length;
      const sample = ['PA','WI','MI','AZ','GA','NV'].map(u => nonNat.find(r=>r.unit===u)).filter(Boolean);
      console.log('[future] 2024 rows:', rows2024.length, 'nonNat:', nonNat.length, 'undef rm:', undefRm, 'zero rm:', zeroRm);
      console.log('[future] 2024 NATIONAL row:', rows2024.find(r=>r.unit==='NATIONAL'));
      console.log('[future] 2024 sample states:', sample);
    } catch(e) { console.warn('[future] debug 2024 inspection failed', e); }

    // Debug: show ME/NE EV composition for 2024 and total EVs for verification
    try {
      const rows2024 = BY.get(2024) || [];
      const units = new Map(rows2024.map(r => [r.unit, r]));
      const me01 = units.get('ME-01'); const me02 = units.get('ME-02'); const meAL = units.get('ME-AL');
      const ne01 = units.get('NE-01'); const ne02 = units.get('NE-02'); const ne03 = units.get('NE-03'); const neAL = units.get('NE-AL');
      console.log('[future] ME 2024 EVs: ME-01 ev=', me01 && me01.ev, 'ME-02 ev=', me02 && me02.ev, 'ME-AL ev=', meAL && meAL.ev);
      console.log('[future] NE 2024 EVs: NE-01 ev=', ne01 && ne01.ev, 'NE-02 ev=', ne02 && ne02.ev, 'NE-03 ev=', ne03 && ne03.ev, 'NE-AL ev=', neAL && neAL.ev);
      const totalEV = rows2024.reduce((s,r)=> s + (+r.ev||0), 0);
      console.log('[future] 2024 total EV sum from BY:', totalEV);
    } catch(e) { console.warn('[future] debug ME/NE EV inspection failed', e); }

    // Allocation debug: for each year, list each unit, its rm, ev and which party wins those EVs; aggregate per-year totals
    try {
      years.forEach(Y => {
        const rows = BY.get(Y) || [];
        let demEV = 0, repEV = 0, tieEV = 0;
        const allocations = rows.map(r => {
          const unit = r.unit || r.abbr || '?';
          const rm = (r && isFinite(r.rm)) ? r.rm : (r && isFinite(r.rel_2024) ? r.rel_2024 : 0);
          const ev = +r.ev || 0;
          let winner = 'TIE';
          if (rm > 0) { winner = 'D'; demEV += ev; }
          else if (rm < 0) { winner = 'R'; repEV += ev; }
          else { tieEV += ev; }
          return { unit, year: Y, rm, ev, winner };
        });
        console.log(`[future] allocation ${Y}: totals D=${demEV} R=${repEV} TIE=${tieEV}`);
        // Also print ME/NE AL winners explicitly if present
        const meal = allocations.find(a => a.unit === 'ME-AL'); const neal = allocations.find(a => a.unit === 'NE-AL');
        if (meal) console.log(`[future] ${Y} ME-AL: rm=${meal.rm} ev=${meal.ev} winner=${meal.winner}`);
        if (neal) console.log(`[future] ${Y} NE-AL: rm=${neal.rm} ev=${neal.ev} winner=${neal.winner}`);
        // For verbosity, only log allocations for small list of battleground units
        const sampleUnits = ['ME-AL','NE-AL','ME-02','NE-02','PA','WI','MI','AZ','GA','NV'];
        const sampleAlloc = allocations.filter(a => sampleUnits.includes(a.unit));
        if (sampleAlloc.length) console.log(`[future] ${Y} sample allocations:`, sampleAlloc);
      });
    } catch(e) { console.warn('[future] allocation debug failed', e); }
  }

  // UI wiring
  async function runWithSeed(seed){
    await generate(seed);
    // default year 2028, build stops via tester.js and render
    const yEl = document.getElementById('yearSlider'); if (yEl) yEl.value = '2028';
    const y = 2028;
    if (typeof window.updateAll === 'function'){
      // ensure stops built for this year
      try {
        const pvStops = document.getElementById('pvStops');
        const pvStopsList = document.getElementById('pvStopsList');
        if (typeof window._stopsByYear !== 'undefined' && typeof window._getNatMargin === 'function'){
          // tester.js will recompute inside updateAll, but build explicitly once for labels
          const fn = window.buildPvStops || null; // not exported; rely on updateAll
        }
      } catch(e) {}
      window.updateAll();
    }
  }

  function getUrlParams(){ const p=new URLSearchParams(location.search); return { seed: p.get('seed') ? parseInt(p.get('seed')) : null, year: p.get('year') ? parseInt(p.get('year')) : null, pv: p.get('pv') ? parseInt(p.get('pv')) : null }; }
  function updateUrl(params){ const url=new URL(location); Object.entries(params).forEach(([k,v])=>{ if (v===null||v===undefined) url.searchParams.delete(k); else url.searchParams.set(k, v); }); history.replaceState({},'',url); }

  // Initialize controls
  window.addEventListener('DOMContentLoaded', async () => {
    const seedInput = document.getElementById('seedInput');
    const genBtn = document.getElementById('genBtn');
    const randBtn = document.getElementById('randBtn');
    const shareBtn = document.getElementById('shareBtn');
    const yearSlider = document.getElementById('yearSlider');
    const pvSlider = document.getElementById('pvSlider');
    const pvText = document.getElementById('pvText');
    const pvPreset = document.getElementById('pvPreset');
    const pvApply = document.getElementById('pvApply');
    const pvFlip = document.getElementById('pvFlip');
    const pvClear = document.getElementById('pvClear');

  const params = getUrlParams();
  const todaySeed = (function(){ try { const d = new Date(); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const da=String(d.getDate()).padStart(2,'0'); return parseInt(`${y}${m}${da}`); } catch(e){ return 20250101; } })();
  const seed = (params.seed && !isNaN(params.seed)) ? params.seed : todaySeed;
    if (seedInput) seedInput.value = String(seed);

    await runWithSeed(seed);

    // apply URL year/pv if present
    if (params.year && yearSlider){ yearSlider.value = String(params.year); }
    if (params.pv!=null && pvSlider){ pvSlider.value = String(params.pv); }
    if (typeof window.updateAll === 'function') window.updateAll();

    if (genBtn) genBtn.addEventListener('click', async () => {
      const s = parseInt(seedInput.value) || 0; updateUrl({seed:s}); await runWithSeed(s);
    });
    if (randBtn) randBtn.addEventListener('click', async () => {
      const s = Math.floor(Math.random()*1e8);
      if (seedInput) seedInput.value = String(s);
      updateUrl({seed:s});
      await runWithSeed(s);
    });
    if (shareBtn) shareBtn.addEventListener('click', () => {
      const yEl = document.getElementById('yearSlider'); const pvEl = document.getElementById('pvSlider');
      const y = yEl ? parseInt(yEl.value) : null; const pv = pvEl ? parseInt(pvEl.value) : null; const seed = parseInt(seedInput.value)||0;
      updateUrl({seed, year:y, pv});
      shareBtn.textContent = 'Copied!';
      try { navigator.clipboard.writeText(window.location.href); } catch(e){}
      setTimeout(()=> shareBtn.textContent='Share', 1200);
    });

    if (yearSlider) yearSlider.addEventListener('input', () => {
      const y = parseInt(yearSlider.value); const pvEl=document.getElementById('pvSlider'); const pv = pvEl? parseInt(pvEl.value):0; const seed = parseInt(seedInput.value)||0; updateUrl({seed, year:y, pv}); if (typeof window.updateAll==='function') window.updateAll();
    });
    if (pvSlider) pvSlider.addEventListener('input', () => {
      const yEl = document.getElementById('yearSlider'); const y = yEl? parseInt(yEl.value):null; const pv = parseInt(pvSlider.value); const seed = parseInt(seedInput.value)||0; updateUrl({seed, year:y, pv}); if (typeof window.updateAll==='function') window.updateAll();
    });

    // PV override handlers
    function parsePvText(txt){
      if (!txt) return null;
      txt = String(txt).trim().toUpperCase();
      if (txt === 'EVEN' || txt === '0' || txt === 'D+0' || txt === 'R+0') return 0;
      // D+4.5 or R+1.6
      let m = txt.match(/^([DR])\s*\+\s*([0-9]*\.?[0-9]+)$/);
      if (m) { const sign = (m[1] === 'D') ? 1 : -1; return sign * (parseFloat(m[2])/100); }
      // raw decimal like 0.045 or -0.016
      if (!isNaN(parseFloat(txt))) return parseFloat(txt);
      return null;
    }
    function clampPv(x){ if (!isFinite(x)) return 0; return Math.max(-PV_CAP, Math.min(PV_CAP, x)); }

    function applyPvOverride(val){
      const yearEl = document.getElementById('yearSlider');
      const y = yearEl ? parseInt(yearEl.value) : 2028;
      // store override globally and update
      window._pvOverride = clampPv(val);
      // When overriding, do not show 'Actual' label; tester.js will hide when override is set
      if (typeof window.updateAll === 'function') window.updateAll();
      // Move pv slider to nearest stop purely for UI alignment, but keep override active
      try {
        const stops = (window._stopsByYear && window._stopsByYear.get(y)) || [0];
        let best=0, bestD=1e9; stops.forEach((s,idx)=>{ const d=Math.abs(s - window._pvOverride); if (d<bestD){bestD=d; best=idx;} });
        const sEl = document.getElementById('pvSlider'); if (sEl) sEl.value = String(best);
      } catch(e) {}
    }

    if (pvApply) pvApply.addEventListener('click', () => {
      const v = parsePvText(pvText && pvText.value);
      if (v == null) return;
      applyPvOverride(v);
    });
    if (pvPreset) pvPreset.addEventListener('change', () => {
      const v = parseFloat(pvPreset.value);
      if (!isNaN(v)) { if (pvText) pvText.value = (v>=0?`D+${(v*100).toFixed(1)}`:`R+${(Math.abs(v)*100).toFixed(1)}`); applyPvOverride(v); }
    });
    if (pvFlip) pvFlip.addEventListener('click', () => {
      let cur = 0;
      if (typeof window._pvOverride === 'number' && isFinite(window._pvOverride)) cur = window._pvOverride;
      else {
        const yearEl = document.getElementById('yearSlider'); const y = yearEl? parseInt(yearEl.value):2028;
        const pvEl = document.getElementById('pvSlider');
        const stops = (window._stopsByYear && window._stopsByYear.get(y)) || [0];
        const idx = pvEl? parseInt(pvEl.value):0; const stopVal = stops[idx] || 0;
        cur = stopVal;
      }
      applyPvOverride(-cur);
      if (pvText) pvText.value = (cur<=0?`D+${(Math.abs(cur)*100).toFixed(1)}`:`R+${(Math.abs(cur)*100).toFixed(1)}`);
    });
    if (pvClear) pvClear.addEventListener('click', () => {
      window._pvOverride = null;
      if (pvText) pvText.value = '';
      if (typeof window.updateAll === 'function') window.updateAll();
    });
  });
})();

// Shared site state helpers for query strings, sharing, and formatting
(function(global){
  const DEFAULTS = {
    yearStart: 1968,
    yearEnd: new Date().getFullYear(),
    metric: 'relative', // margin|relative|delta|twoparty|thirdparty
    chart: 'line',
    denom: 'all', // all|twoParty
    smooth: 0,
    overlay: 'nat', // nat|none
    states: []
  };

  function parseQuery(qs){
    const q = new URLSearchParams(qs || window.location.search);
    const statesStr = q.get('states') || '';
    const yearStart = +(q.get('yearStart') || DEFAULTS.yearStart);
    const yearEnd = +(q.get('yearEnd') || DEFAULTS.yearEnd);
    return {
      yearStart,
      yearEnd,
      metric: q.get('metric') || DEFAULTS.metric,
      chart: q.get('chart') || DEFAULTS.chart,
      denom: q.get('denom') || DEFAULTS.denom,
      smooth: +(q.get('smooth') || DEFAULTS.smooth),
      overlay: q.get('overlay') || DEFAULTS.overlay,
      states: statesStr ? statesStr.split(',').filter(Boolean) : DEFAULTS.states.slice(),
    };
  }

  function updateQuery(partial){
    const cur = parseQuery();
    const next = Object.assign({}, cur, partial || {});
    const q = new URLSearchParams();
    if (next.yearStart != null) q.set('yearStart', String(next.yearStart));
    if (next.yearEnd != null) q.set('yearEnd', String(next.yearEnd));
    if (next.metric) q.set('metric', next.metric);
    if (next.chart) q.set('chart', next.chart);
    if (next.denom) q.set('denom', next.denom);
    if (next.smooth != null) q.set('smooth', String(next.smooth));
    if (next.overlay) q.set('overlay', next.overlay);
    if (Array.isArray(next.states) && next.states.length) q.set('states', next.states.join(','));
    const url = `${location.pathname}?${q.toString()}`;
    history.replaceState(null, '', url);
    return next;
  }

  function setAndPushState(partial){
    const cur = parseQuery();
    const next = Object.assign({}, cur, partial || {});
    const q = new URLSearchParams();
    Object.entries(next).forEach(([k,v]) => {
      if (v == null) return;
      if (Array.isArray(v)) q.set(k, v.join(','));
      else q.set(k, String(v));
    });
    const url = `${location.pathname}?${q.toString()}`;
    history.pushState(next, '', url);
    return next;
  }

  function debounce(fn, ms){
    let t=null; return function(){
      const ctx=this, args=arguments; clearTimeout(t);
      t=setTimeout(()=>fn.apply(ctx,args), ms||100);
    };
  }

  function formatMargin(x){
    if (x == null || !isFinite(x)) return '';
    if (Math.abs(x) < 1e-6) return 'EVEN';
    const s = (Math.abs(x) * 100).toFixed(1);
    return (x>0? 'D+':'R+') + s;
  }

  function colorForMargin(v, isRelative){
    // basic stepped palette; relative mode uses stronger blues/reds around zero
    const x = +v;
    if (!isFinite(x)) return '#999';
    const m = isRelative ? x : x; // identical now; keep hook for future tweak
    if (m <= -0.20) return '#8B0000';
    if (m <= -0.10) return '#B22222';
    if (m <= -0.05) return '#CD5C5C';
    if (m < -0.01) return '#F08080';
    if (m < 0) return '#FFC0CB';
    if (m < 0.01) return '#8aa7ba';
    if (m < 0.05) return '#87CEFA';
    if (m < 0.10) return '#6495ED';
    if (m < 0.20) return '#4169E1';
    return '#00008B';
  }

  const eraPresets = [
    { label:'1916–1932', start:1916, end:1932 },
    { label:'1932–1964', start:1932, end:1964 },
    { label:'1968–1992', start:1968, end:1992 },
    { label:'1992–2008', start:1992, end:2008 },
    { label:'2008–present', start:2008, end:DEFAULTS.yearEnd },
    { label:'2012–present', start:2012, end:DEFAULTS.yearEnd },
    { label:'2016–present', start:2016, end:DEFAULTS.yearEnd },
    { label:'2020–present', start:2020, end:DEFAULTS.yearEnd },
  ];

  function copyCurrentUrl(){
    const txt = window.location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(()=>{
        // no-op; could toast
      }).catch(()=>{});
    }
    return txt;
  }

  global.SiteState = {
    DEFAULTS,
    parseQuery,
    updateQuery,
    setAndPushState,
    debounce,
    formatMargin,
    colorForMargin,
    eraPresets,
    copyCurrentUrl
  };
})(window);

(function(){
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

  const ID_TO_ABBR = {"01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY"};

  const ElectionMap = {
    statePaths: new Map(),
    districtPaths: new Map(),
    _handlers: { state:{}, district:{} },
    setStateFill(abbr, color){
      try {
        const sel = this.statePaths.get(abbr);
        if (!sel) return;
        try {
          sel.transition().duration(250).attrTween('fill', function(){
            const cur = d3.select(this).attr('fill') || '#2f2f2f';
            return d3.interpolateRgb(cur, color || '#2f2f2f');
          });
        } catch(e){ sel.attr('fill', color || '#2f2f2f'); }
      } catch(e) {}
    },
    setDistrictFill(unit, color){
      try {
        const sel = this.districtPaths.get(unit);
        if (!sel) return;
        try {
          sel.transition().duration(250).attrTween('fill', function(){
            const cur = d3.select(this).attr('fill') || 'transparent';
            return d3.interpolateRgb(cur, color || 'transparent');
          });
        } catch(e){ sel.attr('fill', color || 'transparent'); }
      } catch(e) {}
    },
    async build(opts){
      const svgSelector = (opts && opts.svgSelector) || '#map';
      const topoUrl = (opts && opts.topoUrl) || 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';
      const districtGeoUrl = opts && opts.districtGeoUrl; // optional
      this._handlers.state = (opts && opts.stateHandlers) || {};
      this._handlers.district = (opts && opts.districtHandlers) || {};

      const svg = d3.select(svgSelector);
      if (svg.empty()) { console.warn('[ElectionMap] svg not found:', svgSelector); return; }
      svg.selectAll('*').remove();
      // main group for layers
      const g = svg.append('g');
      // expose for other modules for maximum compatibility
      window.mapG = g;
      const projection = d3.geoAlbersUsa().scale(1300).translate([975/2, 610/2]);
      const geoPath = d3.geoPath().projection(projection);
      window.mapPath = geoPath;

      const us = await d3.json(topoUrl);
      const states = topojson.feature(us, us.objects.states).features;

      const self = this;
      g.selectAll('path.state')
        .data(states)
        .join('path')
        .attr('class','state')
        .attr('id', d => {
          const abbr = ID_TO_ABBR[String(d.id).padStart(2,'0')];
          return abbr ? `state-${abbr}` : null;
        })
        .attr('d', geoPath)
        .attr('fill', '#2f2f2f')
        .attr('stroke', '#1f1f1f')
        .attr('stroke-width', 0.6)
        .attr('stroke-linejoin','round')
        .attr('stroke-linecap','round')
        .on('click', function(evt, d){
          try {
            const abbr = ID_TO_ABBR[String(d.id).padStart(2,'0')];
            if (self._handlers.state && typeof self._handlers.state.click === 'function') self._handlers.state.click(evt, abbr);
          } catch(e) {}
        })
        .on('mouseenter', function(evt, d){
          try {
            const abbr = ID_TO_ABBR[String(d.id).padStart(2,'0')];
            if (self._handlers.state && typeof self._handlers.state.mouseenter === 'function') self._handlers.state.mouseenter(evt, abbr);
          } catch(e) {}
        })
        .on('mousemove', function(evt){ try { if (self._handlers.state && typeof self._handlers.state.mousemove === 'function') self._handlers.state.mousemove(evt); } catch(e){} })
        .on('mouseleave', function(evt){ try { if (self._handlers.state && typeof self._handlers.state.mouseleave === 'function') self._handlers.state.mouseleave(evt); } catch(e){} });

      // boundary mesh
      try {
        const mesh = topojson.mesh(us, us.objects.states, (a,b)=>a!==b);
        g.append('path')
          .datum(mesh)
          .attr('fill','none')
          .attr('stroke','#ffffff')
          .attr('stroke-width', 1.0)
          .attr('stroke-linejoin','round')
          .attr('stroke-linecap','round')
          .attr('pointer-events','none')
          .attr('class','state-boundaries')
          .attr('d', geoPath);
      } catch(e) {}

      // cache state path selections
      g.selectAll('path.state').each(function(d){
        try {
          const abbr = ID_TO_ABBR[String(d.id).padStart(2,'0')];
          if (abbr) self.statePaths.set(abbr, d3.select(this));
        } catch(e) {}
      });

      // Dispatch mapReady for consumers relying on this hook
      try { window.dispatchEvent(new Event('mapReady')); } catch(e) {}

      // Load optional district overlay for ME/NE
      if (districtGeoUrl) {
        try { await this._loadDistricts(districtGeoUrl); } catch(e){ console.warn('[ElectionMap] district overlay failed:', e); }
      }
    },
    async _loadDistricts(geoUrl){
      const svg = d3.select('#map');
      const defs = svg.select('defs').empty() ? svg.append('defs') : svg.select('defs');
      const mePath = d3.select('#state-ME');
      const nePath = d3.select('#state-NE');
      if (!mePath.empty()) {
        const d = mePath.attr('d');
        const cp = defs.select('#clip-ME').empty() ? defs.append('clipPath').attr('id','clip-ME') : defs.select('#clip-ME');
        cp.selectAll('*').remove();
        cp.append('path').attr('d', d);
      }
      if (!nePath.empty()) {
        const d = nePath.attr('d');
        const cp = defs.select('#clip-NE').empty() ? defs.append('clipPath').attr('id','clip-NE') : defs.select('#clip-NE');
        cp.selectAll('*').remove();
        cp.append('path').attr('d', d);
      }

      const geo = await d3.json(geoUrl);
      const dg = window.mapG.append('g').attr('class','districts').attr('pointer-events','auto');
      const feats = (geo && geo.features) ? geo.features.slice() : [];
      try {
        feats.sort((a, b) => {
          const getUnit = (f) => (f.properties && (f.properties.unit || f.properties.abbr || f.properties.GEOID)) || null;
          const au = getUnit(a); const bu = getUnit(b);
          const aState = au ? au.slice(0,2) : null; const bState = bu ? bu.slice(0,2) : null;
          if (aState === 'ME' && bState === 'ME') { try { return window.mapPath.area(b) - window.mapPath.area(a); } catch(e){ return 0; } }
          if (aState === 'NE' && bState === 'NE') { try { return window.mapPath.area(a) - window.mapPath.area(b); } catch(e){ return 0; } }
          try { return window.mapPath.area(b) - window.mapPath.area(a); } catch(e){ return 0; }
        });
      } catch(e) {}

      const UNIT_REMAP = {};
      const districtDByUnit = new Map();
      const self = this;
      feats.forEach(f => {
        let unit = null; if (f.properties) unit = f.properties.unit || f.properties.abbr || f.properties.GEOID || null; if (!unit) return;
        const useUnit = (unit.match(/^(ME|NE)-0[123]$/)) ? unit : (UNIT_REMAP[unit] || unit);
        const st = useUnit.slice(0,2);
        const clip = st === 'ME' ? 'url(#clip-ME)' : (st === 'NE' ? 'url(#clip-NE)' : null);
        let dStr = window.mapPath(f);
        if (dStr && dStr.startsWith('M-104,-4.4L1079,-4.4L1079,614.4L-104,614.4Z')) {
          dStr = dStr.replace(/^M-104,-4\.4L1079,-4\.4L1079,614\.4L-104,614\.4Z/, '');
        }
        if (useUnit && dStr) districtDByUnit.set(useUnit, dStr);

        // halo
        dg.append('path')
          .attr('class','district-halo')
          .attr('id', `halo-${useUnit}`)
          .attr('d', dStr)
          .attr('clip-path', clip)
          .attr('fill','none')
          .attr('stroke','#000')
          .attr('stroke-opacity',0.35)
          .attr('stroke-width',2.2)
          .attr('pointer-events','none');

        const p = dg.append('path')
          .attr('class','district')
          .attr('id', `district-${useUnit}`)
          .attr('d', dStr)
          .attr('clip-path', clip)
          .attr('fill','transparent')
          .attr('stroke','#BBBBBB')
          .attr('stroke-width',1.2)
          .attr('stroke-linejoin','round')
          .attr('stroke-linecap','round')
          .attr('data-unit', useUnit)
          .attr('data-st', st)
          .attr('pointer-events','auto')
          .on('click', function(evt){ try { if (self._handlers.district && typeof self._handlers.district.click === 'function') self._handlers.district.click(evt, useUnit); } catch(e){} })
          .on('mouseenter', function(evt){ try { if (self._handlers.district && typeof self._handlers.district.mouseenter === 'function') self._handlers.district.mouseenter(evt, useUnit); } catch(e){} })
          .on('mousemove', function(evt){ try { if (self._handlers.district && typeof self._handlers.district.mousemove === 'function') self._handlers.district.mousemove(evt); } catch(e){} })
          .on('mouseleave', function(evt){ try { if (self._handlers.district && typeof self._handlers.district.mouseleave === 'function') self._handlers.district.mouseleave(evt); } catch(e){} });

        self.districtPaths.set(useUnit, p);
      });

      // Mask to avoid NE-03 overlapping smaller districts
      try {
        const svg = d3.select('#map');
        const defs = svg.select('defs');
        const ne03 = districtDByUnit.get('NE-03');
        if (ne03 && !defs.empty()) {
          const m = defs.select('#mask-NE-03').empty() ? defs.append('mask').attr('id','mask-NE-03') : defs.select('#mask-NE-03');
          m.attr('maskUnits','userSpaceOnUse').attr('x',0).attr('y',0).attr('width',975).attr('height',610);
          m.selectAll('*').remove();
          m.append('rect').attr('x',0).attr('y',0).attr('width',975).attr('height',610).attr('fill','#fff');
          const cut02 = districtDByUnit.get('NE-02');
          const cut01 = districtDByUnit.get('NE-01');
          if (cut02) m.append('path').attr('d', cut02).attr('fill', '#000');
          if (cut01) m.append('path').attr('d', cut01).attr('fill', '#000');
          const p03 = this.districtPaths.get('NE-03');
          if (p03) p03.attr('mask', 'url(#mask-NE-03)');
          const h03 = d3.select('#halo-NE-03');
          if (!h03.empty()) h03.attr('mask', 'url(#mask-NE-03)');
        }
      } catch(e) {}

      try { d3.select('svg#map').select('g').select('.state-boundaries').raise(); } catch(e) {}
    }
  };

  try { window.ElectionMap = ElectionMap; } catch(e) {}
})();

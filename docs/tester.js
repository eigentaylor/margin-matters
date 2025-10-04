(function () {
  // Use shared constants and utilities from modules if available
  const PV_CAP = (window.ElectionConstants && window.ElectionConstants.PV_CAP) || 0.5;
  const EPS = (window.ElectionConstants && window.ElectionConstants.EPS) || 1e-8;
  const STOP_EPS = 0.000005; // tolerance when matching slider to exact flip stops
  const STOP_KEY_PREC = 6;   // rounding precision for matching stops to CSV
  
  // Use constants from shared module if available
  const ID_TO_ABBR = (window.ElectionConstants && window.ElectionConstants.ID_TO_ABBR) || 
    { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY" };
  const SMALL_STATES = (window.ElectionConstants && window.ElectionConstants.SMALL_STATES) || 
    new Set(["MA", "RI", "CT", "NJ", "DE", "MD", "DC", "NH", "VT"]);

  // Use shared EV allocation function if available, otherwise define locally
  const allocateProportionalEVs = (window.EvCalculations && window.EvCalculations.allocateProportionalEVs) || 
  function (dVotes, rVotes, oVotes, totalEVs, topThirdPartyShare, thirdPartyResults) {
    const total = dVotes + rVotes + oVotes;
    if (total <= 0 || totalEVs <= 0) return { D: 0, R: 0, O: 0, thirdParties: {} };

    // When thirdPartyResults is provided and has multiple parties, split third party votes proportionally
    const thirdParties = {};
    let hasMultipleThirdParties = false;

    if (thirdPartyResults && typeof thirdPartyResults === 'object') {
      const thirdPartyEntries = Object.entries(thirdPartyResults).filter(([name, votes]) => {
        // Filter out "Other(s)"
        return name !== 'Other' && name !== 'Others';
      });
      if (thirdPartyEntries.length > 0) {
        hasMultipleThirdParties = thirdPartyEntries.length > 1;

        // Calculate quotas for each party including third parties
        const parties = [
          { name: 'D', votes: dVotes },
          { name: 'R', votes: rVotes }
        ];

        // Add each third party
        thirdPartyEntries.forEach(([name, votes]) => {
          parties.push({ name: name, votes: +votes || 0, isThirdParty: true });
        });

        // Calculate quotas using largest remainder method
        const allocated = {};
        let totalAllocated = 0;
        const remainders = [];

        parties.forEach(p => {
          const share = p.votes / total;
          const quota = Math.floor(share * totalEVs);
          const remainder = (share * totalEVs) - quota;

          if (p.isThirdParty) {
            thirdParties[p.name] = quota;
          } else {
            allocated[p.name] = quota;
          }
          totalAllocated += quota;
          remainders.push({ name: p.name, remainder, isThirdParty: p.isThirdParty });
        });

        // Allocate remaining EVs
        let remaining = totalEVs - totalAllocated;
        remainders.sort((a, b) => b.remainder - a.remainder);

        for (let i = 0; i < remaining && i < remainders.length; i++) {
          const r = remainders[i];
          if (r.isThirdParty) {
            thirdParties[r.name] = (thirdParties[r.name] || 0) + 1;
          } else {
            allocated[r.name] = (allocated[r.name] || 0) + 1;
          }
        }

        return {
          D: allocated.D || 0,
          R: allocated.R || 0,
          O: 0, // Not used when we have detailed third parties
          thirdParties: thirdParties
        };
      }
    }

    // Fallback to simple D/R/O allocation when no detailed third party data
    const dShare = dVotes / total;
    const rShare = rVotes / total;
    const oShare = oVotes / total;

    const dQuota = Math.floor(dShare * totalEVs);
    const rQuota = Math.floor(rShare * totalEVs);
    const oQuota = Math.floor(oShare * totalEVs);

    let allocated = { D: dQuota, R: rQuota, O: oQuota };
    let remaining = totalEVs - (dQuota + rQuota + oQuota);

    if (remaining > 0) {
      const remainders = [
        { party: 'D', remainder: (dShare * totalEVs) - dQuota },
        { party: 'R', remainder: (rShare * totalEVs) - rQuota },
        { party: 'O', remainder: (oShare * totalEVs) - oQuota }
      ];

      remainders.sort((a, b) => b.remainder - a.remainder);

      for (let i = 0; i < remaining; i++) {
        allocated[remainders[i].party]++;
      }
    }

    return { ...allocated, thirdParties: {} };
  };

  // Check if proportional EV mode is enabled
  function isProportionalEvMode() {
    try {
      const toggle = document.getElementById('propEvToggle');
      return toggle && toggle.checked;
    } catch (e) {
      return false;
    }
  }

  // Calculate proportional EV allocation for a specific unit
  // Returns {D: number, R: number, O: number, thirdParties: {}} or null if proportional mode is off
  function calculateUnitProportionalEVs(unit) {
    try {
      if (!isProportionalEvMode()) return null;

      const year = window._curYear;
      const pv = window._curPv || 0;
      if (!year) return null;

      const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
      const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
      if (!rows || !rows.length) return null;

      const r = rows.find(x => x.unit === keyUnit);
      if (!r) return null;

      const ev = +r.ev || 0;
      if (ev <= 0) return null;

      const activeFlip = window._activeFlip && window._activeFlip.year === year ? window._activeFlip : null;
      const flipped = isUnitFlipped(year, keyUnit);

      if (flipped && activeFlip && activeFlip.units) {
        const flipUnit = activeFlip.units.find(u => u.unit === keyUnit);
        if (flipUnit && flipUnit.votes_to_flip) {
          let dVotesBase = Math.max(0, +r.dVotes || 0);
          let rVotesBase = Math.max(0, +r.rVotes || 0);
          let tVotesBase = Math.max(0, +r.tVotes || 0);
          const votesToFlip = Math.max(0, +flipUnit.votes_to_flip || 0);
          if (dVotesBase >= rVotesBase) {
            dVotesBase = Math.max(0, dVotesBase - votesToFlip);
            rVotesBase = rVotesBase + votesToFlip;
          } else {
            dVotesBase = dVotesBase + votesToFlip;
            rVotesBase = Math.max(0, rVotesBase - votesToFlip);
          }
          const topThirdShare = totalVotesFromRow(r) > 0 ? (Math.max(0, +r.topThirdVotes || 0) / totalVotesFromRow(r)) : 0;
          return allocateProportionalEVs(dVotesBase, rVotesBase, Math.max(0, tVotesBase), ev, topThirdShare, r.thirdPartyResults);
        }
      }
      // console.log('Calculating proportional EVs for', keyUnit, 'with PV shift', pv);
      const breakdown = computePvAdjustedBreakdown(r, pv, getNatMargin(year));
      let dVotes = Math.max(0, breakdown.dVotes);
      let rVotes = Math.max(0, breakdown.rVotes);
      let tVotes = Math.max(0, breakdown.totalThirdVotes);

      if (flipped && activeFlip && activeFlip.units) {
        const flipUnit = activeFlip.units.find(u => u.unit === keyUnit);
        if (flipUnit && flipUnit.votes_to_flip) {
          const votesToFlip = Math.max(0, +flipUnit.votes_to_flip || 0);
          if (dVotes >= rVotes) {
            dVotes = Math.max(0, dVotes - votesToFlip);
            rVotes = rVotes + votesToFlip;
          } else {
            dVotes = dVotes + votesToFlip;
            rVotes = Math.max(0, rVotes - votesToFlip);
          }
        }
      }

      const topThirdShare = breakdown.topThirdShareOfTotal;
      // Capture allocation result so we can log it for 1960 (compare with map/election-night)
      const allocResult = allocateProportionalEVs(dVotes, rVotes, tVotes, ev, topThirdShare, r.thirdPartyResults);

      // try {
      //   if (year === 1960) {
      //     console.log('[EV-TRACE] calculateUnitProportionalEVs', { year, keyUnit, ev, dVotes, rVotes, tVotes, thirdPartyResults: r.thirdPartyResults, allocResult });
      //   }
      // } catch(e) {}

      return allocResult;
    } catch (e) {
      return null;
    }
  }

  function getUnitFinalVoteTotals(unit, opts) {
    try {
      if (!unit) return null;
      const options = opts || {};
      let year = (options.year != null && isFinite(options.year)) ? Number(options.year) : null;
      if (!isFinite(year) || year <= 0) {
        if (typeof window._curYear === 'number' && isFinite(window._curYear)) {
          year = window._curYear;
        } else {
          const yearEl = document.getElementById('yearSlider');
          year = yearEl ? parseInt(yearEl.value, 10) : null;
        }
      }
      if (!isFinite(year) || year <= 0) return null;

      let pv = (options.pv != null && isFinite(options.pv)) ? Number(options.pv) : null;
      if (!isFinite(pv)) pv = (typeof window._curPv === 'number' && isFinite(window._curPv)) ? window._curPv : 0;

      const useActiveFlip = options.useActiveFlip !== false;
      const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
      if (!keyUnit) return null;

      const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
      if (!rows || !rows.length) return null;

      const row = rows.find(x => x.unit === keyUnit);
      if (!row) return null;

      const totalVotesRaw = totalVotesFromRow(row);
      if (!isFinite(totalVotesRaw) || totalVotesRaw <= 0) return null;

      const natMargin = (typeof getNatMargin === 'function') ? getNatMargin(year) : 0;
      const breakdown = computePvAdjustedBreakdown(row, pv, natMargin);

      let dVotes = Math.max(0, breakdown.dVotes);
      let rVotes = Math.max(0, breakdown.rVotes);
      let totalThirdVotes = Math.max(0, breakdown.totalThirdVotes);
      let topThirdVotes = Math.max(0, breakdown.topThirdVotes);
      let totalVotes = Math.max(0, breakdown.totalVotes || totalVotesRaw);

      if (totalThirdVotes < topThirdVotes) totalThirdVotes = topThirdVotes;

      if (useActiveFlip) {
        const flipped = (typeof isUnitFlipped === 'function') ? isUnitFlipped(year, keyUnit) : false;
        const activeFlip = window._activeFlip && window._activeFlip.year === year ? window._activeFlip : null;
        if (flipped && activeFlip && Array.isArray(activeFlip.units)) {
          const flipUnit = activeFlip.units.find(u => u.unit === keyUnit);
          if (flipUnit && flipUnit.votes_to_flip) {
            const votesToFlip = Math.max(0, +flipUnit.votes_to_flip || 0);
            if (votesToFlip > 0) {
              if (dVotes >= rVotes) {
                dVotes = Math.max(0, dVotes - votesToFlip);
                rVotes = rVotes + votesToFlip;
              } else {
                dVotes = dVotes + votesToFlip;
                rVotes = Math.max(0, rVotes - votesToFlip);
              }
            }
          }
        }
      }

      return {
        dVotes,
        rVotes,
        topThirdVotes,
        totalThirdVotes,
        totalVotes
      };
    } catch (e) {
      return null;
    }
  }
  try { window.getUnitFinalVoteTotals = getUnitFinalVoteTotals; } catch (e) { }

  // Calculate vote tallies for a specific unit (for index.html - real elections only)
  // Returns {D: number, R: number, O: number, total: number} or null if not applicable
  // Put a star on the current leader (D, R, or O)
  function calculateUnitVoteTallies(unit) {
    try {
      // Only show vote tallies on index.html (real elections), not tester or future
      const isIndexPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/';
      if (!isIndexPage) return null;

      let year = (typeof window._curYear === 'number' && isFinite(window._curYear)) ? window._curYear : null;
      if (!isFinite(year)) {
        const yearEl = document.getElementById('yearSlider');
        year = yearEl ? parseInt(yearEl.value, 10) : null;
      }
      const pv = window._curPv || 0;
      if (!year || year > 2024) return null; // Only real elections

      const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;

      // During election night, use the counted votes from the snapshot
      if (window._electionNightActive && window._electionNightSnapshot) {
        const snapshot = window._electionNightSnapshot;
        const abbr = (typeof keyUnit === 'string' && keyUnit.length >= 2) ? keyUnit.slice(0, 2) : null;
        const candidates = [];
        if (unit && !candidates.includes(unit)) candidates.push(unit);
        if (keyUnit && !candidates.includes(keyUnit)) candidates.push(keyUnit);
        if (abbr && !candidates.includes(abbr)) candidates.push(abbr);

        let snap = null;
        for (const candidate of candidates) {
          if (candidate && snapshot.has(candidate)) {
            snap = snapshot.get(candidate);
            if (snap) break;
          }
        }

        if (snap) {
          // Use the counted votes from the snapshot (starts at 0, grows as batches come in)
          const dVotes = snap.dVotes || 0;
          const rVotes = snap.rVotes || 0;
          const oVotes = snap.oVotes || 0; // This is the top third party votes during election night

          // Don't display if no votes have been counted yet
          const total = dVotes + rVotes + oVotes;
          if (total <= 0) return null;
          // Special-case: 1948 AL stores Dixiecrat/Thurmond in the D column in the CSV;
          // for display we zero out the D_col so it is not shown as a Democratic two-party total.
          try {
            const abbr = (typeof keyUnit === 'string' && keyUnit.length >= 2) ? keyUnit.slice(0, 2) : null;
            if (year === 1948 && abbr === 'AL') {
              return {
                D: 0,
                R: Math.round(rVotes),
                O: Math.round(oVotes),
                total: Math.round(rVotes + oVotes)
              };
            }
          } catch (e) { }

          return {
            D: Math.round(dVotes),
            R: Math.round(rVotes),
            O: Math.round(oVotes),
            total: Math.round(total)
          };
        }
      }

      const totals = getUnitFinalVoteTotals(unit, { year, pv });
      if (!totals) return null;

      const dRounded = Math.round(Math.max(0, totals.dVotes || 0));
      const rRounded = Math.round(Math.max(0, totals.rVotes || 0));
      const oRounded = Math.round(Math.max(0, totals.topThirdVotes || 0));

      // For historical special cases (1948 AL) the CSV intentionally copies
      // the Dixiecrat/Thurmond total into the D_votes column. For tooltip
      // clarity we do not display that copied D_votes as Democratic votes.
      try {
        const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
        const abbr = (typeof keyUnit === 'string' && keyUnit.length >= 2) ? keyUnit.slice(0, 2) : null;
        if (year === 1948 && abbr === 'AL') {
          // Use raw CSV R_votes and T_votes for display so the copied D_votes doesn't
          // push adjusted two-party math to R=0. Prefer topThirdVotes from the row if present.
          try {
            const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
            const row = (rows && rows.length) ? rows.find(x => x.unit === (keyUnit || unit)) : null;
            let rawR = rRounded;
            let rawO = oRounded;
            if (row) {
              rawR = Math.round(Math.max(0, +row.rVotes || 0));
              // prefer a dedicated topThirdVotes or T_votes if present, else fall back to totals
              rawO = Math.round(Math.max(0, (+row.topThirdVotes || +row.tVotes || oRounded || 0)));
            }
            return {
              D: 0,
              R: rawR,
              O: rawO,
              total: rawR + rawO
            };
          } catch (e) {
            return { D: 0, R: rRounded, O: oRounded, total: rRounded + oRounded };
          }
        }
      } catch (e) { }

      return {
        D: dRounded,
        R: rRounded,
        O: oRounded,
        total: dRounded + rRounded + oRounded
      };
    } catch (e) {
      return null;
    }
  }

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
  try { window.smallBoxesConfig = _smallBoxesConfig; } catch (e) { }
  // Helper to update config at runtime and re-render quickly
  function setSmallBoxesConfig(patch) {
    try {
      if (patch && typeof patch === 'object') Object.assign(_smallBoxesConfig, patch);
      // Keep the exported reference updated too
      try { window.smallBoxesConfig = _smallBoxesConfig; } catch (e) { }
      // Re-render using last known colors if available
      const year = window._curYear || (document.getElementById('yearSlider') ? +document.getElementById('yearSlider').value : 2024);
      const ac = window._lastAbbrColors || null;
      const uc = window._lastUnitColors || null;
      if (typeof renderSmallStateBoxes === 'function' && ac && uc) renderSmallStateBoxes(year, ac, uc);
      else if (typeof window.updateAll === 'function') window.updateAll();
    } catch (e) { console.warn('[smallBoxes] setSmallBoxesConfig error', e); }
  }
  function nudgeSmallBoxes(dx, dy) {
    const curX = (typeof _smallBoxesConfig.x === 'number') ? _smallBoxesConfig.x : null;
    if (curX == null) {
      // Convert from right-anchored to absolute x based on current SVG width
      try {
        const svg = d3.select('svg#map');
        const vb = svg.empty() ? [0, 0, 975, 610] : (svg.attr('viewBox') ? svg.attr('viewBox').split(/\s+/).map(Number) : [0, 0, 975, 610]);
        const width = vb[2] || 975;
        _smallBoxesConfig.x = width - (_smallBoxesConfig.right || 8) - (_smallBoxesConfig.boxW || 86);
      } catch (e) { _smallBoxesConfig.x = 860; }
    }
    _smallBoxesConfig.x += (+dx || 0);
    _smallBoxesConfig.y = (_smallBoxesConfig.y || 0) + (+dy || 0);
    setSmallBoxesConfig({});
  }
  try { window.setSmallBoxesConfig = setSmallBoxesConfig; window.nudgeSmallBoxes = nudgeSmallBoxes; } catch (e) { }

  // Lazily created layer for state labels
  let stateLabelsLayer = null; // d3 selection of g.state-labels
  const _labelCache = new Map(); // abbr -> d3 selection for text
  // Cache for computed visual centers (screen coords) per state abbr
  const _visualCenterCache = new Map(); // abbr -> {x,y}
  // Configurable whitelist for which states should use visual-center placement.
  // Default to a focused set; if emptied, we treat as ALL states using visual center.
  let _visualCenterStates = new Set(['MI', 'FL', 'LA']);
  try { window.visualCenterStates = _visualCenterStates; } catch (e) { }
  function setVisualCenterStates(list) {
    try {
      if (Array.isArray(list)) _visualCenterStates = new Set(list.map(s => String(s || '').toUpperCase()));
      else if (list instanceof Set) _visualCenterStates = new Set(Array.from(list).map(s => String(s || '').toUpperCase()));
      // publish reference for quick tweaking in console
      try { window.visualCenterStates = _visualCenterStates; } catch (e) { }
      // centers depend on geometry, so clear cache
      try { _visualCenterCache.clear(); } catch (e) { }
      // re-render labels
      try { updateStateLabels(window._curYear || 2024); } catch (e) { }
    } catch (e) { /* ignore */ }
  }
  try { window.setVisualCenterStates = setVisualCenterStates; } catch (e) { }

  // Centralized tooltip helpers (consistent positioning; fixes offset glitches)
  function _getMapWrap() {
    return document.getElementById('map-wrap') || document.body;
  }
  function _ensureTip() {
    return document.getElementById('mapTip') || null;
  }
  function _placeTipAt(evt) {
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
  function showMapTip(evt, text) {
    try {
      const tip = _ensureTip(); if (!tip) return;
      // Handle multi-line tooltips by converting newlines to <br> tags
      const content = text != null ? String(text).replace(/\n/g, '<br>') : '';
      tip.innerHTML = content;
      tip.style.display = 'block';
      _placeTipAt(evt);
    } catch (e) { }
  }
  function moveMapTip(evt) { try { _placeTipAt(evt); } catch (e) { } }
  const _activeTipState = {
    info: null
  };
  function _setActiveTip(info) { _activeTipState.info = info || null; }
  function _updateActiveTipCoords(evt) {
    if (!_activeTipState.info || !evt) return;
    _activeTipState.info.clientX = evt.clientX;
    _activeTipState.info.clientY = evt.clientY;
  }
  function refreshActiveMapTip() {
    try {
      const info = _activeTipState.info;
      if (!info || typeof info.getText !== 'function') return;
      const text = info.getText();
      if (text == null) return;
      const coords = {
        clientX: info.clientX,
        clientY: info.clientY
      };
      if (coords.clientX == null || coords.clientY == null) return;
      showMapTip(coords, text);
    } catch (e) { }
  }
  function hideMapTip() {
    try {
      const tip = _ensureTip();
      if (tip) tip.style.display = 'none';
    } catch (e) { }
    _setActiveTip(null);
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
  } catch (e) { }

  function createUnitTipInfo(unit, opts) {
    const options = { ...(opts || {}) };
    return {
      unit,
      options,
      clientX: null,
      clientY: null,
      getText: function () { return formatUnitTooltip(unit, options); }
    };
  }

  function formatUnitTooltip(unit, opts) {
    try {
      const options = opts || {};
      if (options.staticText != null) return options.staticText;
      const display = options.label || unit;
      const info = (typeof window.getAdjustedInfo === 'function') ? window.getAdjustedInfo(unit) : null;
      let ev = options.evOverride;
      if (info && info.ev != null && !isNaN(info.ev)) ev = info.ev;
      let marginStr = options.marginOverride || '';
      if (info && info.marginStr) marginStr = info.marginStr;
      const cappedMarginStr = (function () {
        if (!marginStr || typeof marginStr !== 'string') return marginStr;
        const match = marginStr.match(/^([A-Z])\+([\d.]+)$/);
        if (!match) return marginStr;
        const prefix = match[1];
        const value = parseFloat(match[2]);
        if (!isFinite(value) || value <= 99.9) return marginStr;
        return `${prefix}+99.9`;
      })();

      // Build tooltip content with multiple rows
      const rows = [];

      // First row: Basic info (display name, EV, margin)
      const basicParts = [];
      if (display) basicParts.push(display);
      if (ev != null && ev !== '') basicParts.push(`${ev} EV`);
      if (cappedMarginStr) basicParts.push(cappedMarginStr);
      if (basicParts.length) rows.push(basicParts.join(' · '));

      // Second row: EV allocation (for proportional mode)
      const evAllocation = (function () {
        const electionNightActive = !!window._electionNightActive;
        const reportingVal = (info && info.reporting != null) ? Number(info.reporting) : null;
        const fullyCounted = (reportingVal != null && isFinite(reportingVal)) ? (reportingVal >= 0.999) : false;
        if (electionNightActive && !fullyCounted) return null;
        const alloc = calculateUnitProportionalEVs(unit);
        // try {
        //   // Log why calculateUnitProportionalEVs may have returned null or what it returned
        //   if ((window._curYear === 1960) || (alloc && (alloc.D || alloc.R || alloc.O))) {
        //     console.log('[EV-TRACE] tooltip evAllocation computed', { unit, electionNightActive, reportingVal, fullyCounted, alloc });
        //   }
        // } catch(e) {}
        return alloc;
      })();
      if (evAllocation) {
        const evParts = [];
        if (evAllocation.D > 0) evParts.push(`D: ${evAllocation.D}`);
        if (evAllocation.R > 0) evParts.push(`R: ${evAllocation.R}`);
        // Aggregate any "Other" EVs: include traditional O plus any detailed thirdParty allocations
        const detailed = evAllocation.thirdParties || {};
        let othersTotal = (evAllocation.O || 0);
        try {
          Object.values(detailed).forEach(v => { if (isFinite(v)) othersTotal += Number(v) || 0; });
        } catch (e) { /* ignore */ }
        // try {
        //   if (window._curYear === 1960) {
        //     console.log('[EV-TRACE] tooltip evParts O aggregation', { unit, ev, evAllocation, detailed, othersTotal });
        //   }
        // } catch(e) {}
        if (othersTotal > 0) {
          // Try to display the top third-party's last name instead of a generic 'O'
          let topThirdLabel = null;
          try {
            const lastNameFrom = (full) => {
              try {
                if (!full || typeof full !== 'string') return null;
                const s = full.trim(); if (!s) return null;
                if (s.indexOf(',') !== -1) return s.split(',')[0].trim();
                const parts = s.split(/\s+/).filter(Boolean);
                return parts.length ? parts[parts.length - 1] : s;
              } catch (e) { return null; }
            };
            if (info && info.thirdPartyResults && typeof info.thirdPartyResults === 'object') {
              const entries = Object.entries(info.thirdPartyResults).map(([nm, v]) => ({ name: nm, votes: Number(v) || 0 }));
              if (entries.length) {
                entries.sort((a, b) => b.votes - a.votes);
                const top = entries[0];
                if (top && top.name) topThirdLabel = lastNameFrom(String(top.name)) || String(top.name);
              }
            }
          } catch (e) { }
          if (topThirdLabel) evParts.push(`${topThirdLabel}: ${othersTotal}`);
          else evParts.push(`O: ${othersTotal}`);
        }
        if (evParts.length) {
          rows.push(evParts.join(' | '));
        }
      }

      // Third row: Vote tallies (for index.html - real elections only)
      const voteTallies = calculateUnitVoteTallies(unit);
      if (voteTallies) {
        const voteParts = [];
        const formatter = (x) => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '0';

        // Find the party with the highest vote tally
        const maxVotes = Math.max(voteTallies.D, voteTallies.R, voteTallies.O);
        const frontRunner = (function () {
          if (voteTallies.D === maxVotes) return 'D';
          if (voteTallies.R === maxVotes) return 'R';
          if (voteTallies.O === maxVotes) return 'O';
          return null;
        })();
        const displayNames = true; // if true, show candidate last names in tooltip (if available)
        const onlyThirdParty = false; // if true, show only third-party name for O, not generic 'O' but still show D and R (not names)
        const candidateNames = (function () {
          if (!displayNames) return { D: 'D', R: 'R', O: 'O' };
          //try { console.log('info for', unit, info); } catch(e){}

          // Helper: return a sensible "last name" from a full name string
          const lastNameFrom = (full) => {
            try {
              if (!full || typeof full !== 'string') return null;
              const s = full.trim();
              if (!s) return null;
              // If name is in "Last, First" format, take the part before comma
              if (s.indexOf(',') !== -1) return s.split(',')[0].trim();
              // Otherwise take last token
              const parts = s.split(/\s+/).filter(Boolean);
              return parts.length ? parts[parts.length - 1] : s;
            } catch (e) { return null; }
          };

          const names = { D: 'D', R: 'R', O: 'Top O' };

          // Prefer explicit per-party candidate entries when present
          try {
            if (info && info.candidates && typeof info.candidates === 'object') {
              const candObj = info.candidates;
              console.log('candidates object', candObj);
              if (candObj.D && candObj.D.name && !onlyThirdParty) {
                const ln = lastNameFrom(candObj.D.name);
                if (ln) names.D = ln;
              }
              if (candObj.R && candObj.R.name && !onlyThirdParty) {
                const ln = lastNameFrom(candObj.R.name);
                if (ln) names.R = ln;
              }
              // For O, prefer an explicit O candidate entry
              if (candObj.O && candObj.O.name) {
                const ln = lastNameFrom(candObj.O.name);
                //console.log('extracted O from candidates.O.name', ln);
                if (ln) names.O = ln;

              }
            } else {
              // Fallback: some data rows expose dCandidate/rCandidate as simple strings
              console.log('candidates object not found, checking dCandidate/rCandidate', info);
              if (info && info.dCandidate && !names.D) {
                const ln = lastNameFrom(String(info.dCandidate)); if (ln) names.D = ln;
                console.log('extracted D from dCandidate', ln);
              }
              if (info && info.rCandidate && !names.R) {
                const ln = lastNameFrom(String(info.rCandidate)); if (ln) names.R = ln;
                console.log('extracted R from rCandidate', ln);
              }
            }
          } catch (e) { }

          // If we still don't have a top third-party name for O, try to infer from thirdPartyResults
          try {
            if ((!names.O || names.O === 'O') && info && info.thirdPartyResults && typeof info.thirdPartyResults === 'object') {
              const entries = Object.entries(info.thirdPartyResults).map(([nm, v]) => ({ name: nm, votes: Number(v) || 0 }));
              if (entries.length) {
                entries.sort((a, b) => b.votes - a.votes);
                const top = entries[0];
                if (top && top.name) {
                  const ln = lastNameFrom(String(top.name));
                  if (ln) names.O = ln;
                }
              }
            }
          } catch (e) { }

          return names;
        })();
        //console.log('candidateNames', candidateNames);
        // Only display parties with votes, add star to the highest
        if (voteTallies.D > 0) {
          const dLabel = candidateNames && candidateNames.D ? candidateNames.D : 'D';
          voteParts.push(`${voteTallies.D === maxVotes ? dLabel + '*' : dLabel}: ${formatter(voteTallies.D)}`);
        }
        if (voteTallies.R > 0) {
          const rLabel = candidateNames && candidateNames.R ? candidateNames.R : 'R';
          voteParts.push(`${voteTallies.R === maxVotes ? rLabel + '*' : rLabel}: ${formatter(voteTallies.R)}`);
        }
        // Only display top third party if it has votes (not all third parties)
        if (voteTallies.O > 0) {
          const oLabel = candidateNames && candidateNames.O ? candidateNames.O : 'O';
          voteParts.push(`${voteTallies.O === maxVotes ? oLabel + '*' : oLabel}: ${formatter(voteTallies.O)}`);
        }

        // Only add vote row if we have votes to display
        if (voteParts.length) {
          rows.push(voteParts.join(' | '));
        }

        // Add vote margin between top and runner-up
        const votes = [
          { party: 'D', count: voteTallies.D },
          { party: 'R', count: voteTallies.R },
          { party: 'O', count: voteTallies.O }
        ].filter(v => v.count > 0).sort((a, b) => b.count - a.count);

        if (votes.length >= 2) {
          const margin = votes[0].count - votes[1].count;
          const marginText = `${frontRunner}+${formatter(margin)} vote${margin !== 1 ? 's' : ''}`;
          rows.push(marginText);
        }
      }

      // Election night reporting info
      const reportingText = (function () {
        if (!window._electionNightActive) return '';
        if (!info || info.reporting == null) return '';
        const value = Number(info.reporting);
        if (!isFinite(value) || value < 0) return '';
        const pct = Math.max(0, Math.min(100, value * 100));
        const label = (pct >= 99.95) ? '100.0% counted' : `${pct.toFixed(1)}% counted`;
        return label;
      })();
      if (reportingText) rows.push(reportingText);

      // Called/confidence info
      if (info) {
        if (info.called) {
          rows.push('Called');
        } else {
          const reporting = (info.reporting != null && isFinite(info.reporting)) ? info.reporting : 0;
          const confidence = (info.confidence != null && isFinite(info.confidence)) ? info.confidence : null;
          if (reporting > EPS && confidence != null) {
            const pct = Math.max(0, Math.min(100, Math.round(confidence * 100)));
            rows.push(`Confidence ${pct}%`);
          }
        }
      }

      return rows.join('\n');
    } catch (e) { return unit; }
  }

  // Expose helper to get candidate last names for a unit (D, R, top third-party O)
  function getUnitCandidateLastNames(unit, opts) {
    try {
      const options = opts || {};
      let year = (options.year != null && isFinite(options.year)) ? Number(options.year) : (typeof window._curYear === 'number' ? window._curYear : null);
      if (!isFinite(year)) year = null;
      if (!unit) return { D: 'D', R: 'R', O: 'O' };
      const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
      const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
      const row = (rows && rows.length) ? rows.find(x => x.unit === keyUnit) : null;
      // last name extractor
      const lastNameFrom = (full) => {
        try {
          if (!full || typeof full !== 'string') return null;
          const s = full.trim(); if (!s) return null;
          if (s.indexOf(',') !== -1) return s.split(',')[0].trim();
          const parts = s.split(/\s+/).filter(Boolean); return parts.length ? parts[parts.length - 1] : s;
        } catch (e) { return null; }
      };
      const names = { D: 'D', R: 'R', O: 'O' };
      if (row) {
        try {
          if (row.dCandidate) {
            const ln = lastNameFrom(String(row.dCandidate)); if (ln) names.D = ln;
          }
          if (row.rCandidate) {
            const ln = lastNameFrom(String(row.rCandidate)); if (ln) names.R = ln;
          }
          if (row.thirdPartyResults && typeof row.thirdPartyResults === 'object') {
            const entries = Object.entries(row.thirdPartyResults).map(([nm, v]) => ({ name: nm, votes: Number(v) || 0 }));
            if (entries.length) {
              entries.sort((a, b) => b.votes - a.votes);
              const top = entries[0]; if (top && top.name) { const ln = lastNameFrom(String(top.name)); if (ln) names.O = ln; }
            }
          }
        } catch (e) { }
      }
      return names;
    } catch (e) { return { D: 'D', R: 'R', O: 'O' }; }
  }

  // Compute a "visual center" for a GeoJSON Polygon/MultiPolygon feature using
  // projected screen coordinates and a lightweight polylabel-like search.
  // Returns {x, y} in SVG coordinate space.
  function _computeVisualCenter(feature, abbr) {
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
          for (let i = 0; i < ring.length; i++) {
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
        for (const poly of polys) {
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
        for (let i = 1; i < rings.length; i++) {
          if (pointInRing(pt, rings[i])) return false; // in a hole
        }
        return true;
      };
      // Distance from point to poly edges (min over outer and holes)
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

      // Lightweight grid-refinement search per polygon
      const searchPoly = (rings) => {
        // bbox of outer ring
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of rings[0]) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
        // start with coarse step; 5 rounds
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
      for (const rings of polygons) {
        const res = searchPoly(rings);
        if (res && res.point && res.score > bestScore) { bestScore = res.score; bestGlobal = res.point; }
      }
      if (bestGlobal && isFinite(bestGlobal[0]) && isFinite(bestGlobal[1])) {
        const pt = { x: bestGlobal[0], y: bestGlobal[1] };
        if (abbr) _visualCenterCache.set(abbr, pt);
        return pt;
      }
      return null;
    } catch (e) { return null; }
  }

  // Ensure an overlay group inside the map for small-state boxes
  function ensureSmallBoxesLayer() {
    try {
      const svg = d3.select('svg#map');
      if (svg.empty()) return null;
      let layer = svg.select('g.small-state-overlay');
      if (layer.empty()) {
        // Insert the overlay above the state paths but below labels
        layer = svg.append('g').attr('class', 'small-state-overlay');
        // Give it a pointer cursor for clicks
        layer.attr('pointer-events', 'auto');
      }
      return layer;
    } catch (e) { return null; }
  }

  // Render equal-width boxes along the east coast within the map SVG
  function renderSmallStateBoxes(year, abbrColors, unitColors) {
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
      const data = tiny.map(({ unit, label }) => {
        let color = unitColors.get(unit);
        if (!color) {
          const st = unit.slice(0, 2);
          const entry = abbrColors.get(st);
          color = entry ? entry.color : '#2f2f2f';
        }
        let ev = null;
        try { if (typeof window.getEvFor === 'function') ev = window.getEvFor(year, unit); } catch (e) { }
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
      const vb = svg.attr('viewBox') ? svg.attr('viewBox').split(/\s+/).map(Number) : [0, 0, 975, 610];
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
        .attr('class', 'small-box');

      groups.each(function (d, i) {
        const g = d3.select(this);
        const gx = x;
        const gy = startY + i * (boxH + gapY);
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
        const padX = 6, midY = Math.floor(boxH / 2) + 1;
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
        if (d.ev != null && isFinite(d.ev)) {
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
        const hoverHandler = function (evt) {
          try {
            const tipInfo = createUnitTipInfo(d.unit, { label: d.label, evOverride: d.ev });
            if (typeof window.showMapTip === 'function') window.showMapTip(evt, tipInfo.getText(), tipInfo);
          } catch (e) { }
        };
        g.on('mouseenter', hoverHandler)
          .on('mousemove', function (evt) { try { if (typeof window.moveMapTip === 'function') window.moveMapTip(evt); } catch (e) { } })
          .on('mouseleave', function () { try { if (typeof window.hideMapTip === 'function') window.hideMapTip(); } catch (e) { } });

        // Click-through disabled in future mode; only enable for historical/tester pages
        if (!window._futureMode) {
          g.style('cursor', 'pointer')
            .on('click', () => {
              let abbr = d.unit;
              if (abbr.endsWith('-AL')) abbr = abbr.slice(0, 2);
              window.open(`state/${abbr}.html`, '_blank');
            });
        } else {
          g.style('cursor', 'default');
        }
      });

      // Keep label layer on top of overlay if exists
      try { raiseStateLabelsLayer(); } catch (e) { }
      //console.log('[smallBoxes] render done (svg overlay). count:', data.length);
    } catch (e) { console.warn('[smallBoxes] svg overlay render error', e); }
  }

  function raiseStateLabelsLayer() {
    try {
      if (stateLabelsLayer && !stateLabelsLayer.empty()) stateLabelsLayer.raise();
      else {
        const sel = d3.select('svg#map').select('g.state-labels');
        if (!sel.empty()) sel.raise();
      }
    } catch (e) { }
  }

  // Recompute visual centers if layout/projection likely changed
  try {
    window.addEventListener('resize', function () {
      try { _visualCenterCache.clear(); } catch (e) { }
      try { updateStateLabels(window._curYear || 2024); } catch (e) { }
    });
    window.addEventListener('mapReady', function () {
      try { _visualCenterCache.clear(); } catch (e) { }
    });
  } catch (e) { }

  function ensureStateLabelsLayer() {
    try {
      try {
        const svgSel = d3.select('svg#map');
        //console.log('[labels] ensureStateLabelsLayer enter', { svgExists: !svgSel.empty(), mapGExists: !!window.mapG });
      } catch (e) { }
      if (stateLabelsLayer && !stateLabelsLayer.empty()) return stateLabelsLayer;
      // Prefer to attach to main map group if exposed; otherwise, to the svg root
      const svg = d3.select('svg#map');
      if (svg.empty()) { try { console.warn('[labels] svg#map not found'); } catch (e) { }; return null; }
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
      } catch (e) { parent = null; }
      if (!parent || parent.empty()) parent = svg;
      try {
        //console.log('[labels] parent resolved', { tag: parent.node() && parent.node().tagName, id: parent.attr('id') || '', class: parent.attr('class') || '' });
      } catch (e) { }
      let layer = parent.select('g.state-labels');
      if (layer.empty()) {
        layer = parent.append('g').attr('class', 'state-labels').attr('pointer-events', 'none');
        //try { console.log('[labels] created state-labels layer under', parent.node() === svg.node() ? 'svg#map' : 'mapG'); } catch(e) {}
      }
      // keep labels above states/districts
      try { layer.raise(); } catch (e) { }
      stateLabelsLayer = layer;
      try {
        const countNow = svg.selectAll('g.state-labels').nodes().length;
        //console.log('[labels] ensureStateLabelsLayer exit', { layersInSvg: countNow });
      } catch (e) { }
      return layer;
    } catch (e) { return null; }
  }

  // Compute total EV for a state abbreviation, summing district/at-large rows as needed
  function getTotalEvForState(year, abbr) {
    try {
      if (typeof window.getRowsForYear !== 'function') return null;
      const rows = window.getRowsForYear(year) || [];
      let sum = 0; let found = false;
      for (const r of rows) {
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
      } catch (e) { }
      return null;
    } catch (e) { return null; }
  }

  // Create/update text labels for states for the current year
  function updateStateLabels(year) {
    const layer = ensureStateLabelsLayer();
    if (!layer) return;
    // Build or update labels for each state path
    const states = d3.selectAll('path.state');
    //try { console.log('[labels] updateStateLabels start', { year, stateCount: states.size ? states.size() : states.nodes().length }); } catch(e) {}
    if (states.empty()) {
      // Map may not be ready yet; try again shortly
      try { setTimeout(() => { try { updateStateLabels(year); } catch (e) { } }, 100); } catch (e) { }
      return;
    }
    // Extra guard: if the label layer somehow isn't attached, create under svg directly
    try {
      if (!stateLabelsLayer || stateLabelsLayer.empty()) {
        const svg = d3.select('svg#map');
        stateLabelsLayer = svg.append('g').attr('class', 'state-labels').attr('pointer-events', 'none');
        console.log('[labels] fallback created state-labels under svg');
      }
    } catch (e) { }
    states.each(function (d) {
      try {
        const node = this;
        // derive abbr from FIPS id
        const id = (d && d.id != null) ? String(d.id).padStart(2, '0') : (node && node.__data__ && node.__data__.id != null ? String(node.__data__.id).padStart(2, '0') : null);
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
          } catch (e) { }
        }
        // Fallbacks: centroid, then bbox center
        if (cx == null || cy == null) {
          try {
            if (window.mapPath && typeof window.mapPath.centroid === 'function' && d) {
              const c = window.mapPath.centroid(d);
              if (Array.isArray(c) && c.length === 2 && isFinite(c[0]) && isFinite(c[1])) { cx = c[0]; cy = c[1]; }
            }
          } catch (e) { }
        }
        if (cx == null || cy == null) {
          let bbox;
          try { bbox = node.getBBox(); } catch (e) { bbox = null; }
          if (!bbox) return;
          cx = bbox.x + bbox.width / 2;
          cy = bbox.y + bbox.height / 2;
        }

        // Resolve EV
        let ev = null;
        try {
          ev = (typeof window.getEvFor === 'function') ? window.getEvFor(year, abbr) : null;
        } catch (e) { }
        if (ev == null || !isFinite(ev)) {
          ev = getTotalEvForState(year, abbr);
        }
        if (ev == null || !isFinite(ev)) ev = '';

        // Create or update the label
        let t = _labelCache.get(abbr);
        const isNew = (!t || t.empty());
        if (isNew) {
          t = layer.append('text')
            .attr('class', 'state-label')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('dy', '0');
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
                enter => enter.append('circle').attr('class', 'tx-debug-dot').attr('r', 4).attr('fill', '#ff0').attr('stroke', '#000').attr('stroke-width', 1).attr('cx', fx).attr('cy', fy),
                update => update.attr('cx', fx).attr('cy', fy),
                exit => exit.remove()
              );
            }
          } catch (e) { }
        }
      } catch (e) { }
    });
    // keep labels above boundaries and districts
    try { stateLabelsLayer.raise(); } catch (e) { }
    // Post-update: quick presence check without spamming
    // try {
    //   const tx = _labelCache.get('TX');
    //   console.log('[labels] updateStateLabels done', { labelsCount: stateLabelsLayer.selectAll('text.state-label').nodes().length, hasTXLabel: !!tx && !tx.empty() });
    // } catch(e) {}
  }

  // Ensure we react immediately when the map signals it's ready, even if data loads later/earlier
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
      } catch (e) { }
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
              const id = d && d.id != null ? String(d.id).padStart(2, '0') : null;
              const abbr = id ? idToAbbr[id] : null;
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
            } catch (e) { }
          })
          .on('mousemove', function (evt) { try { if (typeof window.moveMapTip === 'function') window.moveMapTip(evt); } catch (e) { } })
          .on('mouseout', function () {
            const sel = d3.select(this);
            const orig = sel.attr('data-orig-fill') || '#2f2f2f';
            sel.attr('fill', orig);
            sel.attr('data-orig-fill', null);
            try { if (typeof window.hideMapTip === 'function') window.hideMapTip(); } catch (e) { }
          });
      } catch (e) { }
    });
  } catch (e) { }

  // Expose for manual testing: you can call window.updateStateLabels(2024) in console
  try { window.updateStateLabels = updateStateLabels; } catch (e) { }

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
    } catch (e) { }

    // Persist proportional EV mode
    try {
      const propEvToggle = document.getElementById('propEvToggle');
      if (propEvToggle && propEvToggle.checked) {
        url.searchParams.set('propEv', 'true');
      } else {
        url.searchParams.delete('propEv');
      }
    } catch (e) { }

    // No flipped URL param: we store PV overrides directly as numeric values (possibly negative)

    window.history.replaceState({}, '', url);
  }

  // Use shared formatting and color utilities if available, otherwise define locally
  function leanStr(x) {
    if (window.FormattingUtils && window.FormattingUtils.leanStr) {
      return window.FormattingUtils.leanStr(x);
    }
    if (!isFinite(x)) return '';
    if (Math.abs(x) < 0.000005) return 'EVEN';
    const s = (Math.abs(x) * 100).toFixed(1);
    return (x > 0 ? 'D+' : 'R+') + s;
  }
  try { window.leanStr = leanStr; } catch (e) { }

  function marginToColor(m, isThirdParty = false) {
    if (window.ColorUtils && window.ColorUtils.marginToColor) {
      return window.ColorUtils.marginToColor(m, isThirdParty);
    }
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
  try { window.marginToColor = marginToColor; } catch (e) { }

  function clampMargin(value) {
    if (window.FormattingUtils && window.FormattingUtils.clampMargin) {
      return window.FormattingUtils.clampMargin(value);
    }
    if (!isFinite(value)) return 0;
    const LIMIT = 1 - 1e-9;
    if (value > LIMIT) return LIMIT;
    if (value < -LIMIT) return -LIMIT;
    return value;
  }

  function totalVotesFromRow(row) {
    if (window.VoteCalculations && window.VoteCalculations.totalVotesFromRow) {
      return window.VoteCalculations.totalVotesFromRow(row);
    }
    const direct = +row.total;
    if (isFinite(direct) && direct > 0) return direct;
    const fallback = (+row.dVotes || 0) + (+row.rVotes || 0) + (+row.tVotes || 0);
    return fallback > 0 ? fallback : 0;
  }

  function computePvAdjustedBreakdown(row, pvShift = 0, natActualMargin = 0) {
    // Given a data row with dVotes, rVotes, tVotes (or total), and a desired PV shift,
    const pv = isFinite(pvShift) ? 1 * (pvShift - natActualMargin) : 0;
    //console.log({ pvShift, natActualMargin, pv });
    const totalVotes = totalVotesFromRow(row);

    let dVotesBase = Math.max(0, +row.dVotes || 0);
    let rVotesBase = Math.max(0, +row.rVotes || 0);

    let totalThirdVotes = +row.tVotes;
    if (!isFinite(totalThirdVotes) || totalThirdVotes < 0) {
      totalThirdVotes = Math.max(0, totalVotes - dVotesBase - rVotesBase);
    }
    if (totalVotes > 0) totalThirdVotes = Math.min(totalVotes, totalThirdVotes);
    else totalThirdVotes = 0;

    let topThirdVotes = +row.topThirdVotes;
    if (!isFinite(topThirdVotes) || topThirdVotes < 0) topThirdVotes = totalThirdVotes;
    topThirdVotes = Math.max(0, Math.min(totalThirdVotes, topThirdVotes));

    const otherThirdVotes = Math.max(0, totalThirdVotes - topThirdVotes);
    const twoPartyVotes = Math.max(0, totalVotes - totalThirdVotes);

    const twoPartyDenom = twoPartyVotes > EPS ? twoPartyVotes : 0;
    let baseDShareTwoParty = twoPartyDenom > 0 ? dVotesBase / twoPartyDenom : 0.5;
    if (!isFinite(baseDShareTwoParty)) baseDShareTwoParty = 0.5;
    baseDShareTwoParty = Math.max(0, Math.min(1, baseDShareTwoParty));

    const baseMargin = clampMargin(2 * baseDShareTwoParty - 1);
    const targetMargin = clampMargin(baseMargin + pv);
    const targetDShareTwoParty = (targetMargin + 1) / 2;
    const targetRShareTwoParty = 1 - targetDShareTwoParty;

    const adjustedDVotes = twoPartyVotes * targetDShareTwoParty;
    const adjustedRVotes = twoPartyVotes * targetRShareTwoParty;

    return {
      totalVotes,
      dVotes: adjustedDVotes,
      rVotes: adjustedRVotes,
      twoPartyVotes,
      totalThirdVotes,
      topThirdVotes,
      otherThirdVotes,
      baseMargin,
      targetMargin,
      twoPartyShareOfTotal: totalVotes > EPS ? twoPartyVotes / totalVotes : 0,
      topThirdShareOfTotal: totalVotes > EPS ? topThirdVotes / totalVotes : 0,
      totalThirdShareOfTotal: totalVotes > EPS ? totalThirdVotes / totalVotes : 0
    };
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

  function clampShare(value) {
    const v = Number(value);
    if (!isFinite(v) || v <= 0) return 0;
    if (v >= 1) return 1;
    return v;
  }

  function dbg() {
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

    // Build flip scenarios (metric-aware)
    window._flipByYear = new Map(); // year -> metric -> { classic/no_majority/tie: [rows] }
    const groupFD = new Map();
    (flipDetails || []).forEach(r => {
      const y = +r.year; const mode = String(r.mode || '').toLowerCase();
      const metric = (r.metric && String(r.metric).toLowerCase()) || 'votes';
      if (!y || !mode) return;
      const key = `${y}:${metric}:${mode}`;
      const arr = groupFD.get(key) || [];
      arr.push({ unit: r.abbr, ev: +r.ev || 0, votes_to_flip: +r.votes_to_flip || 0, pct_of_state_votes: +r.pct_of_state_votes || 0 });
      groupFD.set(key, arr);
    });
    // sort states by votes_to_flip ascending for determinism
    groupFD.forEach(arr => arr.sort((a, b) => (a.votes_to_flip || 0) - (b.votes_to_flip || 0)));
    // store per year/metric
    const modes = ['classic', 'no_majority', 'tie'];
    const years = new Set((flipDetails || []).map(r => +r.year));
    years.forEach(y => {
      if (!window._flipByYear.has(y)) window._flipByYear.set(y, new Map());
      const byMetric = window._flipByYear.get(y);
      // discover metrics present for this year from groupFD keys
      const metricsForYear = new Set();
      groupFD.forEach((_, key) => { const [ky, metric] = key.split(':'); if (+ky === +y) metricsForYear.add(metric); });
      if (metricsForYear.size === 0) metricsForYear.add('votes');
      metricsForYear.forEach(metric => {
        const o = {};
        modes.forEach(m => o[m] = groupFD.get(`${y}:${metric}:${m}`) || []);
        byMetric.set(metric, o);
      });
    });

    // Capture per-year total EV from flip_results.csv for accurate EV bar scaling
    window._totalEvByYear = new Map();
    try {
      (flipResults || []).forEach(r => {
        const y = +r.year;
        const tot = +r.total_ev || 0;
        if (y && isFinite(tot) && tot > 0) window._totalEvByYear.set(y, tot);
      });
    } catch (e) { /* optional */ }

    // Track available metrics per year from flip_results.csv
    window._metricsByYear = new Map(); // year -> Set(metrics)
    try {
      (flipResults || []).forEach(r => {
        const y = +r.year; const metric = (r.metric && String(r.metric).toLowerCase()) || 'votes';
        if (!y) return;
        if (!window._metricsByYear.has(y)) window._metricsByYear.set(y, new Set());
        window._metricsByYear.get(y).add(metric);
      });
    } catch (e) { }

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
        byStop.get(key).set(unit, { winner, color_css, color_name });
        // Record effective once per stop key
        if (!effByStop.has(key) && eff != null && isFinite(eff)) effByStop.set(key, eff);
      });
    } catch (e) { /* optional */ }

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
        } catch (e) { }

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
                try { if (cur && cur.toLowerCase && cur.toLowerCase() === '#ffd700') highlight = '#FFD700'; } catch (e) { }
                sel.attr('fill', highlight);
                const unit = sel.attr('data-unit');
                const tipInfo = createUnitTipInfo(unit, { label: unit });
                if (typeof window.showMapTip === 'function') window.showMapTip(evt, tipInfo.getText(), tipInfo);
              } catch (e) { }
            })
            .on('mousemove', function (evt) { try { if (typeof window.moveMapTip === 'function') window.moveMapTip(evt); } catch (e) { } })
            .on('mouseout', function () {
              try {
                const sel = d3.select(this);
                const orig = sel.attr('data-orig-fill') || 'transparent';
                sel.attr('fill', orig);
                sel.attr('data-orig-fill', null);
                if (typeof window.hideMapTip === 'function') window.hideMapTip();
              } catch (e) { }
            })
            .on('click', function () {
              if (window._futureMode) return; // disable navigation in future mode
              try {
                const unit = this.getAttribute('data-unit');
                if (unit) window.open(`unit/${unit}.html`, '_blank');
              } catch (e) { }
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
        try { d3.select('svg#map').select('g').select('.state-boundaries').raise(); } catch (e) { }
        // apply initial colors now that district paths exist
        try { updateAll(); } catch (e) { }
      } catch (e) {
        console.warn(`Couldn't render ME/NE districts: ${e && e.message ? e.message : e}`);
      }
    }).catch(() => {/* no district overlay available */ });
  });

  function getNatMargin(year) {
    const arr = byYear.get(year) || [];
    for (const r of arr) {
      if (r.unit === 'NATIONAL' || r.unit === 'NAT') return r.nm || 0;
    }
    let sum = 0, n = 0;
    arr.forEach(r => { if (isFinite(r.nm)) { sum += r.nm; n++; } });
    return n ? sum / n : 0;
  }

  function buildPvStops(year, container, datalist) {
    const cap = PV_CAP;
    // clear any prior mappings
    stopToEff.clear();
    stopToUnits.clear();

    // Build from stop_colors.csv when available
    const byYearStops = (window._stopColorsByYear && window._stopColorsByYear.get(year)) || null;
    const effByYearStops = (window._stopEffByYear && window._stopEffByYear.get(year)) || null;
    const nat = (window._futureMode && year > 2024) ? 0 : getNatMargin(year);

    try {
      //console.log('[stops] buildPvStops start', { year, hasStopColors: !!byYearStops, stopColorKeys: byYearStops ? byYearStops.size : 0, hasEff: !!effByYearStops });
      if (byYearStops) {
        const sampleKeys = Array.from(byYearStops.keys()).slice(0, 12);
        //console.log('[stops] raw stop keys (sample)', sampleKeys);
      }
    } catch (e) { }

    // Always include EVEN and (unless forced to 0 by future) Actual
    const stopsSet = new Set([0]);
    stopToEff.set(0, 0 + EPS);
    if (!(window._futureMode && year > 2024) && isFinite(nat) && Math.abs(nat) <= cap) {
      stopsSet.add(nat);
      stopToEff.set(nat, nat);
    }

    // If CSV has entries, collect all distinct stop keys and map to numeric and effective
    if (byYearStops && effByYearStops && byYearStops.size > 0) {
      // stop_key strings -> parse to number for ordering
      //try { console.log('[stops] preliminary sorted stops', stops); } catch(e) {}
      const keys = Array.from(byYearStops.keys());
      for (const k of keys) {
        const v = parseFloat(k);
        if (!isFinite(v) || Math.abs(v) > cap) continue;
        stopsSet.add(v);
        // Map effective from CSV when present; otherwise default to D-nudge
        const eff = effByYearStops.has(k) ? effByYearStops.get(k) : (v + EPS);
        stopToEff.set(v, eff);
        // Also record which units share this stop (for chips label coloring); fall back to all units mapped for the key
        const unitsMap = byYearStops.get(k);
        if (unitsMap && typeof unitsMap.forEach === 'function') {
          const list = [];
          unitsMap.forEach((_, unit) => list.push(unit));
          if (list.length) stopToUnits.set(v, list);
        }
      }
    } else {
      // Fallback: if CSV missing for this year, keep a minimal set of stops only (EVEN + Actual)
      // This avoids recomputing complex thresholds in JS, per user's request.
    }

    const stops = Array.from(stopsSet).sort((a, b) => a - b);
    // Append PV presets (if any) as extra discrete stops at the end so each preset
    // becomes an integer slider index. We keep original numeric stops sorted, then
    // add presets in the order they appear in the preset select.
    const presetStops = [];
    try {
      const presetEl = document.getElementById && document.getElementById('pvPreset');
      if (presetEl && presetEl.options && presetEl.options.length) {
        const existing = stops.slice();
        const almostEqual = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
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
          } catch (e) { }
        }
      }
    } catch (e) { }
    // Keep slider stops as the base numeric stops only. Preset stops will be rendered
    // as separate chips that set a numeric PV override (window._pvOverride) when clicked.
    const allStops = stops.slice();
    try {
      const effPreview = allStops.slice(0, 25).map(s => ({ s, eff: stopToEff.get(s), units: (stopToUnits.get(s) || []).length }));
      //console.log('[stops] finalized stops', { year, count: allStops.length, preview: effPreview });
    } catch (e) { }
    // Ensure every base stop has an effective value (keep any precomputed ones).
    for (let i = 0; i < allStops.length; i++) {
      const s = allStops[i];
      if (!stopToEff.has(s)) stopToEff.set(s, s + EPS);
    }
    // store only the base numeric stops for the slider; presets are separate
    stopsByYear.set(year, allStops);
    if (datalist) {
      // Only include base numeric stops in datalist
      datalist.innerHTML = allStops.map(v => `<option value="${(v * 100).toFixed(1)}"></option>`).join('');
      const s = document.getElementById('pvSlider');
      if (s) s.setAttribute('list', 'pvStopsList');
    }
    if (container) {
      const nat = (window._futureMode && year > 2024) ? 0 : getNatMargin(year);
      // Render main stops and presets on a separate line. Main stops first (sorted),
      // then presets on a new line so they visually stand apart. Preset chips colored
      // blue for positive (D) and red for negative (R).
      const mainHtml = stops.map((v, i) => {
        const isEven = Math.abs(v) < 1e-12;
        const isNat = ((!(window._futureMode && year > 2024)) && Math.abs(v - nat) < 1e-12);
        const unitsRaw = (stopToUnits.get(v) || []).filter(u => u !== 'NATIONAL' && u !== 'NAT');
        for (let j = 0; j < unitsRaw.length; j++) { if (unitsRaw[j] && unitsRaw[j].startsWith('PRESET:')) unitsRaw[j] = unitsRaw[j].replace(/^PRESET:/, ''); }
        const units = (isEven || isNat) ? '' : unitsRaw.slice(0, 3).map(u => u.slice(0, 5)).join(',');
        const base = isEven ? 'EVEN' : (isNat ? (leanStr(v) + ' Actual') : leanStr(v));
        const label = units ? `${base} <small style="margin-left:6px;color:var(--muted)">${units}</small>` : base;
        // Determine color same as before
        let bgColor = '#0d0d0dff';
        if (!isEven) {
          const key = Number(v).toFixed(STOP_KEY_PREC);
          const byStopCsv = byYearStops && byYearStops.get(key);
          if (byStopCsv) {
            const winners = [];
            const colors = [];
            const unitsList = unitsRaw && unitsRaw.length ? unitsRaw : Array.from(byStopCsv.keys());
            unitsList.forEach(u => { const info = byStopCsv.get(u); if (info) { winners.push(info.winner); colors.push(info.color_css || ''); } });
            if (winners.includes('T')) bgColor = (colors[winners.indexOf('T')] || 'yellow');
            else if (winners.includes('D')) bgColor = (colors[winners.indexOf('D')] || 'deepskyblue');
            else if (winners.includes('R')) bgColor = (colors[winners.indexOf('R')] || 'red');
            else if (colors.length) bgColor = colors[0];
          } else {
            // No CSV color info for this stop; keep neutral color
          }
        }
        const isYellowish = (bgColor && bgColor.toLowerCase && (bgColor.toLowerCase() === '#c9a400' || bgColor.toLowerCase() === '#ffd700' || bgColor.toLowerCase() === 'yellow'));
        const textColor = (bgColor === '#FFFFFF' || isYellowish) ? '#000' : '#fff';
        const smallColor = isYellowish ? '#000' : 'var(--muted)';
        return `<span class="btn" style="padding:4px 6px;margin:2px;background-color:${bgColor};color:${textColor}" data-idx="${i}">${label.replace('<small', `<small style=\"color:${smallColor}\"`)}</span>`;
      }).join('');
      // Preset chips: render on their own line
      const presetHtml = presetStops.map((v, pi) => {
        const idx = pi; // index into presetStops array
        const sign = (v > 0) ? 'D' : (v < 0 ? 'R' : 'EVEN');
        const label = (sign === 'EVEN') ? 'EVEN' : ((v > 0 ? 'D+' : 'R+') + (Math.abs(v) * 100).toFixed(1));
        const bg = (v > 0) ? '#4169E1' : (v < 0 ? '#B22222' : '#888888');
        const txt = (bg === '#FFFFFF') ? '#000' : '#fff';
        // store numeric value on attribute so click handler sets an override instead of slider index
        const name = null; // placeholder if we want to show preset name
        return `<span class="btn preset-chip" style="padding:4px 6px;margin:2px;background-color:${bg};color:${txt}" data-pv="${v}" data-name="${name || ''}">${label}</span>`;
      }).join('');
      container.innerHTML = 'Stops: ' + mainHtml + '<div style="margin-top:6px">Presets: ' + (presetHtml || '<span class="muted">None</span>') + '</div>';
      container.querySelectorAll('span.btn').forEach((el) => {
        el.addEventListener('click', () => {
          // Changing PV stop should reset any active flips
          try { clearFlips(); } catch (e) { }
          const pvValAttr = el.getAttribute('data-pv');
          if (pvValAttr != null) {
            // This is a preset chip: set numeric PV override instead of changing slider index
            const val = parseFloat(pvValAttr);
            if (!isNaN(val)) {
              try { window._pvOverride = val; window._pvPresetName = el.getAttribute('data-name') || null; } catch (e) { }
              try { updateAll(); } catch (e) { }
              //try { console.log('[stops] preset chip click -> set PV override', { year, val }); } catch(e) {}
            }
          } else {
            // Regular stop chip: set slider index
            const i = Number(el.getAttribute('data-idx'));
            const s = document.getElementById('pvSlider');
            try { window._pvOverride = null; } catch (e) { }
            if (s) { s.value = String(i); updateAll(); }
          }
        });
      });
    }
  }

  function init() {
    const yearSlider = document.getElementById('yearSlider');
    const pvSlider = document.getElementById('pvSlider');
    const flipMetricSel = document.getElementById('flipMetric');
    const yearVal = document.getElementById('yearVal');
    const pvVal = document.getElementById('pvVal');
    const pvStops = document.getElementById('pvStops');
    const pvStopsList = document.getElementById('pvStopsList');
    if (!yearSlider || !pvSlider) return;

    window.addEventListener('mapReady', () => updateAll());
    yearSlider.addEventListener('input', () => {
      clearFlips();
      updateAll();
      updateFlipMetricOptionsForYear();
      // Update URL with new year
      const pvEl = document.getElementById('pvSlider');
      const year = parseInt(yearSlider.value);
      const pvIndex = pvEl ? parseInt(pvEl.value) : 0;
      updateUrl(year, pvIndex, null);
    });
    // Metric change resets flips and re-renders
    if (flipMetricSel) {
      flipMetricSel.addEventListener('change', () => {
        const yEl = document.getElementById('yearSlider');
        const pvEl = document.getElementById('pvSlider');
        const yNow = yEl ? parseInt(yEl.value) : null;
        const pvIdx = pvEl ? parseInt(pvEl.value) : null;
        const hadActive = !!(window._activeFlip && window._activeFlip.year === yNow);
        const prevMode = hadActive ? window._activeFlip.mode : null;
        // Do not clear the details if open; instead, re-apply same flip mode with new metric
        if (!hadActive) { try { clearFlips(); } catch (e) { } }
        updateFlipMetricOptionsForYear();
        // If a flip is active, re-apply same mode using the new metric
        if (hadActive && prevMode) {
          try { applyFlip(prevMode); } catch (e) { updateAll(); }
        } else {
          updateAll();
        }
        // Update URL to include metric
        try {
          const flipMode = (window._activeFlip && window._activeFlip.mode) ? window._activeFlip.mode : null;
          updateUrl(yNow, pvIdx, flipMode);
        } catch (e) { }
      });
    }
    pvSlider.addEventListener('input', () => {
      // Don't clear flips if we're in the middle of applying one
      if (!window._applyingFlip) clearFlips();
      // moving the slider cancels any PV override and flipped flag
      try { window._pvOverride = null; } catch (e) { }
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
    // Default selection: prefer 2028 when in future mode (if we have data for it),
    // otherwise fall back to historical default 2024 when no data found.
    if (window._futureMode) {
      if (byYear.has(2028)) y = 2028;
      else if (y === 0) y = 2024;
    } else {
      if (y === 0) y = 2024;
    }

    // Load from URL parameters if available
    const urlParams = getUrlParams();
    if (urlParams.year && byYear.has(urlParams.year)) {
      y = urlParams.year;
    }
    // Preselect metric from URL if present
    try {
      const sel = document.getElementById('flipMetric');
      if (sel && urlParams.metric && (urlParams.metric === 'votes' || urlParams.metric === 'margin')) {
        sel.value = urlParams.metric;
      }
    } catch (e) { }

    // Preselect proportional EV mode from URL if present
    try {
      const propEvToggle = document.getElementById('propEvToggle');
      if (propEvToggle && urlParams.propEv) {
        propEvToggle.checked = true;
      }
    } catch (e) { }

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
      try { window._pvOverride = parseFloat(urlParams.pvValue); } catch (e) { window._pvOverride = null; }
      // If flipped flag present, negate the override and mark flipped state
      if (urlParams.pvValue) { try { window._pvOverride = parseFloat(urlParams.pvValue); } catch (e) { } }
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
          try { window._pvOverride = foundVal; } catch (e) { window._pvOverride = null; }
          if (urlParams.pvValue) { try { window._pvOverride = foundVal; } catch (e) { } }
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
    // Initialize metric select with available metrics for current year
    updateFlipMetricOptionsForYear();

    // buttons
    const btnClassic = document.getElementById('flipClassic');
    const btnNoMaj = document.getElementById('flipNoMaj');
    const btnTie = document.getElementById('flipTie');
    const btnReset = document.getElementById('flipReset');
    if (btnClassic) btnClassic.addEventListener('click', () => applyFlip('classic'));
    if (btnNoMaj) btnNoMaj.addEventListener('click', () => applyFlip('no_majority'));
    if (btnTie) btnTie.addEventListener('click', () => applyFlip('tie'));
    if (btnReset) btnReset.addEventListener('click', () => { clearFlips(); updateAll(); });
    // Initial button visibility update
    updateFlipButtons();

    // Initialize proportional EV mode toggle
    const propEvToggle = document.getElementById('propEvToggle');
    const propEvFooter = document.getElementById('propEvFooter');
    if (propEvToggle && propEvFooter) {
      // Show the footer and add body class for padding
      propEvFooter.style.display = 'flex';
      document.body.classList.add('has-prop-ev-toggle');

      // Add event listener for toggle changes
      propEvToggle.addEventListener('change', () => {
        // Clear any active flip scenarios when toggling proportional mode
        clearFlips();
        updateAll();

        // Update URL to preserve state
        const yearEl = document.getElementById('yearSlider');
        const pvEl = document.getElementById('pvSlider');
        const year = yearEl ? parseInt(yearEl.value) : null;
        const pvIndex = pvEl ? parseInt(pvEl.value) : null;
        updateUrl(year, pvIndex, null);
      });
    }

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
            const yearEl = document.getElementById('yearSlider'); const y = yearEl ? parseInt(yearEl.value) : 2024;
            const pvEl = document.getElementById('pvSlider');
            const stops = (stopsByYear && stopsByYear.get(y)) || [0];
            const idx = pvEl ? parseInt(pvEl.value) : 0; const stopVal = stops[idx] || 0; cur = stopVal;
          }
        } catch (e) { }
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
        if (urlParams.flip === 'classic' || urlParams.flip === 'no_majority' || urlParams.flip === 'tie') {
          applyFlip(urlParams.flip);
        }
      }, 100);
    }
  }

  function updateCandidateInfo(year) {
    const candidateNamesEl = document.getElementById('candidateNames');
    const specialNotesEl = document.getElementById('specialNotes');
    if (!candidateNamesEl || !specialNotesEl) return;

    // Get candidate names from national row for this year
    const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
    if (!rows || !rows.length) {
      candidateNamesEl.textContent = '';
      specialNotesEl.textContent = '';
      return;
    }

    const nationalRow = rows.find(r => r.unit === 'NATIONAL' || r.unit === 'NAT');
    if (!nationalRow) {
      candidateNamesEl.textContent = '';
      specialNotesEl.textContent = '';
      return;
    }

    // Update candidate names
    const dCandidate = nationalRow.dCandidate || '';
    const rCandidate = nationalRow.rCandidate || '';

    // Build base candidate line
    let candidateHtml = '';
    if (dCandidate || rCandidate) {
      candidateHtml = `${year}: ${dCandidate} (D) vs ${rCandidate} (R)`;
    }

    // Attempt to enumerate third parties that received EVs for this year.
    try {
      let allocations = null;
      try {
        if (typeof getAllEvAllocations === 'function') allocations = getAllEvAllocations();
        //console.log('allocations:', allocations);
      } catch (e) { }
      if (!allocations) {
        try { if (typeof window.getAllEvAllocations === 'function') allocations = window.getAllEvAllocations(); } catch (e) { }
      }
      const thirdPartiesWithEVs = new Map(); // Map of name -> total EV count
      let totalOtherEV = 0;
      if (allocations && Array.isArray(allocations)) {
        allocations.forEach(a => {
          //console.log('a:', a);
          totalOtherEV += (a.oEV || 0);
          // add any detailed third-party allocations
          if (a.thirdPartyEVs && typeof a.thirdPartyEVs === 'object') {
            //console.log('detailed third party EVs', a.thirdPartyEVs, 'a:', a);
            Object.keys(a.thirdPartyEVs).forEach(name => {
              const v = a.thirdPartyEVs[name] || 0;
              if (v > 0) {
                thirdPartiesWithEVs.set(name, (thirdPartiesWithEVs.get(name) || 0) + v);
              }
            });
          }
        });
      }

      // Fallback: if allocations weren't available or yielded nothing, scan rows for any
      // per-row thirdPartyResults (votes) to discover third-party names. This allows
      // candidate area to show names even if the allocation helper isn't ready yet.
      if ((thirdPartiesWithEVs.size === 0) && (!allocations || !Array.isArray(allocations) || allocations.length === 0)) {
        try {
          rows.forEach(r => {
            if (!r) return;
            // r.thirdPartyResults holds per-row third-party vote counts (if present)
            if (r.thirdPartyResults && typeof r.thirdPartyResults === 'object') {
              Object.keys(r.thirdPartyResults).forEach(name => {
                const v = r.thirdPartyResults[name] || 0;
                // We don't know EVs here, but presence of votes indicates the party existed in this unit
                if (v > 0) thirdPartiesWithEVs.set(name, (thirdPartiesWithEVs.get(name) || 0));
              });
            }
          });
        } catch (e) { /* ignore fallback failures */ }
      }

      // If there are Other EVs but no detailed names, track as generic "Other"
      if (totalOtherEV > 0 && thirdPartiesWithEVs.size === 0) {
        thirdPartiesWithEVs.set('Other', totalOtherEV);
      }

      if (candidateHtml) {
        // Compute major-party EV totals (if allocations are available)
        let totalDEv = 0, totalREv = 0;
        try {
          if (allocations && Array.isArray(allocations)) {
            totalDEv = allocations.reduce((s, a) => s + (a.dEV || 0), 0);
            totalREv = allocations.reduce((s, a) => s + (a.rEV || 0), 0);
          }
        } catch (e) { }

        // If we have EV totals, render first line with fixed-space layout so names don't jump
        if ((totalDEv > 0 || totalREv > 0) && (dCandidate || rCandidate)) {
          // left and right columns use inline-blocks with a min-width so changing names don't reflow
          const left = `${dCandidate} (D) <span style="font-variant-numeric:tabular-nums">(${totalDEv} ${totalDEv === 1 ? 'EV' : 'EVs'})</span>`;
          const right = `<span style="font-variant-numeric:tabular-nums">(${totalREv} ${totalREv === 1 ? 'EV' : 'EVs'})</span> ${rCandidate} (R)`;
          candidateHtml = `${year}: <span style="display:inline-block;min-width:260px;white-space:nowrap">${left}</span><span style="display:inline-block;width:48px;text-align:center">vs</span><span style="display:inline-block;min-width:260px;white-space:nowrap;text-align:right">${right}</span>`;
        }

        if (thirdPartiesWithEVs.size > 0) {
          // Format: "Candidate Name (X EVs)"
          const thirdPartyLines = Array.from(thirdPartiesWithEVs.entries())
            .sort((a, b) => b[1] - a[1]) // Sort by EV count descending
            .map(([name, evCount]) => `${name} (${evCount} ${evCount === 1 ? 'EV' : 'EVs'})`);
          candidateHtml += '<br>' + thirdPartyLines.join(', ');
        }
        candidateNamesEl.innerHTML = candidateHtml;
      } else {
        // No major-party names available, but maybe show third parties only
        if (thirdPartiesWithEVs.size > 0) {
          const thirdPartyLines = Array.from(thirdPartiesWithEVs.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name, evCount]) => `${name} (${evCount} ${evCount === 1 ? 'EV' : 'EVs'})`);
          candidateNamesEl.innerHTML = `${year}: ` + thirdPartyLines.join(', ');
        } else {
          candidateNamesEl.textContent = '';
        }
      }
    } catch (e) {
      // Fallback to original simple text when something goes wrong
      if (dCandidate || rCandidate) {
        candidateNamesEl.textContent = `${year}: ${dCandidate} (D) vs ${rCandidate} (R)`;
      } else {
        candidateNamesEl.textContent = '';
      }
    }

    // Update special notes: aggregate any specialCaseNotes present on any row for this year
    try {
      const rowsForYear = rows || [];
      // Map from note text -> Set of units that have that note
      const noteMap = new Map();
      rowsForYear.forEach(rr => {
        if (!rr) return;
        const raw = (rr.specialCaseNotes || '').toString().trim();
        if (!raw) return;
        const u = rr.unit || '';
        if (!noteMap.has(raw)) noteMap.set(raw, new Set());
        if (u) noteMap.get(raw).add(u);
      });

      // Build display lines. If a note applies to a single unit, prefix with unit. If it applies to multiple units (including all), show the note once without repeating.
      const lines = [];
      noteMap.forEach((unitsSet, noteText) => {
        const units = Array.from(unitsSet || []);
        if (units.length === 1) {
          lines.push(`${units[0]}: ${noteText}`);
        } else {
          // Show the note once; don't repeat across many states
          lines.push(noteText);
        }
      });

      if (lines.length > 0) {
        specialNotesEl.innerHTML = lines.join('<br>');
      } else {
        specialNotesEl.textContent = '';
      }
    } catch (e) {
      // fallback to national row note
      const specialNotes = nationalRow.specialCaseNotes || '';
      specialNotesEl.textContent = specialNotes;
    }
  }

  function updateAll() {
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
    } catch (e) { }
    // pvSlider is now an index into the stops array
    const nat = getNatMargin(year);
    // expose current for tooltip helper
    window._curYear = year;
    const pvIndex = +pvEl.value;
    const stops = stopsByYear.get(year) || [0];
    //try { console.log('[stops] updateAll current stops set', { year, count: stops.length, sample: stops.slice(0,25) }); } catch(e) {}
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
    if (override == null) {
      const eff = stopToEff.get(stopVal);
      if (eff != null && isFinite(eff) && Math.abs(pv - eff) <= STOP_EPS) {
        const list = stopToUnits.get(stopVal) || [];
        list.forEach(u => { if (u && u !== 'NATIONAL' && u !== 'NAT') matches.push(String(u).slice(0, 5)); });
      }
    }
    const showNat = ((!(window._futureMode && year > 2024)) && override == null && Math.abs(stopVal - nat) <= STOP_EPS);
    const matchLabel = (Math.abs(stopVal) < STOP_EPS) ? '' : (matches.length ? ' (' + (matches.slice(0, 6).join(',') + (matches.length > 6 ? '…' : '')) + ')' : '');
    (function () {
      const el = document.getElementById('pvVal'); if (!el) return;
      const base = (showNat ? 'Actual ' : '') + leanStr(pv) + matchLabel;
      // If a preset override is active (window._pvOverride set AND we have a name), append name in parentheses
      let out = base;
      try {
        if (typeof window._pvOverride === 'number' && isFinite(window._pvOverride) && window._pvPresetName) {
          // Avoid duplicating if already present
          if (!base.includes('(' + window._pvPresetName + ')')) out = base + ' (' + window._pvPresetName + ')';
        }
      } catch (e) { }
      el.textContent = out;
    })();

    buildPvStops(year, document.getElementById('pvStops'), document.getElementById('pvStopsList'));

    const arr = byYear.get(year) || [];
    const abbrColors = new Map();
    const unitColors = new Map();
    const unitParties = new Map(); // unit -> 'Blue'|'Red'|'Even'|'Other'
    let dEV = 0, rEV = 0, oEV = 0;
    // Build a quick lookup of votes_to_flip for active scenario
    const activeFlip = window._activeFlip && window._activeFlip.year === year ? window._activeFlip : null;
    const vtByUnit = new Map();
    if (activeFlip && Array.isArray(activeFlip.units)) {
      activeFlip.units.forEach(u => vtByUnit.set(u.unit, Math.max(0, +u.votes_to_flip || 0)));
    }
    arr.forEach(r => {
      const unit = r.unit;
      // Historical anomaly: Colorado (CO) in 1876 had no popular returns but its electors voted for Hayes (R).
      // Force a tiny Republican tilt so the map colors CO red and the EVs count for R.
      // try {
      //   if (year === 1876 && unit === 'CO') {
      //     // Push relative margin slightly negative so all sign checks treat CO as R
      //     r.rm = (typeof r.rm === 'number') ? (r.rm > 0 ? -Math.abs(EPS) : -Math.abs(EPS)) : -Math.abs(EPS);
      //     // Ensure the per-year/unit EV lookup contains 3 EVs for CO:1876
      //     try { if (window._evByUnitMap && typeof window._evByUnitMap.set === 'function') window._evByUnitMap.set(`${year}:CO`, 3); } catch(e) {}
      //   }
      // } catch(e) {}
      if (!unit || unit === 'NATIONAL') return;
      // If a flip scenario is active, flip the sign (winner reverses) by nudging margin to opposite winner by tiny epsilon
      const flipped = isUnitFlipped(year, unit);
      // Historical static: CO in 1876 should ignore national PV (treat as static Republican)
      let m = (year === 1876 && unit === 'CO') ? (+r.rm || 0) : ((+r.rm || 0) + pv);
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

      const tallies = calculateUnitVoteTallies(unit);
      let voteLeader = null;
      let voteRunner = null;
      let votesColor = null;
      let votesMargin = null;
      if (tallies && isFinite(tallies.total) && tallies.total > 0) {
        const breakdown = [
          { code: 'D', votes: Math.max(0, tallies.D || 0) },
          { code: 'R', votes: Math.max(0, tallies.R || 0) },
          { code: 'O', votes: Math.max(0, tallies.O || 0) }
        ].filter(p => p.votes > 0);
        breakdown.sort((a, b) => b.votes - a.votes);
        voteLeader = breakdown[0] || null;
        voteRunner = breakdown[1] || null;
        if (voteLeader && voteLeader.votes > 0) {
          if (voteLeader.code === 'O') {
            votesColor = '#FFD700';
            votesMargin = 0;
          } else {
            const runnerVotes = voteRunner ? voteRunner.votes : 0;
            const totalVotes = Math.max(voteLeader.votes + runnerVotes, tallies.total);
            let mv = (voteLeader.votes - runnerVotes) / Math.max(EPS, totalVotes);
            if (!isFinite(mv)) mv = 0;
            mv = clampMargin(mv);
            if (voteLeader.code === 'R') mv = -mv;
            votesMargin = mv;
            votesColor = marginToColor(mv);
          }
        }
      }
      // Special case: Alabama 1960 and Mississippi 1960 - always use fixed allocation when not R
      let counted = false;
      if (!counted && year === 1960 && (unit === 'AL' || unit === 'MS')) {
        // Determine winner using PV-adjusted margin to match other code paths
        const margin = +r.rm || 0;
        const pv = window._curPv || 0;
        const adjMargin = margin + pv;
        const winner = adjMargin >= 0 ? 'D' : 'R';

        if (winner !== 'R') {
          if (unit === 'AL') {
            // Alabama: 5 D, 6 O
            dEV += 5;
            oEV += 6;
          } else {
            // Mississippi: 0 D, all O
            dEV += 0;
            oEV += ev;
          }
        } else {
          // Republicans win: normal winner-take-all
          rEV += ev;
        }
        counted = true;
      }

      // Count EVs, ensuring the tipping-point state is included (no black sliver)
      // Third-party EV handling: classify as Other when PV is strictly within the yellow window
      if (!counted) {
        // Check if proportional EV mode is enabled
        if (isProportionalEvMode()) {
          // Proportional EV allocation using PV-adjusted vote totals so the PV slider affects allocations
          const total = +r.total || (+r.dVotes || 0) + (+r.rVotes || 0) + (+r.tVotes || 0) || 0;
          // third-party share (use thirdShare if present, else tp)
          const tp = Math.max(0, Math.min(1, (r.thirdShare != null ? +r.thirdShare : +r.tp) || 0));
          // Adjust two-party split by current PV and flips
          let rmAdj = (+r.rm || 0) + pv;
          if (flipped) rmAdj = -rmAdj;
          let twoD = 0.5 + rmAdj / 2;
          if (!isFinite(twoD)) twoD = 0.5;
          twoD = Math.max(0, Math.min(1, twoD));
          const dShare = (1 - tp) * twoD;
          const rShare = (1 - tp) * (1 - twoD);
          const tShare = tp;
          const dVotesAdj = total * dShare;
          const rVotesAdj = total * rShare;
          const tVotesAdj = total * tShare;
          const topThirdShare = +r.tp || 0;
          const allocation = allocateProportionalEVs(dVotesAdj, rVotesAdj, tVotesAdj, ev, topThirdShare, r.thirdPartyResults);
          // try {
          //   if (year === 1960) {
          //     console.log('[EV-TRACE] evBar proportional allocation', { year, unit, ev, dVotesAdj, rVotesAdj, tVotesAdj, thirdPartyResults: r.thirdPartyResults, allocation });
          //   }
          // } catch(e) {}
          dEV += allocation.D;
          rEV += allocation.R;
          oEV += allocation.O;
          // Also add any third party EVs
          if (allocation.thirdParties) {
            Object.values(allocation.thirdParties).forEach(tpEV => oEV += tpEV);
          }
          counted = true;
        } else {
          if (voteLeader && voteLeader.votes > 0) {
            if (!isNaN(ev)) {
              if (voteLeader.code === 'D') dEV += ev;
              else if (voteLeader.code === 'R') rEV += ev;
              else oEV += ev;
            }
            counted = true;
          } else {
            // Original winner-take-all fallback using PV margins
            const t = +r.tp || 0;
            const a = 3 * t - 1;
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
      const st = unit.slice(0, 2);
      const prev = abbrColors.get(st);

      // Special pluralities / fallback logic when vote tallies are unavailable
      const rVal = +(r.rm || 0);
      const tShare = +r.tp || 0;
      const thirdWindow = 3 * tShare - 1;
      let fallbackColor;
      if (year === 1948 && r.unit === 'AL') {
        fallbackColor = (pv < -rVal) ? marginToColor(m) : '#FFD700';
      } else {
        fallbackColor = marginToColor(m);
      }

      const color = votesColor || fallbackColor;
      const marginForState = (votesMargin != null) ? votesMargin : m;
      const isStateAggregate = unit.length === 2 || unit.endsWith('-AL');
      const isThirdPartyColor = color === '#FFD700';
      const shouldOverrideStateColor = !prev || isStateAggregate || isThirdPartyColor || Math.abs(marginForState) > Math.abs(prev.m);
      if (shouldOverrideStateColor) {
        abbrColors.set(st, { m: marginForState, color });
      }
      // store per-unit color and party label so district polygons can be filled individually
      unitColors.set(unit, color);
      if (voteLeader && voteLeader.code === 'O') {
        unitParties.set(unit, 'Other');
      } else {
        unitParties.set(unit, (marginForState > EPS) ? 'Blue' : ((marginForState < -EPS) ? 'Red' : 'Even'));
      }
    });

    // After per-unit colors are computed, adjust ME-AL/NE-AL statewide color to account for district flips
    (function adjustAtLargeFromDistricts() {
      const states = ['ME', 'NE'];
      for (const st of states) {
        // determine if this year has district data for this state
        const districtUnits = (st === 'ME') ? ['ME-01', 'ME-02'] : ['NE-01', 'NE-02', 'NE-03'];
        const haveAll = districtUnits.every(u => arr.some(r => r && r.unit === u));
        if (!haveAll) continue; // nothing to recompute
        // Sum D/R votes across districts, applying flips where applicable
        let dSum = 0, rSum = 0;
        for (const du of districtUnits) {
          const row = arr.find(x => x && x.unit === du);
          if (!row) continue;
          let d0 = +row.dVotes || 0;
          let r0 = +row.rVotes || 0;
          const vt = vtByUnit.get(du) || 0;
          const baseRm = (+row.rm || 0) + (window._curPv || 0);
          const flipped = isUnitFlipped(year, du);
          if (flipped) {
            // move vt votes from the original winner to the loser
            if (d0 >= r0) { d0 = Math.max(0, d0 - vt); r0 = r0 + vt; }
            else { d0 = d0 + vt; r0 = Math.max(0, r0 - vt); }
          }
          dSum += d0; rSum += r0;
        }
        const twoTot = dSum + rSum;
        if (twoTot <= 0) continue;
        let m = (dSum - rSum) / twoTot; // two-party margin D-R
        // If at-large itself is flipped, force sign to opposite side
        const alUnit = st + '-AL';
        if (isUnitFlipped(year, alUnit)) {
          m = (m > 0 ? -1e-6 : 1e-6);
        }
        const color = marginToColor(m);
        unitColors.set(alUnit, color);
        // If the state fill uses at-large color as representative, update abbrColors when |m| is stronger
        const prev = abbrColors.get(st);
        if (!prev || Math.abs(m) >= Math.abs(prev.m)) {
          abbrColors.set(st, { m, color });
        }
      }
    })();

    // Use smooth transitions for state fills
    (function () {
      if (window._electionNightActive) {
        window._electionNightLastAbbrColors = abbrColors;
        return;
      }
      const idToAbbr = { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY" };
      d3.selectAll('path.state').each(function (d) {
        const id = String(d.id).padStart(2, '0');
        const abbr = idToAbbr[id];
        const entry = abbrColors.get(abbr);
        const fill = entry ? entry.color : '#2f2f2f';
        try {
          d3.select(this)
            .transition()
            .duration(450)
            .attrTween('fill', function () {
              const current = d3.select(this).attr('fill') || '#2f2f2f';
              return d3.interpolateRgb(current, fill);
            });
        } catch (e) {
          d3.select(this).attr('fill', fill);
        }
      });
      try { raiseStateLabelsLayer(); } catch (e) { }
    })();

    // color district polygons (ME/NE) if overlay loaded
    if (window._districtPaths) {
      if (window._electionNightActive) {
        window._electionNightLastUnitColors = unitColors;
      } else {
        try {
          // Show/hide districts based on year availability
          const showME = year >= 1972;
          const showNE = year >= 1992;
          // Update both fill and visibility
          window._districtPaths.forEach((pSel, unit) => {
            // unit is expected like 'ME-01' or 'NE-02'
            const stateAbbr = unit.slice(0, 2);
            const atLargeEntry = abbrColors.get(stateAbbr);
            const atLargeColor = atLargeEntry ? atLargeEntry.color : '#2f2f2f';
            const ucolor = unitColors.get(unit) || atLargeColor || 'transparent';
            const st = stateAbbr;
            const visible = (st === 'ME' ? showME : (st === 'NE' ? showNE : true));
            try {
              // transition fill color for district polygons
              try {
                pSel.transition().duration(400).attrTween('fill', function () {
                  const cur = d3.select(this).attr('fill') || 'transparent';
                  return d3.interpolateRgb(cur, ucolor);
                });
              } catch (e) {
                pSel.attr('fill', ucolor);
              }
              pSel.attr('display', visible ? null : 'none');
              // also toggle the matching halo
              const halo = pSel.node && pSel.node().previousSibling;
              if (halo && halo.setAttribute) halo.setAttribute('display', visible ? null : 'none');

            } catch (e) { }
          });
          // after districts update, keep labels above them
          try { raiseStateLabelsLayer(); } catch (e) { }
        } catch (e) { /* ignore */ }
      }
    }

    // Use actual total EV for the selected year (fallback to 538)
    let totalEV = 538;
    try {
      const t = window._totalEvByYear && window._totalEvByYear.get(year);
      if (isFinite(t) && t > 0) totalEV = t;
    } catch (e) { }

    const otherEV = oEV || 0;
    const uEV = Math.max(0, totalEV - (dEV + rEV + otherEV));
    const dPct = totalEV ? (dEV / totalEV) * 100 : 0;
    const uPct = totalEV ? (uEV / totalEV) * 100 : 0;
    const oPct = totalEV ? (otherEV / totalEV) * 100 : 0;
    const rPct = totalEV ? (rEV / totalEV) * 100 : 0;

    const dEl = document.getElementById('evFillD');
    const uEl = document.getElementById('evFillU');
    const oEl = document.getElementById('evFillO');
    const rEl = document.getElementById('evFillR');

    const segments = [
      { el: dEl, pct: dPct, value: dEV },
      { el: uEl, pct: uPct, value: uEV },
      { el: oEl, pct: oPct, value: otherEV },
      { el: rEl, pct: rPct, value: rEV }
    ];
    let offset = 0;
    const activeSegs = [];
    // Animate bar changes smoothly by applying CSS transitions to left/right/width
    const TRANS_MS = 360;
    const TRANS_EASE = 'cubic-bezier(0.22,0.61,0.36,1)';
    segments.forEach(seg => {
      if (!seg.el) return;
      const visible = seg.value > EPS;
      seg.el.style.borderRadius = '0';
      if (!visible) {
        // hide immediately (no transition) to avoid flicker when value is zero
        try { seg.el.style.transition = 'none'; seg.el.style.willChange = 'auto'; } catch (e) { }
        seg.el.style.width = '0%';
        seg.el.style.display = 'none';
        return;
      }

      // ensure element is visible before animating
      try { seg.el.style.display = ''; } catch (e) { }
      try {
        seg.el.style.transition = `left ${TRANS_MS}ms ${TRANS_EASE}, right ${TRANS_MS}ms ${TRANS_EASE}, width ${TRANS_MS}ms ${TRANS_EASE}`;
        seg.el.style.willChange = 'left, right, width';
      } catch (e) { }

      const anchor = (seg.el.dataset && seg.el.dataset.anchor) || '';
      const widthPct = `${Math.max(0, seg.pct).toFixed(3)}%`;
      if (anchor === 'right') {
        seg.el.style.left = 'auto';
        seg.el.style.right = `${offset.toFixed(3)}%`;
        seg.el.style.width = widthPct;
      } else {
        seg.el.style.left = `${offset.toFixed(3)}%`;
        seg.el.style.right = 'auto';
        seg.el.style.width = widthPct;
      }
      offset += Math.max(0, seg.pct);
      activeSegs.push(seg.el);
    });
    if (activeSegs.length) {
      const first = activeSegs[0];
      const last = activeSegs[activeSegs.length - 1];
      first.style.borderTopLeftRadius = first.style.borderBottomLeftRadius = '9px';
      if (activeSegs.length === 1) {
        first.style.borderTopRightRadius = first.style.borderBottomRightRadius = '9px';
      } else {
        last.style.borderTopRightRadius = last.style.borderBottomRightRadius = '9px';
      }
    }

    const evText = document.getElementById('evText');
    if (evText) {
      const parts = [`D ${dEV}`];
      if (uEV > 0) parts.push(`U ${uEV}`);
      if (otherEV > 0) parts.push(`O ${otherEV}`);
      parts.push(`R ${rEV}`);
      evText.textContent = (uEV > 0 || otherEV > 0) ? parts.join(' | ') : `${dEV} - ${rEV}`;
    }
    const flipEC = document.getElementById('flipEC');
    if (flipEC) {
      const parts = [`D ${dEV}`];
      if (uEV > 0) parts.push(`U ${uEV}`);
      if (otherEV > 0) parts.push(`O ${otherEV}`);
      parts.push(`R ${rEV}`);
      flipEC.textContent = (uEV > 0 || otherEV > 0) ? parts.join(' | ') : `${dEV} - ${rEV}`;
    }

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
          const t = +r.tp || 0; const a = 3 * t - 1; const rVal = +(r.rm || 0);
          // If inside third-party (yellow) window, exclude from close list of D/R
          if (a > 0) {
            const nD = -rVal + a; const nR = -rVal - a;
            if (pv > nR + EPS && pv < nD - EPS) return; // Other wins here, not a close D/R
          }
          if (Math.abs(m) < THRESH) {
            list.push({ unit: r.unit, ev: (+r.ev || 0), m });
          }
        });
        list.sort((a, b) => Math.abs(a.m) - Math.abs(b.m));
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
          const t = +r.tp || 0; const a = 3 * t - 1; const rVal = +(r.rm || 0);
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
        function _textColorFor(bg) { try { if (!bg || bg[0] !== '#') return '#fff'; const c = bg.slice(1); const val = parseInt(c, 16); const rr = (val >> 16) & 255; const gg = (val >> 8) & 255; const bb = val & 255; const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb; return lum > 186 ? '#000' : '#fff'; } catch (e) { return '#fff'; } }
        function _smallColorFor(textCol) { return textCol === '#fff' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)'; }

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
          const relTxt = ((r.relToNat > 0) ? 'D+' : 'R+') + (Math.abs(r.relToNat) * 100).toFixed(1);
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
    } catch (e) { /* optional */ }

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
          for (const r of rows) {
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
        for (const r of rows) {
          if (!r || !r.unit || r.unit === 'NATIONAL') continue;
          // Skip district rows to avoid double counting; include -AL and normal states only
          if (r.unit.includes('-') && !r.unit.endsWith('-AL')) continue;
          const total = +r.total || (+r.dVotes + +r.rVotes + +r.tVotes) || 0;
          if (!isFinite(total) || total <= 0) continue;
          const tp = Math.max(0, Math.min(1, (r.thirdShare != null ? +r.thirdShare : +r.tp) || 0));
          const flipped = isUnitFlipped(year, r.unit);
          let rmAdj = (+r.rm || 0) + pv;
          if (flipped) rmAdj = -rmAdj; // swap two-party shares
          let twoD = 0.5 + rmAdj / 2;
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
    } catch (e) { /* non-fatal */ }

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
    } catch (e) { console.warn('[smallBoxes] error rendering side boxes', e); }

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
          items.sort((a, b) => a.delta - b.delta);
          function fmtLean(x) {
            if (!isFinite(x)) return '';
            if (Math.abs(x) < 0.000005) return 'EVEN';
            const s = (Math.abs(x) * 100).toFixed(1);
            return (x > 0 ? 'D+' : 'R+') + s;
          }
          function textColor(bg) { try { if (!bg || bg[0] !== '#') return '#fff'; const c = bg.slice(1); const val = parseInt(c, 16); const rr = (val >> 16) & 255, gg = (val >> 8) & 255, bb = val & 255; const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb; return lum > 186 ? '#000' : '#fff'; } catch (e) { return '#fff'; } }
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
    } catch (e) { /* optional */ }

    // If the baseline select is present, ensure changing it reruns updateAll
    try {
      const sel = document.getElementById('relBaseline');
      if (sel) {
        sel.addEventListener('change', () => { try { if (typeof window.updateAll === 'function') window.updateAll(); } catch (e) { } });
      }
    } catch (e) { }

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
    } catch (e) { }

    dbg('updateAll: ending successfully');
    // Update candidate names and special notes
    try { updateCandidateInfo(year); } catch (e) { }
    // Update on-map labels last so they sit on top and have current EV totals
    try { updateStateLabels(year); } catch (e) { }
    try { raiseStateLabelsLayer(); } catch (e) { }
  }

  // Expose updateAll to global scope for applyFlip
  window.updateAll = updateAll;
  // Expose small-state boxes renderer for manual testing
  try { window.renderSmallStateBoxes = renderSmallStateBoxes; } catch (e) { }

  // Expose scope variables needed by external functions
  window._stopsByYear = stopsByYear;
  window._getNatMargin = getNatMargin;
  window._STOP_EPS = STOP_EPS;
  window.updateUrl = updateUrl;

  // Expose proportional EV allocation for use in modal
  window.allocateProportionalEVs = allocateProportionalEVs;
})();

// Current metric helper and options filter
function getCurrentMetric() {
  const sel = document.getElementById('flipMetric');
  const val = sel ? String(sel.value || 'votes').toLowerCase() : 'votes';
  return (val === 'margin') ? 'margin' : 'votes';
}
function updateFlipMetricOptionsForYear() {
  try {
    const yearEl = document.getElementById('yearSlider');
    const sel = document.getElementById('flipMetric');
    if (!yearEl || !sel) return;
    const y = +yearEl.value;
    const avail = (window._metricsByYear && window._metricsByYear.get(y)) || new Set(['votes']);
    // Show/hide options based on availability
    Array.from(sel.options).forEach(opt => {
      const m = String(opt.value || '').toLowerCase();
      opt.disabled = !avail.has(m);
      // If currently selected is disabled, switch to a valid one
    });
    const cur = String(sel.value || '').toLowerCase();
    if (!avail.has(cur)) {
      sel.value = avail.has('votes') ? 'votes' : Array.from(avail)[0] || 'votes';
    }
  } catch (e) { }
}

// Access flip scenarios for current year/metric
function getFlipScenariosForYearMetric(y) {
  const byYear = window._flipByYear || new Map();
  const byMetric = byYear.get(y);
  const metric = getCurrentMetric();
  if (!byMetric) return null;
  // Backward compatibility: if map doesn't store Map metrics, treat object directly
  if (typeof byMetric.get !== 'function') return byMetric;
  return byMetric.get(metric) || byMetric.get('votes') || null;
}

// Helper for tooltip: given a unit abbr (state or district), return {ev, margin, marginStr}
window.getAdjustedInfo = function (unit) {
  try {
    const year = window._curYear;
    const pv = window._curPv || 0;
    if (!year) return null;
    const keyUnit = (unit === 'ME' || unit === 'NE') ? (unit + '-AL') : unit;
    const snapshot = (window._electionNightActive && window._electionNightSnapshot && window._electionNightSnapshot.size)
      ? window._electionNightSnapshot
      : null;
    if (snapshot) {
      const abbr = (typeof keyUnit === 'string' && keyUnit.length >= 2) ? keyUnit.slice(0, 2) : null;
      const candidates = [];
      if (unit && !candidates.includes(unit)) candidates.push(unit);
      if (keyUnit && !candidates.includes(keyUnit)) candidates.push(keyUnit);
      if (abbr && !candidates.includes(abbr)) candidates.push(abbr);
      let snap = null;
      for (const candidate of candidates) {
        if (candidate && snapshot.has(candidate)) {
          snap = snapshot.get(candidate);
          if (snap) break;
        }
      }
      if (snap) {
        let evVal = snap.ev;
        if (evVal == null) {
          try { if (typeof window.getEvFor === 'function') evVal = window.getEvFor(year, keyUnit); } catch (e) { }
        }
        const hasMargin = snap.margin != null && isFinite(snap.margin);
        const marginVal = hasMargin ? snap.margin : null;
        let marginStrVal = snap.marginStr;
        if (marginStrVal == null || marginStrVal === '') {
          if (!hasMargin) marginStrVal = 'None';
          else if (typeof leanStr === 'function') marginStrVal = leanStr(marginVal);
          else {
            const pct = (Math.abs(marginVal) * 100).toFixed(1);
            marginStrVal = `${marginVal >= 0 ? 'D' : 'R'}+${pct}`;
          }
        }
        const calledVal = !!snap.called;
        const reportingVal = (snap.reporting != null && isFinite(snap.reporting)) ? Math.max(0, Math.min(1, snap.reporting)) : 0;
        const confidenceVal = (snap.confidence != null && isFinite(snap.confidence)) ? Math.max(0, Math.min(1, snap.confidence)) : 0;
        // Normalize candidate info: prefer a candidates object with D/R/O entries when possible,
        // but also expose dCandidate/rCandidate and thirdPartyResults for backward compatibility.
        const outCandidates = {};
        try {
          if (snap.candidates && Array.isArray(snap.candidates)) {
            // Try to map array into D/R/O keys if elements include party/id hints
            snap.candidates.forEach(c => {
              try {
                if (!c) return;
                // party id may be at c.party, c.id, or c.abbr
                const pid = (c.party || c.id || c.abbr || '').toString();
                if (pid === 'D' || pid === 'Dem' || /D/i.test(pid)) outCandidates.D = c;
                else if (pid === 'R' || pid === 'GOP' || /R/i.test(pid)) outCandidates.R = c;
                else {
                  // fallback: register as a third-party candidate under O if not set
                  if (!outCandidates.O) outCandidates.O = c;
                }
              } catch (e) { }
            });
          } else if (snap.candidates && typeof snap.candidates === 'object') {
            // If already an object, copy over
            Object.assign(outCandidates, snap.candidates);
          }
        } catch (e) { }
        // Expose simple name fields if present on snap
        const dCand = (snap.dCandidate || snap.D_candidate || (outCandidates.D && outCandidates.D.name) || null);
        const rCand = (snap.rCandidate || snap.R_candidate || (outCandidates.R && outCandidates.R.name) || null);
        const thirdPartyResults = (snap.thirdPartyResults || snap.third_party_results || null);
        return {
          ev: evVal,
          margin: marginVal,
          marginStr: marginStrVal,
          called: calledVal,
          reporting: reportingVal,
          confidence: confidenceVal,
          candidates: (Object.keys(outCandidates).length ? outCandidates : (Array.isArray(snap.candidates) ? snap.candidates.slice() : [])),
          dCandidate: dCand,
          rCandidate: rCand,
          thirdPartyResults: thirdPartyResults
        };
      }
    }
    const rows = (function () {
      // byYear lives inside the IIFE; expose via window if available
      if (typeof window.getRowsForYear === 'function') return window.getRowsForYear(year);
      return null;
    })();
    // Fallback: reconstruct from CSV already parsed via closure if not exposed
    let r = null;
    if (rows && rows.length) {
      r = rows.find(x => x.unit === keyUnit);
    }
    // If closure isn't exposed, try reading from the DOM colors map via evByUnit
    // but we did store evByUnit in closure as well; we mirror EV lookup by re-reading electoral_college.csv not feasible here.
    // Instead, rely on title info for EV not available; return margin only if needed.
    let ev = null;
    try { if (typeof window.getEvFor === 'function') ev = window.getEvFor(year, keyUnit); } catch (e) { }
    if ((ev == null || isNaN(ev)) && r && isFinite(+r.ev)) ev = +r.ev;
    if (!r) return { ev, margin: null, marginStr: '', called: false, reporting: 0, confidence: 0 };
    // Default margin from row
    let m = (+r.rm || 0) + (pv || 0);
    // Special case: For ME/NE statewide tooltips, recompute at-large margin from districts when available
    try {
      const isAL = (keyUnit === 'ME-AL' || keyUnit === 'NE-AL');
      if (isAL && Array.isArray(rows) && rows.length) {
        const st = keyUnit.slice(0, 2);
        const districtUnits = (st === 'ME') ? ['ME-01', 'ME-02'] : ['NE-01', 'NE-02', 'NE-03'];
        const haveAll = districtUnits.every(u => rows.some(rr => rr && rr.unit === u));
        if (haveAll) {
          // Build a map of votes_to_flip for active scenario
          const f = window._activeFlip;
          const vtByUnit = new Map();
          if (f && f.year === year && Array.isArray(f.units)) {
            f.units.forEach(u => vtByUnit.set(u.unit, Math.max(0, +u.votes_to_flip || 0)));
          }
          let dSum = 0, rSum = 0;
          for (const du of districtUnits) {
            const row = rows.find(x => x && x.unit === du);
            if (!row) continue;
            let d0 = +row.dVotes || 0;
            let r0 = +row.rVotes || 0;
            const vt = vtByUnit.get(du) || 0;
            const flipped = (!!vt) || (f && f._set && f._set.has(du));
            if (flipped) {
              if (d0 >= r0) { d0 = Math.max(0, d0 - vt); r0 = r0 + vt; }
              else { d0 = d0 + vt; r0 = Math.max(0, r0 - vt); }
            }
            dSum += d0; rSum += r0;
          }
          const twoTot = dSum + rSum;
          if (twoTot > 0) {
            m = (dSum - rSum) / twoTot; // recomputed two-party margin
            // If at-large itself is flipped, force sign to opposite side
            const alFlipped = (f && f.year === year && f._set && f._set.has(keyUnit));
            if (alFlipped) m = (m > 0 ? -1e-6 : 1e-6);
          }
          // For ME/NE state hover, prefer showing total state EV instead of AL-only EV
          if (unit === st) {
            try {
              const parts = rows.filter(x => x && (x.unit === `${st}-AL` || x.unit.startsWith(`${st}-`)));
              const sumEv = parts.reduce((s, x) => s + (+x.ev || 0), 0);
              if (isFinite(sumEv) && sumEv > 0) ev = sumEv;
            } catch (e) { }
          }
        }
      }
    } catch (e) { /* non-fatal recompute for AL */ }
    // Check if this unit is flipped in the current scenario
    const flipped = isUnitFlipped(year, keyUnit);
    if (flipped) {
      // If flipped, reverse the winner by nudging margin to opposite side
      m = (m > 0 ? -0.000001 : 0.000001); // Use small epsilon like in updateAll
      console.log('getAdjustedInfo: unit flipped', { unit, keyUnit, originalMargin: (+r.rm || 0) + (pv || 0), flippedMargin: m });
    }
    // Build candidate info from the CSV row for tooltip consumers
    const candMap = {};
    try {
      if (r.dCandidate) candMap.D = { name: String(r.dCandidate) };
      if (r.rCandidate) candMap.R = { name: String(r.rCandidate) };
      // derive top third-party candidate name if present in parsed thirdPartyResults
      if (r.thirdPartyResults && typeof r.thirdPartyResults === 'object') {
        const entries = Object.entries(r.thirdPartyResults).map(([nm, v]) => ({ name: nm, votes: Number(v) || 0 }));
        if (entries.length) {
          entries.sort((a, b) => b.votes - a.votes);
          candMap.O = { name: String(entries[0].name) };
        }
      } else if (r.thirdPartyResults && typeof r.thirdPartyResults === 'string') {
        // if still serialized string, leave as-is and parsing elsewhere will handle it
      }

    } catch (e) { }

    return {
      ev,
      margin: m,
      marginStr: (function () {
        if (!isFinite(m)) return '';
        if (Math.abs(m) < 0.000005) return 'EVEN';

        // Check for third-party scenario (yellow window) for any year
        {
          const t = +r.tp || 0;
          const a = 3 * t - 1;
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
      })(),
      called: false,
      reporting: 0,
      confidence: 0,
      // attach candidate metadata for tooltips and other UI consumers
      candidates: (Object.keys(candMap).length ? candMap : undefined),
      dCandidate: r.dCandidate || null,
      rCandidate: r.rCandidate || null,
      thirdPartyResults: r.thirdPartyResults || null
    };
  } catch (e) { return null; }
}

// Update visibility of flip buttons based on year and scenario equality
function updateFlipButtons() {
  try {
    const yearEl = document.getElementById('yearSlider');
    const y = yearEl ? +yearEl.value : null;
    const btnClassic = document.getElementById('flipClassic');
    const btnNoMaj = document.getElementById('flipNoMaj');
    const btnTie = document.getElementById('flipTie');
    if (!btnNoMaj) return;
    const yearSc = (y != null) ? getFlipScenariosForYearMetric(y) : null;
    // No-majority button: hide if identical to classic or data missing
    if (!yearSc || !yearSc.classic || !yearSc.no_majority) {
      btnNoMaj.style.display = '';
    } else {
      const a = (yearSc.classic || []).map(r => r.unit).join('|');
      const b = (yearSc.no_majority || []).map(r => r.unit).join('|');
      btnNoMaj.style.display = (a === b) ? 'none' : '';
    }
    // Tie button: show only when tie scenario exists and is distinct from other scenarios
    try {
      if (!btnTie) {
        // nothing
      } else if (!yearSc || !yearSc.tie || !Array.isArray(yearSc.tie) || yearSc.tie.length === 0) {
        btnTie.style.display = 'none';
      } else {
        // Normalize unit lists by sorting so equality is order-insensitive
        const sortUnits = (arr) => (arr || []).map(r => String(r.unit || r).trim()).filter(x => x).sort().join('|');
        const tieUnits = sortUnits(yearSc.tie);
        const noMajUnits = sortUnits(yearSc.no_majority);
        // Show Tie only when a tie solution exists and is distinct from the break-majority solution
        btnTie.style.display = (tieUnits === '' || tieUnits === noMajUnits) ? 'none' : '';
      }
    } catch (e) { /* non-fatal */ }

    // Update active button styling to reflect current applied flip for this year
    const active = (window._activeFlip && window._activeFlip.year === y) ? window._activeFlip.mode : null;
    try {
      const btns = [btnClassic, btnNoMaj, btnTie];
      btns.forEach(b => {
        if (!b) return;
        const id = b.id || '';
        const should = (id === 'flipClassic' && active === 'classic') || (id === 'flipNoMaj' && active === 'no_majority') || (id === 'flipTie' && active === 'tie');
        if (should) b.classList.add('active'); else b.classList.remove('active');
      });
    } catch (e) { }
  } catch (e) { }
}

// Flip application state and helpers
window._activeFlip = null; // { year, mode, units: [{unit, votes_to_flip, ev}], votesSum }
function isUnitFlipped(year, unit) {
  const f = window._activeFlip; if (!f || f.year !== year) return false;
  // Historical static: CO in 1876 is not flippable (its electors voted for Hayes)
  if (year === 1876 && (unit === 'CO' || unit === 'CO-AL')) return false;
  // allow unit or at-large semantics
  if (unit === 'ME' || unit === 'NE') unit = unit + '-AL';
  const result = !!(f._set && f._set.has(unit));
  // if (f._set && f._set.size > 0) {
  //   console.log('isUnitFlipped check', {unit, hasUnit: result, setContents: Array.from(f._set)});
  // }
  return result;
}
function clearFlips() {
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
function applyFlip(mode) {
  console.log('applyFlip', mode);
  try {
    window._applyingFlip = true; // Flag to prevent clearing during PV slider change

    // Turn off proportional EV mode when applying flip scenarios
    const propEvToggle = document.getElementById('propEvToggle');
    if (propEvToggle && propEvToggle.checked) {
      propEvToggle.checked = false;
      console.log('applyFlip: disabled proportional EV mode for flip scenario');
    }

    const yearEl = document.getElementById('yearSlider');
    const year = +yearEl.value;
    const by = getFlipScenariosForYearMetric(year);
    if (!by) { try { console.log('applyFlip: no scenarios for year', year); } catch (e) { }; return; }
    const rows = by[mode] || [];
    // Toggle: if same mode is already active for this year, clear flips
    const curMetric = getCurrentMetric();
    if (window._activeFlip && window._activeFlip.year === year && window._activeFlip.mode === mode && window._activeFlip.metric === curMetric) {
      clearFlips();
      try { updateAll(); updateFlipButtons(); } catch (e) { }
      return;
    }
    try { console.log('applyFlip click', { mode, year, rows: rows.length, sample: rows.slice(0, 3) }); } catch (e) { }
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
        console.log('applyFlip: set PV slider to actual stop', { idx, natNow, stopsLength: stopsNow.length });
      }
    } catch (e) {
      console.error('applyFlip: error setting PV to actual:', e);
    }
    const set = new Set(rows.map(r => r.unit));
    const votesSum = rows.reduce((s, r) => s + (r.votes_to_flip || 0), 0);
    window._activeFlip = { year, mode, metric: curMetric, units: rows, votesSum, _set: set };
    try { console.log('applyFlip set state', { units: rows.map(r => r.unit).slice(0, 8), votesSum }); } catch (e) { }
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
    try { updateFlipButtons(); } catch (e) { }
  } catch (e) {
    console.error('applyFlip error:', e);
  } finally {
    window._applyingFlip = false; // Always clear the flag
  }
}
function renderFlipDetails() {
  try {
    const f = window._activeFlip; if (!f) return;
    const wrap = document.getElementById('flipDetailsWrap'); if (wrap) wrap.style.display = '';
    const title = document.getElementById('flipDetailsTitle');
    if (title) {
      const m = (f.metric === 'margin') ? 'min margin' : 'min votes';
      title.textContent = `Applied flips (optimize: ${m})`;
    }
    const t = document.getElementById('flipDetails'); if (!t) return;
    const year = f.year;
    const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : [];
    const byUnit = new Map(); rows.forEach(r => byUnit.set(r.unit, r));
    let html = '';
    let dEv = 0, rEv = 0;
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
      <td>${r0.toLocaleString('en-US')}<br/>→ ${r1.toLocaleString('en-US')}</td><td>${(+u.votes_to_flip || 0).toLocaleString('en-US')} (${+u.pct_of_state_votes || 0}%)</td></tr>`;
    });
    t.innerHTML = html;
    const votes = document.getElementById('flipVotes'); if (votes) votes.textContent = (f.votesSum || 0).toLocaleString('en-US');
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
    } catch (e) { }
    // EC badge is updated by updateAll; here we just ensure badge shows current numbers after next update
  } catch (e) { }
}

// ============================================================================
// EV Breakdown Modal Functionality
// ============================================================================

(function () {
  // State for the EV breakdown modal
  let currentSort = { column: 'state', ascending: true };

  // Initialize the modal when DOM is ready
  function initEvBreakdownModal() {
    const propEvToggle = document.getElementById('propEvToggle');
    const evBreakdownBtn = document.getElementById('evBreakdownBtn');
    const evBreakdownModal = document.getElementById('evBreakdownModal');
    const evBreakdownClose = document.getElementById('evBreakdownClose');

    if (!propEvToggle || !evBreakdownBtn || !evBreakdownModal) return;

    // Always show the button (regardless of proportional mode)
    evBreakdownBtn.style.display = 'inline-block';

    // Update table when proportional EV toggle changes
    propEvToggle.addEventListener('change', function () {
      // Update the table if modal is open
      if (evBreakdownModal.style.display === 'flex') {
        updateEvBreakdownTable();
      }
    });

    // Open modal
    evBreakdownBtn.addEventListener('click', function () {
      updateEvBreakdownTable();
      evBreakdownModal.style.display = 'flex';
    });

    // Close modal
    if (evBreakdownClose) {
      evBreakdownClose.addEventListener('click', function () {
        evBreakdownModal.style.display = 'none';
      });
    }

    // Close on background click
    evBreakdownModal.addEventListener('click', function (e) {
      if (e.target === evBreakdownModal) {
        evBreakdownModal.style.display = 'none';
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && evBreakdownModal.style.display === 'flex') {
        evBreakdownModal.style.display = 'none';
      }
    });

    // Add sorting listeners to table headers
    const table = document.getElementById('evBreakdownTable');
    if (table) {
      const headers = table.querySelectorAll('th.sortable');
      headers.forEach(header => {
        header.addEventListener('click', function () {
          const column = this.getAttribute('data-column');
          if (currentSort.column === column) {
            currentSort.ascending = !currentSort.ascending;
          } else {
            currentSort.column = column;
            currentSort.ascending = true;
          }
          updateEvBreakdownTable();
        });
      });
    }

    // Update table when year or PV changes (if modal is open)
    const yearSlider = document.getElementById('yearSlider');
    const pvSlider = document.getElementById('pvSlider');

    if (yearSlider) {
      yearSlider.addEventListener('input', function () {
        if (evBreakdownModal && evBreakdownModal.style.display === 'flex') {
          // Use setTimeout to ensure updateAll() has completed
          setTimeout(() => updateEvBreakdownTable(), 50);
        }
      });
    }

    if (pvSlider) {
      pvSlider.addEventListener('input', function () {
        if (evBreakdownModal && evBreakdownModal.style.display === 'flex') {
          // Use setTimeout to ensure updateAll() has completed
          setTimeout(() => updateEvBreakdownTable(), 50);
        }
      });
    }
  }

  // Get EV allocations for all states
  function getAllEvAllocations() {
    const year = window._curYear;
    if (!year) return [];

    const rows = (typeof window.getRowsForYear === 'function') ? window.getRowsForYear(year) : null;
    if (!rows || !rows.length) return [];

    const isProportional = (() => {
      try {
        const toggle = document.getElementById('propEvToggle');
        return toggle && toggle.checked;
      } catch (e) {
        return false;
      }
    })();

    const isElectionNight = window._electionNightActive || false;
    const snapshot = window._electionNightSnapshot || null;

    const allocations = [];

    // Get all unique state/unit codes (excluding NATIONAL)
    const processedStates = new Set();
    rows.forEach(r => {
      if (!r || !r.unit) return;
      const unit = r.unit;

      // Skip national totals
      if (unit === 'NATIONAL' || unit === 'NAT') return;

      // Use the unit as-is for display (including ME-01, ME-02, NE-01, NE-02, NE-03)
      let displayUnit = unit;

      // Skip duplicates
      if (processedStates.has(displayUnit)) return;
      processedStates.add(displayUnit);

      const ev = +r.ev || 0;
      if (ev <= 0) return;

      // Get state name
      const stateName = getStateName(displayUnit);

      // Initialize allocation
      let dEV = 0, rEV = 0, oEV = 0;
      let thirdPartyEVs = {}; // Store individual third party EVs
      let showBlank = false;
      let dVotes = 0, rVotes = 0, oVotes = 0;

      // Check if we should show blank (election night mode)
      if (isElectionNight && snapshot) {
        // snapshot is a Map, get the state data by unit key
        const stateData = snapshot.get(displayUnit);
        if (stateData) {
          const called = stateData.called || false;
          const reporting = stateData.reporting || 0;

          // Show blank if not called or not 100% counted
          if (!called || reporting < 0.999) {
            showBlank = true;
          } else {
            // Use election night vote counts
            dVotes = stateData.dVotes || 0;
            rVotes = stateData.rVotes || 0;
            oVotes = stateData.oVotes || 0;
          }
        } else {
          showBlank = true;
        }
      }

      // Calculate allocations if not blank
      if (!showBlank) {
        // Special case: Alabama 1960 and Mississippi 1960 - always use fixed allocation
        if (year === 1960 && (displayUnit === 'AL' || displayUnit === 'MS')) {
          // Check winner with PV adjustment (use >= 0 to match map logic)
          const margin = +r.rm || 0;
          const pv = window._curPv || 0;
          const adjMargin = margin + pv;
          const winner = adjMargin >= 0 ? 'D' : 'R';  // Match map's m >= 0 check

          if (winner !== 'R') {
            // Democrats/Third party win: use the special fixed split
            if (displayUnit === 'AL') {
              dEV = 5;  // Alabama: 5D, 6O
              oEV = 6;
            } else {
              dEV = 0;  // Mississippi: 0D, 8O
              oEV = 8;
            }
          } else {
            // Republicans win: normal winner-take-all
            rEV = ev;
          }

          // Get vote counts
          if (!isElectionNight) {
            dVotes = +r.dVotes || 0;
            rVotes = +r.rVotes || 0;
            oVotes = +r.tVotes || 0;
          }
        } else if (isProportional) {
          // Use proportional allocation
          // Get base vote counts for BOTH EV allocation AND margin display
          const baseD = +r.dVotes || 0;
          const baseR = +r.rVotes || 0;
          const baseO = +r.tVotes || 0;

          // Store the original votes for margin display (before PV adjustment)
          dVotes = baseD;
          rVotes = baseR;
          oVotes = baseO;

          if (!isElectionNight) {
            // Apply PV adjustment ONLY for EV allocation calculation
            const pv = window._curPv || 0;
            const total = +r.total || (baseD + baseR + baseO) || 0;
            let dVotesAdj = baseD;
            let rVotesAdj = baseR;
            let oVotesAdj = baseO;

            if (total > 0 && pv !== 0) {
              // Apply uniform swing adjustment for EV allocation
              const rm = +r.rm || 0;
              const adjMargin = rm + pv;
              const tp = Math.max(0, Math.min(1, (r.thirdShare != null ? +r.thirdShare : +r.tp) || 0));

              // Calculate adjusted two-party share
              let twoD = 0.5 + adjMargin / 2;
              twoD = Math.max(0, Math.min(1, twoD));

              const dShare = (1 - tp) * twoD;
              const rShare = (1 - tp) * (1 - twoD);
              const oShare = tp;

              dVotesAdj = total * dShare;
              rVotesAdj = total * rShare;
              oVotesAdj = total * oShare;
            }

            // Allocate EVs proportionally using adjusted votes
            const allocFn = window.allocateProportionalEVs || function (d, r, o, ev) {
              // Fallback if function not available
              return { D: 0, R: 0, O: 0, thirdParties: {} };
            };
            const alloc = allocFn(dVotesAdj, rVotesAdj, oVotesAdj, ev, +r.tp || 0, r.thirdPartyResults);
            dEV = alloc.D;
            rEV = alloc.R;
            oEV = alloc.O;
            // Store third party allocations if they exist
            thirdPartyEVs = alloc.thirdParties || {};
          }
        } else {
          // Winner-take-all - match map logic exactly
          const margin = +r.rm || 0;
          const pv = window._curPv || 0;
          const adjMargin = margin + pv;

          // Check if this is a third party winner (color = 'yellow')
          const isThirdPartyWinner = (r.color === 'yellow' || r.color === '#C9A400');

          if (isThirdPartyWinner) {
            // Third party won - allocate all EVs to O
            oEV = ev;
          } else {
            // Normal two-party winner-take-all
            // Match the map's logic from updateAll()
            if (adjMargin > 0) {
              dEV = ev;
            } else if (adjMargin < 0) {
              rEV = ev;
            } else {
              // Tie-breaking: match map's logic (line 2083-2085)
              // Get national margin and stop value for tie-breaking
              const nat = (typeof getNatMargin === 'function') ? getNatMargin(year) : 0;
              const stopVal = pv;  // Current PV is the stop value
              const side = Math.sign((stopVal || 0) - (nat || 0));
              if (side >= 0) dEV = ev;
              else rEV = ev;
            }
          }

          // Get vote counts
          if (!isElectionNight) {
            dVotes = +r.dVotes || 0;
            rVotes = +r.rVotes || 0;
            oVotes = +r.tVotes || 0;
          }
        }
      }

      // If there are Other EVs but we don't have a detailed thirdPartyEVs
      // mapping, infer a breakdown. However, when NOT in proportional mode
      // (winner-take-all), don't proportionally split O EVs across multiple
      // third-party names — instead give the entire O block to the single
      // top third-party candidate (by votes). Proportional splitting only
      // applies when proportional mode is active.
      if (!showBlank && oEV > 0 && Object.keys(thirdPartyEVs || {}).length === 0) {
        try {
          const tpVotes = (r.thirdPartyResults && typeof r.thirdPartyResults === 'object') ? r.thirdPartyResults : {};
          const tpNames = Object.keys(tpVotes).filter(n => (tpVotes[n] || 0) > 0);

          // If we're in proportional mode, keep the existing floor+largest-fractions
          // behavior to split O EVs among third parties.
          if (typeof isProportional !== 'undefined' && isProportional) {
            if (tpNames.length > 0) {
              const totalTpVotes = tpNames.reduce((s, n) => s + (+tpVotes[n] || 0), 0);
              if (totalTpVotes > 0) {
                // Proportionally assign integer EVs using floor+largest-fractions method
                const floats = tpNames.map(name => {
                  const raw = (oEV * (+tpVotes[name] || 0)) / totalTpVotes;
                  return { name, raw, frac: raw - Math.floor(raw), assigned: Math.floor(raw) };
                });
                let assignedSum = floats.reduce((s, f) => s + f.assigned, 0);
                let remaining = oEV - assignedSum;
                // Sort by fractional part descending to distribute remainders fairly
                floats.sort((a, b) => b.frac - a.frac);
                let idx = 0;
                while (remaining > 0 && floats.length > 0) {
                  floats[idx % floats.length].assigned += 1;
                  remaining -= 1;
                  idx += 1;
                }
                const allocMap = {};
                floats.forEach(f => { if (f.assigned > 0) allocMap[f.name] = f.assigned; });
                // If rounding produced no assignments (shouldn't), fall back to Other
                thirdPartyEVs = Object.keys(allocMap).length ? allocMap : { Other: oEV };
              } else {
                // No vote totals for third parties, but names exist: give the whole
                // O EV block to the first listed third party to at least surface a name
                const map = {}; map[tpNames[0]] = oEV; thirdPartyEVs = map;
              }
            } else {
              // No per-row third-party vote info available: fall back to generic
              thirdPartyEVs = { Other: oEV };
            }
          } else {
            // Winner-take-all: give all O EVs to the top third-party candidate (if any)
            if (tpNames.length > 0) {
              // Find the third-party with the maximum votes
              let topName = tpNames[0];
              for (let i = 1; i < tpNames.length; i++) {
                const n = tpNames[i];
                if ((+tpVotes[n] || 0) > (+tpVotes[topName] || 0)) topName = n;
              }
              const map = {};
              map[topName] = oEV;
              thirdPartyEVs = map;
            } else {
              thirdPartyEVs = { Other: oEV };
            }
          }
        } catch (e) {
          thirdPartyEVs = { Other: oEV };
        }
      }

      // Calculate vote percentages for margin column
      let dPct = 0, rPct = 0, oPct = 0;
      if (!showBlank && (dVotes > 0 || rVotes > 0 || oVotes > 0)) {
        const totalVotes = dVotes + rVotes + oVotes;
        if (totalVotes > 0) {
          dPct = (dVotes / totalVotes) * 100;
          rPct = (rVotes / totalVotes) * 100;
          oPct = (oVotes / totalVotes) * 100;
        }
      }

      allocations.push({
        state: displayUnit,
        stateName: stateName,
        dEV: showBlank ? null : dEV,
        rEV: showBlank ? null : rEV,
        oEV: showBlank ? null : oEV,
        thirdPartyEVs: showBlank ? {} : thirdPartyEVs, // Include third party EVs
        thirdPartyVotes: showBlank ? {} : (r.thirdPartyResults || {}), // Include third party votes for tooltips
        totalEV: ev,
        dVotes: showBlank ? null : dVotes,
        rVotes: showBlank ? null : rVotes,
        oVotes: showBlank ? null : oVotes,
        dPct: showBlank ? null : dPct,
        rPct: showBlank ? null : rPct,
        oPct: showBlank ? null : oPct,
        dCandidate: r.dCandidate || '', // Add candidate names
        rCandidate: r.rCandidate || '',
        showBlank: showBlank
      });
    });

    return allocations;
  }

  // Get full state name from abbreviation
  function getStateName(abbr) {
    const STATE_NAMES = {
      'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
      'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'DC': 'District of Columbia',
      'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois',
      'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana',
      'ME': 'Maine', 'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota',
      'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
      'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
      'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma', 'OR': 'Oregon',
      'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina', 'SD': 'South Dakota',
      'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia',
      'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming'
    };

    // Handle ME-AL, NE-AL, ME-01, NE-02, etc.
    if (abbr.includes('-')) {
      const parts = abbr.split('-');
      const state = STATE_NAMES[parts[0]] || parts[0];
      if (parts[1] === 'AL') {
        return `${state} At-Large`;
      } else {
        return `${state} CD-${parts[1]}`;
      }
    }

    return STATE_NAMES[abbr] || abbr;
  }

  // Sort allocations based on current sort state
  function sortAllocations(allocations) {
    const sorted = [...allocations];
    const { column, ascending } = currentSort;

    sorted.sort((a, b) => {
      let aVal, bVal;

      switch (column) {
        case 'state':
          aVal = a.stateName;
          bVal = b.stateName;
          break;
        case 'margin':
          // Sort by Democratic percentage
          aVal = a.dPct === null ? -1 : a.dPct;
          bVal = b.dPct === null ? -1 : b.dPct;
          break;
        case 'd':
          aVal = a.dEV === null ? -1 : a.dEV;
          bVal = b.dEV === null ? -1 : b.dEV;
          break;
        case 'r':
          aVal = a.rEV === null ? -1 : a.rEV;
          bVal = b.rEV === null ? -1 : b.rEV;
          break;
        case 'o':
          aVal = a.oEV === null ? -1 : a.oEV;
          bVal = b.oEV === null ? -1 : b.oEV;
          break;
        case 'total':
          aVal = a.totalEV;
          bVal = b.totalEV;
          break;
        default:
          // Handle third party columns (tp-NAME format)
          if (column && column.startsWith('tp-')) {
            const tpName = column.substring(3);
            aVal = (a.thirdPartyEVs && a.thirdPartyEVs[tpName]) || 0;
            bVal = (b.thirdPartyEVs && b.thirdPartyEVs[tpName]) || 0;
          } else {
            return 0;
          }
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return ascending ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      } else {
        return ascending ? (aVal - bVal) : (bVal - aVal);
      }
    });

    return sorted;
  }

  // Update the table with current data
  // Update the table with current data
  function updateEvBreakdownTable() {
    const tbody = document.getElementById('evBreakdownBody');
    const table = document.getElementById('evBreakdownTable');
    if (!tbody || !table) return;

    // Get and sort allocations
    const allocations = getAllEvAllocations();
    const sorted = sortAllocations(allocations);

    // Check if proportional mode is enabled
    const isProportional = (() => {
      try {
        const toggle = document.getElementById('propEvToggle');
        return toggle && toggle.checked;
      } catch (e) {
        return false;
      }
    })();

    // Determine if we need third party columns and get candidate names + totals
    let dCandidate = '';
    let rCandidate = '';
    const thirdPartyNames = new Set();
    let hasAnyThirdPartyEVs = false;
    const thirdPartyTotals = {}; // name -> EV total across states
    let totalOtherEV_ForHeader = 0; // aggregate O EVs when no detailed breakdown

    sorted.forEach(alloc => {
      if (!dCandidate && alloc.dCandidate) dCandidate = alloc.dCandidate;
      if (!rCandidate && alloc.rCandidate) rCandidate = alloc.rCandidate;

      // Check for detailed third party EVs and accumulate totals
      if (alloc.thirdPartyEVs && typeof alloc.thirdPartyEVs === 'object') {
        Object.keys(alloc.thirdPartyEVs).forEach(name => {
          const v = alloc.thirdPartyEVs[name] || 0;
          if (v > 0) {
            thirdPartyNames.add(name);
            hasAnyThirdPartyEVs = true;
            thirdPartyTotals[name] = (thirdPartyTotals[name] || 0) + v;
          }
        });
      }
      // Aggregate generic Other EVs
      if (alloc.oEV > 0) {
        hasAnyThirdPartyEVs = true;
        totalOtherEV_ForHeader += alloc.oEV;
      }
    });

    const hasDetailedThirdParties = thirdPartyNames.size > 0;
    const thirdPartyList = Array.from(thirdPartyNames).sort();

    // Also inject third-party names into candidate display area so they appear under D vs R
    try {
      const candidateNamesEl = document.getElementById('candidateNames');
      if (candidateNamesEl) {
        const base = (dCandidate || rCandidate) ? `${(window._curYear || '')} : ${dCandidate} (D) vs ${rCandidate} (R)` : '';
        let extra = '';
        if (thirdPartyList.length > 0) {
          // Include EV counts for each third party when available
          extra = '<br>' + thirdPartyList.map(name => {
            const cnt = thirdPartyTotals[name] || 0;
            return cnt > 0 ? `${name} (${cnt} ${cnt === 1 ? 'EV' : 'EVs'})` : name;
          }).join(', ');
        } else if (hasAnyThirdPartyEVs && thirdPartyList.length === 0) {
          // Generic Other with aggregate EVs if present
          extra = '<br>Other' + (totalOtherEV_ForHeader > 0 ? ` (${totalOtherEV_ForHeader} EVs)` : '');
        }
        if (base || extra) candidateNamesEl.innerHTML = (base || '') + extra;
      }
    } catch (e) { }

    // Show O EVs column only if: proportional mode is on, OR any third party got EVs
    const showOColumn = isProportional || hasAnyThirdPartyEVs;

    // Helper to get last name
    const getLastName = (fullName) => {
      if (!fullName) return '';
      const parts = fullName.trim().split(/\s+/);
      return parts[parts.length - 1];
    };

    // Update table headers
    const thead = table.querySelector('thead');
    if (thead) {
      const headerRow = thead.querySelector('tr');
      if (headerRow) {
        headerRow.innerHTML = '';

        // State column
        const stateHeader = document.createElement('th');
        stateHeader.className = 'sortable';
        stateHeader.setAttribute('data-column', 'state');
        stateHeader.textContent = 'State';
        headerRow.appendChild(stateHeader);

        // Margin column (now just D% and R%)
        const marginHeader = document.createElement('th');
        marginHeader.className = 'sortable';
        marginHeader.setAttribute('data-column', 'margin');
        marginHeader.textContent = 'Margin (D%, R%)';
        headerRow.appendChild(marginHeader);

        // D EVs column with candidate name in format "Obama (D) EVs"
        const dHeader = document.createElement('th');
        dHeader.className = 'sortable';
        dHeader.setAttribute('data-column', 'd');
        const dLastName = getLastName(dCandidate);
        dHeader.textContent = dLastName ? `${dLastName} (D) EVs` : 'D EVs';
        headerRow.appendChild(dHeader);

        // R EVs column with candidate name in format "Romney (R) EVs"
        const rHeader = document.createElement('th');
        rHeader.className = 'sortable';
        rHeader.setAttribute('data-column', 'r');
        const rLastName = getLastName(rCandidate);
        rHeader.textContent = rLastName ? `${rLastName} (R) EVs` : 'R EVs';
        headerRow.appendChild(rHeader);

        // Third party columns (if any have EVs in proportional mode or detailed third parties)
        if (hasDetailedThirdParties) {
          thirdPartyList.forEach(name => {
            const tpHeader = document.createElement('th');
            tpHeader.className = 'sortable';
            tpHeader.setAttribute('data-column', `tp-${name}`);
            tpHeader.textContent = `${name} EVs`;
            headerRow.appendChild(tpHeader);
          });
        } else if (showOColumn) {
          // O EVs column (traditional third party aggregate)
          const oHeader = document.createElement('th');
          oHeader.className = 'sortable';
          oHeader.setAttribute('data-column', 'o');
          oHeader.textContent = 'O EVs';
          headerRow.appendChild(oHeader);
        }

        // Total EVs column
        const totalHeader = document.createElement('th');
        totalHeader.className = 'sortable';
        totalHeader.setAttribute('data-column', 'total');
        totalHeader.textContent = 'Total EVs';
        headerRow.appendChild(totalHeader);
      }
    }

    // Re-add click handlers to new headers
    const headers = table.querySelectorAll('th.sortable');
    headers.forEach(header => {
      const column = header.getAttribute('data-column');
      // Remove old listeners by cloning
      const newHeader = header.cloneNode(true);
      header.parentNode.replaceChild(newHeader, header);

      newHeader.addEventListener('click', function () {
        if (currentSort.column === column) {
          currentSort.ascending = !currentSort.ascending;
        } else {
          currentSort.column = column;
          currentSort.ascending = true;
        }
        updateEvBreakdownTable();
      });

      // Update sort indicators
      newHeader.classList.remove('sorted-asc', 'sorted-desc');
      if (column === currentSort.column) {
        newHeader.classList.add(currentSort.ascending ? 'sorted-asc' : 'sorted-desc');
      }
    });

    // Build table rows
    tbody.innerHTML = '';

    // Calculate totals
    let totalD = 0, totalR = 0, totalO = 0, totalAll = 0;
    const totalThirdParties = {};
    thirdPartyList.forEach(name => totalThirdParties[name] = 0);

    sorted.forEach(alloc => {
      const row = document.createElement('tr');
      row.setAttribute('data-state', alloc.state);

      // State name cell (with hover tooltip showing last names)
      const stateCell = document.createElement('td');
      stateCell.textContent = alloc.stateName;
      if (!alloc.showBlank && alloc.dVotes !== null) {
        const formatter = (x) => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '0';
        const voteInfo = [];
        if (alloc.dVotes > 0) {
          const dLastName = getLastName(alloc.dCandidate);
          voteInfo.push(`D${dLastName ? ' (' + dLastName + ')' : ''}: ${formatter(alloc.dVotes)}`);
        }
        if (alloc.rVotes > 0) {
          const rLastName = getLastName(alloc.rCandidate);
          voteInfo.push(`R${rLastName ? ' (' + rLastName + ')' : ''}: ${formatter(alloc.rVotes)}`);
        }
        if (alloc.oVotes > 0) voteInfo.push(`O: ${formatter(alloc.oVotes)}`);
        stateCell.title = voteInfo.join(' | ');
      }
      row.appendChild(stateCell);

      // Margin column (D% and R% only)
      const marginCell = document.createElement('td');
      if (alloc.showBlank) {
        marginCell.textContent = '—';
        marginCell.classList.add('blank-entry');
      } else {
        const dPct = alloc.dPct || 0;
        const rPct = alloc.rPct || 0;
        marginCell.textContent = `${dPct.toFixed(1)}%, ${rPct.toFixed(1)}%`;
      }
      row.appendChild(marginCell);

      // D EVs
      const dCell = document.createElement('td');
      if (alloc.showBlank) {
        dCell.textContent = '—';
        dCell.classList.add('blank-entry');
      } else {
        const dEV = alloc.dEV || 0;
        const percent = alloc.totalEV > 0 ? Math.round((dEV / alloc.totalEV) * 100) : 0;
        dCell.textContent = dEV > 0 ? `${dEV} (${percent}%)` : dEV;
        totalD += dEV;
      }
      row.appendChild(dCell);

      // R EVs
      const rCell = document.createElement('td');
      if (alloc.showBlank) {
        rCell.textContent = '—';
        rCell.classList.add('blank-entry');
      } else {
        const rEV = alloc.rEV || 0;
        const percent = alloc.totalEV > 0 ? Math.round((rEV / alloc.totalEV) * 100) : 0;
        rCell.textContent = rEV > 0 ? `${rEV} (${percent}%)` : rEV;
        totalR += rEV;
      }
      row.appendChild(rCell);

      // Third party EVs (either individual columns or aggregate O column)
      if (hasDetailedThirdParties) {
        // Show individual third party columns with tooltips
        thirdPartyList.forEach(name => {
          const tpCell = document.createElement('td');
          if (alloc.showBlank) {
            tpCell.textContent = '—';
            tpCell.classList.add('blank-entry');
          } else {
            const tpEV = (alloc.thirdPartyEVs && alloc.thirdPartyEVs[name]) || 0;
            const percent = alloc.totalEV > 0 ? Math.round((tpEV / alloc.totalEV) * 100) : 0;
            tpCell.textContent = tpEV > 0 ? `${tpEV} (${percent}%)` : tpEV;
            totalThirdParties[name] = (totalThirdParties[name] || 0) + tpEV;

            // Add tooltip with vote information
            if (alloc.thirdPartyVotes && alloc.thirdPartyVotes[name]) {
              const formatter = (x) => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '0';
              const votes = alloc.thirdPartyVotes[name];
              const totalVotes = alloc.dVotes + alloc.rVotes + alloc.oVotes;
              const votePct = totalVotes > 0 ? ((votes / totalVotes) * 100).toFixed(1) : '0.0';
              tpCell.title = `${formatter(votes)} votes (${votePct}%)`;
            }
          }
          row.appendChild(tpCell);
        });
      } else if (showOColumn) {
        // Show traditional O EVs column with tooltip
        const oCell = document.createElement('td');
        if (alloc.showBlank) {
          oCell.textContent = '—';
          oCell.classList.add('blank-entry');
        } else {
          const oEV = alloc.oEV || 0;
          const percent = alloc.totalEV > 0 ? Math.round((oEV / alloc.totalEV) * 100) : 0;
          oCell.textContent = oEV > 0 ? `${oEV} (${percent}%)` : oEV;
          totalO += oEV;

          // Add tooltip with vote information
          if (alloc.oVotes > 0) {
            const formatter = (x) => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '0';
            const totalVotes = alloc.dVotes + alloc.rVotes + alloc.oVotes;
            const votePct = totalVotes > 0 ? ((alloc.oVotes / totalVotes) * 100).toFixed(1) : '0.0';
            oCell.title = `${formatter(alloc.oVotes)} votes (${votePct}%)`;
          }
        }
        row.appendChild(oCell);
      }

      // Total EVs (always shown)
      const totalCell = document.createElement('td');
      totalCell.textContent = alloc.totalEV;
      totalAll += alloc.totalEV;
      row.appendChild(totalCell);

      tbody.appendChild(row);
    });

    // Add total row
    const totalRow = document.createElement('tr');
    totalRow.classList.add('total-row');

    const totalLabelCell = document.createElement('td');
    totalLabelCell.textContent = 'Total';
    totalLabelCell.style.fontWeight = 'bold';
    totalRow.appendChild(totalLabelCell);

    // Empty cell for margin column in total row
    const totalMarginCell = document.createElement('td');
    totalMarginCell.textContent = '—';
    totalMarginCell.style.fontWeight = 'bold';
    totalRow.appendChild(totalMarginCell);

    const totalDCell = document.createElement('td');
    const totalDPercent = totalAll > 0 ? ((totalD / totalAll) * 100).toFixed(1) : '0.0';
    totalDCell.textContent = totalD > 0 ? `${totalD} (${totalDPercent}%)` : totalD;
    totalDCell.style.fontWeight = 'bold';
    totalRow.appendChild(totalDCell);

    const totalRCell = document.createElement('td');
    const totalRPercent = totalAll > 0 ? ((totalR / totalAll) * 100).toFixed(1) : '0.0';
    totalRCell.textContent = totalR > 0 ? `${totalR} (${totalRPercent}%)` : totalR;
    totalRCell.style.fontWeight = 'bold';
    totalRow.appendChild(totalRCell);

    // Third party totals (either individual columns or aggregate O column)
    if (hasDetailedThirdParties) {
      thirdPartyList.forEach(name => {
        const tpTotalCell = document.createElement('td');
        const tpTotal = totalThirdParties[name] || 0;
        const tpPercent = totalAll > 0 ? ((tpTotal / totalAll) * 100).toFixed(1) : '0.0';
        tpTotalCell.textContent = tpTotal > 0 ? `${tpTotal} (${tpPercent}%)` : tpTotal;
        tpTotalCell.style.fontWeight = 'bold';
        totalRow.appendChild(tpTotalCell);
      });
    } else if (showOColumn) {
      const totalOCell = document.createElement('td');
      const totalOPercent = totalAll > 0 ? ((totalO / totalAll) * 100).toFixed(1) : '0.0';
      totalOCell.textContent = totalO > 0 ? `${totalO} (${totalOPercent}%)` : totalO;
      totalOCell.style.fontWeight = 'bold';
      totalRow.appendChild(totalOCell);
    }

    const totalAllCell = document.createElement('td');
    totalAllCell.textContent = totalAll;
    totalAllCell.style.fontWeight = 'bold';
    totalRow.appendChild(totalAllCell);

    tbody.appendChild(totalRow);
  }

  // Expose update function globally so it can be called during election night
  window.updateEvBreakdownTable = updateEvBreakdownTable;

  // Also expose the allocations helper so other UI code can call it directly
  try { if (typeof getAllEvAllocations === 'function') window.getAllEvAllocations = getAllEvAllocations; } catch (e) { }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEvBreakdownModal);
  } else {
    initEvBreakdownModal();
  }
})();
// Expose helper to global scope so other UI bits can call it
try { if (typeof getAllEvAllocations === 'function') window.getAllEvAllocations = getAllEvAllocations; } catch (e) { }


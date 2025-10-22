'use strict';

export function createUpdateAll(deps) {
  const {
    byYear,
    evByUnit,
    stopToEff,
    stopToUnits,
    stopsByYear,
    buildPvStops,
    STOP_EPS,
    EPS,
    leanStr,
    fmtLean,
    marginToColor,
    calculateUnitVoteTallies,
    clampMargin,
    getNatMargin,
    isUnitFlipped,
    allocateProportionalEVs,
    isProportionalEvMode,
    updateFlipButtons,
    updateCandidateInfo,
    updateStateLabels,
    refreshMapDecorations,
    dbg,
    shouldAggregateAtLarge,
    getAtLargeAdjustedTotals,
    idToAbbr,
    d3
  } = deps;

  function getDomRefs() {
    if (typeof document === 'undefined') return null;
    const yearSlider = document.getElementById('yearSlider');
    const pvSlider = document.getElementById('pvSlider');
    if (!yearSlider || !pvSlider) return null;
    return {
      yearSlider,
      pvSlider,
      yearVal: document.getElementById('yearVal'),
      pvVal: document.getElementById('pvVal'),
      pvStops: document.getElementById('pvStops'),
      pvStopsList: document.getElementById('pvStopsList'),
      evFillD: document.getElementById('evFillD'),
      evFillU: document.getElementById('evFillU'),
      evFillO: document.getElementById('evFillO'),
      evFillR: document.getElementById('evFillR'),
      evText: document.getElementById('evText'),
      pvResetActual: document.getElementById('pvResetActual'),
      pvTippingBtn: document.getElementById('pvTipping'),
      flipEC: document.getElementById('flipEC'),
      closeStates: document.getElementById('closeStates'),
      pvDem: document.getElementById('pvDem'),
      pvRep: document.getElementById('pvRep'),
      pvOth: document.getElementById('pvOth'),
      pvTot: document.getElementById('pvTot'),
      relBaseline: document.getElementById('relBaseline'),
      relDeltas: document.getElementById('relDeltas'),
      relDeltasList: document.getElementById('relDeltasList'),
      relDeltasTitle: document.getElementById('relDeltasTitle')
    };
  }

  function syncStopsForYear(year, refs, updateFn) {
    if (window._prevYear === year) return;
    const extraPresets = (typeof window !== 'undefined' && Array.isArray(window._pvExtraPresets)) ? window._pvExtraPresets : [];
    const injectNegativePresets = (typeof window !== 'undefined') ? !!window._injectNegativePresets : false;
    buildPvStops(year, {
      container: refs.pvStops,
      datalist: refs.pvStopsList,
      getNatMargin,
      updateAll: updateFn,
      extraPresets,
      injectNegativePresets
    });
    const stopsNow = stopsByYear.get(year) || [0];
    const natNow = getNatMargin(year);
    let idx = stopsNow.findIndex(v => Math.abs(v - natNow) <= STOP_EPS);
    if (idx < 0) idx = stopsNow.findIndex(v => Math.abs(v) <= STOP_EPS);
    if (idx < 0) idx = 0;
    refs.pvSlider.min = 0;
    refs.pvSlider.max = Math.max(0, stopsNow.length - 1);
    refs.pvSlider.step = 1;
    refs.pvSlider.value = String(idx);
    window._prevYear = year;
  }

  function getPvState(year, refs) {
    const stops = stopsByYear.get(year) || [0];
    const nat = getNatMargin(year);
    let pvIndex = Number(refs.pvSlider.value);
    if (!Number.isFinite(pvIndex) || pvIndex < 0 || pvIndex >= stops.length) pvIndex = 0;
    const stopVal = (stops && stops.length > 0 && stops[pvIndex] !== undefined) ? stops[pvIndex] : 0;
    const override = (typeof window._pvOverride === 'number' && isFinite(window._pvOverride)) ? window._pvOverride : null;
    const pv = (override != null) ? override : (stopToEff.get(stopVal) || (stopVal + EPS * (stopVal === 0 ? 1 : Math.sign(stopVal - nat))));

    const matches = [];
    if (override == null) {
      const eff = stopToEff.get(stopVal);
      if (eff != null && isFinite(eff) && Math.abs(pv - eff) <= STOP_EPS) {
        const list = stopToUnits.get(stopVal) || [];
          list.forEach(u => {
            if (!u || u === 'NATIONAL' || u === 'NAT') return;
            const s = String(u);
            if (s.startsWith('PRESET:')) {
              matches.push(s.replace(/^PRESET:/, ''));
            } else {
              matches.push(s.slice(0, 5));
            }
          });
      }
    }
    const showNat = ((!(window._futureMode && year > 2024)) && override == null && Math.abs(stopVal - nat) <= STOP_EPS);

    return { stops, nat, pvIndex, stopVal, override, pv, matches, showNat };
  }

  function updatePvLabel(refs, pvState) {
    const { pvVal } = refs;
    if (!pvVal) return;
    const { pv, matches, showNat } = pvState;
    const matchLabel = (Math.abs(pvState.stopVal) < STOP_EPS) ? '' : (matches.length ? ' (' + (matches.slice(0, 6).join(',') + (matches.length > 6 ? '…' : '')) + ')' : '');
    const base = (showNat ? 'Actual ' : '') + leanStr(pv) + matchLabel;
    let out = base;
    try {
      if (typeof window._pvOverride === 'number' && isFinite(window._pvOverride) && window._pvPresetName) {
        if (!base.includes('(' + window._pvPresetName + ')')) out = base + ' (' + window._pvPresetName + ')';
      }
    } catch (e) { console.warn(e); }
    pvVal.textContent = out;
  }

  const tippingInfoByYear = new Map();

  function computeMapState(year, pvState) {
    const { pv, nat, stopVal } = pvState;
    const arr = byYear.get(year) || [];
    const abbrColors = new Map();
    const unitColors = new Map();
    const unitParties = new Map();
    let dEV = 0; let rEV = 0; let oEV = 0;

    const activeFlip = window._activeFlip && window._activeFlip.year === year ? window._activeFlip : null;

    if (activeFlip && window._activeFlip && window._activeFlip.year === year) {
      console.log('Active flip debug:', {
        flipUnits: window._activeFlip.units.map(u => u.unit),
        flipSet: Array.from(window._activeFlip._set || [])
      });
    }

    arr.forEach(r => {
      const unit = r && r.unit;
      if (!unit || unit === 'NATIONAL') return;
      const flipped = isUnitFlipped(year, unit);
      let baseMargin = (year === 1876 && unit === 'CO') ? (+r.rm || 0) : ((+r.rm || 0) + pv);
      if (typeof shouldAggregateAtLarge === 'function' && typeof getAtLargeAdjustedTotals === 'function' && shouldAggregateAtLarge(year, unit)) {
        const aggregated = getAtLargeAdjustedTotals(year, unit, { pv, useActiveFlip: true });
        if (aggregated && isFinite(aggregated.twoPartyMargin)) {
          baseMargin = aggregated.twoPartyMargin;
        }
      }
      if (flipped) {
        baseMargin = (baseMargin > 0 ? -EPS : EPS);
      }
      let m = baseMargin;

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

      let counted = false;
      if (!counted && year === 1960 && (unit === 'AL' || unit === 'MS')) {
        const margin = +r.rm || 0;
        const pvShift = window._curPv || 0;
        const adjMargin = margin + pvShift;
        const winner = adjMargin >= 0 ? 'D' : 'R';
        if (winner !== 'R') {
          if (unit === 'AL') {
            dEV += 5;
            oEV += 6;
          } else {
            dEV += 0;
            oEV += ev;
          }
        } else {
          rEV += ev;
        }
        counted = true;
      }

      if (!counted) {
        if (isProportionalEvMode()) {
          const total = +r.total || (+r.dVotes || 0) + (+r.rVotes || 0) + (+r.tVotes || 0) || 0;
          const tp = Math.max(0, Math.min(1, (r.thirdShare != null ? +r.thirdShare : +r.tp) || 0));
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
          dEV += allocation.D;
          rEV += allocation.R;
          oEV += allocation.O;
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
            const t = +r.tp || 0;
            const a = 3 * t - 1;
            if (a > 0) {
              const rVal = +(r.rm || 0);
              const nD = -rVal + a;
              const nR = -rVal - a;
              if (pv > nR + EPS && pv < nD - EPS) {
                if (!isNaN(ev)) oEV += ev;
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
          const side = Math.sign((stopVal || 0) - (nat || 0));
          if (side >= 0) dEV += ev; else rEV += ev;
        }
      }

      const st = unit.slice(0, 2);
      const prev = abbrColors.get(st);
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
      unitColors.set(unit, color);
      if (voteLeader && voteLeader.code === 'O') {
        unitParties.set(unit, 'Other');
      } else {
        unitParties.set(unit, (marginForState > EPS) ? 'Blue' : ((marginForState < -EPS) ? 'Red' : 'Even'));
      }
    });

    adjustAtLargeFromDistricts(year, abbrColors, unitColors, pvState.pv);

    return { arr, abbrColors, unitColors, unitParties, dEV, rEV, oEV };
  }

  // Identify the PV stop where the election flips relative to EVEN.
  // Algorithm:
  // - compute EV outcome at the EVEN stop
  // - determine the winner at EVEN (D or R)
  // - move in the opposite direction from that winner through all stops
  //   until the result flips; return the stop where the flip occurs.
  function computeTippingInfo(year, natMargin) {
    const stops = stopsByYear.get(year) || [];
    if (!stops.length) return null;
    const totalEv = (typeof window !== 'undefined' && window._totalEvByYear && typeof window._totalEvByYear.get === 'function')
      ? window._totalEvByYear.get(year) || 538
      : 538;
    const majorityCutoff = (totalEv / 2) + EPS;
    const prevYear = (typeof window !== 'undefined') ? window._curYear : null;
    const prevPv = (typeof window !== 'undefined') ? window._curPv : null;
    // CSV-only mode: read stop_colors flags for IS_TIPPING_POINT / IS_TIE_STOP and
    // select the first matching stop (prefer IS_TIPPING_POINT over IS_TIE_STOP).
    try {
      const futureMetaMap = (typeof window !== 'undefined' && window._futureStopMeta && typeof window._futureStopMeta.get === 'function') ? window._futureStopMeta : null;
      if (futureMetaMap && futureMetaMap.has(year)) {
        const meta = futureMetaMap.get(year);
        const stopsArr = stopsByYear.get(year) || [];
        if (!Array.isArray(stopsArr) || !stopsArr.length) return null;
        const chooseFromSet = (set) => {
          if (!set || typeof set.forEach !== 'function' || set.size === 0) return null;
          let bestVal = null;
          let bestAbs = Infinity;
          set.forEach(val => {
            if (!Number.isFinite(val)) return;
            const diff = Math.abs(val - natMargin);
            if (diff < bestAbs) {
              bestAbs = diff;
              bestVal = val;
            }
          });
          return bestVal;
        };
        const setHasValue = (set, val, tol) => {
          if (!set || typeof set.forEach !== 'function') return false;
          const threshold = Math.max(tol || STOP_EPS, 0.0005);
          let match = false;
          set.forEach(entry => {
            if (match) return;
            if (!Number.isFinite(entry)) return;
            if (Math.abs(entry - val) <= threshold) match = true;
          });
          return match;
        };
        let candidateStop = chooseFromSet(meta.tippingStops);
        if (candidateStop == null) candidateStop = chooseFromSet(meta.tieStops);
        if (candidateStop == null || !Number.isFinite(candidateStop)) return null;
        let idx = stopsArr.findIndex(s => Math.abs(s - candidateStop) <= STOP_EPS);
        if (idx < 0) idx = stopsArr.findIndex(s => Math.abs(s - candidateStop) <= 0.0005);
        if (idx < 0) {
          let bestIdx = -1;
          let bestDiff = Infinity;
          for (let i = 0; i < stopsArr.length; i++) {
            const diff = Math.abs(stopsArr[i] - candidateStop);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestIdx = i;
            }
          }
          idx = bestIdx;
        }
        if (idx < 0) return null;
        const stopVal = stopsArr[idx];
        const lookupTotals = (val) => {
          if (!meta || !meta.totalsByValue || typeof meta.totalsByValue.forEach !== 'function') return null;
          if (typeof meta.totalsByValue.get === 'function' && meta.totalsByValue.has(val)) {
            return meta.totalsByValue.get(val);
          }
          let best = null;
          let bestDiff = Infinity;
          meta.totalsByValue.forEach((entry, key) => {
            if (!Number.isFinite(key)) return;
            const diff = Math.abs(key - val);
            if (diff < bestDiff) {
              bestDiff = diff;
              best = entry;
            }
          });
          return best;
        };
        const totalsEntry = lookupTotals(stopVal) || lookupTotals(candidateStop);
        const effPv = totalsEntry && Number.isFinite(totalsEntry.eff) ? totalsEntry.eff : (stopToEff.get(stopVal) || stopVal);
        try { if (typeof window !== 'undefined') { window._curYear = year; window._curPv = effPv; } } catch (e) { }
        const dEv = totalsEntry && Number.isFinite(totalsEntry.d) ? totalsEntry.d : 0;
        const effectiveTotalEv = meta && Number.isFinite(meta.totalEv) ? meta.totalEv : totalEv;
        const effectiveMajority = meta && Number.isFinite(meta.majority) ? meta.majority : ((effectiveTotalEv / 2) + EPS);
        // units listed for this stop (may include PRESET:, NATIONAL etc.)
        const rawUnits = (stopToUnits.get(stopVal) || []).filter(Boolean).filter(u => !/^PRESET:/.test(u) && u !== 'NATIONAL' && u !== 'NAT');

        // Validate pivot units by simulating the map state at effPv and checking which unit(s)
        // are actually pivotal: removing that unit's EV assigned to D should drop D below majority.
        const pivotUnits = [];
        try {
          const sim = computeMapState(year, { pv: effPv, nat: natMargin, stopVal });
          const simDEv = sim && Number.isFinite(sim.dEV) ? sim.dEV : dEv;
          // For each unit candidate, check its EV and whether it is currently assigned to D
          for (const u of rawUnits) {
            try {
              // find EV for unit
              let uEv = null;
              try {
                if (typeof evByUnit !== 'undefined' && evByUnit && typeof evByUnit.get === 'function') {
                  const v = evByUnit.get(`${year}:${u}`);
                  if (Number.isFinite(v)) uEv = v;
                }
              } catch (ee) { /* ignore */ }
              // fallback: look up from byYear rows
              if (uEv == null) {
                const rows = byYear.get(year) || [];
                const row = rows.find(r => r && r.unit === u);
                if (row && Number.isFinite(+row.ev)) uEv = +row.ev;
              }
              if (!Number.isFinite(uEv)) continue;
              const unitParty = (sim && sim.unitParties && sim.unitParties.get(u)) || null;
              // Only consider units currently giving EVs to D
              if (!unitParty || unitParty !== 'Blue') continue;
              const dWithout = simDEv - uEv;
              if (dWithout < effectiveMajority) {
                pivotUnits.push(u);
                // prefer single pivot; break if we found one
                break;
              }
            } catch (ee) { /* ignore per-unit errors */ }
          }
        } catch (ee) { /* ignore simulation errors */ }

        const chosenUnits = (pivotUnits.length ? pivotUnits : rawUnits);
        const dEvDisplay = Number.isFinite(dEv) ? (Math.abs(dEv - Math.round(dEv)) < 1e-6 ? String(Math.round(dEv)) : dEv.toFixed(1)) : '0';
        const isTippingStop = setHasValue(meta && meta.tippingStops, stopVal, STOP_EPS);
        const titleParts = [(isTippingStop ? `Tipping point ${leanStr(effPv)}` : `EC tie ${leanStr(effPv)}`), `D ${dEvDisplay} of ${effectiveTotalEv} EV`];

        // Verification logging: ensure chosen unit(s) are actual pivots. For each candidate unit,
        // compute its EV and verify that D_without_unit < majority <= D_with_unit.
        try {
          const verifyRows = [];
          // compute base D ev from totalsEntry (meta) or simulation fallback
          const baseDEv = Number.isFinite(dEv) ? dEv : (sim && Number.isFinite(sim.dEV) ? sim.dEV : 0);
          for (const u of (chosenUnits.length ? chosenUnits : rawUnits)) {
            let uEv = null;
            try {
              // Prefer the runtime EV map created by future.js (window._evByUnitMap) when present,
              // otherwise fall back to the injected evByUnit dependency.
              if (typeof window !== 'undefined' && window._evByUnitMap && typeof window._evByUnitMap.get === 'function') {
                const v = window._evByUnitMap.get(`${year}:${u}`) || window._evByUnitMap.get(`2024:${u}`);
                if (Number.isFinite(v)) uEv = v;
              }
              if (uEv == null && typeof evByUnit !== 'undefined' && evByUnit && typeof evByUnit.get === 'function') {
                const v = evByUnit.get(`${year}:${u}`);
                if (Number.isFinite(v)) uEv = v;
              }
            } catch (e) { /* ignore */ }
            if (uEv == null) {
              const rows = byYear.get(year) || [];
              const row = rows.find(r => r && r.unit === u);
              if (row && Number.isFinite(+row.ev)) uEv = +row.ev;
            }
            const dWithout = (Number.isFinite(baseDEv) && Number.isFinite(uEv)) ? (baseDEv - uEv) : NaN;
            const flips = Number.isFinite(dWithout) && Number.isFinite(effectiveMajority) ? (dWithout < effectiveMajority && baseDEv >= effectiveMajority) : false;
            verifyRows.push({ unit: u, unitEV: uEv, dWith: baseDEv, dWithout, majority: effectiveMajority, flips });
          }
          // Log verification details
          try { console.debug('[TIPPING-VERIFY] synthetic meta check', { year, stopVal, effPv, totalsEntryD: dEv, effectiveTotalEv, effectiveMajority, verifyRows, pivotUnits }); } catch (e) { /* ignore */ }
          // Filter chosenUnits to those that actually flip the majority (if any)
          const actualPivots = verifyRows.filter(r => r.flips).map(r => r.unit);
          if (actualPivots.length) {
            chosenUnits.splice(0, chosenUnits.length, ...actualPivots);
          }
          // If none of the chosen units actually flip the majority, warn to aid debugging
          if (!verifyRows.some(r => r.flips)) {
            try { console.warn('[TIPPING-VERIFY] No pivot unit actually flips the majority for this stop — meta may be inconsistent', { year, stopVal, effPv, totalsEntryD: dEv, effectiveTotalEv, effectiveMajority, verifyRows }); } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore verification errors */ }

        if (chosenUnits.length) titleParts.push(`Trigger: ${chosenUnits.join(', ')}`);
        const res = { index: idx, stop: stopVal, pv: effPv, dEV: dEv, majority: effectiveMajority, units: chosenUnits, title: titleParts.join(' | ') };
        try { console.debug('TIPPING: selected from synthetic future meta', { year, idx: res.index, pv: res.pv, title: res.title, pivotUnits }); } catch (e) { }
        return res;
      }
      if (typeof window === 'undefined' || !window._stopColorsByYear || typeof window._stopColorsByYear.get !== 'function') return null;
      const byYearStops = window._stopColorsByYear.get(year);
      if (!byYearStops || typeof byYearStops.keys !== 'function') return null;
      const parseBool = (v) => (v === true || v === '1' || v === 1 || String(v).toLowerCase() === 'true');
      let tippingStopVal = null;
      let tieStopVal = null;
      for (const key of byYearStops.keys()) {
        try {
          const table = byYearStops.get(key);
          if (!table || typeof table.forEach !== 'function') continue;
          table.forEach((info) => {
            if (!info) return;
            try {
              if (!tippingStopVal && parseBool(info.IS_TIPPING_POINT)) {
                tippingStopVal = parseFloat(key);
              }
              if (!tieStopVal && parseBool(info.IS_TIE_STOP)) {
                tieStopVal = parseFloat(key);
              }
            } catch (e) { /* ignore */ }
          });
          if (tippingStopVal) break;
        } catch (e) { /* ignore individual key errors */ }
      }
      const chosenStop = (tippingStopVal != null) ? tippingStopVal : (tieStopVal != null ? tieStopVal : null);
      if (chosenStop == null || !isFinite(chosenStop)) return null;
      // map numeric stop to slider index
      let idx = stops.findIndex(s => Math.abs(s - chosenStop) <= STOP_EPS);
      if (idx < 0) idx = stops.findIndex(s => Math.abs(s - chosenStop) <= 0.0005);
      if (idx < 0) {
        try { console.debug('TIPPING: CSV indicated stop not found in slider stops', { year, chosenStop }); } catch (e) { }
        return null;
      }
      const stopVal = stops[idx];
      const effPv = stopToEff.has(stopVal) ? stopToEff.get(stopVal) : stopVal;
      try { if (typeof window !== 'undefined') { window._curYear = year; window._curPv = effPv; } } catch (e) { }
      const mapState = computeMapState(year, { pv: effPv, nat: natMargin, stopVal });
      const dEv = mapState && isFinite(mapState.dEV) ? mapState.dEV : 0;
      const dEvDisplay = Number.isFinite(dEv) ? (Math.abs(dEv - Math.round(dEv)) < 1e-6 ? String(Math.round(dEv)) : dEv.toFixed(1)) : '0';
      const units = (stopToUnits.get(stopVal) || []).filter(Boolean).filter(u => !/^PRESET:/.test(u) && u !== 'NATIONAL' && u !== 'NAT');
      const titleParts = [(tippingStopVal != null) ? `Tipping point ${leanStr(effPv)}` : `EC tie ${leanStr(effPv)}`, `D ${dEvDisplay} of ${totalEv} EV`];
      if (units.length) titleParts.push(`Trigger: ${units.join(', ')}`);
      const res = { index: idx, stop: stopVal, pv: effPv, dEV: dEv, majority: majorityCutoff, units, title: titleParts.join(' | ') };
      try { console.log('TIPPING: selected from CSV flags', { year, idx: res.index, pv: res.pv, title: res.title }); } catch (e) { }
      return res;
    } catch (e) {
      console.warn(e);
      return null;
    } finally {
      if (typeof window !== 'undefined') {
        try { window._curYear = prevYear; window._curPv = prevPv; } catch (e) { }
      }
    }
  }

  function adjustAtLargeFromDistricts(year, abbrColors, unitColors, pv) {
    if (typeof shouldAggregateAtLarge !== 'function' || typeof getAtLargeAdjustedTotals !== 'function') return;
    const states = ['ME', 'NE'];
    for (const st of states) {
      const atLargeUnit = `${st}-AL`;
      if (!shouldAggregateAtLarge(year, atLargeUnit)) continue;
      const totals = getAtLargeAdjustedTotals(year, atLargeUnit, { pv, useActiveFlip: true });
      if (!totals) continue;
      let margin = totals.twoPartyMargin;
      if (isUnitFlipped(year, atLargeUnit)) {
        margin = margin > 0 ? -EPS : EPS;
      }
      const color = marginToColor(margin, totals.thirdPartyDominant);
      unitColors.set(atLargeUnit, color);
      const prev = abbrColors.get(st);
      if (!prev || totals.thirdPartyDominant || Math.abs(margin) >= Math.abs(prev.m)) {
        abbrColors.set(st, { m: margin, color });
      }
    }
  }

  function applyStateFills(abbrColors) {
    if (!d3) return;
    if (window._electionNightActive) {
      window._electionNightLastAbbrColors = abbrColors;
      return;
    }
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
        console.warn(e);
        d3.select(this).attr('fill', fill);
      }
    });
  }

  function applyDistrictFills(year, unitColors) {
    if (!window._districtPaths) return;
    if (window._electionNightActive) {
      window._electionNightLastUnitColors = unitColors;
      return;
    }
    try {
      const showME = year >= 1972;
      const showNE = year >= 1992;
      window._districtPaths.forEach((pSel, unit) => {
        const stateAbbr = unit.slice(0, 2);
        const atLargeEntry = unitColors.get(stateAbbr + '-AL') || unitColors.get(stateAbbr);
        const atLargeColor = atLargeEntry || '#2f2f2f';
        const ucolor = unitColors.get(unit) || atLargeColor || 'transparent';
        const visible = (stateAbbr === 'ME' ? showME : (stateAbbr === 'NE' ? showNE : true));
        try {
          pSel.transition().duration(400).attrTween('fill', function () {
            const cur = d3.select(this).attr('fill') || 'transparent';
            return d3.interpolateRgb(cur, ucolor);
          });
        } catch (e) {
          pSel.attr('fill', ucolor);
        }
        pSel.attr('display', visible ? null : 'none');
        const halo = pSel.node && pSel.node().previousSibling;
        if (halo && halo.setAttribute) halo.setAttribute('display', visible ? null : 'none');
      });
    } catch (e) { /* ignore */ }
  }

  function updateEvSummary(refs, totals, year) {
    let override = null;
    try {
      if (typeof window !== 'undefined' && window._evSummaryOverride && typeof window._evSummaryOverride === 'object') {
        override = window._evSummaryOverride;
      }
    } catch (e) { /* ignore */ }

    const hasOverride = override && (
      override.dEV != null || override.rEV != null || override.oEV != null || override.uEV != null
    );

    if (typeof window !== 'undefined' && window._electionNightActive && !hasOverride) {
      return;
    }

    const totalsSource = hasOverride ? {
      dEV: Number.isFinite(+override.dEV) ? +override.dEV : 0,
      rEV: Number.isFinite(+override.rEV) ? +override.rEV : 0,
      oEV: Number.isFinite(+override.oEV) ? +override.oEV : 0,
      uEV: Number.isFinite(+override.uEV) ? +override.uEV : null
    } : totals;

    let totalEV = (hasOverride && Number.isFinite(+override.totalEV) && +override.totalEV > 0)
      ? +override.totalEV
      : 538;
    try {
      if (!hasOverride) {
        const t = window._totalEvByYear && window._totalEvByYear.get(year);
        if (isFinite(t) && t > 0) totalEV = t;
      }
    } catch (e) { console.warn(e); }

    const otherEV = totalsSource.oEV || 0;
    const computedUEV = Math.max(0, totalEV - ((totalsSource.dEV || 0) + (totalsSource.rEV || 0) + otherEV));
    const uEV = totalsSource.uEV != null && Number.isFinite(+totalsSource.uEV)
      ? Math.max(0, +totalsSource.uEV)
      : computedUEV;
    const dPct = totalEV ? ((totalsSource.dEV || 0) / totalEV) * 100 : 0;
    const uPct = totalEV ? (uEV / totalEV) * 100 : 0;
    const oPct = totalEV ? (otherEV / totalEV) * 100 : 0;
    const rPct = totalEV ? ((totalsSource.rEV || 0) / totalEV) * 100 : 0;

    const segments = [
      { el: refs.evFillD, pct: dPct, value: totalsSource.dEV || 0, code: 'D' },
      { el: refs.evFillU, pct: uPct, value: uEV, code: 'Uncalled' },
      { el: refs.evFillO, pct: oPct, value: otherEV, code: 'O' },
      { el: refs.evFillR, pct: rPct, value: totalsSource.rEV || 0, code: 'R' }
    ];
    let offset = 0;
    const activeSegs = [];
    const TRANS_MS = 360;
    const TRANS_EASE = 'cubic-bezier(0.22,0.61,0.36,1)';
    // Helper: choose readable text color (black/white) from an rgb/hex background
    function readableTextColor(bg) {
      try {
        const tmp = document.createElement('div');
        tmp.style.color = bg || '#000';
        document.body.appendChild(tmp);
        const cs = getComputedStyle(tmp).color || 'rgb(0,0,0)';
        document.body.removeChild(tmp);
        const m = cs.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return '#fff';
        const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
        const lum = 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
        return lum > 0.55 ? '#000' : '#fff';
      } catch (e) { return '#fff'; }
    }

    // Parent container for floating labels (the EV bar)
    const parentBar = (refs.evFillD && refs.evFillD.parentElement) || null;
    // Clean up any stale floating labels from previous runs so they don't persist
    try {
      if (parentBar) {
        const stale = Array.from(parentBar.querySelectorAll('.ev-global-label'));
        stale.forEach(n => { try { n.parentElement && n.parentElement.removeChild(n); } catch (e) { /* ignore */ } });
      }
    } catch (e) { /* ignore cleanup errors */ }

    segments.forEach(seg => {
      if (!seg.el) return;
      const visible = seg.value > EPS;
      seg.el.style.borderRadius = '0';
      if (!visible) {
        try { seg.el.style.transition = 'none'; seg.el.style.willChange = 'auto'; } catch (e) { console.warn(e); }
        seg.el.style.width = '0%';
        seg.el.style.display = 'none';
        return;
      }

      try { seg.el.style.display = ''; } catch (e) { console.warn(e); }
      try {
        seg.el.style.transition = `left ${TRANS_MS}ms ${TRANS_EASE}, right ${TRANS_MS}ms ${TRANS_EASE}, width ${TRANS_MS}ms ${TRANS_EASE}`;
        seg.el.style.willChange = 'left, right, width';
      } catch (e) { console.warn(e); }

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

      // Create/update in-bar label
      try {
        seg.el.style.position = seg.el.style.position || 'absolute';
        let lbl = seg.el.querySelector('.ev-seg-label');
        if (!lbl) {
          lbl = document.createElement('div');
          lbl.className = 'ev-seg-label';
          lbl.style.position = 'absolute';
          lbl.style.left = '50%';
          lbl.style.top = '50%';
          lbl.style.transform = 'translate(-50%, -50%)';
          lbl.style.pointerEvents = 'none';
          lbl.style.fontSize = '0.85rem';
          lbl.style.fontWeight = '600';
          lbl.style.whiteSpace = 'nowrap';
          lbl.style.padding = '0 6px';
          lbl.style.lineHeight = '1';
          seg.el.appendChild(lbl);
        }
        const labelText = `${seg.code} ${seg.value}`;
        lbl.textContent = labelText;
        const hasPositive = Number(seg.value) > 0;
        const showLabelPct = 3.0;
        const centerPct = offset + (Math.max(0, seg.pct) / 2);

        // Floating label above the bar (one per code, attached to parent)
        let floatLbl = null;
        if (parentBar) floatLbl = parentBar.querySelector(`.ev-global-label[data-code="${seg.code}"]`);

        if (seg.pct >= showLabelPct) {
          const bg = seg.el.style.backgroundColor || getComputedStyle(seg.el).backgroundColor || '#000';
          lbl.style.color = readableTextColor(bg);
          lbl.style.display = '';
          if (floatLbl) floatLbl.style.display = 'none';
        } else if (seg.pct <= EPS) {
          console.log('Segment too small to show anything', seg);
          // segment too small to show anything
          if (lbl) lbl.style.display = 'none';
          if (floatLbl) floatLbl.style.display = 'none';
        } else {
          // small segment => hide in-bar label and show floating label (only for strictly positive values)
          if (lbl) lbl.style.display = 'none';
          try {
            if (!hasPositive) {
              // ensure any existing floating label for this code is removed/hidden
              if (floatLbl) {
                try { floatLbl.style.display = 'none'; } catch (e) { /* ignore */ }
              }
            } else {
              if (!floatLbl && parentBar) {
                floatLbl = document.createElement('div');
                floatLbl.className = 'ev-global-label';
                floatLbl.setAttribute('data-code', seg.code || 'X');
                floatLbl.style.position = 'absolute';
                floatLbl.style.top = '-22px';
                floatLbl.style.transform = 'translate(-50%, 0)';
                floatLbl.style.pointerEvents = 'none';
                floatLbl.style.fontSize = '0.78rem';
                floatLbl.style.fontWeight = '600';
                floatLbl.style.whiteSpace = 'nowrap';
                floatLbl.style.padding = '2px 6px';
                floatLbl.style.borderRadius = '8px';
                floatLbl.style.boxShadow = '0 1px 2px rgba(0,0,0,0.3)';
                floatLbl.style.background = 'rgba(0,0,0,0.65)';
                floatLbl.style.color = '#fff';
                parentBar.appendChild(floatLbl);
              }
              if (floatLbl) {
                floatLbl.textContent = labelText;
                floatLbl.style.left = `${centerPct.toFixed(3)}%`;
                try { floatLbl.style.display = 'block'; } catch (e) { floatLbl.style.display = ''; }
              }
            }
          } catch (ee) { console.warn(ee); }
        }
      } catch (e) { console.warn(e); }
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

    const dDisplay = totalsSource.dEV || 0;
    const rDisplay = totalsSource.rEV || 0;
    const oDisplay = otherEV || 0;
    const parts = [`D ${dDisplay}`];
    if (uEV > 0) parts.push(`U ${uEV}`);
    if (oDisplay > 0) parts.push(`O ${oDisplay}`);
    parts.push(`R ${rDisplay}`);
    const summary = (uEV > 0 || oDisplay > 0) ? parts.join(' | ') : `${dDisplay} - ${rDisplay}`;
    // Hide the central overlay text to avoid covering the midline; labels are now inside segments
    if (refs.evText) {
      try { refs.evText.style.display = 'none'; refs.evText.setAttribute && refs.evText.setAttribute('aria-hidden', 'true'); } catch (e) { /* ignore */ }
    }
    if (refs.flipEC) refs.flipEC.textContent = summary;
  }

  function updateCloseStatesPanel(refs, year, pv) {
    const closeWrap = refs.closeStates;
    if (!closeWrap) return;
    try {
      const THRESH = 0.01;
      const isALorState = (u) => (u && (u.length === 2 || u === 'DC' || u.endsWith('-AL')));
      const rows = byYear.get(year) || [];
      const list = [];
      rows.forEach(r => {
        if (!r || r.unit === 'NATIONAL') return;
        if (!isALorState(r.unit)) return;
        let m = (+r.rm || 0) + pv;
        const t = +r.tp || 0; const a = 3 * t - 1; const rVal = +(r.rm || 0);
        if (a > 0) {
          const nD = -rVal + a; const nR = -rVal - a;
          if (pv > nR + EPS && pv < nD - EPS) return;
        }
        if (Math.abs(m) < THRESH) {
          list.push({ unit: r.unit, ev: (+r.ev || 0), m });
        }
      });
      list.sort((a, b) => Math.abs(a.m) - Math.abs(b.m));

      const BELLWETHER_THRESHOLD = 0.05;
      const bellwetherList = [];
      rows.forEach(r => {
        if (!r || r.unit === 'NATIONAL') return;
        if (!isALorState(r.unit)) return;
        const t = +r.tp || 0; const a = 3 * t - 1; const rVal = +(r.rm || 0);
        if (a > 0) {
          const nD = -rVal + a; const nR = -rVal - a;
          if (pv > nR + EPS && pv < nD - EPS) return;
        }
        const relToNat = (+r.rm || 0);
        if (Math.abs(r.rm) < BELLWETHER_THRESHOLD) bellwetherList.push({ unit: r.unit, ev: (+r.ev || 0), relToNat });
      });
      bellwetherList.sort((a, b) => Math.abs(a.relToNat) - Math.abs(b.relToNat));

      const textColorFor = (bg) => {
        try {
          if (!bg || bg[0] !== '#') return '#fff';
          const c = bg.slice(1);
          const val = parseInt(c, 16);
          const rr = (val >> 16) & 255; const gg = (val >> 8) & 255; const bb = val & 255;
          const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb;
          return lum > 186 ? '#000' : '#fff';
        } catch (e) { console.warn(e); return '#fff'; }
      };
      const smallColorFor = (textCol) => textCol === '#fff' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)';

      const fmt = (x) => {
        if (!isFinite(x)) return '';
        if (Math.abs(x) < 0.000005) return 'EVEN';
        const s = (Math.abs(x) * 100).toFixed(1);
        return (x > 0 ? 'D+' : 'R+') + s;
      };

      const closeChips = list.map(r => {
        const bg = marginToColor(r.m);
        const txt = textColorFor(bg);
        const small = smallColorFor(txt);
        return `<span class="btn" style="padding:4px 6px;background-color:${bg};color:${txt}">${r.unit} · <small style="color:${small}">${fmt(r.m)}</small> · ${r.ev} EV</span>`;
      }).join('');

      const rowsMap = new Map(rows.map(rr => [rr.unit, rr]));
      const bellwetherChips = (bellwetherList.length === 0)
        ? '<span class="muted">No bellwether states within 5.0 pp.</span>'
        : bellwetherList.map(r => {
          const row = rowsMap.get(r.unit) || {};
          const displayM = (row && isFinite(+row.rm)) ? (+row.rm || 0) + pv : r.relToNat + (getNatMargin(year) || 0);
          const bg = marginToColor(displayM);
          const txt = textColorFor(bg);
          const small = smallColorFor(txt);
          const relTxt = ((r.relToNat > 0) ? 'D+' : 'R+') + (Math.abs(r.relToNat) * 100).toFixed(1);
          return `<span class="btn" style="padding:4px 6px;background-color:${bg};color:${txt}">${r.unit} · <small style="color:${small}">${relTxt}</small> · ${r.ev} EV</span>`;
        }).join('');

      const bellwetherStateLegend = '<div class="legend" style="margin-bottom:6px">Bellwether states (within 5.0 pp of national margin — i.e. close to the national popular vote, not necessarily close to flipping)</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px">' + bellwetherChips + '</div>';

      let closeSection = '';
      if (closeChips.length === 0) {
        closeSection = '<div class="legend" style="margin-top:12px">Close states (|raw margin| < 1.0 pp)</div><div class="legend">No close states within 1.0 pp.</div>';
      } else {
        closeSection = '<div class="legend" style="margin-top:12px">Close states (|raw margin| < 1.0 pp)</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:8px">' + closeChips + '</div>';
      }

      closeWrap.innerHTML = bellwetherStateLegend + closeSection;
    } catch (e) { console.warn(e); }
  }

  function updateNationalTotals(refs, year, pvState) {
    try {
      let dSum = 0, rSum = 0, tSum = 0, totSum = 0;
      const rows = byYear.get(year) || [];
      const nat = pvState.nat;
      const pv = pvState.pv;
      const pvIndex = pvState.pvIndex;
      const stops = pvState.stops;
      const isActual = Math.abs((stops[pvIndex] || 0) - nat) <= STOP_EPS;
      if (isActual) {
        const f = window._activeFlip;
        const active = (f && f.year === year && Array.isArray(f.units) && f.units.length > 0);
        if (active) {
          const vtByUnit = new Map();
          f.units.forEach(u => vtByUnit.set(u.unit, Math.max(0, +u.votes_to_flip || 0)));
          for (const r of rows) {
            if (!r || !r.unit || r.unit === 'NATIONAL') continue;
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
        } else {
          const natRow = rows.find(rr => rr.unit === 'NATIONAL' || rr.unit === 'NAT');
          if (natRow) {
            const fmt = (x) => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '0';
            if (refs.pvDem) refs.pvDem.textContent = fmt(+natRow.dVotes || 0);
            if (refs.pvRep) refs.pvRep.textContent = fmt(+natRow.rVotes || 0);
            if (refs.pvOth) refs.pvOth.textContent = fmt(+natRow.tVotes || 0);
            if (refs.pvTot) refs.pvTot.textContent = fmt(+natRow.total || 0);
            return;
          }
        }
      } else {
        for (const r of rows) {
          if (!r || !r.unit || r.unit === 'NATIONAL') continue;
          if (r.unit.includes('-') && !r.unit.endsWith('-AL')) continue;
          const total = +r.total || (+r.dVotes + +r.rVotes + +r.tVotes) || 0;
          if (!isFinite(total) || total <= 0) continue;
          const tp = Math.max(0, Math.min(1, (r.thirdShare != null ? +r.thirdShare : +r.tp) || 0));
          const flipped = isUnitFlipped(year, r.unit);
          let rmAdj = (+r.rm || 0) + pv;
          if (flipped) rmAdj = -rmAdj;
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
      }
      const fmt = (x) => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '0';
      if (refs.pvDem) refs.pvDem.textContent = fmt(dSum);
      if (refs.pvRep) refs.pvRep.textContent = fmt(rSum);
      if (refs.pvOth) refs.pvOth.textContent = fmt(tSum);
      if (refs.pvTot) refs.pvTot.textContent = fmt(totSum);
    } catch (e) { /* non-fatal */ }
  }

  function updateRelativeMarginPanel(refs, year, pv) {
    try {
      const wrap = refs.relDeltas;
      const listEl = refs.relDeltasList;
      const titleEl = refs.relDeltasTitle;
      if (!wrap || !listEl) return;
      const baselineEl = refs.relBaseline;
      if (baselineEl) {
        const optPrev = Array.from(baselineEl.options || []).find(o => String(o.value) === 'prev');
        const opt2024 = Array.from(baselineEl.options || []).find(o => String(o.value) === '2024');
        const prevYear = year - 4;
        const hasPrev = (prevYear >= 1916) && byYear.has(prevYear);
        if (optPrev) optPrev.disabled = !hasPrev;
        if (!hasPrev) {
          if (opt2024) { opt2024.disabled = false; baselineEl.value = '2024'; }
        }
        if (opt2024) {
          if (year === 2024) {
            opt2024.disabled = true;
            if (baselineEl.value === '2024') baselineEl.value = 'prev';
          } else if (hasPrev) {
            opt2024.disabled = false;
          }
        }
      }

      const baselineMode = baselineEl ? baselineEl.value : 'prev';
      const baselineYear = (baselineMode === '2024') ? 2024 : (year - 4);
      const showPanel = (baselineYear >= 1916) && byYear.has(baselineYear);
      if (!showPanel) {
        wrap.style.display = 'none';
        return;
      }
      wrap.style.display = '';
      if (titleEl) titleEl.textContent = `Relative margin change in ${year} vs ${baselineYear}`;
      const curRows = byYear.get(year) || [];
      const baseRows = byYear.get(baselineYear) || [];
      const baseMap = new Map();
      baseRows.forEach(r => {
        if (!r || !r.unit || r.unit === 'NATIONAL') return;
        const val = +r.rm || 0;
        baseMap.set(r.unit, val);
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
        const curRel = +r.rm || 0;
        const prevRel = b;
        let delta = curRel - b;
        if (year < 2024 && baselineYear === 2024) {
          delta = -delta;
        }
        items.push({ unit: r.unit, delta, prevRel, curRel });
      });
      items.sort((a, b) => a.delta - b.delta);

      const textColor = (bg) => {
        try {
          if (!bg || bg[0] !== '#') return '#fff';
          const c = bg.slice(1);
          const val = parseInt(c, 16);
          const rr = (val >> 16) & 255, gg = (val >> 8) & 255, bb = val & 255;
          const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb;
          return lum > 186 ? '#000' : '#fff';
        } catch (e) { console.warn(e); return '#fff'; }
      };
      const smallColor = (textCol) => textCol === '#fff' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)';

      const html = items.map(it => {
        const bg = marginToColor(it.curRel);
        const txt = textColor(bg);
        const small = smallColor(txt);
        const prevStr = (year < 2024 && baselineYear === 2024) ? fmtLean(it.curRel) : fmtLean(it.prevRel);
        const curStr = (year < 2024 && baselineYear === 2024) ? fmtLean(it.prevRel) : fmtLean(it.curRel);
        return `<div class="btn" style="padding:6px 8px;background:${bg};color:${txt};display:flex;flex-direction:column;align-items:flex-start;min-width:110px">
            <div style="font-weight:600">${it.unit}</div>
            <div style="font-size:0.86rem;color:${small}">Δ ${fmtLean(it.delta)}</div>
            <div style="font-size:0.86rem;color:${small}">${prevStr} → ${curStr}</div>
          </div>`;
      }).join('');
      listEl.innerHTML = html || '<span class="legend">No data.</span>';
    } catch (e) { console.warn(e); }
  }

  function ensureBaselineSelector(year, refs) {
    try {
      const baselineSel = refs.relBaseline;
      const yearEl = refs.yearSlider;
      if (!baselineSel || !yearEl) return;
      const y = +yearEl.value;
      const opt2024 = Array.from(baselineSel.options || []).find(o => String(o.value) === '2024');
      if (!opt2024) return;
      if (y === 2024) {
        opt2024.disabled = true;
        if (baselineSel.value === '2024') baselineSel.value = 'prev';
      } else {
        opt2024.disabled = false;
      }
    } catch (e) { console.warn(e); }
  }

  return function updateAll() {
    dbg('updateAll: starting...');
    const refs = getDomRefs();
    if (!refs) return;

    const year = Number(refs.yearSlider.value);
    if (!Number.isFinite(year)) return;
    if (refs.yearVal) refs.yearVal.textContent = year;

    syncStopsForYear(year, refs, updateAll);

    const pvState = getPvState(year, refs);
    window._curYear = year;
    window._curPv = pvState.pv;

    updatePvLabel(refs, pvState);

    const tippingInfo = computeTippingInfo(year, pvState.nat);
    if (typeof window !== 'undefined') {
      window._curYear = year;
      window._curPv = pvState.pv;
    }
    if (tippingInfo) {
      tippingInfoByYear.set(year, tippingInfo);
    } else {
      tippingInfoByYear.delete(year);
    }
    if (typeof window !== 'undefined') {
      window._pvTippingByYear = tippingInfoByYear;
    }

    const tippingTitle = tippingInfo ? tippingInfo.title : '';
    const tippingIndex = tippingInfo ? tippingInfo.index : null;
    if (refs.pvTippingBtn) {
      refs.pvTippingBtn.disabled = !tippingInfo;
      if (tippingInfo) {
        refs.pvTippingBtn.dataset.year = String(year);
        refs.pvTippingBtn.dataset.idx = String(tippingInfo.index);
  const unitHint = (tippingInfo.units && tippingInfo.units.length) ? ` - ${tippingInfo.units.join(', ')}` : '';
        refs.pvTippingBtn.title = `Set PV to tipping point ${leanStr(tippingInfo.pv)}${unitHint}`;
      } else {
        delete refs.pvTippingBtn.dataset.year;
        delete refs.pvTippingBtn.dataset.idx;
        refs.pvTippingBtn.title = 'Tipping point unavailable';
      }
    }

    buildPvStops(year, {
      container: refs.pvStops,
      datalist: refs.pvStopsList,
      getNatMargin,
      updateAll,
      extraPresets: (typeof window !== 'undefined' && Array.isArray(window._pvExtraPresets)) ? window._pvExtraPresets : [],
      injectNegativePresets: (typeof window !== 'undefined') ? !!window._injectNegativePresets : false,
      tippingIndex,
      tippingTitle
    });

    if (refs.pvResetActual) {
      const showActual = !!(window._futureMode && year === 2024);
      refs.pvResetActual.style.display = showActual ? '' : 'none';
      refs.pvResetActual.disabled = !showActual;
    }

    updateFlipButtons();

    const mapState = computeMapState(year, pvState);

    applyStateFills(mapState.abbrColors);
    applyDistrictFills(year, mapState.unitColors);

    window._lastAbbrColors = mapState.abbrColors;
    window._lastUnitColors = mapState.unitColors;
    refreshMapDecorations(year, mapState.abbrColors, mapState.unitColors);

    updateEvSummary(refs, mapState, year);
    updateCloseStatesPanel(refs, year, pvState.pv);
    updateNationalTotals(refs, year, pvState);
    updateRelativeMarginPanel(refs, year, pvState.pv);
    ensureBaselineSelector(year, refs);

    dbg('updateAll: ending successfully');
    try { updateCandidateInfo(year); } catch (e) { console.warn(e); }
    try { updateStateLabels(year); } catch (e) { console.warn(e); }
  };
}

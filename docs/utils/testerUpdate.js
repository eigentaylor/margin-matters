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
    buildPvStops(year, {
      container: refs.pvStops,
      datalist: refs.pvStopsList,
      getNatMargin,
      updateAll: updateFn
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
        list.forEach(u => { if (u && u !== 'NATIONAL' && u !== 'NAT') matches.push(String(u).slice(0, 5)); });
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

  function computeMapState(year, pvState) {
    const { pv, nat, stopVal } = pvState;
    const arr = byYear.get(year) || [];
    const abbrColors = new Map();
    const unitColors = new Map();
    const unitParties = new Map();
    let dEV = 0; let rEV = 0; let oEV = 0;

    const activeFlip = window._activeFlip && window._activeFlip.year === year ? window._activeFlip : null;
    const vtByUnit = new Map();
    if (activeFlip && Array.isArray(activeFlip.units)) {
      activeFlip.units.forEach(u => vtByUnit.set(u.unit, Math.max(0, +u.votes_to_flip || 0)));
    }

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
      let m = (year === 1876 && unit === 'CO') ? (+r.rm || 0) : ((+r.rm || 0) + pv);
      if (flipped) {
        m = (m > 0 ? -EPS : EPS);
      }

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

    adjustAtLargeFromDistricts(year, arr, abbrColors, unitColors, vtByUnit, pvState.pv);

    return { arr, abbrColors, unitColors, unitParties, dEV, rEV, oEV };
  }

  function adjustAtLargeFromDistricts(year, rows, abbrColors, unitColors, vtByUnit, pv) {
    const states = ['ME', 'NE'];
    for (const st of states) {
      const districtUnits = (st === 'ME') ? ['ME-01', 'ME-02'] : ['NE-01', 'NE-02', 'NE-03'];
      const haveAll = districtUnits.every(u => rows.some(r => r && r.unit === u));
      if (!haveAll) continue;
      let dSum = 0; let rSum = 0;
      for (const du of districtUnits) {
        const row = rows.find(x => x && x.unit === du);
        if (!row) continue;
        let d0 = +row.dVotes || 0;
        let r0 = +row.rVotes || 0;
        const vt = vtByUnit.get(du) || 0;
        const flipped = isUnitFlipped(year, du);
        if (flipped) {
          if (d0 >= r0) { d0 = Math.max(0, d0 - vt); r0 = r0 + vt; }
          else { d0 = d0 + vt; r0 = Math.max(0, r0 - vt); }
        }
        dSum += d0; rSum += r0;
      }
      const twoTot = dSum + rSum;
      if (twoTot <= 0) continue;
      let m = (dSum - rSum) / twoTot;
      const alUnit = st + '-AL';
      if (isUnitFlipped(year, alUnit)) {
        m = (m > 0 ? -1e-6 : 1e-6);
      }
      const color = marginToColor(m);
      unitColors.set(alUnit, color);
      const prev = abbrColors.get(st);
      if (!prev || Math.abs(m) >= Math.abs(prev.m)) {
        abbrColors.set(st, { m, color });
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
    let totalEV = 538;
    try {
      const t = window._totalEvByYear && window._totalEvByYear.get(year);
      if (isFinite(t) && t > 0) totalEV = t;
    } catch (e) { console.warn(e); }

    const otherEV = totals.oEV || 0;
    const uEV = Math.max(0, totalEV - (totals.dEV + totals.rEV + otherEV));
    const dPct = totalEV ? (totals.dEV / totalEV) * 100 : 0;
    const uPct = totalEV ? (uEV / totalEV) * 100 : 0;
    const oPct = totalEV ? (otherEV / totalEV) * 100 : 0;
    const rPct = totalEV ? (totals.rEV / totalEV) * 100 : 0;

    const segments = [
      { el: refs.evFillD, pct: dPct, value: totals.dEV },
      { el: refs.evFillU, pct: uPct, value: uEV },
      { el: refs.evFillO, pct: oPct, value: otherEV },
      { el: refs.evFillR, pct: rPct, value: totals.rEV }
    ];
    let offset = 0;
    const activeSegs = [];
    const TRANS_MS = 360;
    const TRANS_EASE = 'cubic-bezier(0.22,0.61,0.36,1)';
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

    const parts = [`D ${totals.dEV}`];
    if (uEV > 0) parts.push(`U ${uEV}`);
    if (otherEV > 0) parts.push(`O ${otherEV}`);
    parts.push(`R ${totals.rEV}`);
    const summary = (uEV > 0 || otherEV > 0) ? parts.join(' | ') : `${totals.dEV} - ${totals.rEV}`;
    if (refs.evText) refs.evText.textContent = summary;
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

    buildPvStops(year, {
      container: refs.pvStops,
      datalist: refs.pvStopsList,
      getNatMargin,
      updateAll
    });

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

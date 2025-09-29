(function(){
  'use strict';

  const EPS = 1e-6;
  const NEUTRAL_COLOR = '#2f2f2f';
  const THIRD_PARTY_COLOR = '#C9A400';
  const BASE_MINUTES_PER_SECOND = 6;
  const MIN_DURATION = 160;
  const MIN_CALL_DELAY = 30;
  const EXTRA_CALL_WINDOW = 210;
  const TIME_OFFSET_MIN = 180;
  const DEFAULT_CONFIDENCE_THRESHOLD = 0.4;
  const MIN_REPORTING_TO_CALL = 0.2;
  const BRIGHT_TOSSUP_COLOR = '#bcbcbc';
  const UNCALLED_BRIGHTEN = 0.45;

  const POLL_CLOSINGS = {
    '15:00': ['KY','IN','PR'],
    '16:00': ['VT','VA','SC','GA'],
    '16:30': ['NC','OH','WV'],
    '17:00': ['AL','CT','DC','DE','FL','IL','KS','ME','MD','MA','MS','MO','NH','NJ','OK','PA','RI','TN','TX'],
    '17:30': ['AR'],
    '18:00': ['AZ','CO','LA','MI','MN','NE','NM','NY','SD','WI','WY'],
    '19:00': ['IA','MT','NV','UT'],
    '20:00': ['CA','OR','WA','ID','ND'],
    '22:00': ['AK','HI']
  };

  const STATE_COUNTING_SPEEDS = {
    AL: 1.1, AK: 0.6, AZ: 0.9, AR: 1.0, CA: 0.7, CO: 0.9, CT: 0.9, DE: 1.0,
    DC: 1.0, FL: 1.4, GA: 1.1, HI: 0.6, ID: 1.3, IL: 1.1, IN: 1.1, IA: 1.2,
    KS: 1.0, KY: 1.0, LA: 1.0, ME: 0.8, MD: 1.0, MA: 0.9, MI: 1.0, MN: 0.9,
    MS: 1.0, MO: 1.0, MT: 0.7, NE: 1.2, NV: 0.7, NH: 1.0, NJ: 0.9, NM: 0.9,
    NY: 0.8, NC: 1.0, ND: 1.3, OH: 1.1, OK: 1.0, OR: 0.8, PA: 0.8, PR: 0.6,
    RI: 0.9, SC: 1.0, SD: 1.2, TN: 1.1, TX: 1.2, UT: 1.0, VT: 0.8, VA: 1.0,
    WA: 0.8, WV: 0.9, WI: 1.1, WY: 0.7
  };

  const MAIL_HEAVY_STATES = new Set(['AZ','CA','CO','HI','NV','NJ','NY','OR','UT','VT','WA','MI','PA','WI','MN']);

  const PHASES = [
    { name: 'Early', start: toMinutesWithOffset('19:00'), end: toMinutesWithOffset('20:30') },
    { name: 'Mid', start: toMinutesWithOffset('20:30'), end: toMinutesWithOffset('22:00') },
    { name: 'Central', start: toMinutesWithOffset('22:00'), end: toMinutesWithOffset('23:30') },
    { name: 'Late', start: toMinutesWithOffset('23:30'), end: toMinutesWithOffset('25:00') },
    { name: 'Final', start: toMinutesWithOffset('25:00'), end: toMinutesWithOffset('28:00') }
  ];

  const STATE_NAMES = {
    AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut',
    DE:'Delaware', DC:'District of Columbia', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois',
    IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts',
    MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada',
    NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota',
    OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota',
    TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia',
    WI:'Wisconsin', WY:'Wyoming'
  };

  const state = {
    prepared: false,
    running: false,
    pvMode: 'current',
    pvValue: 0,
    targetPvLabel: 'EVEN',
    speedMultiplier: 1,
    minutesPerSecond: BASE_MINUTES_PER_SECOND,
    currentTime: 0,
    simStart: 0,
    simEnd: 0,
    stateData: [],
    snapshot: new Map(),
    totalEligibleVotes: 0,
    prevPvOverride: null,
    prevPvSliderValue: null,
    prevPvPresetName: null,
    lastTimestamp: null,
    rafId: null,
    lastLogKey: '',
    lastUncalledKey: '',
    suppressProgressEvent: false,
    year: null,
    totalEvPool: 538,
    unitColorMap: null,
    abbrColorMap: null,
    prevUnitColors: null,
    prevAbbrColors: null,
    boxesDirty: false,
    callRecords: [],
    confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
    pvRandomCache: null,
    pvRandomCacheMode: null,
    pvRandomSeed: null
  };

  const elements = {
    toggle: null,
    reset: null,
    speed: null,
    pvMode: null,
    pvDisplay: null,
    timeLabel: null,
    progress: null,
    phase: null,
    log: null,
    logHeader: null,
    logUncalled: null,
    confidence: null,
    confidenceVal: null,
    victory: null
  };

  function init(){
    elements.toggle = document.getElementById('enToggle');
    elements.reset = document.getElementById('enReset');
    elements.speed = document.getElementById('enSpeed');
    elements.pvMode = document.getElementById('enPvMode');
    elements.pvDisplay = document.getElementById('enPvDisplay');
    elements.timeLabel = document.getElementById('enTime');
    elements.progress = document.getElementById('enProgress');
    elements.phase = document.getElementById('enPhase');
    elements.log = document.getElementById('enLog');
    elements.logHeader = document.querySelector('#enLogPanel .en-log-header');
    elements.logUncalled = document.getElementById('enLogUncalled');
  elements.confidence = document.getElementById('enConfidence');
  elements.confidenceVal = document.getElementById('enConfidenceVal');
  elements.victory = document.getElementById('enVictory');

    if (elements.toggle) {
      elements.toggle.addEventListener('click', () => {
        if (!state.prepared) {
          prepareSimulation();
          startSimulation();
        } else if (state.running) {
          pauseSimulation();
        } else {
          if (state.currentTime >= state.simEnd - EPS) {
            state.currentTime = state.simStart;
            renderAt(state.currentTime);
          }
          startSimulation();
        }
        updateToggleLabel();
      });
    }

    if (elements.reset) {
      elements.reset.addEventListener('click', () => resetSimulation(true));
    }

    if (elements.speed) {
      elements.speed.addEventListener('change', () => {
        const val = parseFloat(elements.speed.value);
        if (isFinite(val) && val > 0) state.speedMultiplier = val;
      });
    }

    if (elements.pvMode) {
      elements.pvMode.addEventListener('change', () => {
        state.pvMode = elements.pvMode.value || 'current';
        state.pvRandomCache = null;
        state.pvRandomCacheMode = null;
        state.pvRandomSeed = null;
        if (!state.prepared) return;
        const resume = state.running;
        resetSimulation(false);
        prepareSimulation();
        renderAt(state.currentTime);
        if (resume) startSimulation();
      });
    }

    if (elements.progress) {
      elements.progress.addEventListener('input', () => {
        if (state.suppressProgressEvent) return;
        const raw = parseFloat(elements.progress.value);
        const clamped = Math.max(0, Math.min(1, isFinite(raw) ? raw : 0));
        if (!state.prepared) {
          prepareSimulation();
          if (!state.prepared) return;
        }
        const wasRunning = state.running;
        if (wasRunning) pauseSimulation();
        seekToProgress(clamped);
        if (wasRunning) startSimulation();
        updateToggleLabel();
      });
    }

    const yearSlider = document.getElementById('yearSlider');
    if (yearSlider) {
      yearSlider.addEventListener('input', () => {
        if (state.prepared) resetSimulation(true);
      });
    }

    const pvSlider = document.getElementById('pvSlider');
    if (pvSlider) {
      pvSlider.addEventListener('input', () => {
        if (state.prepared && !state.running) {
          resetSimulation(false);
          if (elements.pvDisplay) elements.pvDisplay.textContent = 'PV: —';
        }
      });
    }

    if (elements.confidence) {
      const sliderVal = getConfidenceSliderValue();
      state.confidenceThreshold = sliderVal;
      updateConfidenceLabel(sliderVal);
      elements.confidence.addEventListener('input', () => {
        const val = getConfidenceSliderValue();
        state.confidenceThreshold = val;
        updateConfidenceLabel(val);
      });
    } else {
      updateConfidenceLabel(state.confidenceThreshold);
    }

    updateToggleLabel();
  }

  function prepareSimulation(){
    const year = getSelectedYear();
    if (!year) return;

    state.prevPvOverride = (typeof window._pvOverride === 'number' && isFinite(window._pvOverride)) ? window._pvOverride : null;
    state.prevPvSliderValue = getPvSliderValue();
    state.prevPvPresetName = window._pvPresetName || null;

    const pvValue = resolvePvValue();
    state.pvValue = pvValue;
    state.targetPvLabel = formatLean(pvValue);
  state.confidenceThreshold = getConfidenceSliderValue();
  updateConfidenceLabel(state.confidenceThreshold);

    if (typeof window.updateAll === 'function') window.updateAll();

    state.prevUnitColors = window._lastUnitColors ? new Map(window._lastUnitColors) : null;
    state.prevAbbrColors = window._lastAbbrColors
      ? new Map(Array.from(window._lastAbbrColors.entries(), ([abbr, info]) => [abbr, { ...(info || {}) }]))
      : null;

    state.unitColorMap = state.prevUnitColors ? new Map(state.prevUnitColors) : new Map();
    state.abbrColorMap = state.prevAbbrColors
      ? new Map(Array.from(state.prevAbbrColors.entries(), ([abbr, info]) => [abbr, { ...(info || {}) }]))
      : new Map();
    state.boxesDirty = false;
    state.callRecords = [];

    state.year = year;

    window._electionNightActive = true;
    state.snapshot = new Map();
    window._electionNightSnapshot = state.snapshot;
    state.lastLogKey = '';
    state.lastUncalledKey = '';
    if (elements.log) elements.log.innerHTML = '';
    if (elements.logUncalled) elements.logUncalled.innerHTML = '';
    if (elements.logHeader) elements.logHeader.textContent = 'Call log';
    if (elements.victory) {
      elements.victory.textContent = '';
      elements.victory.className = 'en-log-victory';
      elements.victory.style.display = 'none';
    }

    const data = buildStateData(year, pvValue);
    state.stateData = data;
    if (!data.length) {
      updateToggleLabel();
      return;
    }

    state.totalEvPool = determineEvPool(year, data);

    state.totalEligibleVotes = data.reduce((sum, st) => sum + (st.pvWeight ? st.totalVotes : 0), 0);

    let minStart = Infinity;
    let maxEnd = -Infinity;
    data.forEach(st => {
      if (st.startTime < minStart) minStart = st.startTime;
      const finish = st.startTime + st.duration;
      if (finish > maxEnd) maxEnd = finish;
      if (st.callDeadline > maxEnd) maxEnd = st.callDeadline;
    });
    if (!isFinite(minStart)) minStart = toMinutesWithOffset('18:00');
    if (!isFinite(maxEnd)) maxEnd = minStart + 480;

    state.simStart = minStart - 5;
    state.simEnd = maxEnd + 30;
    state.currentTime = state.simStart;
    state.lastTimestamp = null;

    if (elements.progress) {
      state.suppressProgressEvent = true;
      elements.progress.value = '0';
      state.suppressProgressEvent = false;
    }
    if (elements.phase) elements.phase.textContent = 'Phase: Early';
    if (elements.timeLabel) elements.timeLabel.textContent = `${formatTimeLabel(state.simStart)} ET`;
    if (elements.pvDisplay) {
      elements.pvDisplay.textContent = (state.pvMode === 'current')
        ? `PV: ${state.targetPvLabel}`
        : `PV: — (target ${state.targetPvLabel})`;
    }

    renderAt(state.currentTime);
    state.prepared = true;
    updateToggleLabel();
  }

  function progressToTime(progress){
    const clamped = Math.max(0, Math.min(1, isFinite(progress) ? progress : 0));
    const span = state.simEnd - state.simStart;
    if (!isFinite(span) || Math.abs(span) < EPS) return state.simStart;
    return state.simStart + clamped * span;
  }

  function timeToProgress(timeMinutes){
    const span = state.simEnd - state.simStart;
    if (!isFinite(timeMinutes) || !isFinite(span) || Math.abs(span) < EPS) return 0;
    return Math.max(0, Math.min(1, (timeMinutes - state.simStart) / span));
  }

  function advanceDeterministic(targetTime){
    if (!state.prepared) return;
    const clamped = Math.max(state.simStart, Math.min(state.simEnd, isFinite(targetTime) ? targetTime : state.simEnd));
    const delta = clamped - state.currentTime;
    if (Math.abs(delta) <= EPS) {
      state.currentTime = clamped;
      renderAt(clamped);
      return;
    }
    const direction = delta >= 0 ? 1 : -1;
    const total = Math.abs(delta);
    const approxStep = 6; // minutes per slice
    const maxSteps = 480;
    const steps = Math.max(1, Math.min(maxSteps, Math.ceil(total / approxStep)));
    let current = state.currentTime;
    for (let i = 1; i <= steps; i++) {
      const remaining = clamped - current;
      const segmentsLeft = steps - i + 1;
      const stepSize = remaining / segmentsLeft;
      current = Math.max(state.simStart, Math.min(state.simEnd, current + stepSize));
      state.currentTime = current;
      renderAt(current);
      if (direction > 0 && current >= clamped - EPS) break;
      if (direction < 0 && current <= clamped + EPS) break;
    }
    if (Math.abs(current - clamped) > EPS) {
      state.currentTime = clamped;
      renderAt(clamped);
    } else {
      state.currentTime = clamped;
    }
  }

  function seekToProgress(progress){
    if (!state.prepared) return;
    const targetTime = progressToTime(progress);
    if (targetTime < state.currentTime - EPS) {
      const savedMode = state.pvMode;
      const savedCache = state.pvRandomCache;
      const savedCacheMode = state.pvRandomCacheMode;
      const savedSeed = state.pvRandomSeed;
      const savedConfidence = state.confidenceThreshold;
      const savedSpeed = state.speedMultiplier;
      const savedPvOverride = (typeof window._pvOverride === 'number' && isFinite(window._pvOverride)) ? window._pvOverride : null;
      resetSimulation(false);
      state.pvMode = savedMode;
      state.pvRandomCache = savedCache;
      state.pvRandomCacheMode = savedCacheMode;
      state.pvRandomSeed = savedSeed;
      state.confidenceThreshold = savedConfidence;
      state.speedMultiplier = savedSpeed;
      if (savedPvOverride != null) window._pvOverride = savedPvOverride;
      prepareSimulation();
      if (!state.prepared) return;
      if (elements.confidence) {
        elements.confidence.value = String(Math.max(0, Math.min(1, savedConfidence)));
      }
      updateConfidenceLabel(savedConfidence);
      if (elements.speed && isFinite(savedSpeed) && savedSpeed > 0) {
        elements.speed.value = String(savedSpeed);
      }
    }
    advanceDeterministic(targetTime);
  }

  function resetSimulation(restorePv){
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = null;
    state.running = false;
    state.prepared = false;
    state.stateData = [];
    state.snapshot = new Map();
    window._electionNightSnapshot = null;
    state.currentTime = 0;
    state.lastTimestamp = null;
    state.lastLogKey = '';
    state.lastUncalledKey = '';
    state.year = null;
    state.totalEvPool = 538;
    state.unitColorMap = null;
    state.abbrColorMap = null;
    state.boxesDirty = false;
    state.callRecords = [];
    state.confidenceThreshold = getConfidenceSliderValue();
    updateConfidenceLabel(state.confidenceThreshold);

    if (elements.progress) {
      state.suppressProgressEvent = true;
      elements.progress.value = '0';
      state.suppressProgressEvent = false;
    }
    if (elements.phase) elements.phase.textContent = 'Idle';
    if (elements.timeLabel) elements.timeLabel.textContent = '19:00';
    if (elements.pvDisplay) elements.pvDisplay.textContent = 'PV: —';
    if (elements.log) elements.log.innerHTML = '';
    if (elements.logUncalled) elements.logUncalled.innerHTML = '';
    if (elements.logHeader) elements.logHeader.textContent = 'Call log';
    if (elements.victory) {
      elements.victory.textContent = '';
      elements.victory.className = 'en-log-victory';
      elements.victory.style.display = 'none';
    }

    if (restorePv) {
      window._pvOverride = state.prevPvOverride;
      if (state.prevPvPresetName != null) window._pvPresetName = state.prevPvPresetName;
      if (typeof window.updateAll === 'function') window.updateAll();
      const pvSlider = document.getElementById('pvSlider');
      if (pvSlider && state.prevPvSliderValue != null) pvSlider.value = state.prevPvSliderValue;
    }

    if (state.prevUnitColors) {
      window._lastUnitColors = new Map(state.prevUnitColors);
    }
    if (state.prevAbbrColors) {
      window._lastAbbrColors = new Map(Array.from(state.prevAbbrColors.entries(), ([abbr, info]) => [abbr, { ...(info || {}) }]));
    }
    if (typeof window.renderSmallStateBoxes === 'function' && window._lastUnitColors && window._lastAbbrColors && state.prevUnitColors) {
      const year = getSelectedYear();
      try { window.renderSmallStateBoxes(year, window._lastAbbrColors, window._lastUnitColors); } catch(e) {}
    }

    window._electionNightActive = false;
    updateToggleLabel();
  }

  function startSimulation(){
    if (!state.prepared || state.running) return;
    state.running = true;
    state.lastTimestamp = null;
    state.rafId = requestAnimationFrame(tick);
    updateToggleLabel();
  }

  function pauseSimulation(){
    state.running = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = null;
    updateToggleLabel();
  }

  function tick(timestamp){
    if (!state.running) return;
    if (!state.lastTimestamp) state.lastTimestamp = timestamp;
    const deltaMs = timestamp - state.lastTimestamp;
    state.lastTimestamp = timestamp;
    const deltaMinutes = (deltaMs / 1000) * state.speedMultiplier * state.minutesPerSecond;
    state.currentTime = Math.min(state.currentTime + deltaMinutes, state.simEnd);
    renderAt(state.currentTime);
    if (state.currentTime >= state.simEnd - EPS) {
      pauseSimulation();
    } else {
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function buildStateData(year, pvValue){
    const rows = (window._byYearMap && window._byYearMap.get(year)) || [];
    if (!rows.length) return [];
    const out = [];

    rows.forEach(row => {
      if (!row || !row.unit || row.unit === 'NATIONAL') return;
      const unit = String(row.unit);
      const abbr = unit.slice(0,2);
      const isAtLarge = /-AL$/.test(unit);
      const isDistrict = /-(0[1-9])$/.test(unit);
      const isState = /^[A-Z]{2}$/.test(unit) || unit === 'DC';
      if (!isState && !isAtLarge && !isDistrict) return;

      const totalVotes = totalFromRow(row);
      if (!isFinite(totalVotes) || totalVotes <= 0) return;

      const totalThirdVotesRaw = +row.tVotes || 0;
      const totalThirdVotes = Math.max(0, Math.min(totalVotes, totalThirdVotesRaw));
      const totalThirdShare = clamp01(totalVotes > 0 ? (totalThirdVotes / totalVotes) : 0);
      let topThirdShare = clamp01(isFinite(+row.tp) ? (+row.tp) : totalThirdShare);
      if (topThirdShare > totalThirdShare + EPS) {
        topThirdShare = Math.min(topThirdShare, totalThirdShare);
      }
      const thirdPartyShare = totalThirdShare;
      const baseMargin = +row.rm || 0;
      let adjustedMargin = baseMargin + pvValue;
      if (typeof isUnitFlipped === 'function' && isUnitFlipped(year, unit)) {
        adjustedMargin = -adjustedMargin;
      }
      if (year === 1876 && abbr === 'CO') {
        const forced = Math.abs(adjustedMargin);
        adjustedMargin = forced > 0 ? -forced : -0.06;
      }

      const twoPartyShare = Math.max(0, Math.min(1, 1 - thirdPartyShare));
      const dTwoPartyFinal = clamp01(0.5 + adjustedMargin / 2);
      const rTwoPartyFinal = 1 - dTwoPartyFinal;
      const dShareFinal = twoPartyShare * dTwoPartyFinal;
      const rShareFinal = twoPartyShare * rTwoPartyFinal;
      const topShareFinal = Math.max(0, Math.min(1, topThirdShare));

      let winner = determineWinner(dShareFinal, rShareFinal, topShareFinal);
    if (year === 1876 && abbr === 'CO') winner = 'R';
      const ev = getEv(year, unit);

      const startTime = getStateStartTime(abbr);
      const closeness = 1 - Math.min(1, Math.abs(adjustedMargin) / 0.12);
      const speed = STATE_COUNTING_SPEEDS[abbr] || 1.0;
      let duration = Math.max(MIN_DURATION, (MIN_DURATION * (1 + 1.3 * closeness)) / Math.max(0.35, speed));
      const rng = mulberry32(hashCode(`${year}-${unit}-${Math.round(pvValue*10000)}`));
      const jitter = (rng() - 0.5) * 24;
      let callDeadline = startTime + MIN_CALL_DELAY + closeness * EXTRA_CALL_WINDOW + jitter;
      callDeadline = Math.max(startTime + 10, Math.min(callDeadline, startTime + duration - 10));

      const instantCall = year === 1876 && abbr === 'CO';
      if (instantCall) {
        duration = Math.max(20, duration * 0.2);
        callDeadline = startTime + 1;
      }

      const biasParams = instantCall ? null : createBiasParams(unit, adjustedMargin, closeness, rng);
      const pathSelections = collectPathSelections(unit, abbr);
      if (!pathSelections.length) return;

      const aliases = new Set([unit]);
      if (isAtLarge) aliases.add(abbr);
      if (isState) aliases.add(abbr);

      const finalDVotes = totalVotes * dShareFinal;
      const finalRVotes = totalVotes * rShareFinal;
      const finalOTopVotes = totalVotes * topShareFinal;
      const finalOTotalVotes = totalVotes * thirdPartyShare;
      const finalMarginTwoParty = dTwoPartyFinal - rTwoPartyFinal;
      const finalLeader = determineLeader(dShareFinal, rShareFinal, topShareFinal, 1);
      const finalMarginStr = finalLeader === 'O' ? 'Other lead' : formatLean(finalMarginTwoParty);
      const finalColor = safeMarginToColor(finalMarginTwoParty, finalLeader === 'O');
      const finalCountedVotes = totalVotes;
      const countedMargin = finalCountedVotes > EPS
        ? ((finalDVotes - finalRVotes) / finalCountedVotes)
        : 0;
      let countedMarginStr = 'None';
      const twoPartyVotes = finalDVotes + finalRVotes;
      if (finalLeader === 'O') {
        countedMarginStr = 'Other lead';
      } else if (twoPartyVotes > EPS) {
        const leanVal = (finalDVotes - finalRVotes) / twoPartyVotes;
        countedMarginStr = Math.abs(leanVal) < 0.00005 ? 'EVEN' : formatLean(leanVal);
      } else if (finalCountedVotes > EPS) {
        countedMarginStr = 'EVEN';
      }
      const targetMetrics = {
        reporting: 1,
        leader: finalLeader,
        margin: finalMarginTwoParty,
        marginStr: finalMarginStr,
        countedMargin,
        countedMarginStr,
        color: finalColor,
        dShare: dShareFinal,
        rShare: rShareFinal,
        oShare: thirdPartyShare,
        topThirdShare: topShareFinal,
        totalThirdShare: thirdPartyShare,
        confidence: 1,
        dVotesCounted: finalDVotes,
        rVotesCounted: finalRVotes,
        oVotesCounted: finalOTopVotes,
        oVotesCountedTotal: finalOTotalVotes,
        countedVotes: finalCountedVotes,
        remainingVotes: 0
      };

      out.push({
        unitKey: unit,
        abbr,
        type: isDistrict ? 'district' : (isAtLarge ? 'atlarge' : 'state'),
        totalVotes,
        thirdPartyShare,
        topThirdShare,
        twoPartyShare,
        dTwoPartyFinal,
        rTwoPartyFinal,
        dShareFinal,
        rShareFinal,
        winner,
        ev,
        startTime,
        duration,
        callDeadline,
        calledAt: null,
        calledMetrics: null,
        callRecord: null,
        instantCall,
        biasParams,
        pathSelections,
        aliases,
        pvWeight: isAtLarge ? 0 : 1,
        closeness,
        targetMetrics,
        callLeader: null,
        misCallLogged: false
      });
    });

    return out;
  }

  function renderAt(timeMinutes){
    if (!state.stateData.length) return;

    const phase = getPhase(timeMinutes);
    const phaseName = phase ? phase.name : 'Final';
    if (elements.phase) elements.phase.textContent = `Phase: ${phaseName}`;
    if (elements.timeLabel) elements.timeLabel.textContent = `${formatTimeLabel(timeMinutes)} ET`;

    let dEV = 0, rEV = 0, oEV = 0;
    let dCounted = 0, rCounted = 0, oCounted = 0, countedVotes = 0;

    state.snapshot.clear();

    state.stateData.forEach(st => {
      const metrics = computeMetrics(st, timeMinutes, phaseName);
      st.latestMetrics = metrics;

      if (!st.calledAt) {
        if (shouldCallState(st, metrics, timeMinutes)) {
          registerCall(st, metrics, timeMinutes);
        } else if (shouldForceCall(st, metrics, timeMinutes)) {
          registerCall(st, metrics, Math.max(timeMinutes, st.callDeadline));
        }
      }

      const isCalled = st.calledAt != null && timeMinutes >= st.calledAt - EPS;

      let displayColor = metrics.color;
      if (!isCalled && metrics.reporting > 0) {
        if (metrics.margin != null && Math.abs(metrics.margin) < 0.01) {
          displayColor = BRIGHT_TOSSUP_COLOR;
        } else {
          displayColor = blendColors(metrics.color, '#cccccc', UNCALLED_BRIGHTEN);
        }
      }
      applyColor(st, displayColor, metrics);

      if (isCalled) {
        if (st.winner === 'D') dEV += st.ev;
        else if (st.winner === 'R') rEV += st.ev;
        else oEV += st.ev;
      }

      if (st.pvWeight) {
        const counted = st.totalVotes * metrics.reporting;
        dCounted += counted * metrics.dShare;
        rCounted += counted * metrics.rShare;
        oCounted += counted * metrics.oShare;
        countedVotes += counted;
      }

      const snapshot = {
        ev: st.ev,
        margin: metrics.countedMargin,
        marginStr: metrics.countedMarginStr,
        reporting: metrics.reporting,
        called: isCalled,
        leader: metrics.leader,
        confidence: metrics.confidence,
        dVotes: metrics.dVotesCounted,
        rVotes: metrics.rVotesCounted,
        oVotes: metrics.oVotesCounted,
        oVotesTotal: metrics.oVotesCountedTotal,
        countedVotes: metrics.countedVotes,
        remainingVotes: metrics.remainingVotes,
        topThirdShare: metrics.topThirdShare,
        totalThirdShare: metrics.totalThirdShare
      };
      st.aliases.forEach(alias => state.snapshot.set(alias, snapshot));
      state.snapshot.set(st.unitKey, snapshot);
      maybeEmitMiscall(st, metrics, timeMinutes);
    });

    flushSmallBoxes();

    window._electionNightSnapshot = state.snapshot;

    updateEvDisplay(dEV, rEV, oEV);
    updatePopularVoteDisplay(dCounted, rCounted, oCounted, countedVotes);
    updateProgressSlider(timeMinutes);
    updateCallLog(timeMinutes);
    if (typeof window.refreshActiveMapTip === 'function') {
      try { window.refreshActiveMapTip(); } catch(e) {}
    }
  }

  function computeMetrics(st, timeMinutes, phaseName){
    const reporting = computeReportingFraction(st, timeMinutes);
    const bias = logisticBias(st.biasParams, reporting, phaseName);
    const rawD = st.dTwoPartyFinal * Math.max(0.2, bias);
    const rawR = Math.max(EPS, st.rTwoPartyFinal);
    const sumRaw = rawD + rawR;
    const dTwoParty = sumRaw > EPS ? rawD / sumRaw : 0.5;
    const rTwoParty = 1 - dTwoParty;
    const blend = Math.pow(Math.max(0, Math.min(1, reporting)), 3);
    const dShareBlend = (dTwoParty * (1 - blend) + st.dTwoPartyFinal * blend);
    const rShareBlend = 1 - dShareBlend;
    const totalThirdShare = st.thirdPartyShare;
    const topThirdShare = (st.topThirdShare != null) ? st.topThirdShare : totalThirdShare;
    const dShare = st.twoPartyShare * dShareBlend;
    const rShare = st.twoPartyShare * rShareBlend;
    const oShare = totalThirdShare;

    const leader = determineLeader(dShare, rShare, topThirdShare, reporting);
    const margin = reporting > 0 ? (dShareBlend - rShareBlend) : null;
    const marginStr = (reporting > 0 && leader !== 'O') ? formatLean(margin) : (leader === 'O' && reporting > 0 ? 'Other lead' : '');

    const baseColor = leader === 'O'
      ? THIRD_PARTY_COLOR
      : safeMarginToColor(margin || 0, leader === 'O');
    const intensity = Math.pow(Math.max(0, Math.min(1, reporting)), 0.7);
    const color = intensity <= 0 ? NEUTRAL_COLOR : blendColors(NEUTRAL_COLOR, baseColor, Math.min(1, intensity));

    const stats = computeVoteStats(st, reporting, dShare, rShare, oShare, topThirdShare);
    const countedMargin = stats.countedVotes > EPS ? ((stats.dCounted - stats.rCounted) / stats.countedVotes) : null;
    let countedMarginStr = 'None';
    if (stats.countedVotes > EPS) {
      if (leader === 'O') countedMarginStr = 'Other lead';
      else countedMarginStr = formatLean(countedMargin);
    }
    const confidence = calculateConfidence(st, stats);

    let result = {
      reporting,
      leader,
      margin,
      marginStr,
      countedMargin,
      countedMarginStr,
      color,
      dShare,
      rShare,
      oShare,
      topThirdShare,
      totalThirdShare,
      confidence,
      dVotesCounted: stats.dCounted,
      rVotesCounted: stats.rCounted,
      oVotesCounted: stats.oCounted,
      oVotesCountedTotal: stats.oTotalCounted,
      countedVotes: stats.countedVotes,
      remainingVotes: stats.remainingVotes
    };

    if (st.targetMetrics && reporting >= 1 - EPS) {
      result = { ...result, ...st.targetMetrics };
    }

    return result;
  }

  function computeVoteStats(st, reporting, dShare, rShare, totalThirdShare, topThirdShare){
    const countedVotes = st.totalVotes * Math.max(0, Math.min(1, reporting));
    const dCounted = countedVotes * Math.max(0, Math.min(1, dShare));
    const rCounted = countedVotes * Math.max(0, Math.min(1, rShare));
    const totalThirdClamped = Math.max(0, Math.min(1, totalThirdShare || 0));
    const topThirdClamped = Math.max(0, Math.min(1, (topThirdShare != null ? topThirdShare : totalThirdClamped)));
    const oTotalCounted = countedVotes * totalThirdClamped;
    const oCounted = countedVotes * topThirdClamped;
    const remainingVotes = Math.max(0, st.totalVotes - countedVotes);
    return {
      countedVotes,
      dCounted,
      rCounted,
      oCounted,
      oTotalCounted,
      remainingVotes
    };
  }

  function calculateConfidence(st, stats){
    if (!st) return 0;
    const { countedVotes, dCounted, rCounted, oCounted, remainingVotes } = stats;
    if (countedVotes <= EPS) return 0;
    if (remainingVotes <= EPS) {
      const votes = [dCounted, rCounted, oCounted];
      votes.sort((a, b) => b - a);
      return votes[0] - votes[1] > EPS ? 1 : 0;
    }
    const partyVotes = [
      { code: 'D', value: dCounted },
      { code: 'R', value: rCounted },
      { code: 'O', value: oCounted }
    ];
    partyVotes.sort((a, b) => b.value - a.value);
    const leaderVotes = partyVotes[0].value;
    const runnerVotes = partyVotes[1] ? partyVotes[1].value : 0;
    const voteGap = leaderVotes - runnerVotes;
    if (voteGap <= EPS) return 0;
    if (voteGap >= remainingVotes - EPS) return 1;
    return Math.min(1, Math.max(0, voteGap / Math.max(EPS, remainingVotes)));
  }

  function maybeEmitMiscall(st, metrics, currentTime){
    if (!st || !st.callRecord || st.misCallLogged) return;
    if (st.callRecord.kind !== 'call') return;
    const calledLeader = st.callRecord.leader;
    const finalLeader = st.winner;
    if (!calledLeader || calledLeader === finalLeader) return;
    if (!metrics || metrics.reporting < 1 - EPS) return;
    st.misCallLogged = true;
    const correctionTime = Math.max(currentTime, st.callRecord.time + 0.01);
    const finalLeaderText = formatLeader(finalLeader);
    const calledLeaderText = formatLeader(calledLeader);
    const callTimeStr = formatTimeLabel(st.callRecord.time);
    const thresholdText = isFinite(st.callRecord.threshold)
      ? ` (threshold ${st.callRecord.threshold.toFixed(2)})`
      : '';
    const message = `${formatTimeLabel(correctionTime)} – Correction: ${formatUnitLabel(st.unitKey)} finishes for ${finalLeaderText}. Previously called for ${calledLeaderText} at ${callTimeStr}${thresholdText}.`;
    state.callRecords.push({
      kind: 'notice',
      noticeType: 'miscall',
      unitKey: st.unitKey,
      displayLabel: formatUnitLabel(st.unitKey),
      time: correctionTime,
      text: message,
      calledLeader,
      finalLeader
    });
    state.lastLogKey = '';
  }

  function shouldCallState(st, metrics, currentTime){
    if (st.instantCall) {
      return currentTime >= st.startTime - EPS;
    }
    if (!metrics || metrics.leader == null) return false;
    if (metrics.reporting < MIN_REPORTING_TO_CALL && currentTime < st.callDeadline - 5) return false;
    if (metrics.reporting >= 0.999) return true;
    const threshold = Math.max(0, Math.min(1, isFinite(state.confidenceThreshold) ? state.confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD));
    return isFinite(metrics.confidence) && metrics.confidence >= threshold;
  }

  function shouldForceCall(st, metrics, currentTime){
    if (!metrics || metrics.leader == null) return false;
    if (metrics.reporting >= 0.999) {
      return metrics.leader === st.winner;
    }
    if (currentTime < st.callDeadline - EPS) return false;
    if (metrics.reporting < MIN_REPORTING_TO_CALL) return false;
    if (metrics.leader !== st.winner) return false;
    const threshold = Math.max(0, Math.min(1, isFinite(state.confidenceThreshold) ? state.confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD));
    return isFinite(metrics.confidence) && metrics.confidence >= threshold;
  }

  function registerCall(st, metrics, currentTime){
    if (!st || st.calledAt != null) return;
    const callTime = Math.max(currentTime, st.startTime);
    st.calledAt = callTime;
    st.calledMetrics = metrics ? { ...metrics } : null;
    const effectiveMarginStr = metrics
      ? metrics.countedMarginStr
      : 'None';
    const reporting = metrics ? metrics.reporting : 0;
    const confidence = metrics ? metrics.confidence : 1;
    const calledLeader = metrics ? metrics.leader : null;
    const thresholdUsed = Math.max(0, Math.min(1, isFinite(state.confidenceThreshold) ? state.confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD));
    st.callLeader = calledLeader;
    st.callRecord = {
      kind: 'call',
      unitKey: st.unitKey,
      displayLabel: formatUnitLabel(st.unitKey),
      time: callTime,
      leader: calledLeader,
      actualWinner: st.winner,
      marginStr: effectiveMarginStr,
      reporting,
      ev: st.ev,
      confidence,
      threshold: thresholdUsed,
      dVotes: metrics ? metrics.dVotesCounted : null,
      rVotes: metrics ? metrics.rVotesCounted : null,
      oVotes: metrics ? metrics.oVotesCounted : null,
      oVotesTotal: metrics ? metrics.oVotesCountedTotal : null,
      countedVotes: metrics ? metrics.countedVotes : null,
      remainingVotes: metrics ? metrics.remainingVotes : null,
      topThirdShare: metrics ? metrics.topThirdShare : null,
      totalThirdShare: metrics ? metrics.totalThirdShare : null
    };
    state.callRecords.push(st.callRecord);
  }

  function flushSmallBoxes(){
    if (!state.boxesDirty || !state.unitColorMap || !state.abbrColorMap || !state.year) return;
    state.boxesDirty = false;
    if (typeof window.renderSmallStateBoxes === 'function') {
      window._lastUnitColors = state.unitColorMap;
      window._lastAbbrColors = state.abbrColorMap;
      try { window.renderSmallStateBoxes(state.year, state.abbrColorMap, state.unitColorMap); } catch(e) {}
    }
  }

  function updateSmallBoxes(st, color, metrics){
    if (!st || !state.unitColorMap || !state.abbrColorMap) return;
    state.unitColorMap.set(st.unitKey, color);
    if (st.type !== 'district') {
      const info = metrics ? {
        color,
        reporting: metrics.reporting,
        margin: metrics.countedMargin,
        marginStr: metrics.countedMarginStr,
        leader: metrics.leader,
        confidence: metrics.confidence,
        called: st.calledAt != null,
        dVotes: metrics.dVotesCounted,
        rVotes: metrics.rVotesCounted,
        oVotes: metrics.oVotesCounted,
        oVotesTotal: metrics.oVotesCountedTotal,
        countedVotes: metrics.countedVotes,
        remainingVotes: metrics.remainingVotes,
        topThirdShare: metrics.topThirdShare,
        totalThirdShare: metrics.totalThirdShare
      } : { color };
      state.abbrColorMap.set(st.abbr, info);
    }
    state.boxesDirty = true;
  }

  function updateEvDisplay(dEV, rEV, oEV){
    const totalPool = Math.max(1, state.totalEvPool || 538);
    const called = Math.max(0, dEV + rEV + oEV);
    const uEV = Math.max(0, totalPool - called);

    const dPct = (dEV / totalPool) * 100;
    const uPct = (uEV / totalPool) * 100;
    const oPct = (oEV / totalPool) * 100;
    const rPct = (rEV / totalPool) * 100;

    const dEl = document.getElementById('evFillD');
    const uEl = document.getElementById('evFillU');
    const oEl = document.getElementById('evFillO');
    const rEl = document.getElementById('evFillR');
    const txt = document.getElementById('evText');

    const segments = [
      { el: dEl, pct: dPct, value: dEV },
      { el: uEl, pct: uPct, value: uEV },
      { el: oEl, pct: oPct, value: oEV },
      { el: rEl, pct: rPct, value: rEV }
    ];

    let leftOffset = 0;
    let rightOffset = 0;
    const leftActive = [];
    const rightActive = [];

    segments.forEach(seg => {
      if (!seg.el) return;
      const visible = seg.value > EPS;
      seg.el.style.display = visible ? '' : 'none';
      seg.el.style.borderRadius = '0';
      if (!visible) {
        seg.el.style.width = '0%';
        return;
      }

      const anchor = (seg.el.dataset && seg.el.dataset.anchor) || '';
      const widthPct = `${seg.pct.toFixed(3)}%`;
      if (anchor === 'right') {
        seg.el.style.left = 'auto';
        seg.el.style.right = `${rightOffset.toFixed(3)}%`;
        seg.el.style.width = widthPct;
        rightOffset += seg.pct;
        rightActive.push(seg.el);
      } else {
        seg.el.style.left = `${leftOffset.toFixed(3)}%`;
        seg.el.style.right = 'auto';
        seg.el.style.width = widthPct;
        leftOffset += seg.pct;
        leftActive.push(seg.el);
      }
    });

    if (leftActive.length) {
      const firstLeft = leftActive[0];
      firstLeft.style.borderTopLeftRadius = firstLeft.style.borderBottomLeftRadius = '9px';
      if (!rightActive.length) {
        const lastLeft = leftActive[leftActive.length - 1];
        lastLeft.style.borderTopRightRadius = lastLeft.style.borderBottomRightRadius = '9px';
      }
    }

    if (rightActive.length) {
      const firstRight = rightActive[0];
      firstRight.style.borderTopRightRadius = firstRight.style.borderBottomRightRadius = '9px';
      if (!leftActive.length) {
        const lastRight = rightActive[rightActive.length - 1];
        lastRight.style.borderTopLeftRadius = lastRight.style.borderBottomLeftRadius = '9px';
      }
    }

    if (txt) {
      const parts = [`D ${dEV}`];
      if (uEV > 0) parts.push(`U ${uEV}`);
      if (oEV > 0) parts.push(`O ${oEV}`);
      parts.push(`R ${rEV}`);
      txt.textContent = (uEV > 0 || oEV > 0)
        ? parts.join(' | ')
        : `${dEV} - ${rEV}`;
    }
  }

  function updatePopularVoteDisplay(dVotes, rVotes, oVotes, counted){
    if (!state.prepared) return;
    const fmt = x => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '0';
    const pvDem = document.getElementById('pvDem');
    const pvRep = document.getElementById('pvRep');
    const pvOth = document.getElementById('pvOth');
    const pvTot = document.getElementById('pvTot');
    if (pvDem) pvDem.textContent = fmt(dVotes);
    if (pvRep) pvRep.textContent = fmt(rVotes);
    if (pvOth) pvOth.textContent = fmt(oVotes);
    if (pvTot) pvTot.textContent = fmt(counted);

    const margin = counted > 0 ? ((dVotes - rVotes) / counted) : null;
    const marginStr = margin == null ? '—' : formatLean(margin);

    const pvVal = document.getElementById('pvVal');
    if (pvVal) pvVal.textContent = margin == null ? 'PV (counted): —' : `PV (counted): ${marginStr}`;

    if (elements.pvDisplay) {
      if (state.pvMode === 'current') {
        elements.pvDisplay.textContent = margin == null ? `PV: —` : `PV: ${marginStr}`;
      } else {
        elements.pvDisplay.textContent = margin == null
          ? `PV: — ` //(target ${state.targetPvLabel})`
          : `PV: ${marginStr}`; // (target ${state.targetPvLabel})`;
      }
    }
  }

  function updateProgressSlider(timeMinutes){
    if (!elements.progress) return;
    const value = (timeMinutes - state.simStart) / (state.simEnd - state.simStart);
    state.suppressProgressEvent = true;
    elements.progress.value = String(Math.max(0, Math.min(1, value)));
    state.suppressProgressEvent = false;
  }

  function getConfidenceSliderValue(){
    if (!elements.confidence) return Math.max(0, Math.min(1, isFinite(state.confidenceThreshold) ? state.confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD));
    const raw = parseFloat(elements.confidence.value);
    if (!isFinite(raw)) return Math.max(0, Math.min(1, isFinite(state.confidenceThreshold) ? state.confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD));
    return Math.max(0, Math.min(1, raw));
  }

  function updateConfidenceLabel(val){
    const target = Math.max(0, Math.min(1, isFinite(val) ? val : getConfidenceSliderValue()));
    if (elements.confidenceVal) {
      elements.confidenceVal.textContent = target.toFixed(2);
    }
  }

  function updateCallLog(currentTime){
    const timeLabel = formatTimeLabel(currentTime);
    if (elements.logHeader) elements.logHeader.textContent = `Call log ${timeLabel} ET`;
    if (!elements.log && !elements.logUncalled && !elements.victory) return;

    const readyEvents = state.callRecords
      .filter(rec => rec && currentTime >= rec.time - EPS)
      .slice()
      .sort((a, b) => {
        if (Math.abs(a.time - b.time) > EPS) return a.time - b.time;
        const orderMap = { call: 0, notice: 1, outcome: 2 };
        const orderA = orderMap[(a && a.kind) ? a.kind : 'call'] ?? 3;
        const orderB = orderMap[(b && b.kind) ? b.kind : 'call'] ?? 3;
        if (orderA !== orderB) return orderA - orderB;
        return (a.unitKey || '').localeCompare(b.unitKey || '');
      });

    const uncalledCandidates = (state.stateData || [])
      .filter(st => st && st.calledAt == null && st.latestMetrics && st.latestMetrics.reporting > EPS)
      .map(st => {
        const metrics = st.latestMetrics;
        return {
          unitKey: st.unitKey,
          displayLabel: formatUnitLabel(st.unitKey),
          confidence: isFinite(metrics.confidence) ? metrics.confidence : 0,
          reporting: isFinite(metrics.reporting) ? metrics.reporting : 0,
          leader: metrics.leader,
          marginStr: metrics.countedMarginStr,
          ev: st.ev || 0
        };
      })
      .sort((a, b) => {
        const confDiff = (b.confidence || 0) - (a.confidence || 0);
        if (Math.abs(confDiff) > EPS) return confDiff;
        return (b.reporting || 0) - (a.reporting || 0);
      })
      .slice(0, 3);

  const readyCalls = readyEvents.filter(rec => !rec.kind || rec.kind === 'call');
    const callLines = [];
    const signatureParts = [];
    const totalPool = state.totalEvPool || 538;
    const majority = Math.floor(totalPool / 2) + 1;
    let dRunning = 0, rRunning = 0, oRunning = 0;
    let outcome = null;

    readyCalls.forEach(record => {
      const live = state.snapshot.get(record.unitKey);
      if (live) {
        record.reporting = live.reporting;
        record.marginStr = live.marginStr;
        record.confidence = live.confidence;
        record.dVotes = live.dVotes;
        record.rVotes = live.rVotes;
        record.oVotes = live.oVotes;
        record.oVotesTotal = live.oVotesTotal;
        record.countedVotes = live.countedVotes;
        record.remainingVotes = live.remainingVotes;
        record.topThirdShare = live.topThirdShare;
        record.totalThirdShare = live.totalThirdShare;
      }
  const tallyWinner = record.actualWinner || record.leader;
  if (tallyWinner === 'D') dRunning += record.ev || 0;
  else if (tallyWinner === 'R') rRunning += record.ev || 0;
  else oRunning += record.ev || 0;
      if (!outcome) {
        if (dRunning >= majority) outcome = { type: 'D', time: record.time, total: dRunning };
        else if (rRunning >= majority) outcome = { type: 'R', time: record.time, total: rRunning };
      }
      const leaderText = formatLeader(record.leader);
      const reportingText = formatReportingText(record.reporting);
      const marginText = formatMarginText(record.marginStr, record.leader);
      const confidenceText = formatConfidenceText(record.confidence);
      const callLine = {
        kind: 'call',
        time: record.time,
        className: 'en-log-entry',
        text: `${formatTimeLabel(record.time)} – Called ${record.displayLabel} for ${leaderText} (${reportingText}, ${marginText}, ${confidenceText})`,
        signature: `call:${record.unitKey}:${(isFinite(record.confidence) ? record.confidence : -1).toFixed(3)}:${(isFinite(record.reporting) ? record.reporting : -1).toFixed(3)}:${record.marginStr || ''}`
      };
      callLines.push(callLine);
      signatureParts.push(callLine.signature);
    });

    const finalD = dRunning;
    const finalR = rRunning;
    const finalO = oRunning;
    const totalCalled = finalD + finalR + finalO;
    const allCalled = totalCalled >= totalPool - EPS;
    if (!outcome && allCalled && Math.abs(dRunning - rRunning) <= EPS) {
      outcome = {
        type: 'T',
        time: readyCalls.length ? readyCalls[readyCalls.length - 1].time : currentTime,
        total: finalD,
        other: finalO
      };
    }

    let outcomeLine = null;
    let outcomeMessage = null;
    let outcomeClass = '';
    if (outcome) {
      const timeStr = formatTimeLabel(outcome.time != null ? outcome.time : currentTime);
      if (outcome.type === 'D') {
        const latestTotal = finalD;
        outcome.total = latestTotal;
        outcomeMessage = `Democrats clinch the presidency with ${latestTotal} EV (needed ${majority}).`;
        outcomeClass = ' win-dem';
      } else if (outcome.type === 'R') {
        const latestTotal = finalR;
        outcome.total = latestTotal;
        outcomeMessage = `Republicans clinch the presidency with ${latestTotal} EV (needed ${majority}).`;
        outcomeClass = ' win-rep';
      } else {
        const latestOther = finalO;
        outcome.other = latestOther;
        outcomeMessage = `Electoral College tie: D ${finalD} | R ${finalR}${latestOther ? ` | Other ${latestOther}` : ''}.`;
        outcomeClass = ' tie';
      }
      const outcomeText = `${timeStr} – ${outcomeMessage}`;
      outcomeLine = {
        kind: 'outcome',
        time: outcome.time != null ? outcome.time : currentTime,
        className: `en-log-entry en-log-outcome${outcomeClass}`,
        text: outcomeText,
        signature: `outcome:${outcome.type}:${outcomeText}`
      };
    }

    if (elements.victory) {
      if (outcomeLine) {
        elements.victory.textContent = outcomeMessage || '';
        elements.victory.className = `en-log-victory${outcomeClass}`;
        elements.victory.style.display = '';
      } else {
        elements.victory.textContent = '';
        elements.victory.className = 'en-log-victory';
        elements.victory.style.display = 'none';
      }
    }

    const noticeLines = readyEvents
      .filter(rec => rec.kind === 'notice')
      .map(rec => {
        const text = rec.text || `${formatTimeLabel(rec.time)} – ${rec.noticeType || 'Notice'}${rec.displayLabel ? `: ${rec.displayLabel}` : ''}`;
        return {
          kind: 'notice',
          time: rec.time,
          className: 'en-log-entry en-log-notice',
          text,
          signature: `${rec.kind}:${rec.noticeType || ''}:${rec.unitKey || ''}:${rec.time.toFixed(3)}:${text}`
        };
      });
    noticeLines.forEach(line => signatureParts.push(line.signature));
    if (outcomeLine) signatureParts.push(outcomeLine.signature);

    let renderLines = [...callLines, ...noticeLines];
    if (outcomeLine) renderLines.push(outcomeLine);
    renderLines.sort((a, b) => {
      if (Math.abs(a.time - b.time) > EPS) return a.time - b.time;
      const orderMap = { call: 0, notice: 1, outcome: 2 };
      const orderA = orderMap[(a && a.kind) ? a.kind : 'call'] ?? 3;
      const orderB = orderMap[(b && b.kind) ? b.kind : 'call'] ?? 3;
      if (orderA !== orderB) return orderA - orderB;
      return a.signature.localeCompare(b.signature);
    });

    const readySignature = signatureParts.join('|');
    const uncalledSignatureParts = uncalledCandidates.map(c => {
      const confVal = isFinite(c.confidence) ? c.confidence : -1;
      const repVal = isFinite(c.reporting) ? c.reporting : -1;
      return `${c.unitKey}:${confVal.toFixed(3)}:${repVal.toFixed(3)}`;
    });
    const uncalledSignature = uncalledSignatureParts.join('|');

    const shouldUpdateLog = readySignature !== state.lastLogKey;
    const shouldUpdateUncalled = uncalledSignature !== state.lastUncalledKey;
    if (!shouldUpdateLog && !shouldUpdateUncalled) return;

    if (shouldUpdateLog) {
      state.lastLogKey = readySignature;
      if (elements.log) {
        const logEl = elements.log;
        const prevScrollTop = logEl.scrollTop;
        const prevScrollHeight = logEl.scrollHeight;
        const atBottom = prevScrollTop >= (prevScrollHeight - logEl.clientHeight - 4);
        logEl.innerHTML = '';
        if (renderLines.length) {
          const frag = document.createDocumentFragment();
          renderLines.forEach(lineInfo => {
            const line = document.createElement('div');
            line.className = lineInfo.className;
            line.textContent = lineInfo.text;
            frag.appendChild(line);
          });
          logEl.appendChild(frag);
        }
        const newScrollHeight = logEl.scrollHeight;
        if (atBottom) {
          logEl.scrollTop = newScrollHeight;
        } else {
          const delta = newScrollHeight - prevScrollHeight;
          logEl.scrollTop = Math.max(0, prevScrollTop + delta);
        }
      }
    }

    if (shouldUpdateUncalled) {
      state.lastUncalledKey = uncalledSignature;
      if (elements.logUncalled) {
        const container = elements.logUncalled;
        container.innerHTML = '';
        if (uncalledCandidates.length) {
          const title = document.createElement('div');
          title.className = 'en-log-section-title';
          title.textContent = 'STILL COUNTING (UNCALLED, TOP 3)';
          container.appendChild(title);
          const cardsContainer = document.createElement('div');
          cardsContainer.className = 'en-log-uncalled-cards';
          uncalledCandidates.forEach(candidate => {
            const card = document.createElement('div');
            card.className = 'en-log-uncalled-card';
            const label = candidate.ev > 0
              ? `${candidate.displayLabel} (${candidate.ev} EV)`
              : candidate.displayLabel;
            const infoParts = [];
            if (candidate.leader) {
              infoParts.push(`${formatLeader(candidate.leader)} lead`);
            }
            const marginDisplay = formatMarginText(candidate.marginStr, candidate.leader);
            if (marginDisplay && marginDisplay !== 'None') {
              infoParts.push(marginDisplay === 'EVEN' ? 'EVEN' : `Margin ${marginDisplay}`);
            }
            const confPct = Math.max(0, Math.min(100, Math.round((candidate.confidence || 0) * 100)));
            infoParts.push(`Confidence ${confPct}%`);
            infoParts.push(`${((candidate.reporting || 0) * 100).toFixed(1)}% reporting`);
            card.textContent = `${label} – ${infoParts.join(' · ')}`;
            cardsContainer.appendChild(card);
          });
          container.appendChild(cardsContainer);
        }
      }
    }
  }

  function resolvePvValue(){
    const mode = state.pvMode || 'current';
    const current = getCurrentPv();
    if (mode === 'current') {
      state.pvRandomCache = null;
      state.pvRandomCacheMode = null;
      state.pvRandomSeed = null;
      return current;
    }

    if (state.pvRandomCache != null && state.pvRandomCacheMode === mode) {
      window._pvOverride = state.pvRandomCache;
      return state.pvRandomCache;
    }

    if (state.pvRandomSeed == null) {
      const baseSeed = Date.now() >>> 0;
      const year = getSelectedYear() || 0;
      state.pvRandomSeed = hashCode(`${year}:${mode}:${baseSeed}`);
    }
    const rng = mulberry32(state.pvRandomSeed >>> 0);
    let sample = 0;
    for (let attempts = 0; attempts < 200; attempts++) {
      const draw = randStudentT4(rng) * 0.035;
      if (mode === 'randomD' && draw <= 0) continue;
      if (mode === 'randomR' && draw >= 0) continue;
      if (Math.abs(draw) > 0.18) continue;
      sample = draw;
      break;
    }
    state.pvRandomCache = sample;
    state.pvRandomCacheMode = mode;
    window._pvOverride = sample;
    return sample;
  }

  function applyColor(st, color, metrics){
    st.pathSelections.forEach(sel => {
      if (!sel) return;
      try { sel.attr('fill', color); }
      catch(e){ try { sel.style('fill', color); } catch(err){} }
    });
    updateSmallBoxes(st, color, metrics);
  }

  function collectPathSelections(unit, abbr){
    const selections = [];
    const statePath = selectStatePath(abbr);
    if (/-AL$/.test(unit) || /^[A-Z]{2}$/.test(unit) || unit === 'DC') {
      if (statePath) selections.push(statePath);
    }
    if (/(ME|NE)-0[1-9]$/.test(unit)) {
      const districtPath = selectDistrictPath(unit);
      if (districtPath) selections.push(districtPath);
    }
    return selections;
  }

  function selectStatePath(abbr){
    if (!window.d3) return null;
    const sel = d3.select(`#state-${abbr}`);
    return sel && !sel.empty() ? sel : null;
  }

  function selectDistrictPath(unit){
    if (window._districtPaths && typeof window._districtPaths.get === 'function') {
      return window._districtPaths.get(unit) || null;
    }
    return null;
  }

  function createBiasParams(unit, margin, closeness, rng){
    const rand = rng || Math.random;
    const mailHeavy = MAIL_HEAVY_STATES.has(unit.slice(0,2));
    const finalWinner = margin > EPS ? 'D' : margin < -EPS ? 'R' : null;
    let favored;
    if (!finalWinner) {
      favored = rand() < 0.5 ? 'D' : 'R';
    } else {
      let againstProb = 0.55 + 0.35 * closeness;
      if (mailHeavy) againstProb += finalWinner === 'D' ? -0.12 : 0.12;
      againstProb = Math.min(0.95, Math.max(0.05, againstProb));
      favored = rand() < againstProb ? (finalWinner === 'D' ? 'R' : 'D') : finalWinner;
    }
    const midpoint = clamp01(0.38 + rand() * 0.28);
    const steepness = 4.5 + rand() * 8.5;
    const strength = (1.0 + rand() * 1.2) * (0.65 + 0.5 * closeness);
    const linger = 0.65 + rand() * 0.35;
    return { favored, midpoint, steepness, strength, linger };
  }

  function logisticBias(params, reporting, phaseName){
    if (!params) return 1;
    const midpoint = params.midpoint;
    const steepness = params.steepness;
    const strength = params.strength;
    const favored = params.favored;
    const logisticVal = 1 / (1 + Math.exp(-steepness * (reporting - midpoint)));
    const base = favored === 'D'
      ? 0.72 + (0.5 * logisticVal * strength)
      : 1.28 - (0.5 * logisticVal * strength);
    const phaseDampener = {
      Early: 1.0,
      Mid: 0.95,
      Central: 0.8,
      Late: 0.55,
      Final: 0.25
    }[phaseName] || 0.25;
    const remaining = Math.max(0.3, 1 - reporting);
    const linger = params.linger ?? 0.8;
    const damp = phaseDampener * remaining * linger;
    return 1 + (base - 1) * damp;
  }

  function computeReportingFraction(st, timeMinutes){
    if (st.instantCall) {
      if (timeMinutes <= st.startTime) return 0;
      return 1;
    }
    if (timeMinutes <= st.startTime) return 0;
    if (timeMinutes >= st.startTime + st.duration) return 1;
    const normalized = (timeMinutes - st.startTime) / st.duration;
    const eased = normalized * normalized * (3 - 2 * normalized);
    return clamp01(eased);
  }

  function updateToggleLabel(){
    if (!elements.toggle) return;
    if (state.running) elements.toggle.textContent = 'Pause';
    else if (!state.prepared) elements.toggle.textContent = 'Start';
    else if (state.currentTime >= state.simEnd - EPS) elements.toggle.textContent = 'Replay';
    else elements.toggle.textContent = 'Resume';
  }

  function determineWinner(dShare, rShare, oShare){
    const shares = [
      { code: 'D', value: isFinite(dShare) ? dShare : 0 },
      { code: 'R', value: isFinite(rShare) ? rShare : 0 },
      { code: 'O', value: isFinite(oShare) ? oShare : 0 }
    ];
    shares.sort((a, b) => b.value - a.value);
    const top = shares[0];
    const runnerUp = shares[1];
    if (!top) return 'T';
    if (!runnerUp) return top.code;
    if (top.value - runnerUp.value <= EPS) return 'T';
    return top.code;
  }

  function determineLeader(dShare, rShare, oShare, reporting){
    if (reporting <= 0) return null;
    if (dShare >= rShare && dShare >= oShare) return 'D';
    if (rShare >= dShare && rShare >= oShare) return 'R';
    return 'O';
  }

  function formatLeader(code){
    if (code === 'D') return 'Democrats';
    if (code === 'R') return 'Republicans';
    if (code === 'O') return 'Other';
    return 'No call';
  }

  function formatMarginText(marginStr, leader){
    if (marginStr === 'None') return 'None';
    if (!marginStr) return leader === 'O' ? 'Other lead' : 'EVEN';
    return marginStr;
  }

  function formatReportingText(reporting){
    if (reporting == null || reporting <= 0) return '0% reporting';
    return `${(reporting * 100).toFixed(1)}% reporting`;
  }

  function formatConfidenceText(confidence){
    if (!isFinite(confidence)) return 'Confidence —';
    return `Confidence ${(confidence * 100).toFixed(0)}%`;
  }

  function formatLean(value){
    if (!isFinite(value)) return 'EVEN';
    if (typeof window.leanStr === 'function') return window.leanStr(value);
    if (Math.abs(value) < 0.00005) return 'EVEN';
    const pct = (Math.abs(value) * 100).toFixed(1);
    return `${value > 0 ? 'D' : 'R'}+${pct}`;
  }

  function formatUnitLabel(unit){
    if (/^[A-Z]{2}$/.test(unit)) return STATE_NAMES[unit] || unit;
    if (/-AL$/.test(unit)) {
      const abbr = unit.slice(0,2);
      return `${STATE_NAMES[abbr] || abbr} at-large`;
    }
    if (/(ME|NE)-0[1-9]$/.test(unit)) {
      const abbr = unit.slice(0,2);
      const district = unit.slice(3);
      return `${STATE_NAMES[abbr] || abbr} ${district}`;
    }
    return unit;
  }

  function getCurrentPv(){
    if (typeof window._pvOverride === 'number' && isFinite(window._pvOverride)) return window._pvOverride;
    return (typeof window._curPv === 'number' && isFinite(window._curPv)) ? window._curPv : 0;
  }

  function getSelectedYear(){
    const slider = document.getElementById('yearSlider');
    return slider ? parseInt(slider.value, 10) : 2024;
  }

  function getPvSliderValue(){
    const slider = document.getElementById('pvSlider');
    return slider ? slider.value : null;
  }

  function getStateStartTime(abbr){
    for (const [timeStr, arr] of Object.entries(POLL_CLOSINGS)) {
      if (arr.includes(abbr)) return toMinutesWithOffset(timeStr);
    }
    return toMinutesWithOffset('19:00');
  }

  function getPhase(minutes){
    if (!PHASES.length) return null;
    if (minutes < PHASES[0].start) return PHASES[0];
    for (const phase of PHASES) {
      if (minutes >= phase.start && minutes < phase.end) return phase;
    }
    return PHASES[PHASES.length - 1];
  }

  function toMinutes(timeStr){
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  function toMinutesWithOffset(timeStr){
    return toMinutes(timeStr) + TIME_OFFSET_MIN;
  }

  function formatTimeLabel(minutes){
    const dayMinutes = 24 * 60;
    const minuteOfDay = ((minutes % dayMinutes) + dayMinutes) % dayMinutes;
    const hours = Math.floor(minuteOfDay / 60);
    const mins = Math.floor(minuteOfDay % 60);
    const h12 = ((hours + 11) % 12) + 1;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    return `${h12}:${mins.toString().padStart(2, '0')} ${ampm}`;
  }

  function getEv(year, unit){
    if (typeof window.getEvFor === 'function') {
      const ev = window.getEvFor(year, unit);
      if (isFinite(ev)) return ev;
    }
    if (window._evByUnitMap && typeof window._evByUnitMap.get === 'function') {
      const alt = window._evByUnitMap.get(`${year}:${unit}`);
      if (isFinite(alt)) return alt;
    }
    return 0;
  }

  function determineEvPool(year, data){
    const fromGlobal = window._totalEvByYear && window._totalEvByYear.get(year);
    if (isFinite(fromGlobal) && fromGlobal > 0) return fromGlobal;
    if (!Array.isArray(data) || !data.length) return 538;

    const hasDistrictOrAtLarge = new Set();
    data.forEach(st => {
      if (!st) return;
      if (st.type === 'district' || st.type === 'atlarge') hasDistrictOrAtLarge.add(st.abbr);
    });

    const seen = new Set();
    let total = 0;
    data.forEach(st => {
      if (!st || !isFinite(st.ev)) return;
      if (st.type === 'district' || st.type === 'atlarge') {
        if (seen.has(st.unitKey)) return;
        seen.add(st.unitKey);
        total += st.ev;
      } else {
        if (hasDistrictOrAtLarge.has(st.abbr)) return;
        if (seen.has(st.abbr)) return;
        seen.add(st.abbr);
        total += st.ev;
      }
    });
    return total > 0 ? total : 538;
  }

  function totalFromRow(row){
    const direct = +row.total;
    if (isFinite(direct) && direct > 0) return direct;
    const sum = (+row.dVotes || 0) + (+row.rVotes || 0) + (+row.tVotes || 0);
    return sum > 0 ? sum : 1;
  }

  function clamp01(x){
    if (!isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  function clampByte(v){
    return Math.max(0, Math.min(255, v | 0));
  }

  function hexToRgb(hex){
    if (!hex) return [47, 47, 47];
    let cleaned = hex.replace('#', '');
    if (cleaned.length === 8) cleaned = cleaned.slice(0, 6);
    if (cleaned.length === 3) cleaned = cleaned.split('').map(c => c + c).join('');
    if (cleaned.length !== 6) return [47, 47, 47];
    const num = parseInt(cleaned, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function rgbToHex(r, g, b){
    return '#' + [r, g, b].map(v => clampByte(v).toString(16).padStart(2, '0')).join('');
  }

  function blendColors(a, b, t){
    const rgbA = hexToRgb(a);
    const rgbB = hexToRgb(b);
    const blended = [
      Math.round(rgbA[0] + (rgbB[0] - rgbA[0]) * t),
      Math.round(rgbA[1] + (rgbB[1] - rgbA[1]) * t),
      Math.round(rgbA[2] + (rgbB[2] - rgbA[2]) * t)
    ];
    return rgbToHex(blended[0], blended[1], blended[2]);
  }

  function safeMarginToColor(margin, isThird){
    if (isThird) return THIRD_PARTY_COLOR;
    if (typeof window.marginToColor === 'function') return window.marginToColor(margin, false);
    if (margin <= -0.20) return '#8B0000';
    if (margin <= -0.10) return '#B22222';
    if (margin <= -0.05) return '#CD5C5C';
    if (margin < 0) return '#F08080';
    if (margin < 0.05) return '#87CEFA';
    if (margin < 0.10) return '#6495ED';
    if (margin < 0.20) return '#4169E1';
    return '#00008B';
  }

  function hashCode(str){
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return h >>> 0;
  }

  function mulberry32(a){
    return function(){
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randn(rng){
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function randStudentT4(rng){
    const z = randn(rng);
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const g = randn(rng);
      v += g * g;
    }
    return z / Math.sqrt(v / 4);
  }

  window.resetElectionNightSimulation = function(restorePv = true){
    resetSimulation(restorePv);
  };

  window.prepareElectionNightSimulation = function(){
    if (!state.prepared) prepareSimulation();
  };

  window.seekElectionNightProgress = function(progress){
    const clamped = Math.max(0, Math.min(1, isFinite(progress) ? progress : 0));
    if (!state.prepared) prepareSimulation();
    if (state.prepared) seekToProgress(clamped);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

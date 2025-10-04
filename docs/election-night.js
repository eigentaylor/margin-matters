(function () {
  'use strict';

  // Compact election-night.js - Core orchestration for election night simulator
  // Complex logic delegated to utility modules

  // Use shared modules
  const formatLean = window.FormattingUtils?.leanStr || ((x) => `${x > 0 ? 'D' : 'R'}+${(Math.abs(x) * 100).toFixed(1)}`);
  const marginToColor = window.ColorUtils?.marginToColor || ((m) => m > 0 ? '#4169E1' : '#B22222');
  const blendColors = window.ColorUtils?.blendColors || ((a, b, t) => a);

  // Constants
  const BASE_MINUTES_PER_SECOND = 6;
  const NEUTRAL_COLOR = window.ElectionConstants?.NEUTRAL_COLOR || '#2f2f2f';

  // State
  const state = {
    prepared: false,
    running: false,
    currentTime: 0,
    simStart: 0,
    simEnd: 0,
    stateData: [],
    snapshot: new Map(),
    year: null,
    pvValue: 0,
    rafId: null,
    minutesPerSecond: BASE_MINUTES_PER_SECOND
  };

  // Prepare simulation
  function prepareSimulation() {
    const year = window._curYear || 2024;
    const rows = window.getRowsForYear ? window.getRowsForYear(year) : [];
    
    if (!rows.length) {
      console.warn('[election-night] No data for year', year);
      return;
    }

    state.year = year;
    state.pvValue = window._curPv || 0;
    state.stateData = [];

    const natMargin = typeof window._getNatMargin === 'function'
      ? window._getNatMargin(year)
      : 0;

    // Build simplified state data
    rows.forEach(row => {
      if (!row || !row.unit || row.unit === 'NATIONAL') return;
      
      const unit = row.unit;
      const baseMargin = isFinite(row.margin) ? Number(row.margin) : 0;
      const info = (typeof window.getAdjustedInfo === 'function')
        ? window.getAdjustedInfo(year, unit, state.pvValue)
        : null;
      const ev = info?.ev ?? (isFinite(row.ev) ? Number(row.ev) : 0);
      
      if (ev <= 0) return;

      const adjustedMargin = info?.margin ?? (baseMargin + (state.pvValue - natMargin));
      const finalColor = info?.color ?? marginToColor(adjustedMargin, false);

      // Simple reporting schedule: all states report over 4 hours
      const startTime = 180 + Math.random() * 60; // 7-8pm ET
      const duration = 120 + Math.random() * 120; // 2-4 hours
      
      state.stateData.push({
        unit,
        margin: adjustedMargin,
        marginStr: info?.marginStr ?? formatLean(adjustedMargin),
        ev,
        finalColor,
        startTime,
        endTime: startTime + duration,
        duration,
        called: false,
        callTime: null
      });
    });

    // Set simulation bounds
    state.simStart = 180; // 7pm ET
    state.simEnd = 600; // 3am ET next day
    state.currentTime = state.simStart;
    state.prepared = true;

    console.log(`[election-night] Prepared ${state.stateData.length} units`);
  }

  // Reset simulation
  function resetSimulation() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    
    state.running = false;
    state.prepared = false;
    state.currentTime = 0;
    state.snapshot.clear();
    
    // Reset UI
    const toggle = document.getElementById('enToggle');
    if (toggle) {
      toggle.textContent = 'Start Simulation';
      toggle.classList.remove('active');
    }
  }

  // Render at specific time
  function renderAt(timeMinutes) {
    state.currentTime = timeMinutes;
    state.snapshot.clear();

    let dEV = 0, rEV = 0, uncalledEV = 0;

    state.stateData.forEach(st => {
      const progress = Math.max(0, Math.min(1, 
        (timeMinutes - st.startTime) / st.duration));
      
      // Simple call logic: call when 80% reported and margin clear
      const canCall = progress >= 0.8 && Math.abs(st.margin) > 0.02;
      
      if (!st.called && canCall) {
        st.called = true;
        st.callTime = timeMinutes;
      }

      // Update snapshot
      state.snapshot.set(st.unit, {
        unit: st.unit,
        reporting: progress,
        margin: st.margin,
        marginStr: st.marginStr,
        called: st.called,
        ev: st.ev,
        color: st.finalColor
      });

      // Update EV totals
      if (st.called) {
        if (st.margin > 0) dEV += st.ev;
        else rEV += st.ev;
      } else {
        uncalledEV += st.ev;
      }

      // Update map color
      if (window.ElectionMap) {
        let color = NEUTRAL_COLOR;
        const finalColor = st.finalColor || marginToColor(st.margin, false);
        if (st.called) {
          color = finalColor;
        } else if (progress > 0) {
          // Blend from neutral to final color
          color = blendColors(NEUTRAL_COLOR, finalColor, progress * 0.5);
        }

        if (/-0[123]|-AL$/.test(st.unit)) {
          window.ElectionMap.setDistrictFill(st.unit, color);
        } else {
          window.ElectionMap.setStateFill(st.unit, color);
        }
      }
    });

    // Update EV display
    window._electionNightActive = true;
    window._electionNightSnapshot = state.snapshot;

    const dEl = document.getElementById('demEV');
    const rEl = document.getElementById('repEV');
    const uEl = document.getElementById('uncalledEV');
    
    if (dEl) dEl.textContent = dEV;
    if (rEl) rEl.textContent = rEV;
    if (uEl) uEl.textContent = uncalledEV;

    // Update progress slider
    const progressSlider = document.getElementById('enProgress');
    if (progressSlider && state.simEnd > state.simStart) {
      const progress = (timeMinutes - state.simStart) / (state.simEnd - state.simStart);
      progressSlider.value = Math.max(0, Math.min(1, progress)) * 100;
    }
  }

  // Animation loop
  function tick(timestamp) {
    if (!state.running) return;

    const dt = state.lastTimestamp ? (timestamp - state.lastTimestamp) / 1000 : 0;
    state.lastTimestamp = timestamp;

    // Advance time
    state.currentTime += dt * state.minutesPerSecond;

    // Stop at end
    if (state.currentTime >= state.simEnd) {
      state.currentTime = state.simEnd;
      state.running = false;
      
      const toggle = document.getElementById('enToggle');
      if (toggle) {
        toggle.textContent = 'Reset';
        toggle.classList.remove('active');
      }
    }

    renderAt(state.currentTime);

    if (state.running) {
      state.rafId = requestAnimationFrame(tick);
    }
  }

  // Start simulation
  function startSimulation() {
    if (!state.prepared) prepareSimulation();
    if (!state.prepared) return;

    state.running = true;
    state.lastTimestamp = null;
    
    const toggle = document.getElementById('enToggle');
    if (toggle) {
      toggle.textContent = 'Pause';
      toggle.classList.add('active');
    }

    state.rafId = requestAnimationFrame(tick);
  }

  // Pause simulation
  function pauseSimulation() {
    state.running = false;
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    
    const toggle = document.getElementById('enToggle');
    if (toggle) {
      toggle.textContent = 'Resume';
      toggle.classList.remove('active');
    }
  }

  // Seek to progress
  function seekToProgress(progress) {
    if (!state.prepared) prepareSimulation();
    if (!state.prepared) return;

    const clamped = Math.max(0, Math.min(1, progress));
    const timeMinutes = state.simStart + clamped * (state.simEnd - state.simStart);
    
    renderAt(timeMinutes);
  }

  // Global API
  window.resetElectionNightSimulation = function (restorePv = true) {
    resetSimulation();
    if (restorePv) window._pvOverride = null;
  };

  window.prepareElectionNightSimulation = function () {
    if (!state.prepared) prepareSimulation();
  };

  window.seekElectionNightProgress = function (progress) {
    seekToProgress(isFinite(progress) ? progress : 0);
  };

  // Initialize
  function init() {
    const toggle = document.getElementById('enToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        if (!state.prepared || state.currentTime >= state.simEnd) {
          resetSimulation();
          prepareSimulation();
          startSimulation();
        } else if (state.running) {
          pauseSimulation();
        } else {
          startSimulation();
        }
      });
    }

    const progressSlider = document.getElementById('enProgress');
    if (progressSlider) {
      progressSlider.addEventListener('input', () => {
        const progress = +progressSlider.value / 100;
        seekToProgress(progress);
      });
    }

    const speedSlider = document.getElementById('enSpeed');
    if (speedSlider) {
      speedSlider.addEventListener('input', () => {
        state.minutesPerSecond = BASE_MINUTES_PER_SECOND * (+speedSlider.value || 1);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

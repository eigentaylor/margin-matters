import { getStateName } from './utils/constants.js';
import { leanStr, formatLeader, formatLeaderShort, formatMarginText, formatReportingText, formatConfidenceText, formatNpvCallText, formatEvAllocationsForLog, formatUnitLabel, formatTimeLabel } from './utils/formatters.js';
import { updateCandidateInfo } from './utils/candidateInfo.js';
import { clampMargin as sharedClampMargin, totalVotesFromRow } from './utils/unitInfo.js';
import { clamp01 as sharedClamp01, clampByte as sharedClampByte, normalCdf } from './utils/mathUtils.js';
import { getUnitCandidateLastNames } from './utils/candidateNames.js';
import { hashCode, mulberry32, randn, randStudentT4 } from './utils/randomUtils.js';
import { hexToRgb, rgbToHex, blendColors, safeMarginToColor } from './utils/colorUtils.js';
import { prepareAtLargeData } from './utils/atLargeAggregator.js';
import { createRegionalErrorModel } from './utils/sim2028/errorModel.js';
import { POLL_ERROR_SPEC } from './utils/sim2028/pollCalibration.js';
import { regionOf } from './utils/sim2028/regions.js';
import { solveLiveSwing, sampleSwing, unitSwingDelta, makeNormalizedTDraw } from './utils/electionNight/liveSwing.js';

(function () {
  'use strict';

  const clampMargin = typeof sharedClampMargin === 'function'
    ? sharedClampMargin
    : (value => {
      if (!isFinite(value)) return 0;
      const LIMIT = 1 - 1e-9;
      if (value > LIMIT) return LIMIT;
      if (value < -LIMIT) return -LIMIT;
      return value;
    });

  const clamp01 = typeof sharedClamp01 === 'function'
    ? sharedClamp01
    : (x => (isFinite(x) ? Math.max(0, Math.min(1, x)) : 0));

  const clampByte = typeof sharedClampByte === 'function'
    ? sharedClampByte
    : (v => Math.max(0, Math.min(255, v | 0)));

  // Clamp a user-entered speed multiplier to a safe range; returns null
  // for unparseable/non-finite input so callers can leave the current
  // value untouched instead of clobbering it with a bad number.
  function clampSpeed(v) {
    if (!isFinite(v)) return null;
    return Math.max(MIN_SPEED_MULTIPLIER, Math.min(MAX_SPEED_MULTIPLIER, v));
  }

  // Round to 3 decimals to avoid float noise (e.g. 0.5 - 0.05 = 0.44999999999999996)
  // while still preserving any finer value the user typed directly.
  function roundSpeed(v) {
    return Math.round(v * 1000) / 1000;
  }

  // Clamp/apply a new speed value to state and sync the input's displayed
  // value. Shared by the text input's blur/change handler and the +/-
  // stepper buttons so they all funnel through the same validation.
  function setSpeed(v) {
    const clamped = clampSpeed(v);
    const finalVal = clamped != null ? clamped : state.speedMultiplier;
    state.speedMultiplier = finalVal;
    if (elements.speed) elements.speed.value = String(finalVal);
    return finalVal;
  }

  const formatLean = value => {
    if (!isFinite(value)) return 'ERROR';
    if (typeof leanStr === 'function') return leanStr(value);
    const pct = (Math.abs(value) * 100).toFixed(1);
    return `${value > 0 ? 'D' : 'R'}+${pct}`;
  };

  // election-night simulator
  // This script builds a reproducible, time-based simulation of how
  // vote counts and calls might unfold on election night. It is used
  // by the site to animate the map, small boxes, EV bar, and call log.

  // Small epsilon for numeric comparisons
  const EPS = 1e-6;
  // Default colors (neutral and third-party)
  const NEUTRAL_COLOR = '#2f2f2f';
  const THIRD_PARTY_COLOR = '#C9A400';
  // Simulation timing and pacing constants
  // BASE_MINUTES_PER_SECOND: how many simulated minutes pass per real second
  const BASE_MINUTES_PER_SECOND = 1.5;
  // Minimum reporting duration for a unit (in minutes)
  const MIN_DURATION = 160;
  // Early minimum delay before a call may be considered (minutes)
  const MIN_CALL_DELAY = 15;
  // Extra window used when computing flexible call deadlines
  const EXTRA_CALL_WINDOW = 210;
  // Time offset (minutes) used so times like "19:00" map to ET minutes
  const TIME_OFFSET_MIN = 180;
  // Confidence threshold defaults and reporting cutoffs
  const DEFAULT_CONFIDENCE_THRESHOLD = 0.3;
  const MIN_REPORTING_TO_CALL = 0.2;
  // Bounds and default for the free-text simulation speed multiplier input
  const MIN_SPEED_MULTIPLIER = 0.01;
  const MAX_SPEED_MULTIPLIER = 100;
  const DEFAULT_SPEED_MULTIPLIER = 0.5;
  const SPEED_STEP = 0.05;
  // Visual constants for uncalled/tossup styling
  const BRIGHT_TOSSUP_COLOR = '#bcbcbc'; // color used for clear tossups when uncalled
  const UNCALLED_BRIGHTEN = 0.65; // blending factor to brighten a state's color while it's uncalled (0..1)
  // Tiny epsilon used when forcing flips to avoid exact zero margins
  const FLIP_MARGIN_EPS = 0; // small margin to represent a flipped outcome without zero
  // Display update interval for throttling expensive UI work
  const DISPLAY_UPDATE_INTERVAL = 1; // minutes between display updates (counting is continuous)
  // National win-probability estimate: how uncertain the not-yet-counted
  // portion of a unit's vote could still be relative to what's counted so
  // far, expressed as a margin std-dev (see computeUnitPosterior). Larger
  // for MAIL_HEAVY_STATES, matching the same real-world "late mail ballots
  // skew differently than election-day votes" fact createBiasParams already
  // encodes generatively — here it's the analogous observational-uncertainty
  // fact. Starting guesses, meant to be tuned against
  // docs/utils/electionNight/validateWinProb.mjs, the same way
  // CONFIDENCE_JUNCTION_RAW was validated rather than shipped on guesswork.
  const REMAINING_DELTA_SIGMA_BASE = 0.12;
  const REMAINING_DELTA_SIGMA_MAIL_HEAVY = 0.22;
  // "Pacing" damper for the live win-probability MC — deliberately, openly
  // fake extra uncertainty layered ONLY on the shared national/regional
  // swing terms (docs/utils/electionNight/liveSwing.js) right before they
  // feed the Monte Carlo, not on the underlying solve itself (so
  // state.swingEstimate/the exported timeline/debug log stay honest).
  // The honest swing math is real and validated (see liveSwing.js), but a
  // handful of early-reporting states (KY/IN/VA/SC/GA) is a small, non-
  // representative sample — the model can't yet tell "these states are
  // just noisy tonight" from "the whole country is swinging", so a real
  // signal from them can legitimately swing the national number fast and
  // hard right out of the gate. Mathematically honest, but it collapses
  // the suspense a live election-night broadcast is supposed to have.
  // PACING_MEAN_SCALE_START (0..1) trusts only this fraction of the
  // observed national/regional swing at 0% national reporting — this is
  // the lever that actually slows the aggregate win% down (see
  // applyPacingDamper's comment for why sigma alone doesn't). 1 = fully
  // honest immediately. PACING_MULTIPLIER_START widens sigma on top for
  // extra cushion. Both ease back to "honest" (scale/mult = 1) by
  // PACING_DECAY_REPORTING national reporting fraction. Purely a feel/
  // pacing knob, tune by eye against a real replay (e.g. 2016) — there's
  // no "correct" value to validate against.
  const PACING_MEAN_SCALE_START = 0.15;
  const PACING_MULTIPLIER_START = 3.5;
  const PACING_DECAY_REPORTING = 0.85;
  // Monte Carlo draw count for the win-probability tally, and how often
  // (in simulated minutes) the expensive tally re-runs — independent of
  // DISPLAY_UPDATE_INTERVAL, which only throttles the real-time RAF path;
  // this also has to protect advanceDeterministic()'s synchronous
  // fast-forward loop, which DISPLAY_UPDATE_INTERVAL never sees.
  const PROB_MC_SIMS = 2000;
  const PROB_UPDATE_INTERVAL_MINUTES = 3;
  // Reporting jump debug threshold (fraction, e.g. 0.12 = 12 percentage points)
  const REPORTING_JUMP_THRESHOLD = 0.12;
  // Maximum reporting step when densifying schedules (fraction, e.g. 0.005 = 0.5%)
  const MAX_SCHEDULE_REPORT_STEP = 0.005;

  // Load constants from shared file if present, otherwise fall back to
  // the inline definitions for backwards compatibility.
  const _EXT = (typeof window !== 'undefined' && window.ELECTION_NIGHT_CONSTANTS) || {};

  const POLL_CLOSINGS = _EXT.POLL_CLOSINGS || {
    '15:00': ['KY', 'IN', 'PR'],
    '16:00': ['VT', 'VA', 'SC', 'GA'],
    '16:30': ['NC', 'OH', 'WV'],
    '17:00': ['AL', 'CT', 'DC', 'DE', 'FL', 'IL', 'KS', 'ME', 'MD', 'MA', 'MS', 'MO', 'NH', 'NJ', 'OK', 'PA', 'RI', 'TN', 'TX'],
    '17:30': ['AR'],
    '18:00': ['AZ', 'CO', 'LA', 'MI', 'MN', 'NE', 'NM', 'NY', 'SD', 'WI', 'WY'],
    '19:00': ['IA', 'MT', 'NV', 'UT'],
    '20:00': ['CA', 'OR', 'WA', 'ID', 'ND'],
    '22:00': ['AK', 'HI']
  };

  const STATE_COUNTING_SPEEDS = _EXT.STATE_COUNTING_SPEEDS || {
    AL: 1.1, AK: 0.7, AZ: 0.9, AR: 1.0, CA: 0.7, CO: 0.9, CT: 0.9, DE: 1.0,
    DC: 1.0, FL: 1.2, GA: 1.1, HI: 0.6, ID: 1.3, IL: 1.1, IN: 1.1, IA: 1.2,
    KS: 1.0, KY: 1.0, LA: 1.0, ME: 0.8, MD: 1.0, MA: 0.9, MI: 1.0, MN: 0.9,
    MS: 1.0, MO: 1.0, MT: 0.7, NE: 1.2, NV: 0.7, NH: 1.0, NJ: 0.9, NM: 0.9,
    NY: 0.7, NC: 1.0, ND: 1.3, OH: 1.1, OK: 1.0, OR: 0.8, PA: 0.7, PR: 0.6,
    RI: 0.9, SC: 1.0, SD: 1.2, TN: 1.1, TX: 1.2, UT: 1.0, VT: 0.8, VA: 1.0,
    WA: 0.8, WV: 0.9, WI: 1.0, WY: 0.7
  };

  const MAIL_HEAVY_STATES = new Set(_EXT.MAIL_HEAVY_STATES || ['AZ', 'CA', 'CO', 'HI', 'NV', 'NJ', 'NY', 'OR', 'UT', 'VT', 'WA', 'MI', 'PA', 'WI', 'MN']);

  // Convert PHASES time strings to minute offsets using toMinutesWithOffset
  const _PHASES_RAW = _EXT.PHASES || [
    { name: 'Early', start: '19:00', end: '20:30' },
    { name: 'Mid', start: '20:30', end: '22:00' },
    { name: 'Central', start: '22:00', end: '23:30' },
    { name: 'Late', start: '23:30', end: '25:00' },
    { name: 'Final', start: '25:00', end: '28:00' }
  ];

  const PHASES = _PHASES_RAW.map(p => ({
    name: p.name,
    start: typeof p.start === 'string' ? toMinutesWithOffset(p.start) : p.start,
    end: typeof p.end === 'string' ? toMinutesWithOffset(p.end) : p.end
  }));


  // Runtime simulation state. This object stores everything needed to
  // keep the simulation consistent across frames: whether it's prepared,
  // running, current time window, per-unit data, UI caches, and call logs.
  const state = {
    prepared: false,
    running: false,
    pvMode: 'current',
    pvValue: 0,
    targetPvLabel: 'EVEN',
    speedMultiplier: DEFAULT_SPEED_MULTIPLIER,
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
    npvCallRecord: null,
    npvMisCallLogged: false,
    nationalFinalDVotes: 0,
    nationalFinalRVotes: 0,
    nationalFinalDEv: 0,
    nationalFinalREv: 0,
    lastNationalTotals: null,
    atLargeParts: null,
    unitPosteriors: null,
    swingEstimate: null,
    priorNpvMargin: 0,
    nationalWinProb: null,
    lastProbUpdateTime: -Infinity,
    confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
    pvRandomCache: null,
    pvRandomCacheMode: null,
    pvRandomSeed: null,
    pvRandomCacheYear: null,
    lastDisplayUpdate: 0, // Track last time display was updated for throttling
    // Simulation log state
    logEntries: [],
    logInterval: 5, // minutes between log entries (min 5)
    lastLogTime: -Infinity // last time a log entry was recorded
  };

  // Cached DOM elements for interactive controls and displays. Populated
  // by init() to reduce repeated DOM lookups during animation.
  const elements = {
    toggle: null,
    reset: null,
    speed: null,
    speedDown: null,
    speedUp: null,
    pvMode: null,
    pvDisplay: null,
    timeLabel: null,
    progress: null,
    phase: null,
    log: null,
    logHeader: null,
    winProb: null,
    logUncalled: null,
    logPanel: null,
    confidence: null,
    confidenceVal: null,
    victory: null,
    logInterval: null,
    downloadTxt: null,
    downloadCsv: null
  };

  /**
   * Wire up the UI: find DOM nodes, attach event listeners (toggle,
   * reset, speed, PV mode, progress slider), and initialize labels.
   * This function runs on DOMContentLoaded.
   */
  function init() {
    // Initialize debug logs for ME/NE coloring and calls
    try {
      if (typeof window !== 'undefined') {
        // Feature flags: color/call logs are OFF by default to avoid huge log files.
        // Set `window.ENABLE_EN_COLOR_CALL_LOG = true` in the console to enable.
        window.ENABLE_EN_COLOR_CALL_LOG = window.ENABLE_EN_COLOR_CALL_LOG || false;
        window._enColorLog = window._enColorLog || [];
        window._enCallLog = window._enCallLog || [];
        window._enReportingJumps = window._enReportingJumps || [];
        window.getElectionNightLogs = function () {
          const out = { reportingJumps: (window._enReportingJumps || []).slice() };
          if (window.ENABLE_EN_COLOR_CALL_LOG) {
            out.colorLog = (window._enColorLog || []).slice();
            out.callLog = (window._enCallLog || []).slice();
          }
          return out;
        };
        window.downloadElectionNightLogs = function (filename) {
          try {
            const out = window.getElectionNightLogs();
            const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename || `election-night-logs-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) { } }, 5000);
            return true;
          } catch (e) {
            console.error('downloadElectionNightLogs failed', e);
            return false;
          }
        };
      }
    } catch (e) { console.warn('Failed to initialize EN debug logs', e); }
    elements.toggle = document.getElementById('enToggle');
    elements.reset = document.getElementById('enReset');
    elements.speed = document.getElementById('enSpeed');
    elements.speedDown = document.getElementById('enSpeedDown');
    elements.speedUp = document.getElementById('enSpeedUp');
    elements.pvMode = document.getElementById('enPvMode');
    elements.pvDisplay = document.getElementById('enPvDisplay');
    elements.timeLabel = document.getElementById('enTime');
    elements.progress = document.getElementById('enProgress');
    elements.phase = document.getElementById('enPhase');
    elements.log = document.getElementById('enLog');
    elements.logHeader = document.querySelector('#enLogPanel .en-log-header');
    elements.logHeaderText = document.getElementById('enLogHeaderText');
    elements.logClose = document.getElementById('enLogClose');
    elements.logYear = document.getElementById('enLogYear');
    elements.winProb = document.getElementById('enWinProb');
    elements.logUncalled = document.getElementById('enLogUncalled');
    elements.logPanel = document.getElementById('enLogPanel');
    // The panel starts hidden via the `en-log-closed` class already present
    // in the markup (opacity/visibility transition) so there's no JS-driven
    // FOUC-style show/hide flicker on load.

    if (elements.logClose) {
      elements.logClose.addEventListener('click', (e) => {
        // Stop the click from also reaching the mobile collapse-toggle
        // listener on the header row below.
        e.stopPropagation();
        hideLogPanel();
      });
    }

    // Mobile collapse/expand functionality for call log
    if (elements.logHeader && elements.logPanel) {
      // Start collapsed on mobile
      if (window.innerWidth <= 1200) {
        elements.logPanel.classList.add('collapsed');
      }

      elements.logHeader.addEventListener('click', () => {
        if (window.innerWidth <= 1200) {
          elements.logPanel.classList.toggle('collapsed');
        }
      });

      // Handle window resize
      window.addEventListener('resize', () => {
        if (window.innerWidth > 1200) {
          elements.logPanel.classList.remove('collapsed');
        } else if (!elements.logPanel.classList.contains('collapsed')) {
          // Keep expanded state on mobile if user already expanded it
        }
      });
    }
    elements.confidence = document.getElementById('enConfidence');
    elements.confidenceVal = document.getElementById('enConfidenceVal');
    elements.victory = document.getElementById('enVictory');

    if (elements.toggle) {
      elements.toggle.addEventListener('click', () => {
        //console.log('ELECTION NIGHT TOGGLE CLICK');
        showLogPanel();
        if (!state.prepared) {
          // Start should roll random PV now (at click time). Clear any cached random PV so
          // resolvePvValue will draw fresh values based on the current time/seed.
          state.pvRandomCache = null;
          state.pvRandomCacheMode = null;
          state.pvRandomCacheYear = null;
          state.pvRandomSeed = null;
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
      elements.reset.addEventListener('click', () => resetSimulation(true, true));
    }

    if (elements.speed) {
      elements.speed.addEventListener('input', () => {
        const val = clampSpeed(parseFloat(elements.speed.value));
        if (val != null) state.speedMultiplier = val;
      });
      // On blur/commit, snap the field's displayed value to the clamped
      // number so invalid input (0, negative, non-numeric, absurdly
      // large) doesn't linger visibly.
      elements.speed.addEventListener('change', () => setSpeed(parseFloat(elements.speed.value)));
    }
    if (elements.speedDown) {
      elements.speedDown.addEventListener('click', () => setSpeed(roundSpeed(state.speedMultiplier - SPEED_STEP)));
    }
    if (elements.speedUp) {
      elements.speedUp.addEventListener('click', () => setSpeed(roundSpeed(state.speedMultiplier + SPEED_STEP)));
    }

    if (elements.pvMode) {
      elements.pvMode.addEventListener('change', () => {
        state.pvMode = elements.pvMode.value || 'current';
        state.pvRandomCache = null;
        state.pvRandomCacheMode = null;
        state.pvRandomCacheYear = null;
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

    // Initialize log interval selector and download buttons
    elements.logInterval = document.getElementById('enLogInterval');
    elements.downloadTxt = document.getElementById('enDownloadTxt');
    elements.downloadCsv = document.getElementById('enDownloadCsv');

    if (elements.logInterval) {
      elements.logInterval.addEventListener('change', () => {
        const val = parseInt(elements.logInterval.value, 10);
        if (isFinite(val) && val >= 5) state.logInterval = val;
      });
    }

    if (elements.downloadTxt) {
      elements.downloadTxt.addEventListener('click', () => downloadSimulationLog('txt'));
    }

    if (elements.downloadCsv) {
      elements.downloadCsv.addEventListener('click', () => downloadSimulationLog('csv'));
    }

    updateToggleLabel();
  }

  // --- National win-probability: prior establishment ------------------
  //
  // Two sources for a per-unit poll-like prior (st.priorMargin/st.priorSigma):
  // bridged real 2028 polls (window._enPollPrior, set once by
  // docs/utils/sim2028/electionNightBridge.js when coming from sim2028.html),
  // or a synthesized prior for pages with no real polls (index.html/
  // future.html). Both paths converge on the same per-unit contract so the
  // live win-probability code downstream doesn't need to know which ran.
  // Neither path sets a prior for at-large (ME-AL/NE-AL) units — those are
  // always derived from their districts' draws, never sampled directly (see
  // buildAtLargeParts/runNationalWinProbabilityMC).
  //
  // buildSyntheticPollPriors() is the ONE place allowed to read a unit's
  // ground-truth dTwoPartyFinal/rTwoPartyFinal — it runs once, at prepare
  // time, before the animation starts, exactly mirroring how
  // docs/utils/sim2028/campaign.js generates its own polls from a hidden
  // truth. After this call, st.priorMargin/st.priorSigma are a frozen,
  // poll-like PUBLIC fact for the rest of the night — nothing downstream
  // (computeUnitPosterior, runNationalWinProbabilityMC) may ever read
  // dTwoPartyFinal/rTwoPartyFinal/biasParams/closeness again.
  function buildSyntheticPollPriors(data, year, pvValue) {
    const simUnits = data.filter(st => st.pvWeight && !st.thirdPartyDominant);
    data.forEach(st => { if (st.thirdPartyDominant) { st.priorMargin = 0; st.priorSigma = 0; } });
    if (!simUnits.length) return;
    const units = simUnits.map(st => st.unitKey);
    const weights = new Map(simUnits.map(st => [st.unitKey, st.totalVotes]));
    const unitSigmaMap = new Map(simUnits.map(st => [st.unitKey, POLL_ERROR_SPEC.unitSigmas]));

    const model = createRegionalErrorModel({
      units,
      weights,
      unitSigmas: unitSigmaMap,
      regionShare: POLL_ERROR_SPEC.regionShare,
      nationalSigma: POLL_ERROR_SPEC.nationalSigma,
      df: POLL_ERROR_SPEC.df
    });

    // Deterministic given (year, resolved pvValue) alone: re-seeking within
    // a run never changes pvValue, so this reproduces the same synthetic
    // poll every time; a fresh prepareSimulation() with a newly-rolled
    // random PV mode naturally rerolls it too, since pvValue itself
    // changed. Mirrors the pvRandomCache seeding pattern used elsewhere.
    const seed = hashCode(`prior:${year}:${Math.round((pvValue || 0) * 1e6)}`);
    const rng = mulberry32(seed >>> 0);
    const errOut = new Float64Array(units.length);
    model.drawRelInto(rng, 1, errOut);
    const nationalErr = model.drawNpv(rng, 1);

    const totalSigma = Math.sqrt(POLL_ERROR_SPEC.unitSigmas ** 2 + POLL_ERROR_SPEC.nationalSigma ** 2);
    simUnits.forEach((st, i) => {
      // ONE-TIME allowed peek at ground truth — see comment above.
      const truthMargin = st.dTwoPartyFinal - st.rTwoPartyFinal;
      st.priorMargin = clampMargin(truthMargin + errOut[i] + nationalErr);
      st.priorSigma = totalSigma;
    });
  }

  function applyBridgedPollPriors(data, prior) {
    const spec = prior.spec || POLL_ERROR_SPEC;
    const totalSigma = Math.sqrt(spec.unitSigmas ** 2 + spec.nationalSigma ** 2);
    data.forEach(st => {
      if (st.thirdPartyDominant) { st.priorMargin = 0; st.priorSigma = 0; return; }
      if (!st.pvWeight) return; // at-large: derived, no direct prior
      const margin = prior.marginByUnit ? prior.marginByUnit.get(st.unitKey) : null;
      if (isFinite(margin)) {
        st.priorMargin = clampMargin(margin);
        st.priorSigma = totalSigma;
      } else {
        // No poll data for this particular unit (shouldn't normally
        // happen) — fall back to a one-off synthetic prior just for it.
        st.priorMargin = clampMargin(st.dTwoPartyFinal - st.rTwoPartyFinal);
        st.priorSigma = totalSigma;
      }
    });
  }

  // At-large (ME-AL/NE-AL) units are always derived from their component
  // districts' simulated margins (vote-weighted composite) rather than
  // sampled independently in the win-probability Monte Carlo — a statewide
  // result can never contradict the districts that compose it. Built once
  // per prepared simulation, mirroring docs/utils/sim2028/forecast.js's own
  // alParts pattern.
  function buildAtLargeParts(data) {
    const map = new Map();
    data.forEach(st => {
      if (st.type !== 'atlarge') return;
      const districts = data.filter(d => d.abbr === st.abbr && d.type === 'district');
      const totalW = districts.reduce((sum, d) => sum + d.totalVotes, 0) || 1;
      map.set(st.unitKey, districts.map(d => ({ unitKey: d.unitKey, weight: d.totalVotes / totalW })));
    });
    return map;
  }

  /**
   * Prepare the simulation data for the selected year and PV scenario.
   * This builds per-unit state objects, computes simStart/simEnd, and
   * resets call logs and cached colors. It does not start the RAF loop.
   */
  function prepareSimulation() {
    const year = getSelectedYear();
    if (!year) return;
    // Mark election-night active immediately so any code paths that call
    // updateAll() during preparation will not overwrite the live EV bar.
    try { window._electionNightActive = true; } catch (e) { /* ignore */ }

    try { prepareAtLargeData(); } catch (e) { /* non-fatal */ }

    state.prevPvOverride = (typeof window._pvOverride === 'number' && isFinite(window._pvOverride)) ? window._pvOverride : null;
    state.prevPvSliderValue = getPvSliderValue();
    state.prevPvPresetName = window._pvPresetName || null;

    const pvValue = resolvePvValue();
    state.pvValue = pvValue;
    state.targetPvLabel = formatLean(pvValue);
    state.confidenceThreshold = getConfidenceSliderValue();
    updateConfidenceLabel(state.confidenceThreshold);

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
    state.npvCallRecord = null;
    state.npvMisCallLogged = false;
    state.lastNationalTotals = null;
    state.atLargeParts = null;
    state.unitPosteriors = null;
    state.swingEstimate = null;
    state.priorNpvMargin = 0;
    state.nationalWinProb = null;
    state.lastProbUpdateTime = -Infinity;
    // Initialize log state for this simulation
    state.logEntries = [];
    state.lastLogTime = -Infinity;
    // Read log interval from UI if available
    if (elements.logInterval) {
      const val = parseInt(elements.logInterval.value, 10);
      if (isFinite(val) && val >= 5) state.logInterval = val;
    }
    updateDownloadButtons();

    state.year = year;
    if (elements.logYear) elements.logYear.textContent = String(year);

    // If a proportional EV toggle exists, save its previous state and disable it during election night
    try {
      const prop = document.getElementById('propEvToggle');
      if (prop) {
        state._prevPropEv = { exists: true, checked: !!prop.checked, disabled: !!prop.disabled };
        prop.checked = false;
        prop.disabled = true;
      }
    } catch (e) { /* ignore */ }
    // Show the call log panel when the election-night simulation is prepared.
    // Also shifts the container left on medium screens to avoid overlap
    // (flagged on body too so other fixed page-wide elements, e.g. the
    // proportional-EV toggle footer, can shrink away from the sidebar).
    showLogPanel();
    state.snapshot = new Map();
    window._electionNightSnapshot = state.snapshot;
    state.lastLogKey = '';
    state.lastUncalledKey = '';
    if (elements.log) elements.log.innerHTML = '';
    if (elements.logUncalled) elements.logUncalled.innerHTML = '';
    if (elements.logHeaderText) elements.logHeaderText.textContent = 'Call log';
    if (elements.winProb) elements.winProb.textContent = '';
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

    // Now that we have the correct totalEvPool, set up the EV summary override
    // This ensures updateAll() uses the right "EVs needed to win" value
    try {
      window._evSummaryOverride = {
        dEV: 0,
        rEV: 0,
        oEV: 0,
        uEV: state.totalEvPool,
        totalEV: state.totalEvPool,
        updatedAt: Date.now()
      };
    } catch (e) { /* ignore */ }

    // Call updateAll after setting the override with the correct totalEvPool
    if (typeof window.updateAll === 'function') window.updateAll();

    state.totalEligibleVotes = data.reduce((sum, st) => sum + (st.pvWeight ? st.totalVotes : 0), 0);
    state.nationalFinalDVotes = data.reduce((sum, st) => sum + (st.pvWeight ? st.targetMetrics.dVotesCounted : 0), 0);
    state.nationalFinalRVotes = data.reduce((sum, st) => sum + (st.pvWeight ? st.targetMetrics.rVotesCounted : 0), 0);
    // Ground-truth ELECTORAL COLLEGE winner (distinct from the popular vote
    // above — they can and do disagree, e.g. 2016). Summed over every
    // EV-bearing unit (state/at-large/district all count separately here,
    // unlike the vote totals above, since each has its own non-overlapping
    // electors) — used only by debug/validation instrumentation, never by
    // the live win-probability algorithm itself.
    state.nationalFinalDEv = data.reduce((sum, st) => sum + (st.winner === 'D' ? st.ev : 0), 0);
    state.nationalFinalREv = data.reduce((sum, st) => sum + (st.winner === 'R' ? st.ev : 0), 0);

    if (window._enPollPrior && window._enPollPrior.year === year) {
      applyBridgedPollPriors(data, window._enPollPrior);
    } else {
      buildSyntheticPollPriors(data, year, pvValue);
    }
    state.atLargeParts = buildAtLargeParts(data);
    // Vote-weighted mean of the frozen priors - debug/validation only (e.g.
    // docs/utils/electionNight/validateWinProb.mjs's swing-recovery check),
    // never read by the live algorithm. A derived summary of the already-
    // public prior, not a ground-truth leak.
    state.priorNpvMargin = (() => {
      let acc = 0, wsum = 0;
      data.forEach(st => {
        if (!st.pvWeight || !isFinite(st.priorMargin)) return;
        acc += st.priorMargin * st.totalVotes;
        wsum += st.totalVotes;
      });
      return wsum > EPS ? acc / wsum : 0;
    })();

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

  function progressToTime(progress) {
    const clamped = Math.max(0, Math.min(1, isFinite(progress) ? progress : 0));
    const span = state.simEnd - state.simStart;
    if (!isFinite(span) || Math.abs(span) < EPS) return state.simStart;
    return state.simStart + clamped * span;
  }

  function timeToProgress(timeMinutes) {
    const span = state.simEnd - state.simStart;
    if (!isFinite(timeMinutes) || !isFinite(span) || Math.abs(span) < EPS) return 0;
    return Math.max(0, Math.min(1, (timeMinutes - state.simStart) / span));
  }

  function advanceDeterministic(targetTime) {
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
      // Intermediate steps of a fast-forward seek are never painted (this
      // loop is fully synchronous, no yield to the browser between calls),
      // so anything expensive gated on "settled" (see
      // updateNationalWinProbability) is skipped here and only computed
      // once, after the loop, on the final settled render below.
      renderAt(current, { settled: false });
      if (direction > 0 && current >= clamped - EPS) break;
      if (direction < 0 && current <= clamped + EPS) break;
    }
    state.currentTime = clamped;
    renderAt(clamped);
  }

  function seekToProgress(progress) {
    if (!state.prepared) return;
    const targetTime = progressToTime(progress);
    if (targetTime < state.currentTime - EPS) {
      const savedMode = state.pvMode;
      const savedCache = state.pvRandomCache;
      const savedCacheMode = state.pvRandomCacheMode;
      const savedSeed = state.pvRandomSeed;
      const savedCacheYear = state.pvRandomCacheYear;
      const savedConfidence = state.confidenceThreshold;
      const savedSpeed = state.speedMultiplier;
      const savedPvOverride = (typeof window._pvOverride === 'number' && isFinite(window._pvOverride)) ? window._pvOverride : null;
      resetSimulation(false);
      state.pvMode = savedMode;
      state.pvRandomCache = savedCache;
      state.pvRandomCacheMode = savedCacheMode;
      state.pvRandomCacheYear = savedCacheYear;
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

  function showLogPanel() {
    try { if (elements.logPanel) elements.logPanel.classList.remove('en-log-closed'); } catch (e) { /* ignore */ }
    try { document.querySelector('.container')?.classList.add('en-active'); } catch (e) { /* ignore */ }
    try { document.body.classList.add('en-active'); } catch (e) { /* ignore */ }
  }

  function hideLogPanel() {
    try { if (elements.logPanel) elements.logPanel.classList.add('en-log-closed'); } catch (e) { /* ignore */ }
    try { document.querySelector('.container')?.classList.remove('en-active'); } catch (e) { /* ignore */ }
    try { document.body.classList.remove('en-active'); } catch (e) { /* ignore */ }
  }

  function resetSimulation(restorePv, hidePanel = false) {
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = null;
    state.running = false;
    state.prepared = false;
    state.stateData = [];
    state.snapshot = new Map();
    window._electionNightSnapshot = null;
    try { window._evSummaryOverride = null; } catch (e) { /* ignore */ }
    window._electionNightActive = false;
    state.currentTime = 0;
    state.lastTimestamp = null;
    state.lastDisplayUpdate = 0;
    state.lastLogKey = '';
    state.lastUncalledKey = '';
    state.year = null;
    if (elements.logYear) elements.logYear.textContent = '';
    state.totalEvPool = 538;
    state.unitColorMap = null;
    state.abbrColorMap = null;
    state.boxesDirty = false;
    state.callRecords = [];
    state.npvCallRecord = null;
    state.npvMisCallLogged = false;
    state.lastNationalTotals = null;
    state.atLargeParts = null;
    state.unitPosteriors = null;
    state.swingEstimate = null;
    state.priorNpvMargin = 0;
    state.nationalWinProb = null;
    state.lastProbUpdateTime = -Infinity;
    // Reset log state
    state.logEntries = [];
    state.lastLogTime = -Infinity;
    updateDownloadButtons();

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
    if (elements.logHeaderText) elements.logHeaderText.textContent = 'Call log';
    if (elements.winProb) elements.winProb.textContent = '';
    if (elements.victory) {
      elements.victory.textContent = '';
      elements.victory.className = 'en-log-victory';
      elements.victory.style.display = 'none';
    }

    // Resetting simulation state (e.g. from an incidental Year/PV slider
    // drag) should not itself close the panel — only an explicit "close"
    // action does that. See showLogPanel/hideLogPanel.
    if (hidePanel) hideLogPanel();

    // Remove phantom EV fill elements and clean up right-anchor on evFillR
    try {
      ['evFillPhantomD', 'evFillPhantomR', 'evFillPhantomO'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.parentElement) el.parentElement.removeChild(el);
      });
      const rEl = document.getElementById('evFillR');
      if (rEl && rEl.dataset && rEl.dataset.anchor) {
        delete rEl.dataset.anchor;
      }
    } catch (e) { /* ignore */ }

    if (typeof window.hideMapTip === 'function') {
      try { window.hideMapTip(); } catch (e) { }
    }

    if (restorePv) {
      window._pvOverride = state.prevPvOverride;
      if (state.prevPvPresetName != null) window._pvPresetName = state.prevPvPresetName;
      const pvSlider = document.getElementById('pvSlider');
      if (pvSlider && state.prevPvSliderValue != null) pvSlider.value = state.prevPvSliderValue;
    }

    if (typeof window.updateAll === 'function') {
      try { window.updateAll(); } catch (e) { }
    }

    // Restore proportional EV toggle state if we saved it previously
    try {
      const prop = document.getElementById('propEvToggle');
      if (prop && state._prevPropEv && state._prevPropEv.exists) {
        prop.checked = !!state._prevPropEv.checked;
        prop.disabled = !!state._prevPropEv.disabled;
      }
      // clear saved state
      state._prevPropEv = null;
    } catch (e) { /* ignore */ }

    if (state.prevUnitColors) {
      window._lastUnitColors = new Map(state.prevUnitColors);
    }
    if (state.prevAbbrColors) {
      window._lastAbbrColors = new Map(Array.from(state.prevAbbrColors.entries(), ([abbr, info]) => [abbr, { ...(info || {}) }]));
    }
    if (typeof window.renderSmallStateBoxes === 'function' && window._lastUnitColors && window._lastAbbrColors && state.prevUnitColors) {
      const year = getSelectedYear();
      try { window.renderSmallStateBoxes(year, window._lastAbbrColors, window._lastUnitColors); } catch (e) { }
    }
    updateToggleLabel();
  }

  function startSimulation() {
    if (state.running) return;
    // If not prepared, prepare now so PV random draw happens at start time.
    if (!state.prepared) {
      // clear cached PV random values so resolvePvValue will roll for the current start
      state.pvRandomCache = null;
      state.pvRandomCacheMode = null;
      state.pvRandomCacheYear = null;
      state.pvRandomSeed = null;
      prepareSimulation();
      if (!state.prepared) return;
    }
    state.running = true;
    state.lastTimestamp = null;
    state.lastDisplayUpdate = state.currentTime; // Initialize to current time
    state.rafId = requestAnimationFrame(tick);
    updateToggleLabel();
  }

  function pauseSimulation() {
    state.running = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = null;
    updateToggleLabel();
  }

  /**
   * RAF tick handler. Converts elapsed wall-clock time (timestamp)
   * into simulated minutes using speedMultiplier and minutesPerSecond,
   * advances state.currentTime, renders a frame, and enqueues the next
   * tick while the simulation remains running.
   */
  function tick(timestamp) {
    if (!state.running) return;
    if (!state.lastTimestamp) state.lastTimestamp = timestamp;
    const deltaMs = timestamp - state.lastTimestamp;
    state.lastTimestamp = timestamp;
    const deltaMinutes = (deltaMs / 1000) * state.speedMultiplier * state.minutesPerSecond;
    state.currentTime = Math.min(state.currentTime + deltaMinutes, state.simEnd);

    // Check if we should update the display (throttled updates)
    const timeSinceLastDisplay = state.currentTime - state.lastDisplayUpdate;
    const shouldUpdateDisplay = timeSinceLastDisplay >= DISPLAY_UPDATE_INTERVAL ||
      state.currentTime >= state.simEnd - EPS ||
      state.lastDisplayUpdate === 0;

    if (shouldUpdateDisplay) {
      state.lastDisplayUpdate = state.currentTime;
      renderAt(state.currentTime);
    }

    if (state.currentTime >= state.simEnd - EPS) {
      pauseSimulation();
    } else {
      state.rafId = requestAnimationFrame(tick);
    }
  }

  /**
   * Build the per-unit array used by the simulator. For each input row (unit)
   * this computes final vote shares, an expected reporting schedule,
   * bias parameters, and derived values like startTime and duration.
   * The returned array is stored in state.stateData and consumed by
   * renderAt/computeMetrics.
   */
  function buildStateData(year, pvValue) {
    const rows = (window._byYearMap && window._byYearMap.get(year)) || [];
    if (!rows.length) return [];
    const baselineUnitColors = state.prevUnitColors ? new Map(state.prevUnitColors) : new Map();
    const baselineAbbrColors = state.prevAbbrColors ? new Map(state.prevAbbrColors) : new Map();
    const out = [];

    rows.forEach(row => {
      if (!row || !row.unit || row.unit === 'NATIONAL') return;
      const unit = String(row.unit);
      const abbr = unit.slice(0, 2);
      const isAtLarge = /-AL$/.test(unit);
      const isDistrict = /-(0[1-9])$/.test(unit);
      const isState = /^[A-Z]{2}$/.test(unit) || unit === 'DC';
      if (!isState && !isAtLarge && !isDistrict) return;

      let totals = null;
      if (typeof window.getUnitFinalVoteTotals === 'function') {
        totals = window.getUnitFinalVoteTotals(unit, { year, pv: pvValue });
      }

      const fallbackTotalRaw = totalVotesFromRow(row);
      const fallbackTotal = (isFinite(fallbackTotalRaw) && fallbackTotalRaw > 0) ? fallbackTotalRaw : 1;
      const hasFallbackTotal = isFinite(fallbackTotal) && fallbackTotal > 0;
      if (!totals && !hasFallbackTotal) return;

      let totalVotes = totals && isFinite(totals.totalVotes) ? totals.totalVotes : fallbackTotal;
      if (!isFinite(totalVotes) || totalVotes <= 0) return;

      let finalDVotes = totals && isFinite(totals.dVotes) ? totals.dVotes : Math.max(0, +row.dVotes || 0);
      let finalRVotes = totals && isFinite(totals.rVotes) ? totals.rVotes : Math.max(0, +row.rVotes || 0);
      let finalOTopVotes = totals && isFinite(totals.topThirdVotes) ? totals.topThirdVotes : Math.max(0, +row.topThirdVotes || 0);
      let finalOTotalVotes = totals && isFinite(totals.totalThirdVotes) ? totals.totalThirdVotes : Math.max(0, +row.tVotes || finalOTopVotes || 0);

      finalDVotes = Math.max(0, finalDVotes);
      finalRVotes = Math.max(0, finalRVotes);
      finalOTopVotes = Math.max(0, finalOTopVotes);
      finalOTotalVotes = Math.max(finalOTopVotes, Math.max(0, finalOTotalVotes));

      const sumParts = finalDVotes + finalRVotes + finalOTotalVotes;
      if (!isFinite(totalVotes) || totalVotes <= 0 || sumParts > totalVotes + EPS) totalVotes = sumParts;
      if (totalVotes <= 0) return;

      const twoPartyVotesFinal = finalDVotes + finalRVotes;
      const totalThirdShare = totalVotes > EPS ? Math.min(1, Math.max(0, finalOTotalVotes / totalVotes)) : 0;
      const topThirdShare = totalVotes > EPS ? Math.min(1, Math.max(0, finalOTopVotes / totalVotes)) : totalThirdShare;
      const twoPartyShare = totalVotes > EPS ? Math.min(1, Math.max(0, twoPartyVotesFinal / totalVotes)) : 0;
      const dShareFinal = totalVotes > EPS ? Math.max(0, finalDVotes / totalVotes) : 0;
      const rShareFinal = totalVotes > EPS ? Math.max(0, finalRVotes / totalVotes) : 0;
      const dTwoPartyFinal = twoPartyVotesFinal > EPS ? Math.min(1, Math.max(0, finalDVotes / twoPartyVotesFinal)) : 0.5;
      const rTwoPartyFinal = 1 - dTwoPartyFinal;
      const adjustedMargin = twoPartyVotesFinal > EPS ? clampMargin((finalDVotes - finalRVotes) / Math.max(twoPartyVotesFinal, EPS)) : 0;

      let winner;
      if (finalDVotes >= finalRVotes && finalDVotes >= finalOTopVotes) winner = 'D';
      else if (finalRVotes >= finalDVotes && finalRVotes >= finalOTopVotes) winner = 'R';
      else winner = 'O';
      if (year === 1876 && abbr === 'CO') winner = 'R';
      const thirdPartyDominant = winner === 'O';

      const ev = getEv(year, unit);
      const startTime = getStateStartTime(abbr);
      const closeness = 1 - Math.min(1, Math.abs(adjustedMargin) / 0.12);
      const speed = STATE_COUNTING_SPEEDS[abbr] || 1.0;
      let duration = Math.max(MIN_DURATION, (MIN_DURATION * (1 + 1.3 * closeness)) / Math.max(0.35, speed));

      const rngSeed = hashCode(`${year}-${unit}-${Math.round(pvValue * 10000)}`);
      const rng = mulberry32(rngSeed);
      const jitter = (rng() - 0.5) * 24;
      // Per-unit ease and jitter parameters (deterministic per-unit)
      // Make easePower scale with closeness: closer races (closeness->1)
      // should have a stronger ease-out (larger power) to build tension.
      // Base 2.0, add up to 1.5 from closeness, plus a tiny RNG offset.
      const easePower = 2.0 + (closeness || 0) * 1.5 + rng() * 0.5; // ~2.0..4.0
      const reportJitter = (rng() - 0.5) * 0.04; // ±0.02 max per-unit jitter
      let callDeadline = startTime + MIN_CALL_DELAY + closeness * EXTRA_CALL_WINDOW + jitter;
      callDeadline = Math.max(startTime + 10, Math.min(callDeadline, startTime + duration - 10));

      const instantCall = year === 1876 && abbr === 'CO';
      if (instantCall) {
        duration = Math.max(20, duration * 0.2);
        callDeadline = startTime + 1;
      }

      const mailHeavy = MAIL_HEAVY_STATES.has(abbr);
      const reportingSchedule = generateReportingSchedule(startTime, duration, closeness, mailHeavy, rng);
      const biasParams = (instantCall || thirdPartyDominant) ? null : createBiasParams(unit, adjustedMargin, closeness, rng);
      const pathSelections = collectPathSelections(unit, abbr);
      if (!pathSelections.length) return;

      const aliases = new Set([unit]);
      if (isAtLarge) aliases.add(abbr);
      if (isState) aliases.add(abbr);

      const finalMarginTwoParty = twoPartyShare > EPS ? (dShareFinal - rShareFinal) / Math.max(twoPartyShare, EPS) : 0;
      const finalLeader = determineLeader(dShareFinal, rShareFinal, totalThirdShare, 1, { dVotes: finalDVotes, rVotes: finalRVotes, oVotes: finalOTopVotes, countedVotes: twoPartyVotesFinal });
      const baselineAbbr = baselineAbbrColors.get(abbr);
      let finalColor = baselineAbbr && baselineAbbr.color ? baselineAbbr.color : null;
      if (!finalColor) {
        const baselineUnit = baselineUnitColors.get(unit);
        finalColor = baselineUnit || safeMarginToColor(finalMarginTwoParty, finalLeader === 'O');
      }
      const finalMarginStr = finalLeader === 'O' ? 'Other lead' : formatLean(finalMarginTwoParty);
      const countedMargin = totalVotes > EPS ? ((finalDVotes - finalRVotes) / totalVotes) : 0;
      let countedMarginStr = 'None';
      if (finalLeader === 'O') countedMarginStr = 'Other lead';
      else if (twoPartyVotesFinal > EPS) countedMarginStr = formatLean((finalDVotes - finalRVotes) / Math.max(twoPartyVotesFinal, EPS));
      else if (totalVotes > EPS) countedMarginStr = 'EVEN';

      const evAllocations = buildEvAllocations(year, abbr, unit, ev, winner, finalDVotes, finalRVotes, finalOTotalVotes, topThirdShare);

      const targetMetrics = {
        reporting: 1,
        leader: finalLeader,
        margin: finalMarginTwoParty,
        marginStr: finalMarginStr,
        colorMargin: finalMarginTwoParty,
        countedMargin,
        countedMarginStr,
        color: finalColor,
        dShare: dShareFinal,
        rShare: rShareFinal,
        oShare: totalThirdShare,
        topThirdShare,
        totalThirdShare,
        confidence: 1,
        dVotesCounted: finalDVotes,
        rVotesCounted: finalRVotes,
        oVotesCounted: finalOTopVotes,
        oVotesCountedTotal: finalOTotalVotes,
        countedVotes: totalVotes,
        remainingVotes: 0
      };

      out.push({
        unitKey: unit,
        abbr,
        type: isDistrict ? 'district' : (isAtLarge ? 'atlarge' : 'state'),
        totalVotes,
        thirdPartyShare: totalThirdShare,
        topThirdShare,
        twoPartyShare,
        dTwoPartyFinal,
        rTwoPartyFinal,
        dShareFinal,
        rShareFinal,
        winner,
        ev,
        evAllocations,
        evCalledAllocations: null,
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
        easePower,
        reportJitter,
        targetMetrics,
        callLeader: null,
        misCallLogged: false,
        thirdPartyDominant,
        reportingSchedule,
        rngSeed
      });
    });

    return out;
  }

  function buildEvAllocations(year, abbr, unit, ev, winner, dVotes, rVotes, oVotes, topThirdShare) {
    const allocations = { D: 0, R: 0, O: 0, thirdParties: {} };
    if (!isFinite(ev) || ev <= 0) return allocations;

    // Check if proportional EV mode is enabled
    const isProportional = (() => {
      try {
        const toggle = document.getElementById('propEvToggle');
        return toggle && toggle.checked;
      } catch (e) {
        return false;
      }
    })();

    // Special case: Alabama 1960 and Mississippi 1960 - always use fixed allocation
    if (year === 1960 && (abbr === 'AL' || abbr === 'MS')) {
      const margin = 0; // Doesn't matter for fixed allocation
      const pv = window._curPv || 0;
      const adjMargin = margin + pv;
      const stateWinner = adjMargin >= 0 ? 'D' : 'R';

      if (stateWinner !== 'R') {
        if (abbr === 'AL') {
          allocations.D = 5;
          allocations.O = 6;
        } else { // MS
          allocations.D = 0;
          allocations.O = 8;
        }
      } else {
        // Republicans win: normal winner-take-all
        allocations.R = ev;
      }
      return allocations;
    }

    if (isProportional && dVotes != null && rVotes != null && oVotes != null) {
      // Try to use the global allocateProportionalEVs function with full third party support
      if (typeof window.allocateProportionalEVs === 'function') {
        try {
          // Get thirdPartyResults from the row data
          const rows = (window._byYearMap && window._byYearMap.get(year)) || [];
          const row = rows.find(r => r && r.unit === unit);
          const thirdPartyResults = (row && row.thirdPartyResults) || null;

          const result = window.allocateProportionalEVs(dVotes, rVotes, oVotes, ev, topThirdShare, thirdPartyResults);
          allocations.D = result.D || 0;
          allocations.R = result.R || 0;
          allocations.O = result.O || 0;
          allocations.thirdParties = result.thirdParties || {};

          // Debug log: show where proportional allocations come from for 1960
          // try {
          //   if (year === 1960) {
          //     console.log('[EV-TRACE] buildEvAllocations', { year, abbr, unit, ev, dVotes, rVotes, oVotes, thirdPartyResults, result });
          //   }
          // } catch(e) {}

          // Sum up all third party EVs into O for backwards compatibility with display
          if (allocations.thirdParties && typeof allocations.thirdParties === 'object') {
            let totalThirdEVs = 0;
            Object.values(allocations.thirdParties).forEach(ev => totalThirdEVs += ev);
            allocations.O += totalThirdEVs;
          }

          return allocations;
        } catch (e) {
          console.warn('Failed to use advanced proportional allocation, falling back:', e);
        }
      }

      // Fallback proportional allocation (simple)
      const total = dVotes + rVotes + oVotes;
      if (total > 0) {
        const dShare = dVotes / total;
        const rShare = rVotes / total;
        const oShare = oVotes / total;

        const dQuota = Math.floor(dShare * ev);
        const rQuota = Math.floor(rShare * ev);
        const oQuota = Math.floor(oShare * ev);

        allocations.D = dQuota;
        allocations.R = rQuota;
        allocations.O = oQuota;

        let remaining = ev - (dQuota + rQuota + oQuota);

        if (remaining > 0) {
          const remainders = [
            { party: 'D', remainder: (dShare * ev) - dQuota },
            { party: 'R', remainder: (rShare * ev) - rQuota },
            { party: 'O', remainder: (oShare * ev) - oQuota }
          ];

          remainders.sort((a, b) => b.remainder - a.remainder);

          for (let i = 0; i < remaining; i++) {
            allocations[remainders[i].party]++;
          }
        }

        return allocations;
      }
    }

    // Fall back to original winner-take-all logic
    if (year === 1960 && abbr === 'AL' && winner !== 'R') {
      const demPortion = Math.min(ev, 5);
      allocations.D = demPortion;
      allocations.O = Math.max(0, ev - demPortion);
      return allocations;
    }

    if (winner === 'D') allocations.D = ev;
    else if (winner === 'R') allocations.R = ev;
    else allocations.O = ev;
    return allocations;
  }

  function buildCallAllocation(st, leader) {
    const allocation = { D: 0, R: 0, O: 0 };
    const totalEv = isFinite(st.ev) ? st.ev : 0;
    if (!leader || totalEv <= 0) return allocation;
    if (leader === 'D') allocation.D = totalEv;
    else if (leader === 'R') allocation.R = totalEv;
    else allocation.O = totalEv;
    return allocation;
  }

  function generateReportingSchedule(startTime, duration, closeness, mailHeavy, rng) {
    if (!isFinite(startTime) || !isFinite(duration) || duration <= 0) {
      return [{ time: isFinite(startTime) ? startTime : 0, reporting: 1 }];
    }

    // Generate many more interpolation points for smooth continuous counting
    // This allows counting to appear continuous while display updates happen less frequently
    const pointsPerHour = 30; // generate a point every 2 minutes on average
    const totalPoints = Math.max(60, Math.round((duration / 60) * pointsPerHour));

    const schedule = [];
    const timeWeights = [];
    const reportWeights = [];
    let timeWeightSum = 0;
    let reportWeightSum = 0;

    // Generate weights for smooth distribution across the schedule
    for (let i = 0; i < totalPoints; i++) {
      const progress = i / Math.max(1, totalPoints - 1);

      // Time weights: mail-heavy states count slower early, faster late
      // Regular states count faster early, slower late
      const phaseBias = mailHeavy ? (progress * 2 + 0.5) : (2 - progress * 1.5);
      const timeWeight = Math.max(0.05, phaseBias + rng() * 0.3);
      timeWeights.push(timeWeight);
      timeWeightSum += timeWeight;

      // Report weights: consider closeness for smaller increments
      let reportBias = 0.5 + closeness * 0.6 + rng() * 0.5;
      if (!mailHeavy && i < totalPoints * 0.15) reportBias *= 0.5; // slow start for non-mail states
      if (mailHeavy && i < totalPoints * 0.4) reportBias *= 0.6; // slower early phase for mail states
      reportBias = Math.max(0.05, reportBias);
      reportWeights.push(reportBias);
      reportWeightSum += reportBias;
    }

    let currentTime = startTime;
    let currentReporting = 0;

    for (let i = 0; i < totalPoints; i++) {
      // Distribute time proportionally
      let interval = duration * (timeWeights[i] / timeWeightSum);
      interval = Math.max(0.1, interval); // very small minimum gap for smooth counting
      const remainingTime = (startTime + duration) - currentTime;
      if (interval > remainingTime) interval = remainingTime;
      currentTime = Math.min(startTime + duration, currentTime + interval);

      // Distribute reporting percentage
      let increment = (reportWeights[i] / reportWeightSum) * (1 - currentReporting);
      increment = Math.max(0.005, increment); // smaller increments for smooth progression
      if (i === totalPoints - 1) {
        currentReporting = 1;
      } else {
        currentReporting = Math.min(1, currentReporting + increment);
      }
      schedule.push({ time: currentTime, reporting: currentReporting });
    }

    if (!schedule.length) {
      schedule.push({ time: startTime + duration, reporting: 1 });
    } else {
      const last = schedule[schedule.length - 1];
      last.time = startTime + duration;
      last.reporting = 1;
    }
    return refineReportingScheduleTail(schedule, startTime, duration, closeness);
  }

  function refineReportingScheduleTail(schedule, startTime, duration, closeness) {
    if (!Array.isArray(schedule) || schedule.length < 2) return schedule;
    const endTime = startTime + duration;
    const trigger = 0.75 + (1 - Math.max(0, Math.min(1, closeness || 0))) * 0.12;
    const rawMaxJump = 0.045 - 0.02 * Math.max(0, Math.min(1, closeness || 0));
    const tailMaxJump = Math.max(0.012, rawMaxJump);

    const refined = [];
    let prev = null;
    for (let i = 0; i < schedule.length; i++) {
      const entry = schedule[i] || {};
      const current = {
        time: isFinite(entry.time) ? entry.time : startTime + (duration * (i / Math.max(1, schedule.length - 1))),
        reporting: clamp01(isFinite(entry.reporting) ? entry.reporting : 0)
      };
      if (!prev) {
        refined.push({ ...current });
        prev = refined[refined.length - 1];
        continue;
      }

      const interval = Math.max(0, current.time - prev.time);
      const diff = Math.max(0, current.reporting - prev.reporting);
      const smoothingActive = (prev.reporting >= trigger || current.reporting >= trigger) && diff > tailMaxJump + EPS;
      if (smoothingActive) {
        const segments = Math.max(2, Math.ceil(diff / tailMaxJump));
        for (let s = 1; s < segments; s++) {
          const ratio = s / segments;
          const interp = {
            time: prev.time + interval * ratio,
            reporting: clamp01(prev.reporting + diff * ratio)
          };
          refined.push(interp);
        }
      }

      refined.push({ ...current });
      prev = refined[refined.length - 1];
    }

    const minTimeStep = Math.max(0.05, Math.min(0.5, duration / 360));
    for (let i = 1; i < refined.length; i++) {
      const prevEntry = refined[i - 1];
      const entry = refined[i];
      if (entry.time <= prevEntry.time) {
        entry.time = Math.min(endTime, prevEntry.time + minTimeStep);
      }
    }

    for (let i = refined.length - 2; i >= 0; i--) {
      const entry = refined[i];
      const next = refined[i + 1];
      if (entry.time >= next.time) {
        entry.time = Math.max(startTime, next.time - minTimeStep);
      }
    }

    for (let i = 1; i < refined.length; i++) {
      const prevEntry = refined[i - 1];
      const entry = refined[i];
      if (entry.time <= prevEntry.time) {
        entry.time = Math.min(endTime, prevEntry.time + minTimeStep);
      }
    }

    const last = refined[refined.length - 1];
    if (last) {
      last.time = endTime;
      last.reporting = 1;
    }

    // Densify reporting steps so that reporting never jumps by more than
    // MAX_SCHEDULE_REPORT_STEP between adjacent control points. This creates
    // additional interpolated control points when necessary to make counting
    // appear continuous and avoid large single-step increases.
    try {
      const outDensified = [];
      for (let i = 0; i < refined.length; i++) {
        const cur = refined[i];
        if (!cur) continue;
        if (outDensified.length === 0) {
          outDensified.push({ ...cur });
          continue;
        }
        const prev = outDensified[outDensified.length - 1];
        const repDiff = Math.max(0, (cur.reporting || 0) - (prev.reporting || 0));
        if (repDiff <= MAX_SCHEDULE_REPORT_STEP + EPS) {
          outDensified.push({ ...cur });
          continue;
        }
        // Insert necessary segments
        const segments = Math.max(2, Math.ceil(repDiff / MAX_SCHEDULE_REPORT_STEP));
        for (let s = 1; s <= segments; s++) {
          const ratio = s / segments;
          const t = prev.time + (cur.time - prev.time) * ratio;
          const r = clamp01((prev.reporting || 0) + repDiff * ratio);
          outDensified.push({ time: Math.min(endTime, Math.max(startTime, t)), reporting: r });
        }
      }
      // Ensure final point is exact
      if (outDensified.length) {
        const lastOut = outDensified[outDensified.length - 1];
        lastOut.time = endTime;
        lastOut.reporting = 1;
      }
      return outDensified;
    } catch (e) {
      return refined;
    }
  }

  /**
   * Render the simulation at a specific time (minutes). This iterates
   * over every unit, computes its current metrics, potentially registers
   * calls, updates map colors and small-box summaries, accumulates EV
   * tallies, and then updates UI widgets (EV bar, PV display, progress
   * slider, and the call log).
   */
  function renderAt(timeMinutes, opts = {}) {
    if (!state.stateData.length) return;
    // "Settled" frames are ones the browser actually paints (real-time RAF
    // ticks, or the single call after a fast-forward seek finishes) — see
    // advanceDeterministic()'s intermediate-step calls, which pass
    // {settled:false} since nothing there is ever visible.
    const settled = opts.settled !== false;

    const phase = getPhase(timeMinutes);
    const phaseName = phase ? phase.name : 'Final';
    if (elements.phase) elements.phase.textContent = `Phase: ${phaseName}`;
    if (elements.timeLabel) elements.timeLabel.textContent = `${formatTimeLabel(timeMinutes)} ET`;

    let dEV = 0, rEV = 0, oEV = 0;
    // Track uncalled state leanings for phantom EV display
    let phantomDEV = 0, phantomREV = 0, phantomOEV = 0;
    let dCounted = 0, rCounted = 0, oCounted = 0, countedVotes = 0;

    state.snapshot.clear();

    state.stateData.forEach(st => {
      const prevMetrics = st.latestMetrics || null;
      const metrics = computeMetrics(st, timeMinutes, phaseName);
      // Log large reporting jumps for debugging
      try {
        if (typeof window !== 'undefined' && window._enReportingJumps && prevMetrics && isFinite(prevMetrics.reporting) && isFinite(metrics.reporting)) {
          const diff = Math.abs(metrics.reporting - prevMetrics.reporting);
          if (diff >= REPORTING_JUMP_THRESHOLD) {
            window._enReportingJumps.push({ time: timeMinutes, unit: st.unitKey, prevReporting: prevMetrics.reporting, newReporting: metrics.reporting, diff });
            if (window.DEBUG_ELECTION_NIGHT) console.warn('[EN-REPORT-JUMP]', st.unitKey, prevMetrics.reporting, '->', metrics.reporting, 'diff', diff);
          }
        }
      } catch (e) { /* ignore logging errors */ }
      st.latestMetrics = metrics;

      if (!st.calledAt) {
        if (shouldCallState(st, metrics, timeMinutes)) {
          registerCall(st, metrics, timeMinutes);
        } else if (shouldForceCall(st, metrics, timeMinutes)) {
          registerCall(st, metrics, Math.max(timeMinutes, st.callDeadline));
        }
      }

      const isCalled = st.calledAt != null && timeMinutes >= st.calledAt - EPS;

      if (metrics.reporting >= 1 - EPS && st.evAllocations && isCalled) {
        if (!st.evCalledAllocations || st.callLeader === st.winner) {
          st.evCalledAllocations = { ...st.evAllocations };
        }
      }

      let displayColor = metrics.color;
      if (st.thirdPartyDominant && metrics.reporting <= EPS) {
        displayColor = NEUTRAL_COLOR;
      }
      if (!isCalled && metrics.reporting > 0) {
        const marginForLight = (metrics.colorMargin != null) ? metrics.colorMargin : metrics.margin;
        if (marginForLight != null && Math.abs(marginForLight) < 0.01) {
          displayColor = BRIGHT_TOSSUP_COLOR;
        } else {
          displayColor = blendColors(metrics.color, '#cccccc', UNCALLED_BRIGHTEN);
        }
      }
      applyColor(st, displayColor, metrics);

      const evAllocation = isCalled ? (st.evCalledAllocations || null) : null;
      if (evAllocation) {
        dEV += evAllocation.D || 0;
        rEV += evAllocation.R || 0;
        oEV += evAllocation.O || 0;
      } else if (!isCalled && metrics.reporting > EPS && st.ev > 0) {
        // Track phantom EVs for uncalled states based on current leader
        const leader = metrics.leader;
        if (leader === 'D') {
          phantomDEV += st.ev;
        } else if (leader === 'R') {
          phantomREV += st.ev;
        } else if (leader === 'O') {
          phantomOEV += st.ev;
        }
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
        evAllocations: st.evAllocations ? { ...st.evAllocations } : null,
        evCalledAllocations: st.evCalledAllocations ? { ...st.evCalledAllocations } : null,
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
      // Attach candidate metadata when available (from parsed CSV rows)
      try {
        const year = state.year || getSelectedYear();
        if (typeof window.getRowsForYear === 'function') {
          const rows = window.getRowsForYear(year) || [];
          // Prefer exact unitKey match (ME-AL/NE-AL or state/district), fall back to abbr
          const rowMatch = rows.find(r => r && (r.unit === st.unitKey || r.unit === st.abbr));
          if (rowMatch) {
            // preserve original CSV fields if present
            if (rowMatch.dCandidate) snapshot.dCandidate = rowMatch.dCandidate;
            if (rowMatch.rCandidate) snapshot.rCandidate = rowMatch.rCandidate;
            if (rowMatch.thirdPartyResults) snapshot.thirdPartyResults = rowMatch.thirdPartyResults;
            // Also expose a small candidates object for downstream consumers
            snapshot.candidates = snapshot.candidates || {};
            if (rowMatch.dCandidate) snapshot.candidates.D = { name: rowMatch.dCandidate };
            if (rowMatch.rCandidate) snapshot.candidates.R = { name: rowMatch.rCandidate };
            // If top third-party present, include as O
            try {
              if (rowMatch.thirdPartyResults && typeof rowMatch.thirdPartyResults === 'object') {
                const entries = Object.entries(rowMatch.thirdPartyResults).map(([nm, v]) => ({ name: nm, votes: Number(v) || 0 }));
                if (entries.length) {
                  entries.sort((a, b) => b.votes - a.votes);
                  snapshot.candidates.O = { name: entries[0].name };
                }
              }
            } catch (e) { }
          }
        }
      } catch (e) { }
      // If we didn't get candidate names above, try the shared helper fallback
      try {
        if ((!snapshot.candidates || Object.keys(snapshot.candidates).length === 0) && typeof getUnitCandidateLastNames === 'function') {
          const names = getUnitCandidateLastNames(st.unitKey) || getUnitCandidateLastNames(st.abbr) || null;
          if (names && typeof names === 'object') {
            snapshot.candidates = snapshot.candidates || {};
            if (names.D) { snapshot.candidates.D = { name: names.D }; snapshot.dCandidate = names.D; }
            if (names.R) { snapshot.candidates.R = { name: names.R }; snapshot.rCandidate = names.R; }
            if (names.O) { snapshot.candidates.O = { name: names.O }; }
          }
        }
      } catch (e) { }

      st.aliases.forEach(alias => state.snapshot.set(alias, snapshot));
      state.snapshot.set(st.unitKey, snapshot);
      maybeEmitMiscall(st, metrics, timeMinutes);
    });

    state.lastNationalTotals = { dCounted, rCounted, oCounted, countedVotes };
    maybeRegisterNpvCall(dCounted, rCounted, oCounted, countedVotes, timeMinutes);
    maybeEmitNpvMiscall(countedVotes, timeMinutes);
    updateNationalWinProbability(timeMinutes, settled);

    flushSmallBoxes();

    window._electionNightSnapshot = state.snapshot;

    try {
      const totalPool = state.totalEvPool || 538;
      const uEV = Math.max(0, totalPool - (dEV + rEV + oEV));
      window._evSummaryOverride = {
        dEV,
        rEV,
        oEV,
        uEV,
        totalEV: totalPool,
        phantomDEV,
        phantomREV,
        phantomOEV,
        updatedAt: Date.now()
      };
    } catch (e) { /* ignore */ }

    updateEvDisplay(dEV, rEV, oEV, phantomDEV, phantomREV, phantomOEV);
    updatePopularVoteDisplay(dCounted, rCounted, oCounted, countedVotes);
    updateProgressSlider(timeMinutes);
    updateCallLog(timeMinutes);
    try {
      updateCandidateInfo(state.year || getSelectedYear());
    } catch (e) { console.warn('Failed to update candidate info during election night', e); }

    // Update EV breakdown table during election night if modal is open
    if (typeof window.updateEvBreakdownTable === 'function') {
      try {
        const modal = document.getElementById('evBreakdownModal');
        if (modal && modal.style.display !== 'none') {
          window.updateEvBreakdownTable();
        }
      } catch (e) { }
    }

    if (typeof window.refreshActiveMapTip === 'function') {
      try { window.refreshActiveMapTip(); } catch (e) { }
    }

    // Record log entry at interval boundaries
    maybeRecordLogEntry(timeMinutes, 'interval', null);
  }

  function computeMetrics(st, timeMinutes, phaseName) {
    // Compute the current reporting fraction for this unit (schedule is now densified)
    const reporting = computeReportingFraction(st, timeMinutes);
    const thirdPartyDominant = !!st.thirdPartyDominant;
    const totalThirdShare = st.thirdPartyShare;
    const topThirdShare = (st.topThirdShare != null) ? st.topThirdShare : totalThirdShare;

    let dShare;
    let rShare;
    let oShare;
    let leader;
    let margin = null;
    let marginStr = '';
    let color;
    let statsForLeader = null;

    // If a third party dominates the unit, we don't run the two-party
    // bias model and instead show the final shares directly until reporting
    // occurs.
    if (thirdPartyDominant) {
      dShare = st.dShareFinal;
      rShare = st.rShareFinal;
      oShare = totalThirdShare;
      leader = reporting > 0 ? 'O' : null;
      margin = 0;
      marginStr = leader ? 'Other lead' : '';
      color = null; // assigned after stats using third-party fallback
    } else {
      const bias = logisticBias(st.biasParams, reporting, phaseName);
      const rawD = st.dTwoPartyFinal * Math.max(0.15, bias);
      const rawR = Math.max(EPS, st.rTwoPartyFinal);
      const sumRaw = rawD + rawR;
      const dTwoParty = sumRaw > EPS ? rawD / sumRaw : 0.5;
      const rTwoParty = 1 - dTwoParty;
      const blend = Math.pow(Math.max(0, Math.min(1, reporting)), 3);
      const dShareBlend = (dTwoParty * (1 - blend) + st.dTwoPartyFinal * blend);
      const rShareBlend = 1 - dShareBlend;
      dShare = st.twoPartyShare * dShareBlend;
      rShare = st.twoPartyShare * rShareBlend;
      oShare = totalThirdShare;
      // prefer actual counted vote totals when available (stats computed below)
      statsForLeader = computeVoteStats(st, reporting, dShare, rShare, totalThirdShare, topThirdShare);
      leader = determineLeader(dShare, rShare, topThirdShare, reporting, statsForLeader);
      margin = reporting > 0 ? (dShareBlend - rShareBlend) : null;
      if (leader === 'O') marginStr = 'Other lead';
      else marginStr = (reporting > 0) ? formatLean(margin) : '';
    }

    // Given the current shares and reporting fraction compute vote totals
    // and how many votes remain.
    const stats = statsForLeader || computeVoteStats(st, reporting, dShare, rShare, oShare, topThirdShare);
    const countedTwoParty = (stats.dCounted + stats.rCounted);
    const countedTwoPartyMargin = countedTwoParty > EPS ? ((stats.dCounted - stats.rCounted) / countedTwoParty) : null;
    const countedMargin = stats.countedVotes > EPS ? ((stats.dCounted - stats.rCounted) / stats.countedVotes) : null;
    let countedMarginStr = 'None';
    if (stats.countedVotes > EPS) {
      if (leader === 'O') countedMarginStr = 'Other lead';
      else countedMarginStr = formatLean(countedMargin);
    }
    // Compute a simple confidence metric based on the counted votes and
    // remaining ballots.
    const confidence = calculateConfidence(st, stats);

    let colorMargin = countedTwoPartyMargin;
    if (colorMargin == null && countedMargin != null) colorMargin = countedMargin;
    if (colorMargin == null && isFinite(margin)) colorMargin = margin;
    if (leader === 'O' && colorMargin == null) colorMargin = 0;

    if (!color) {
      if (leader === 'O') {
        color = (st.targetMetrics && st.targetMetrics.color) ? st.targetMetrics.color : THIRD_PARTY_COLOR;
      } else {
        const baseColor = safeMarginToColor((colorMargin || 0), false);
        const intensity = Math.pow(Math.max(0, Math.min(1, reporting)), 0.7);
        color = intensity <= 0 ? NEUTRAL_COLOR : blendColors(NEUTRAL_COLOR, baseColor, Math.min(1, intensity));
      }
    }

    const colorMarginForResult = colorMargin;

    let result = {
      reporting,
      leader,
      margin,
      marginStr,
      countedMargin,
      countedMarginStr,
      colorMargin: colorMarginForResult,
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
      // When a unit is fully reported we normally merge the target/final
      // metrics. However, we must NOT allow a previously-stored baseline
      // color to overwrite the color computed from actual counted votes
      // when those counted votes are available. The user expectation is
      // that coloring should prefer raw/count tallies if present.
      try {
        const computedColor = result.color;
        const computedColorMargin = result.colorMargin;
        const computedConfidence = result.confidence;
        const computedCountedVotes = isFinite(result.countedVotes) ? result.countedVotes : 0;

        // Merge target metrics but preserve computed color/colorMargin when
        // there are counted votes (i.e. raw data is available).
        result = { ...result, ...st.targetMetrics };
        if (computedCountedVotes > EPS) {
          result.color = computedColor;
          result.colorMargin = computedColorMargin;
        }
        // targetMetrics.confidence is a hardcoded 1 (see buildStateData),
        // which would claim false certainty on a genuine exact-vote tie.
        // calculateConfidence() already correctly returns 0 for a tie at
        // full reporting (no clear leader), so always prefer the freshly
        // computed value over the hardcoded one.
        result.confidence = computedConfidence;
      } catch (e) {
        // Fallback to simple merge if anything goes wrong
        result = { ...result, ...st.targetMetrics };
      }
    }

    return result;
  }

  function computeVoteStats(st, reporting, dShare, rShare, totalThirdShare, topThirdShare) {
    // Return numerical totals for counted votes given a reporting fraction
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

  function calculateConfidence(st, stats) {
    // Heuristic confidence calculation:
    // - If there are no counted votes => 0 confidence.
    // - If no remaining votes => 1 if leader > runner, else 0.
    // - Otherwise confidence is proportional to the vote gap divided by
    //   remaining votes (clamped to [0,1]). This approximates how likely
    //   the leader is to hold given worst-case remaining ballots.
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

  // National-level analog of calculateConfidence, reusing the same
  // worst-case-remaining-ballots math against the running national totals
  // instead of a single state's. `calculateConfidence` only inspects its
  // `stats` argument, so a truthy placeholder stands in for `st`.
  function calculateNationalConfidence(dCounted, rCounted, oCounted, countedVotes) {
    const remainingVotes = Math.max(0, state.totalEligibleVotes - countedVotes);
    return calculateConfidence(true, { countedVotes, dCounted, rCounted, oCounted, remainingVotes });
  }

  function nationalLeader(dCounted, rCounted, oCounted) {
    if (dCounted <= EPS && rCounted <= EPS && oCounted <= EPS) return null;
    if (dCounted >= rCounted && dCounted >= oCounted) return 'D';
    if (rCounted >= dCounted && rCounted >= oCounted) return 'R';
    return 'O';
  }

  // Live per-unit posterior for the national win-probability estimate:
  // combines this unit's frozen poll-like prior (st.priorMargin/priorSigma,
  // see buildSyntheticPollPriors/applyBridgedPollPriors) with the currently
  // OBSERVABLE partial count via inverse-variance weighting. The
  // observation uncertainty shrinks as reporting increases and is inflated
  // for MAIL_HEAVY_STATES, derived from the identity
  //   finalMargin = reporting*observedMargin + (1-reporting)*remainingBatchMargin
  // by modeling only the genuinely uncertain term (how differently the
  // not-yet-counted batch might vote) as Normal(0, deltaSigma^2):
  //   obsSigma(reporting) = (1-reporting) * deltaSigma
  // This satisfies both boundaries with no special-casing: reporting->1
  // makes obsSigma->0 (posterior converges to the observed count);
  // reporting->0 still needs one explicit guard below, since observedMargin
  // is genuinely undefined (0/0) before any votes are counted, not just
  // numerically unstable. Reads only st.abbr and st.priorMargin/priorSigma
  // (frozen public facts) plus metrics.dVotesCounted/rVotesCounted/
  // reporting (legitimately observable) — never st.dShareFinal/rShareFinal/
  // biasParams/closeness.
  // Extracted so the live-swing solve (docs/utils/electionNight/liveSwing.js)
  // can reuse the exact same "how much do we know from this unit's own
  // partial count, and how sure are we of it" logic without duplicating it -
  // the swing solve needs the raw observation, not the prior-blended
  // posterior computeUnitPosterior below builds from it.
  function computeUnitObservation(st, metrics) {
    const dV = metrics ? metrics.dVotesCounted : 0;
    const rV = metrics ? metrics.rVotesCounted : 0;
    const twoPartyCounted = dV + rV;
    if (!(twoPartyCounted > EPS)) return { observedMargin: null, obsSigma: null, hasObs: false };
    const observedMargin = (dV - rV) / twoPartyCounted;
    const reporting = metrics && isFinite(metrics.reporting) ? metrics.reporting : 0;
    const deltaSigma = MAIL_HEAVY_STATES.has(st.abbr) ? REMAINING_DELTA_SIGMA_MAIL_HEAVY : REMAINING_DELTA_SIGMA_BASE;
    const obsSigma = Math.max(0, 1 - reporting) * deltaSigma;
    return { observedMargin, obsSigma, hasObs: true };
  }

  function computeUnitPosterior(st, metrics) {
    if (!(st.priorSigma > 0)) return { margin: st.priorMargin || 0, sigma: 0 };
    const obs = computeUnitObservation(st, metrics);
    if (!obs.hasObs) return { margin: st.priorMargin, sigma: st.priorSigma };
    if (obs.obsSigma <= EPS) return { margin: obs.observedMargin, sigma: 0 };

    const priorPrec = 1 / (st.priorSigma * st.priorSigma);
    const obsPrec = 1 / (obs.obsSigma * obs.obsSigma);
    const totalPrec = priorPrec + obsPrec;
    return {
      margin: (st.priorMargin * priorPrec + obs.observedMargin * obsPrec) / totalPrec,
      sigma: Math.sqrt(1 / totalPrec)
    };
  }

  // P(D wins the unit) implied by its posterior margin/sigma, for display in
  // the "still counting" cards. A degenerate zero-sigma posterior (no prior,
  // e.g. before any bridged/synthetic prior was established) resolves to a
  // hard 0/1 rather than a coin-flip.
  function winProbFromPosterior(margin, sigma) {
    if (!(sigma > 0)) return margin >= 0 ? 1 : 0;
    return normalCdf(margin / sigma);
  }

  // Smoothstep-eased pacing factors (see PACING_MULTIPLIER_START/
  // PACING_MEAN_SCALE_START/PACING_DECAY_REPORTING above): both ease from
  // their "early night" extreme back to 1 (fully honest) as
  // nationalReporting approaches PACING_DECAY_REPORTING. meanScale trusts
  // only a fraction of the observed swing early on — this is the part that
  // actually slows the aggregate win% down, since widening sigma ALONE
  // doesn't: every state gets nudged by the SAME shared mean shift, so the
  // aggregate EV total still moves fast even if each individual state's own
  // probability reads less extreme. sigmaMult adds extra cushion on top.
  function pacingFactors(nationalReporting) {
    const r = Math.max(0, Math.min(1, isFinite(nationalReporting) ? nationalReporting : 0));
    const t = PACING_DECAY_REPORTING > 0 ? Math.min(1, r / PACING_DECAY_REPORTING) : 1;
    const eased = t * t * (3 - 2 * t);
    return {
      meanScale: PACING_MEAN_SCALE_START + (1 - PACING_MEAN_SCALE_START) * eased,
      sigmaMult: PACING_MULTIPLIER_START + (1 - PACING_MULTIPLIER_START) * eased
    };
  }

  // Returns a shallow-cloned swing hierarchy with pacing applied to ONLY the
  // shared national/regional terms (national.mean/sigma, each region's
  // dbar/sigma, and the base sigmaR fallback for an unobserved region) —
  // deliberately NOT sigmaI or any per-unit byUnit entry (obs.d), since
  // those drive a unit's OWN reporting-driven certainty and must stay
  // exact: unitSwingDelta's conditional shrinkage (obs.a -> 1 at full
  // reporting) means a fully-counted state's margin collapses to exactly
  // what was counted regardless of how damped N/R are — only the "borrowed"
  // info about OTHER, not-yet-reported units gets paced. Scaling a region's
  // dbar by the SAME meanScale as national.mean is what makes
  // sampleSwing()'s `k*(dbar - N)` recompute correctly damped, rather than
  // just shifting a region's mean relative to an already-shrunk N.
  // state.swingEstimate itself is never mutated — the export timeline/debug
  // log still see the real, undamped signal.
  function applyPacingDamper(swing, nationalReporting) {
    if (!swing) return swing;
    const { meanScale, sigmaMult } = pacingFactors(nationalReporting);
    if (meanScale >= 1 - EPS && sigmaMult <= 1 + EPS) return swing;
    const regions = new Map(Array.from(swing.regions, ([key, r]) => [key, {
      ...r,
      dbar: r.dbar * meanScale,
      sigma: r.sigma * sigmaMult
    }]));
    return {
      ...swing,
      national: { mean: swing.national.mean * meanScale, sigma: swing.national.sigma * sigmaMult },
      regions,
      sigmaR: swing.sigmaR * sigmaMult
    };
  }

  // Monte Carlo national win-probability tally. Already-called units (and
  // third-party-dominant ones, which never count toward either major
  // party's total — a majority of the TRUE EV pool is required, mirroring
  // real 1824/1836-style outcomes) are FIXED, not resampled: a called unit
  // shouldn't flip in the simulation, and fixing it shrinks compute as the
  // night progresses. Everything else is drawn fresh every simulation from
  // the live swing hierarchy (docs/utils/electionNight/liveSwing.js,
  // state.swingEstimate) rather than independent per-unit noise, which is
  // what lets already-reported units inform not-yet-reported ones in the
  // same region/nationally. At-large (ME-AL/NE-AL) units are never drawn
  // directly — each draw derives their margin as the vote-weighted
  // composite of their districts' margins for that same draw
  // (state.atLargeParts).
  function runNationalWinProbabilityMC(timeMinutes, posteriors) {
    const totalPool = state.totalEvPool || 538;
    const needed = Math.floor(totalPool / 2) + 1;

    let fixedDEv = 0, fixedREv = 0;
    const liveUnits = [];
    const liveAl = [];
    state.stateData.forEach(st => {
      if (st.thirdPartyDominant) return;
      const isCalled = st.calledAt != null && timeMinutes >= st.calledAt - EPS;
      if (isCalled) {
        // A called unit is normally fixed on its (observed) call - but if
        // that call has since been publicly corrected (maybeEmitMiscall
        // already logged the correction, which only happens once this
        // unit's own count has finished), the true winner is no longer
        // hidden information: it's sitting in the call log. Keep the MC in
        // sync with that reveal instead of locking the win probability to
        // a call that has already been announced wrong on-screen.
        const effectiveLeader = (st.misCallLogged && st.winner) ? st.winner : st.callLeader;
        if (effectiveLeader === 'D') fixedDEv += st.ev;
        else if (effectiveLeader === 'R') fixedREv += st.ev;
        return;
      }
      if (st.type === 'atlarge') liveAl.push(st);
      else liveUnits.push(st);
    });

    if (!liveUnits.length && !liveAl.length) {
      return { probD: fixedDEv >= needed ? 1 : 0, locked: true, sims: 0, evRange90: null };
    }

    const liveEvTotal = liveUnits.reduce((sum, st) => sum + st.ev, 0) + liveAl.reduce((sum, st) => sum + st.ev, 0);
    const hardLockedD = fixedDEv >= needed;
    const hardLockedR = fixedREv >= needed;
    const impossibleR = fixedREv + liveEvTotal < needed;
    const impossibleD = fixedDEv + liveEvTotal < needed;
    if (hardLockedD || hardLockedR || impossibleD || impossibleR) {
      return { probD: (hardLockedD || impossibleR) ? 1 : 0, locked: true, sims: 0, evRange90: null };
    }

    // Sample from the live swing hierarchy (docs/utils/electionNight/
    // liveSwing.js) instead of independent, memoryless noise per unit.
    // state.swingEstimate is solved just before this call (same throttle,
    // updateNationalWinProbability) from every currently-reporting unit's
    // own deviation from its frozen prior - this is what actually restores
    // the missing national/regional correlation (createRegionalErrorModel's
    // drawRelInto() vote-weighted-recenters every draw to exactly zero by
    // design: "the national factor deliberately lives on the NPV axis
    // instead," docs/utils/sim2028/errorModel.js:30-31,119-122) AND lets
    // already-reported units inform not-yet-reported ones, safely - see
    // liveSwing.js's module docstring for why a couple of noisy early
    // reporters can't swing this on their own.
    // Pacing damper (see PACING_MEAN_SCALE_START/PACING_MULTIPLIER_START/
    // PACING_DECAY_REPORTING): damps only the shared national/regional
    // terms early in the night, easing back to the honest math as overall
    // reporting increases. state.swingEstimate itself is untouched - the
    // export timeline/debug log still see the real, undamped signal.
    const nationalReporting = state.totalEligibleVotes > EPS && state.lastNationalTotals
      ? state.lastNationalTotals.countedVotes / state.totalEligibleVotes : 0;
    const swing = applyPacingDamper(state.swingEstimate || solveLiveSwing([]), nationalReporting);
    const allRegions = new Set(liveUnits.map(st => regionOf(st.unitKey)).filter(Boolean));
    const regionByUnit = new Map(liveUnits.map(st => [st.unitKey, regionOf(st.unitKey)]));
    const drawFn = makeNormalizedTDraw(POLL_ERROR_SPEC.df);

    const n = liveUnits.length;
    const seed = hashCode(`prob:${state.year}:${state.pvRandomSeed || 0}:${Math.round(timeMinutes)}`);
    const rng = mulberry32(seed >>> 0);
    const marginByUnit = new Map();
    const demEvSamples = new Float64Array(PROB_MC_SIMS);
    // Per-unit D-win tally across the same sims, mirroring
    // docs/utils/sim2028/forecast.js's own demWinCounts/stateProb pattern -
    // lets the "still counting" cards show a win% that reflects the shared
    // swing signal (e.g. other Rust Belt states trending R) rather than
    // only that unit's own reported votes.
    const demWinCounts = new Int32Array(n);
    const alDemWinCounts = new Int32Array(liveAl.length);
    let demWins = 0;

    for (let s = 0; s < PROB_MC_SIMS; s++) {
      const sample = sampleSwing(swing, allRegions, rng, drawFn);
      let demEv = fixedDEv;
      for (let i = 0; i < n; i++) {
        const st = liveUnits[i];
        const delta = unitSwingDelta(swing, st.unitKey, regionByUnit.get(st.unitKey), sample, rng, drawFn);
        const margin = st.priorMargin - delta;
        marginByUnit.set(st.unitKey, margin);
        if (margin >= 0) { demEv += st.ev; demWinCounts[i]++; }
      }
      for (let a = 0; a < liveAl.length; a++) {
        const st = liveAl[a];
        const parts = state.atLargeParts ? state.atLargeParts.get(st.unitKey) : null;
        if (!parts || !parts.length) continue;
        let acc = 0, wsum = 0;
        for (const p of parts) {
          const m = marginByUnit.has(p.unitKey) ? marginByUnit.get(p.unitKey)
            : (posteriors.get(p.unitKey) ? posteriors.get(p.unitKey).margin : 0);
          acc += m * p.weight;
          wsum += p.weight;
        }
        if (wsum > EPS && acc / wsum >= 0) { demEv += st.ev; alDemWinCounts[a]++; }
      }
      demEvSamples[s] = demEv;
      if (demEv >= needed) demWins++;
    }

    const stateProb = new Map();
    for (let i = 0; i < n; i++) stateProb.set(liveUnits[i].unitKey, demWinCounts[i] / PROB_MC_SIMS);
    for (let a = 0; a < liveAl.length; a++) stateProb.set(liveAl[a].unitKey, alDemWinCounts[a] / PROB_MC_SIMS);

    // [5%,95%] EV quantile spread, same computation forecast.js's own
    // evRange90 already does — exposed for docs/utils/electionNight/
    // validateWinProb.mjs's CI-narrows-over-time check, not used elsewhere.
    const sortedEv = Array.from(demEvSamples).sort((a, b) => a - b);
    const quantile = q => sortedEv[Math.min(sortedEv.length - 1, Math.max(0, Math.round(q * (sortedEv.length - 1))))];
    const evRange90 = [quantile(0.05), quantile(0.95)];

    // Even a genuinely ~100%-but-not-mathematically-locked race can show a
    // literal N/N on a finite sample by chance — clamp away from the
    // extremes here (mirrors formatConfidenceText's own never-claim-a-
    // false-100% guard in docs/utils/formatters.js) since the exact-math
    // locked/impossible cases above already handle real certainty.
    const rawProbD = demWins / PROB_MC_SIMS;
    return { probD: Math.min(0.999, Math.max(0.001, rawProbD)), locked: false, sims: PROB_MC_SIMS, evRange90, stateProb };
  }

  // Called every renderAt() frame. The cheap per-unit posteriors always
  // refresh (trivial even 480x in a tight fast-forward loop), but the
  // expensive Monte Carlo tally only runs on "settled" frames (ones the
  // browser will actually paint) AND its own independent throttle —
  // separate from DISPLAY_UPDATE_INTERVAL, which only guards the real-time
  // RAF path and never sees advanceDeterministic()'s synchronous loop.
  function updateNationalWinProbability(timeMinutes, settled) {
    if (!state.stateData.length) return;

    const posteriors = new Map();
    // Built in the same pass as the (already-every-frame) posteriors loop
    // so the live-swing solve below doesn't need a second walk over
    // state.stateData. Includes ALREADY-CALLED units too, not just live
    // ones - a unit called early with a healthy vote count is one of the
    // most informative observations about the national mood, even though
    // its own EVs are already fixed for the MC (see liveSwing.js).
    const swingObservations = [];
    state.stateData.forEach(st => {
      if (st.thirdPartyDominant || !st.latestMetrics) return;
      posteriors.set(st.unitKey, computeUnitPosterior(st, st.latestMetrics));
      if (st.priorSigma > 0) {
        const obs = computeUnitObservation(st, st.latestMetrics);
        if (obs.hasObs) {
          swingObservations.push({
            unitKey: st.unitKey,
            priorMargin: st.priorMargin,
            observedMargin: obs.observedMargin,
            obsSigma: obs.obsSigma
          });
        }
      }
    });
    state.unitPosteriors = posteriors;
    // Solved every frame, like state.unitPosteriors above (O(units+regions),
    // trivial even 480x in a tight fast-forward loop) - NOT gated behind
    // `settled`/the MC's own throttle below. collectLogEntry() (the
    // interval-log/export snapshot) runs during every intermediate step of
    // a big seek, not just the final settled one; if this were throttled
    // the same as the expensive MC, every exported timeline entry from a
    // fast-forwarded run would freeze at whatever swing estimate existed
    // before the seek started, defeating the point of a scrubbable
    // "when did the model notice" timeline.
    state.swingEstimate = solveLiveSwing(swingObservations);

    if (!settled) return;

    const isFirst = state.lastProbUpdateTime === -Infinity;
    const isFinal = timeMinutes >= state.simEnd - EPS;
    if (!isFirst && !isFinal && timeMinutes - state.lastProbUpdateTime < PROB_UPDATE_INTERVAL_MINUTES) return;
    state.lastProbUpdateTime = timeMinutes;

    state.nationalWinProb = runNationalWinProbabilityMC(timeMinutes, posteriors);
    renderWinProbLine(state.nationalWinProb);

    // Debug-only instrumentation for docs/utils/electionNight/validateWinProb.mjs
    // (gated the same way ENABLE_EN_COLOR_CALL_LOG gates window._enCallLog).
    // actualWinner is ground truth — fine to read here since this is
    // test-only instrumentation never consulted by the live algorithm.
    try {
      if (window.ENABLE_EN_PROB_LOG) {
        window._enProbLog = window._enProbLog || [];
        window._enProbLog.push({
          time: timeMinutes,
          nationalReporting: state.totalEligibleVotes > EPS
            ? state.lastNationalTotals.countedVotes / state.totalEligibleVotes : 0,
          probD: state.nationalWinProb.probD,
          evRange90: state.nationalWinProb.evRange90,
          // probD is a probability of winning the ELECTORAL COLLEGE, so it
          // must be graded against the EC outcome, not the popular vote —
          // they disagree often enough (2016, 2000, 1888, 1876...) that
          // grading against the wrong one would misreport a well-calibrated
          // model as overconfident/miscalibrated in those years.
          actualWinner: state.nationalFinalDEv >= Math.floor((state.totalEvPool || 538) / 2) + 1 ? 'D' : 'R',
          // Popular-vote margin, kept as informational context.
          actualMargin: (state.nationalFinalDVotes - state.nationalFinalRVotes)
            / Math.max(EPS, state.nationalFinalDVotes + state.nationalFinalRVotes),
          // EV margin (share of the full pool) — the more relevant signal
          // for "was this actually an electoral-college landslide" when
          // deciding whether an early high-confidence call was justified.
          actualEvMargin: (state.nationalFinalDEv - state.nationalFinalREv) / Math.max(1, state.totalEvPool || 538),
          // Live swing hierarchy (docs/utils/electionNight/liveSwing.js) —
          // swingNationalZ is the "honesty" statistic: across many samples
          // it should look roughly standard-normal. A nonzero early-game
          // mean is the fingerprint of systematic early-count contamination
          // (see createBiasParams's center-compression bias), not a real
          // national swing — this is what tells us whether that risk is
          // actually a problem, rather than guessing at a correction.
          swingNational: state.swingEstimate ? state.swingEstimate.national.mean : null,
          swingNationalSigma: state.swingEstimate ? state.swingEstimate.national.sigma : null,
          swingNationalZ: (state.swingEstimate && state.swingEstimate.national.sigma > EPS)
            ? state.swingEstimate.national.mean / state.swingEstimate.national.sigma : null,
          swingRegions: state.swingEstimate
            ? Object.fromEntries(Array.from(state.swingEstimate.regions.entries())
              .map(([region, r]) => [region, { mean: r.mean, sigma: r.sigma, nObs: r.nObs }]))
            : {},
          swingNObs: state.swingEstimate ? state.swingEstimate.nObs : 0,
          priorNpvMargin: state.priorNpvMargin
        });
      }
    } catch (e) { /* debug instrumentation only */ }
  }

  function renderWinProbLine(result) {
    if (!elements.winProb) return;
    if (!result || !isFinite(result.probD)) { elements.winProb.textContent = ''; return; }
    const dPct = (result.probD * 100).toFixed(1);
    const rPct = ((1 - result.probD) * 100).toFixed(1);
    elements.winProb.innerHTML = `<span class="en-winprob-d">D ${dPct}%</span> — <span class="en-winprob-r">R ${rPct}%</span> to win`;
  }

  // Accent color for an uncalled/still-counting race: blends from neutral
  // gray toward the leader's full-saturation party color (the same
  // safeMarginToColor scale the map uses) as confidence approaches the
  // active call threshold, so a race visibly "pops" the closer it gets to
  // being called. Mirrors the reporting-driven brighten effect already
  // used for map coloring (see the blendColors/NEUTRAL_COLOR usage in
  // computeMetrics), but driven by confidence-vs-threshold instead.
  function confidenceAccentColor(leader, margin, confidence, threshold) {
    if (!leader) return NEUTRAL_COLOR;
    const baseColor = leader === 'O' ? THIRD_PARTY_COLOR : safeMarginToColor(margin || 0, false);
    const safeThreshold = Math.max(EPS, isFinite(threshold) ? threshold : DEFAULT_CONFIDENCE_THRESHOLD);
    const closeness = Math.max(0, Math.min(1, (isFinite(confidence) ? confidence : 0) / safeThreshold));
    const intensity = Math.pow(closeness, 0.6);
    return intensity <= 0 ? NEUTRAL_COLOR : blendColors(NEUTRAL_COLOR, baseColor, intensity);
  }

  // Full-saturation accent color for an already-called line (state or NPV):
  // no blending needed since the outcome is settled, just the party's
  // margin-shaded color from the same scale the map/uncalled cards use.
  function calledAccentColor(leader, margin) {
    if (!leader) return NEUTRAL_COLOR;
    return leader === 'O' ? THIRD_PARTY_COLOR : safeMarginToColor(margin || 0, false);
  }

  // Resolves a leader code to the actual candidate's last name when one is
  // known, for personalized call-log text ("Called Ohio for Vance" instead
  // of "...for Republicans"). Returns null (letting callers fall back to
  // formatLeader) for real years/units with no candidate on record, and for
  // every synthetic year — docs/future.js hardcodes dCandidate:'D'/rCandidate:'R'
  // on every row it generates, including its NATIONAL row, so this
  // placeholder-sentinel check makes future.html fall back automatically
  // with no page-specific branching needed. unitKey='NATIONAL' resolves the
  // national ticket the same way, since every data source election-night.js
  // reads from (real CSV rows, docs/future.js, the sim2028 bridge) includes
  // a NATIONAL row.
  function resolveCandidateLastName(leader, unitKey) {
    if (leader !== 'D' && leader !== 'R' && leader !== 'O') return null;
    const names = getUnitCandidateLastNames(unitKey, { year: state.year });
    const name = names ? names[leader] : null;
    if (!name || name === 'D' || name === 'R' || name === 'O') return null;
    return name;
  }

  function maybeRegisterNpvCall(dCounted, rCounted, oCounted, countedVotes, currentTime) {
    if (state.npvCallRecord) return;
    const leader = nationalLeader(dCounted, rCounted, oCounted);
    if (!leader) return;
    const reporting = state.totalEligibleVotes > EPS ? countedVotes / state.totalEligibleVotes : 0;
    if (reporting < MIN_REPORTING_TO_CALL) return;
    const confidence = calculateNationalConfidence(dCounted, rCounted, oCounted, countedVotes);
    const threshold = Math.max(0, Math.min(1, isFinite(state.confidenceThreshold) ? state.confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD));
    if (!(reporting >= 1.0 || (isFinite(confidence) && confidence >= threshold))) return;

    const record = {
      kind: 'npv_call',
      time: currentTime,
      leader,
      candidateName: resolveCandidateLastName(leader, 'NATIONAL'),
      confidence,
      threshold,
      reporting,
      dVotes: dCounted,
      rVotes: rCounted,
      oVotes: oCounted,
      countedVotes
    };
    state.npvCallRecord = record;
    state.callRecords.push(record);
    recordNpvCallLogEntry(currentTime, leader);
    triggerTipRefresh();
  }

  function maybeEmitNpvMiscall(countedVotes, currentTime) {
    if (!state.npvCallRecord || state.npvMisCallLogged) return;
    if (countedVotes < state.totalEligibleVotes - EPS) return;
    const calledLeader = state.npvCallRecord.leader;
    const finalLeader = state.nationalFinalDVotes >= state.nationalFinalRVotes ? 'D' : 'R';
    if (calledLeader === finalLeader) return;
    state.npvMisCallLogged = true;
    const correctionTime = Math.max(currentTime, state.npvCallRecord.time + 0.01);
    const thresholdText = isFinite(state.npvCallRecord.threshold)
      ? ` (threshold ${state.npvCallRecord.threshold.toFixed(2)})`
      : '';
    const finalLeaderText = resolveCandidateLastName(finalLeader, 'NATIONAL') || formatLeader(finalLeader);
    const calledLeaderText = state.npvCallRecord.candidateName || formatLeader(calledLeader);
    const message = `${formatTimeLabel(correctionTime)} – Correction: National popular vote finishes for ${finalLeaderText}. Previously called for ${calledLeaderText} at ${formatTimeLabel(state.npvCallRecord.time)}${thresholdText}.`;
    state.callRecords.push({
      kind: 'notice',
      noticeType: 'npv_miscall',
      time: correctionTime,
      text: message,
      calledLeader,
      finalLeader
    });
    triggerTipRefresh();
    state.lastLogKey = '';
  }

  function maybeEmitMiscall(st, metrics, currentTime) {
    if (!st || !st.callRecord || st.misCallLogged) return;
    if (st.callRecord.kind !== 'call') return;
    const calledLeader = st.callRecord.leader;
    const finalLeader = st.winner;
    if (!calledLeader || calledLeader === finalLeader) return;
    if (!metrics || metrics.reporting < 1 - EPS) return;
    st.misCallLogged = true;
    const correctionTime = Math.max(currentTime, st.callRecord.time + 0.01);
    const finalLeaderText = resolveCandidateLastName(finalLeader, st.unitKey) || formatLeader(finalLeader);
    const calledLeaderText = st.callRecord.candidateName || formatLeader(calledLeader);
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
    st.evCalledAllocations = st.evAllocations ? { ...st.evAllocations } : null;
    triggerTipRefresh();
    state.lastLogKey = '';
  }

  function shouldCallState(st, metrics, currentTime) {
    // Decide whether the simulator should call the unit now.
    // - instantCall units are called as soon as their startTime is reached.
    // - otherwise: require some reporting OR that we're past the call deadline
    //   and that confidence exceeds the chosen threshold. A full-reporting
    //   (>= 1.0) forces a call.
    if (st.instantCall) {
      return currentTime >= st.startTime - EPS;
    }
    if (!metrics || metrics.leader == null) return false;
    if (metrics.reporting < MIN_REPORTING_TO_CALL && currentTime < st.callDeadline - 5) return false;
    if (metrics.reporting >= 1.0) return true;
    const threshold = Math.max(0, Math.min(1, isFinite(state.confidenceThreshold) ? state.confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD));
    return isFinite(metrics.confidence) && metrics.confidence >= threshold;
  }

  function shouldForceCall(st, metrics, currentTime) {
    // Force a call at or after the callDeadline if reporting is sufficient
    // and the visible leader matches the final winner. This helps ensure
    // the simulator will eventually call states even if confidence is
    // borderline.
    if (!metrics || metrics.leader == null) return false;
    if (metrics.reporting >= 1.0) {
      return metrics.leader === st.winner;
    }
    if (currentTime < st.callDeadline - EPS) return false;
    if (metrics.reporting < MIN_REPORTING_TO_CALL) return false;
    if (metrics.leader !== st.winner) return false;
    const threshold = Math.max(0, Math.min(1, isFinite(state.confidenceThreshold) ? state.confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD));
    return isFinite(metrics.confidence) && metrics.confidence >= threshold;
  }

  function registerCall(st, metrics, currentTime) {
    // Record a call for `st` at callTime and create a callRecord object
    // that will later be rendered in the call log. The call record stores
    // a snapshot of the observed metrics and the EV allocation used.
    if (!st || st.calledAt != null) return;
    const callTime = Math.max(currentTime, st.startTime);
    st.calledAt = callTime;
    st.calledMetrics = metrics ? { ...metrics } : null;
    const effectiveMarginStr = metrics
      ? metrics.countedMarginStr
      : '';
    const reporting = metrics ? metrics.reporting : 0;
    const confidence = metrics ? metrics.confidence : 1;
    const calledLeader = metrics ? metrics.leader : null;
    const thresholdUsed = Math.max(0, Math.min(1, isFinite(state.confidenceThreshold) ? state.confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD));
    st.callLeader = calledLeader;
    const callAllocation = buildCallAllocation(st, calledLeader);
    st.evCalledAllocations = { ...callAllocation };
    st.callRecord = {
      kind: 'call',
      unitKey: st.unitKey,
      displayLabel: formatUnitLabel(st.unitKey),
      time: callTime,
      leader: calledLeader,
      candidateName: resolveCandidateLastName(calledLeader, st.unitKey),
      actualWinner: st.winner,
      marginStr: effectiveMarginStr,
      reporting,
      ev: st.ev,
      evAllocations: callAllocation,
      // Starts equal to the call allocation (not the ground-truth final
      // one) so a fresh call never shows a premature "EV X → Y" arrow;
      // updateCallLog()'s per-frame refresh reveals the true allocation
      // only once this unit's count has actually finished (see there).
      finalAllocations: callAllocation ? { ...callAllocation } : null,
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

    // Record a log entry for this call event (bypasses interval check)
    recordCallLogEntry(callTime, st.unitKey, calledLeader);

    try {
      const unit = st && st.unitKey ? st.unitKey : null;
      const abbr = unit && unit.length >= 2 ? unit.slice(0, 2) : null;
      const entry = {
        time: st.callRecord.time,
        unit: st.unitKey,
        leader: st.callRecord.leader,
        actualWinner: st.callRecord.actualWinner,
        reporting: st.callRecord.reporting,
        confidence: st.callRecord.confidence,
        marginStr: st.callRecord.marginStr
      };
      // Pushed for every unit (not just ME/NE) so offline validation tooling
      // (docs/utils/electionNight/validateConfidence.mjs) can compute a
      // historical miscall rate against every call, not just ME/NE districts.
      if (window.ENABLE_EN_COLOR_CALL_LOG) {
        window._enCallLog = window._enCallLog || [];
        window._enCallLog.push(entry);
      }
      if (window.DEBUG_ELECTION_NIGHT && (abbr === 'ME' || abbr === 'NE')) console.log('[EN-CALL]', entry);
    } catch (e) { console.warn('EN call log failed', e); }
    triggerTipRefresh();
  }

  function flushSmallBoxes() {
    if (!state.boxesDirty || !state.unitColorMap || !state.abbrColorMap || !state.year) return;
    state.boxesDirty = false;
    if (typeof window.renderSmallStateBoxes === 'function') {
      window._lastUnitColors = state.unitColorMap;
      window._lastAbbrColors = state.abbrColorMap;
      try { window.renderSmallStateBoxes(state.year, state.abbrColorMap, state.unitColorMap); } catch (e) { }
    }
  }

  function updateSmallBoxes(st, color, metrics) {
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

  function updateEvDisplay(dEV, rEV, oEV, phantomDEV = 0, phantomREV = 0, phantomOEV = 0) {
    const totalPool = Math.max(1, state.totalEvPool || 538);
    const called = Math.max(0, dEV + rEV + oEV);
    const phantomTotal = Math.max(0, phantomDEV + phantomREV + phantomOEV);
    // Uncalled EVs exclude phantom EVs (states with reporting but not yet called)
    const uEV = Math.max(0, totalPool - called - phantomTotal);

    const dPct = (dEV / totalPool) * 100;
    const phantomDPct = (phantomDEV / totalPool) * 100;
    const uPct = (uEV / totalPool) * 100;
    const oPct = (oEV / totalPool) * 100;
    const phantomOPct = (phantomOEV / totalPool) * 100;
    const rPct = (rEV / totalPool) * 100;
    const phantomRPct = (phantomREV / totalPool) * 100;

    const dEl = document.getElementById('evFillD');
    const uEl = document.getElementById('evFillU');
    const oEl = document.getElementById('evFillO');
    const rEl = document.getElementById('evFillR');
    const txt = document.getElementById('evText');
    const parentBar = dEl ? dEl.parentElement : null;

    // Ensure the called R segment is right-anchored only when phantoms are present
    // so the phantom R segment appears immediately to its left (uncalled -> phantom R -> called R).
    // Remove the anchor when no phantoms exist to allow normal left-to-right layout.
    try {
      if (rEl && rEl.dataset) {
        const hasPhantoms = (phantomDEV > EPS || phantomREV > EPS || phantomOEV > EPS);
        if (hasPhantoms) {
          rEl.dataset.anchor = 'right';
        } else {
          delete rEl.dataset.anchor;
        }
      }
    } catch (e) { /* ignore */ }

    // Create or get phantom elements
    const getOrCreatePhantom = (id, baseColor, anchor) => {
      let el = document.getElementById(id);
      if (!el && parentBar) {
        el = document.createElement('div');
        el.id = id;
        el.style.position = 'absolute';
        el.style.top = '0';
        el.style.bottom = '0';
        el.style.background = baseColor;
        el.style.opacity = '0.35';
        el.style.pointerEvents = 'none';
        if (anchor === 'right') {
          el.dataset.anchor = 'right';
        }
        // Insert phantoms before evMid and evText for proper z-order
        const evMid = document.getElementById('evMid');
        if (evMid) {
          parentBar.insertBefore(el, evMid);
        } else {
          parentBar.appendChild(el);
        }
      }
      return el;
    };

    const phantomDEl = getOrCreatePhantom('evFillPhantomD', '#6a8fd9', 'left');
    const phantomOEl = getOrCreatePhantom('evFillPhantomO', '#d9c760', 'left');
    const phantomREl = getOrCreatePhantom('evFillPhantomR', '#d46a6a', 'right');

    // Build ordered segment list: called D, phantom D, uncalled U, phantom O, called O, phantom R, called R
    // Left side: D (called) -> phantomD -> U (part) -> phantomO -> O (called)
    // Right side: R (called) -> phantomR
    const segments = [
      { el: dEl, pct: dPct, value: dEV, code: 'D', side: 'left' },
      { el: phantomDEl, pct: phantomDPct, value: phantomDEV, code: 'UD', side: 'left', isPhantom: true },
      { el: uEl, pct: uPct, value: uEV, code: 'U', side: 'left' },
      { el: phantomOEl, pct: phantomOPct, value: phantomOEV, code: 'UO', side: 'left', isPhantom: true },
      { el: oEl, pct: oPct, value: oEV, code: 'O', side: 'left' },
      { el: rEl, pct: rPct, value: rEV, code: 'R', side: 'right' },
      { el: phantomREl, pct: phantomRPct, value: phantomREV, code: 'UR', side: 'right', isPhantom: true }
    ];

    const showLabelPct = 3;
    const readableTextColor = colorStr => {
      try {
        const test = document.createElement('div');
        test.style.color = colorStr || '#000';
        document.body.appendChild(test);
        const computed = getComputedStyle(test).color || 'rgb(0,0,0)';
        document.body.removeChild(test);
        const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return '#fff';
        const r = Number(m[1]);
        const g = Number(m[2]);
        const b = Number(m[3]);
        const lum = 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
        return lum > 0.55 ? '#000' : '#fff';
      } catch (e) {
        return '#fff';
      }
    };

    let leftOffset = 0;
    let rightOffset = 0;
    const leftActive = [];
    const rightActive = [];

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
        seg.centerPct = 0;
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
        const start = rightOffset;
        const center = 100 - start - (Math.max(0, seg.pct) / 2);
        seg.centerPct = Math.max(0, Math.min(100, center));
        seg.el.style.left = 'auto';
        seg.el.style.right = `${start.toFixed(3)}%`;
        seg.el.style.width = widthPct;
        rightOffset += Math.max(0, seg.pct);
        rightActive.push(seg.el);
      } else {
        const start = leftOffset;
        const center = start + (Math.max(0, seg.pct) / 2);
        seg.centerPct = Math.max(0, Math.min(100, center));
        seg.el.style.left = `${start.toFixed(3)}%`;
        seg.el.style.right = 'auto';
        seg.el.style.width = widthPct;
        leftOffset += Math.max(0, seg.pct);
        leftActive.push(seg.el);
      }
    });

    // Apply border radius to edge segments (skip phantom elements for radius)
    const leftNonPhantom = leftActive.filter(el => !el.id.includes('Phantom'));
    const rightNonPhantom = rightActive.filter(el => !el.id.includes('Phantom'));

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

    // Add labels to all segments (including phantom segments with UD/UO/UR codes)
    segments.forEach(seg => {
      if (!seg.el) return;
      const value = Number.isFinite(seg.value) ? seg.value : 0;
      const labelText = `${seg.code} ${value}`;
      let lbl = seg.el.querySelector('.ev-seg-label');
      if (!lbl) {
        try {
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
        } catch (e) {
          lbl = null;
        }
      }
      if (lbl) {
        if (seg.pct >= showLabelPct) {
          lbl.textContent = labelText;
          try {
            const bg = seg.el.style.backgroundColor || getComputedStyle(seg.el).backgroundColor || '#000';
            lbl.style.color = readableTextColor(bg);
          } catch (e) { }
          lbl.style.display = '';
        } else {
          lbl.style.display = 'none';
        }
      }

      if (!parentBar) return;
      let floatLbl = parentBar.querySelector(`.ev-global-label[data-code="${seg.code}"]`);
      if (!floatLbl && seg.pct < showLabelPct) {
        try {
          floatLbl = document.createElement('div');
          floatLbl.className = 'ev-global-label';
          floatLbl.setAttribute('data-code', seg.code);
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
        } catch (e) { floatLbl = null; }
      }
      if (floatLbl) {
        if (seg.pct < showLabelPct && seg.value > EPS) {
          floatLbl.textContent = labelText;
          floatLbl.style.left = `${(seg.centerPct || 0).toFixed(3)}%`;
          try { floatLbl.style.display = 'block'; } catch (e) { floatLbl.style.display = ''; }
        } else {
          try { floatLbl.style.display = 'none'; } catch (e) { floatLbl.style.display = ''; }
        }
      }
    });

    if (txt) {
      // Include phantom EVs in the display text for context
      const totalUncalled = uEV + phantomDEV + phantomREV + phantomOEV;
      const parts = [`D ${dEV}`];
      if (phantomDEV > 0) parts[0] += ` (+${phantomDEV})`;
      if (totalUncalled > 0) parts.push(`U ${totalUncalled}`);
      if (oEV > 0 || phantomOEV > 0) {
        let oPart = `O ${oEV}`;
        if (phantomOEV > 0) oPart += ` (+${phantomOEV})`;
        parts.push(oPart);
      }
      let rPart = `R ${rEV}`;
      if (phantomREV > 0) rPart += ` (+${phantomREV})`;
      parts.push(rPart);
      txt.textContent = (totalUncalled > 0 || oEV > 0 || phantomOEV > 0)
        ? parts.join(' | ')
        : `${dEV}${phantomDEV > 0 ? ` (+${phantomDEV})` : ''} - ${rEV}${phantomREV > 0 ? ` (+${phantomREV})` : ''}`;
    }
  }

  function updatePopularVoteDisplay(dVotes, rVotes, oVotes, counted) {
    if (!state.prepared) return;
    const fmt = x => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '0';
    const pvDem = document.getElementById('pvDem');
    const pvRep = document.getElementById('pvRep');
    const pvOth = document.getElementById('pvOth');
    const pvTot = document.getElementById('pvTot');
    const pvMargin = document.getElementById('pvMargin');
    const pvDemPct = document.getElementById('pvDemPct');
    const pvRepPct = document.getElementById('pvRepPct');
    const pvOthPct = document.getElementById('pvOthPct');
    if (pvDem) pvDem.textContent = fmt(dVotes);
    if (pvRep) pvRep.textContent = fmt(rVotes);
    if (pvOth) pvOth.textContent = fmt(oVotes);
    if (pvTot) pvTot.textContent = fmt(counted);

    // Add percentages
    if (counted > 0) {
      const dPct = (dVotes / counted * 100).toFixed(1);
      const rPct = (rVotes / counted * 100).toFixed(1);
      const oPct = (oVotes / counted * 100).toFixed(1);
      if (pvDemPct) pvDemPct.textContent = `(${dPct}%)`;
      if (pvRepPct) pvRepPct.textContent = `(${rPct}%)`;
      if (pvOthPct) pvOthPct.textContent = `(${oPct}%)`;
    } else {
      if (pvDemPct) pvDemPct.textContent = '';
      if (pvRepPct) pvRepPct.textContent = '';
      if (pvOthPct) pvOthPct.textContent = '';
    }

    // Add margin
    if (pvMargin) {
      const margin = dVotes - rVotes;
      if (Math.abs(margin) < 0.5) {
        pvMargin.textContent = 'EVEN';
      } else if (margin > 0) {
        const pctDiff = counted > 0 ? Math.abs((dVotes / counted - rVotes / counted) * 100).toFixed(1) : '0.0';
        pvMargin.innerHTML = 'D+' + fmt(Math.abs(margin)) + '<span class="delta" style="margin-left:4px">(' + pctDiff + '%)</span>';
      } else {
        const pctDiff = counted > 0 ? Math.abs((dVotes / counted - rVotes / counted) * 100).toFixed(1) : '0.0';
        pvMargin.innerHTML = 'R+' + fmt(Math.abs(margin)) + '<span class="delta" style="margin-left:4px">(' + pctDiff + '%)</span>';
      }
    }

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

  function updateProgressSlider(timeMinutes) {
    if (!elements.progress) return;
    const value = (timeMinutes - state.simStart) / (state.simEnd - state.simStart);
    state.suppressProgressEvent = true;
    elements.progress.value = String(Math.max(0, Math.min(1, value)));
    state.suppressProgressEvent = false;
  }

  function getConfidenceSliderValue() {
    if (!elements.confidence) return Math.max(0, Math.min(1, isFinite(state.confidenceThreshold) ? state.confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD));
    const raw = parseFloat(elements.confidence.value);
    if (!isFinite(raw)) return Math.max(0, Math.min(1, isFinite(state.confidenceThreshold) ? state.confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD));
    return Math.max(0, Math.min(1, raw));
  }

  function updateConfidenceLabel(val) {
    const target = Math.max(0, Math.min(1, isFinite(val) ? val : getConfidenceSliderValue()));
    if (elements.confidenceVal) {
      elements.confidenceVal.textContent = target.toFixed(2);
    }
  }

  // Builds one "still counting" card (used for both state races and the
  // NPV sub-section below them) — shared so both stay in sync visually.
  function buildUncalledCardElement(candidate, threshold, options) {
    const suppressPulse = !!(options && options.suppressPulse);
    const card = document.createElement('div');
    card.className = 'en-log-uncalled-card';
    const label = candidate.ev > 0
      ? `${candidate.displayLabel} (${candidate.ev} EV)`
      : candidate.displayLabel;
    // Leader is conveyed by the card's accent color/glow (below) rather
    // than a "D/R lead" text line.
    const infoParts = [];
    const marginDisplay = formatMarginText(candidate.marginStr, candidate.leader, candidate.voteMargin);
    if (marginDisplay && marginDisplay !== 'None') {
      infoParts.push(marginDisplay === 'EVEN' ? 'EVEN' : `Margin ${marginDisplay}`);
    }
    infoParts.push(formatConfidenceText(candidate.confidence));
    // Per-state win% (candidate.winProb, from the swing-aware MC's
    // stateProb) is deliberately NOT shown here - it inherits certainty
    // from OTHER states' trends (that's the whole point of the swing
    // mechanism), which reads as "cartoonishly accurate" on a card for a
    // state whose own count is still a toss-up. Confidence already tells
    // that story ("this specific race is too close to call") without the
    // spoiler. winProb/stateProb are kept and still used elsewhere (the
    // downloadable log timeline, debug instrumentation).
    // Use shared formatter so votes-left is shown when available
    try {
      const repText = formatReportingText(candidate.reporting, candidate.remainingVotes);
      infoParts.push(repText);
    } catch (e) {
      infoParts.push(`${((candidate.reporting || 0) * 100).toFixed(1)}% reporting`);
    }
    card.textContent = `${label} – ${infoParts.join(' · ')}`;

    const accentColor = confidenceAccentColor(candidate.leader, candidate.margin, candidate.confidence, threshold);
    card.style.borderLeftColor = accentColor;
    const [ar, ag, ab] = hexToRgb(accentColor);
    const closeness = threshold > EPS ? Math.min(1, (candidate.confidence || 0) / threshold) : 0;
    card.style.background = `rgba(${ar}, ${ag}, ${ab}, ${(0.05 + closeness * 0.16).toFixed(3)})`;
    if (closeness >= 0.85 && !suppressPulse) {
      card.classList.add('en-log-hot');
      card.style.setProperty('--en-pulse-color', `rgba(${ar}, ${ag}, ${ab}, 0.55)`);
    }
    return card;
  }

  function updateCallLog(currentTime) {
    const timeLabel = formatTimeLabel(currentTime);
    if (elements.logHeaderText) elements.logHeaderText.textContent = `Call log ${timeLabel} ET`;
    if (!elements.log && !elements.logUncalled && !elements.victory) return;

    const readyEvents = state.callRecords
      .filter(rec => rec && currentTime >= rec.time - EPS)
      .slice()
      .sort((a, b) => {
        if (Math.abs(a.time - b.time) > EPS) return a.time - b.time;
        const orderMap = { call: 0, npv_call: 1, notice: 2, outcome: 3 };
        const orderA = orderMap[(a && a.kind) ? a.kind : 'call'] ?? 3;
        const orderB = orderMap[(b && b.kind) ? b.kind : 'call'] ?? 3;
        if (orderA !== orderB) return orderA - orderB;
        return (a.unitKey || '').localeCompare(b.unitKey || '');
      });

    const uncalledCandidates = (state.stateData || [])
      .filter(st => st && st.calledAt == null && st.latestMetrics && st.latestMetrics.reporting > EPS)
      .map(st => {
        const metrics = st.latestMetrics;
        // extract a numeric margin for scoring; prefer countedMargin, fall back to margin
        const rawMargin = isFinite(metrics.countedMargin) ? metrics.countedMargin : (isFinite(metrics.margin) ? metrics.margin : 0);
        return {
          unitKey: st.unitKey,
          displayLabel: formatUnitLabel(st.unitKey),
          confidence: isFinite(metrics.confidence) ? metrics.confidence : 0,
          reporting: isFinite(metrics.reporting) ? metrics.reporting : 0,
          remainingVotes: isFinite(metrics.remainingVotes) ? Math.max(0, Math.round(metrics.remainingVotes)) : null,
          leader: metrics.leader,
          margin: rawMargin,
          marginStr: metrics.countedMarginStr,
          voteMargin: (isFinite(metrics.dVotesCounted) && isFinite(metrics.rVotesCounted))
            ? Math.round(metrics.dVotesCounted - metrics.rVotesCounted)
            : null,
          ev: isFinite(st.ev) ? st.ev : 0,
          winProb: (() => {
            if (st.thirdPartyDominant) return null;
            // Prefer the Monte Carlo's own per-unit tally when available -
            // it reflects the shared swing signal (e.g. a Rust Belt state
            // trending R because its neighbors are), not just this unit's
            // own reported votes. Falls back to the simpler posterior-only
            // estimate before the first MC run, or for a called unit (the
            // MC only tallies live units).
            const mcProb = state.nationalWinProb && state.nationalWinProb.stateProb
              ? state.nationalWinProb.stateProb.get(st.unitKey) : null;
            if (isFinite(mcProb)) return mcProb;
            const post = state.unitPosteriors ? state.unitPosteriors.get(st.unitKey) : null;
            return post ? winProbFromPosterior(post.margin, post.sigma) : null;
          })()
        };
      })
      .sort((a, b) => {
        // scoring formula: ev / ((|CONF_THRESHOLD - confidence| + EPS) * (|margin| + EPS))
        const threshold = Math.max(0, Math.min(1, isFinite(state.confidenceThreshold) ? state.confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD));
        const score = x => {
          const conf = (x && isFinite(x.confidence)) ? x.confidence : 0;
          const margin = (x && isFinite(x.margin)) ? Math.abs(x.margin) : 0;
          const denom = (Math.abs(threshold - conf) + EPS) * (margin + EPS);
          return isFinite(x.ev) && x.ev > 0 && denom > 0 ? x.ev / denom : 0;
        };
        const sa = score(a);
        const sb = score(b);
        if (Math.abs(sb - sa) > EPS) return sb - sa;
        // tie-breaker: higher reporting first
        const repDiff = (b.reporting || 0) - (a.reporting || 0);
        if (Math.abs(repDiff) > EPS) return repDiff;
        // final tie-breaker: higher confidence
        const confDiff = (b.confidence || 0) - (a.confidence || 0);
        if (Math.abs(confDiff) > EPS) return confDiff;
        return (a.displayLabel || '').localeCompare(b.displayLabel || '');
      });

    // National popular vote has no EV weight to score against the state
    // races above, so it gets its own small dedicated card rather than
    // being forced into that scoring. Unlike a state, it stays visible
    // here for the whole night (before AND after it's called) — it's
    // meant as an ongoing watch item, not something that disappears once
    // decided, since the underlying count keeps moving regardless.
    let npvWatchCandidate = null;
    if (state.lastNationalTotals && state.totalEligibleVotes > EPS) {
      const { dCounted, rCounted, oCounted, countedVotes } = state.lastNationalTotals;
      if (countedVotes > EPS) {
        const leader = nationalLeader(dCounted, rCounted, oCounted);
        const margin = countedVotes > EPS ? (dCounted - rCounted) / countedVotes : 0;
        npvWatchCandidate = {
          isNpv: true,
          isCalled: !!state.npvCallRecord,
          unitKey: 'NPV',
          displayLabel: 'National Popular Vote',
          confidence: (() => {
            const c = calculateNationalConfidence(dCounted, rCounted, oCounted, countedVotes);
            return isFinite(c) ? c : 0;
          })(),
          reporting: countedVotes / state.totalEligibleVotes,
          remainingVotes: Math.max(0, Math.round(state.totalEligibleVotes - countedVotes)),
          leader,
          margin,
          marginStr: leader === 'O' ? 'Other lead' : formatLean(margin),
          voteMargin: Math.round(dCounted - rCounted),
          ev: 0
        };
      }
    }

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
        if (live.evCalledAllocations) record.evAllocations = { ...live.evCalledAllocations };
        // st.evAllocations is a static, ground-truth allocation (the true
        // final winner's split, computed once in buildStateData) - only
        // reveal it once this unit's own count has effectively finished,
        // the same moment maybeEmitMiscall() would log a correction notice.
        // Otherwise a call that later turns out wrong shows the "EV R 6 →
        // D 6" arrow the instant it's called, spoiling the outcome before
        // anything has actually been corrected on-screen.
        if (live.reporting >= 1 - EPS && live.evAllocations) {
          record.finalAllocations = { ...live.evAllocations };
        } else if (record.evAllocations) {
          record.finalAllocations = { ...record.evAllocations };
        }
      }
      const tallyWinner = record.actualWinner || record.leader;
      if (tallyWinner === 'D') dRunning += record.ev || 0;
      else if (tallyWinner === 'R') rRunning += record.ev || 0;
      else oRunning += record.ev || 0;
      if (!outcome) {
        if (dRunning >= majority) outcome = { type: 'D', time: record.time, total: dRunning };
        else if (rRunning >= majority) outcome = { type: 'R', time: record.time, total: rRunning };
      }
      const leaderText = record.candidateName || formatLeader(record.leader);
      const reportingText = formatReportingText(record.reporting, record.remainingVotes);
      const callVoteMargin = (isFinite(record.dVotes) && isFinite(record.rVotes)) ? (record.dVotes - record.rVotes) : null;
      const marginText = formatMarginText(record.marginStr, record.leader, callVoteMargin);
      const confidenceText = formatConfidenceText(record.confidence);
      const evText = formatEvAllocationsForLog(record.evAllocations, record.finalAllocations);
      const infoParts = [reportingText, marginText, confidenceText];
      if (evText) infoParts.push(evText);
      const infoJoined = infoParts.filter(Boolean).join(', ');
      const evSigCall = record.evAllocations ? `${record.evAllocations.D || 0}-${record.evAllocations.R || 0}-${record.evAllocations.O || 0}` : 'na';
      const evSigFinal = record.finalAllocations ? `${record.finalAllocations.D || 0}-${record.finalAllocations.R || 0}-${record.finalAllocations.O || 0}` : 'na';
      const callNumericMargin = (isFinite(record.dVotes) && isFinite(record.rVotes) && record.countedVotes > EPS)
        ? (record.dVotes - record.rVotes) / record.countedVotes
        : 0;
      const callLine = {
        kind: 'call',
        time: record.time,
        className: 'en-log-entry en-log-called',
        text: `${formatTimeLabel(record.time)} – Called ${record.displayLabel} for ${leaderText} (${infoJoined})`,
        signature: `call:${record.unitKey}:${(isFinite(record.confidence) ? record.confidence : -1).toFixed(3)}:${(isFinite(record.reporting) ? record.reporting : -1).toFixed(3)}:${record.marginStr || ''}:${evSigCall}:${evSigFinal}`,
        accentColor: calledAccentColor(record.leader, callNumericMargin)
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
      const winnerName = outcome.type !== 'T' ? resolveCandidateLastName(outcome.type, 'NATIONAL') : null;
      if (outcome.type === 'D') {
        const latestTotal = finalD;
        outcome.total = latestTotal;
        outcomeMessage = winnerName
          ? `${winnerName} clinches the presidency with ${latestTotal} EV (needed ${majority}).`
          : `Democrats clinch the presidency with ${latestTotal} EV (needed ${majority}).`;
        outcomeClass = ' win-dem';
      } else if (outcome.type === 'R') {
        const latestTotal = finalR;
        outcome.total = latestTotal;
        outcomeMessage = winnerName
          ? `${winnerName} clinches the presidency with ${latestTotal} EV (needed ${majority}).`
          : `Republicans clinch the presidency with ${latestTotal} EV (needed ${majority}).`;
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

    const npvLines = readyEvents
      .filter(rec => rec.kind === 'npv_call')
      .map(record => {
        // Keep the call-log line live after the call, same as state calls
        // refresh from state.snapshot — the underlying national count
        // keeps moving even once a leader has been called. The called
        // `leader` itself is a committed historical fact and stays fixed;
        // only the numeric vote/confidence/reporting readout refreshes.
        if (state.lastNationalTotals) {
          const { dCounted, rCounted, oCounted, countedVotes } = state.lastNationalTotals;
          record.dVotes = dCounted;
          record.rVotes = rCounted;
          record.oVotes = oCounted;
          record.countedVotes = countedVotes;
          if (state.totalEligibleVotes > EPS) record.reporting = countedVotes / state.totalEligibleVotes;
          const liveConfidence = calculateNationalConfidence(dCounted, rCounted, oCounted, countedVotes);
          if (isFinite(liveConfidence)) record.confidence = liveConfidence;
        }
        const text = formatNpvCallText(record);
        const npvNumericMargin = (isFinite(record.dVotes) && isFinite(record.rVotes) && record.countedVotes > EPS)
          ? (record.dVotes - record.rVotes) / record.countedVotes
          : 0;
        return {
          kind: 'npv_call',
          time: record.time,
          className: 'en-log-entry en-log-npv en-log-called',
          text,
          signature: `npv_call:${record.leader}:${(isFinite(record.confidence) ? record.confidence : -1).toFixed(3)}:${(isFinite(record.reporting) ? record.reporting : -1).toFixed(3)}`,
          accentColor: calledAccentColor(record.leader, npvNumericMargin)
        };
      });
    npvLines.forEach(line => signatureParts.push(line.signature));

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

    let renderLines = [...callLines, ...npvLines, ...noticeLines];
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
    if (npvWatchCandidate) {
      const confVal = isFinite(npvWatchCandidate.confidence) ? npvWatchCandidate.confidence : -1;
      const repVal = isFinite(npvWatchCandidate.reporting) ? npvWatchCandidate.reporting : -1;
      uncalledSignatureParts.unshift(`NPV:${confVal.toFixed(3)}:${repVal.toFixed(3)}:${npvWatchCandidate.isCalled ? 1 : 0}`);
    }
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
            if (lineInfo.accentColor) {
              line.style.borderLeftColor = lineInfo.accentColor;
              const [r, g, b] = hexToRgb(lineInfo.accentColor);
              line.style.background = `rgba(${r}, ${g}, ${b}, 0.1)`;
            }
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
        const threshold = Math.max(0, Math.min(1, isFinite(state.confidenceThreshold) ? state.confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD));
        if (uncalledCandidates.length) {
          const title = document.createElement('div');
          title.className = 'en-log-section-title';
          title.textContent = 'STILL COUNTING (UNCALLED)';
          container.appendChild(title);
          const cardsContainer = document.createElement('div');
          cardsContainer.className = 'en-log-uncalled-cards';
          uncalledCandidates.forEach(candidate => {
            cardsContainer.appendChild(buildUncalledCardElement(candidate, threshold));
          });
          container.appendChild(cardsContainer);
        }
        // NPV gets its own small, quieter sub-section below the state
        // races rather than competing for attention at the top of the
        // list — it's a "glance at it occasionally" signal, not a race.
        // Unlike the state cards above, it stays here all night (before
        // and after being called) as an ongoing watch item, since the
        // underlying national count keeps moving either way.
        if (npvWatchCandidate) {
          const npvTitle = document.createElement('div');
          npvTitle.className = 'en-log-section-title en-log-section-title-sub';
          npvTitle.textContent = npvWatchCandidate.isCalled ? 'National popular vote (called)' : 'National popular vote';
          container.appendChild(npvTitle);
          const npvContainer = document.createElement('div');
          npvContainer.className = 'en-log-uncalled-cards';
          const npvCard = buildUncalledCardElement(npvWatchCandidate, threshold, { suppressPulse: npvWatchCandidate.isCalled });
          npvCard.classList.add('en-log-npv-strip');
          npvContainer.appendChild(npvCard);
          container.appendChild(npvContainer);
        }
      }
    }
  }

  function triggerTipRefresh() {
    if (typeof window === 'undefined' || typeof window.refreshActiveMapTip !== 'function') return;
    const runner = () => {
      try { window.refreshActiveMapTip(); } catch (e) { }
    };
    try {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => runner());
      } else if (typeof window.setTimeout === 'function') {
        window.setTimeout(runner, 0);
      } else {
        runner();
      }
    } catch (e) {
      runner();
    }
  }

  function resolvePvValue() {
    const mode = state.pvMode || 'current';
    const current = getCurrentPv();
    if (mode === 'current') {
      state.pvRandomCache = null;
      state.pvRandomCacheMode = null;
      state.pvRandomCacheYear = null;
      state.pvRandomSeed = null;
      return current;
    }

    const year = getSelectedYear() || 0;
    if (state.pvRandomCache != null && state.pvRandomCacheMode === mode && state.pvRandomCacheYear === year) {
      window._pvOverride = state.pvRandomCache;
      return state.pvRandomCache;
    }

    if (state.pvRandomSeed == null) {
      const baseSeed = Date.now() >>> 0;
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
    state.pvRandomCacheYear = year;
    window._pvOverride = sample;
    return sample;
  }

  function applyColor(st, color, metrics) {
    try {
      // Log ME/NE coloring for debugging
      const unit = st && st.unitKey ? st.unitKey : null;
      const abbr = unit && unit.length >= 2 ? unit.slice(0, 2) : null;
      if (abbr === 'ME' || abbr === 'NE') {
        try {
          const entry = {
            time: state.currentTime,
            unit: unit,
            abbr: abbr,
            color: color,
            reporting: metrics && metrics.reporting,
            leader: metrics && metrics.leader,
            margin: metrics && metrics.countedMargin,
            colorMargin: metrics && metrics.colorMargin
          };
          if (typeof window !== 'undefined') {
            if (window.ENABLE_EN_COLOR_CALL_LOG) {
              window._enColorLog = window._enColorLog || [];
              window._enColorLog.push(entry);
            }
            if (window.DEBUG_ELECTION_NIGHT) console.log('[EN-COLOR]', entry);
          }
        } catch (e) { console.warn('EN color log failed', e); }
      }
    } catch (e) { }
    st.pathSelections.forEach(sel => {
      if (!sel) return;
      try { sel.attr('fill', color); }
      catch (e) { try { sel.style('fill', color); } catch (err) { } }
    });
    updateSmallBoxes(st, color, metrics);
  }

  function collectPathSelections(unit, abbr) {
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

  function selectStatePath(abbr) {
    if (!window.d3) return null;
    const sel = d3.select(`#state-${abbr}`);
    return sel && !sel.empty() ? sel : null;
  }

  function selectDistrictPath(unit) {
    if (window._districtPaths && typeof window._districtPaths.get === 'function') {
      return window._districtPaths.get(unit) || null;
    }
    return null;
  }

  function createBiasParams(unit, margin, closeness, rng) {
    const rand = rng || Math.random;
    const mailHeavy = MAIL_HEAVY_STATES.has(unit.slice(0, 2));
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

  function logisticBias(params, reporting, phaseName) {
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

  function computeReportingFraction(st, timeMinutes) {
    if (st.instantCall) {
      if (timeMinutes <= st.startTime) return 0;
      return 1;
    }
    if (!isFinite(timeMinutes)) return 0;
    if (timeMinutes <= st.startTime) return 0;
    // Count at a constant rate between startTime and startTime+duration.
    // The schedule generation is no longer used for display; instead
    // the unit progresses linearly from 0 -> 1 over `st.duration`.
    if (!isFinite(st.duration) || st.duration <= 0) return 1;
    if (timeMinutes >= st.startTime + st.duration) return 1;
    let normalized = (timeMinutes - st.startTime) / st.duration;
    normalized = clamp01(normalized);
    // Apply ease-out so counting slows near the end: easeOut(n) = 1 - (1 - n)^power
    const power = (st && isFinite(st.easePower)) ? Math.max(1, st.easePower) : 2.0;
    const eased = 1 - Math.pow(1 - normalized, power);
    // Apply tiny deterministic jitter that vanishes at 0 and 1: jitter * n * (1-n).
    // The extra (1-n)^2 taper keeps it from fighting the eased curve's own
    // slope right at the tail - without it, a positive jitterParam could
    // make the combined curve dip just before the boundary (reporting
    // briefly going backwards) once the old hard clamp (removed above) was
    // no longer there to mask it.
    const jitterParam = (st && isFinite(st.reportJitter)) ? st.reportJitter : 0;
    const jitterTerm = jitterParam * normalized * Math.pow(1 - normalized, 3);
    // Scale into [0, CAP_BEFORE_END] instead of clamping there: eased can
    // saturate near 1 well before normalized does (steepest for close
    // races, where easePower runs highest), and a hard clamp at that point
    // used to freeze the displayed count at an identical value for a long
    // real-time stretch, then snap straight to 1 at the very end - the
    // "freeze then jump" bug. Scaling keeps it creeping continuously all
    // the way to the boundary, where the final `timeMinutes >= ...` check
    // above still resolves it to exactly 1.
    const CAP_BEFORE_END = 0.999;
    return clamp01(CAP_BEFORE_END * (eased + jitterTerm));
  }

  function updateToggleLabel() {
    if (!elements.toggle) return;
    if (state.running) elements.toggle.textContent = 'Pause';
    else if (!state.prepared) elements.toggle.textContent = 'Start';
    else if (state.currentTime >= state.simEnd - EPS) elements.toggle.textContent = 'Replay';
    else elements.toggle.textContent = 'Resume';
  }

  function determineWinner(dShare, rShare, oShare) {
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

  // Determine visible leader. Prefer vote counts when available (stats object with dCounted/rCounted/oCounted/countedVotes)
  function determineLeader(dShare, rShare, oShare, reporting, stats) {
    if (reporting <= 0) return null;
    // If stats with counted votes are provided and there are counted votes, use them
    if (stats && isFinite(stats.countedVotes) && stats.countedVotes > EPS) {
      const dVotes = isFinite(stats.dCounted) ? stats.dCounted : (isFinite(stats.dVotes) ? stats.dVotes : (isFinite(stats.d) ? stats.d : 0));
      const rVotes = isFinite(stats.rCounted) ? stats.rCounted : (isFinite(stats.rVotes) ? stats.rVotes : (isFinite(stats.r) ? stats.r : 0));
      // oCounted may be named oCounted or oTotalCounted or oVotes; prefer in that order
      const oVotes = isFinite(stats.oCounted) ? stats.oCounted : (isFinite(stats.oTotalCounted) ? stats.oTotalCounted : (isFinite(stats.oVotes) ? stats.oVotes : 0));
      if (dVotes >= rVotes && dVotes >= oVotes) return 'D';
      if (rVotes >= dVotes && rVotes >= oVotes) return 'R';
      return 'O';
    }

    // Fall back to share-based decision if no vote totals available
    if (dShare >= rShare && dShare >= oShare) return 'D';
    if (rShare >= dShare && rShare >= oShare) return 'R';
    return 'O';
  }

  function formatLeader(code) {
    if (code === 'D') return 'Democrats';
    if (code === 'R') return 'Republicans';
    if (code === 'O') return 'Other';
    console.warn('Unknown leader code', code);
    return 'No call';
  }
  // format helper functions moved to ./utils/formatters.js

  function getCurrentPv() {
    if (typeof window._pvOverride === 'number' && isFinite(window._pvOverride)) return window._pvOverride;
    return (typeof window._curPv === 'number' && isFinite(window._curPv)) ? window._curPv : 0;
  }

  function getSelectedYear() {
    const slider = document.getElementById('yearSlider');
    return slider ? parseInt(slider.value, 10) : 2024;
  }

  function getPvSliderValue() {
    const slider = document.getElementById('pvSlider');
    return slider ? slider.value : null;
  }

  function getStateStartTime(abbr) {
    for (const [timeStr, arr] of Object.entries(POLL_CLOSINGS)) {
      if (arr.includes(abbr)) return toMinutesWithOffset(timeStr);
    }
    return toMinutesWithOffset('19:00');
  }

  function getPhase(minutes) {
    if (!PHASES.length) return null;
    if (minutes < PHASES[0].start) return PHASES[0];
    for (const phase of PHASES) {
      if (minutes >= phase.start && minutes < phase.end) return phase;
    }
    return PHASES[PHASES.length - 1];
  }

  function toMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  function toMinutesWithOffset(timeStr) {
    return toMinutes(timeStr) + TIME_OFFSET_MIN;
  }

  function formatTimeLabel(minutes) {
    const dayMinutes = 24 * 60;
    const minuteOfDay = ((minutes % dayMinutes) + dayMinutes) % dayMinutes;
    const hours = Math.floor(minuteOfDay / 60);
    const mins = Math.floor(minuteOfDay % 60);
    const h12 = ((hours + 11) % 12) + 1;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    return `${h12}:${mins.toString().padStart(2, '0')} ${ampm}`;
  }

  function getEv(year, unit) {
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

  function determineEvPool(year, data) {
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
  // color helpers moved to ./utils/colorUtils.js

  /**
   * Collect a log entry capturing the current state of all units.
   * @param {number} timeMinutes - Current simulation time in minutes
   * @param {string|null} eventType - Optional event type ('call', 'interval', etc.)
   * @param {object|null} eventData - Optional data about a specific event (e.g., which state was called)
   * @returns {object} Log entry object
   */
  function collectLogEntry(timeMinutes, eventType = 'interval', eventData = null) {
    const units = [];
    let totalDEV = 0, totalREV = 0, totalOEV = 0;
    let phantomDEV = 0, phantomREV = 0, phantomOEV = 0;
    let totalDVotes = 0, totalRVotes = 0, totalOVotes = 0, totalCounted = 0;

    state.stateData.forEach(st => {
      const snap = state.snapshot.get(st.unitKey);
      if (!snap) return;

      const isCalled = st.calledAt != null && timeMinutes >= st.calledAt - EPS;
      const evAlloc = isCalled ? (st.evCalledAllocations || st.evAllocations) : null;

      if (evAlloc) {
        totalDEV += evAlloc.D || 0;
        totalREV += evAlloc.R || 0;
        totalOEV += evAlloc.O || 0;
      } else if (!isCalled && snap.reporting > EPS && st.ev > 0) {
        if (snap.leader === 'D') phantomDEV += st.ev;
        else if (snap.leader === 'R') phantomREV += st.ev;
        else if (snap.leader === 'O') phantomOEV += st.ev;
      }

      if (st.pvWeight) {
        totalDVotes += snap.dVotes || 0;
        totalRVotes += snap.rVotes || 0;
        totalOVotes += snap.oVotes || 0;
        totalCounted += snap.countedVotes || 0;
      }

      units.push({
        unit: st.unitKey,
        abbr: st.abbr,
        ev: st.ev,
        reporting: snap.reporting,
        reportingPct: (snap.reporting * 100).toFixed(2) + '%',
        leader: snap.leader,
        called: isCalled,
        calledFor: isCalled ? (st.callLeader || snap.leader) : null,
        margin: snap.margin,
        marginStr: snap.marginStr,
        confidence: snap.confidence,
        dVotes: Math.round(snap.dVotes || 0),
        rVotes: Math.round(snap.rVotes || 0),
        oVotes: Math.round(snap.oVotes || 0),
        countedVotes: Math.round(snap.countedVotes || 0),
        remainingVotes: Math.round(snap.remainingVotes || 0),
        evAllocD: evAlloc ? (evAlloc.D || 0) : 0,
        evAllocR: evAlloc ? (evAlloc.R || 0) : 0,
        evAllocO: evAlloc ? (evAlloc.O || 0) : 0
      });
    });

    // Sort units alphabetically by unitKey for consistent ordering
    units.sort((a, b) => a.unit.localeCompare(b.unit));

    return {
      time: timeMinutes,
      timeLabel: formatTimeLabel(timeMinutes),
      eventType,
      eventData,
      summary: {
        calledDEV: totalDEV,
        calledREV: totalREV,
        calledOEV: totalOEV,
        phantomDEV,
        phantomREV,
        phantomOEV,
        totalDVotes: Math.round(totalDVotes),
        totalRVotes: Math.round(totalRVotes),
        totalOVotes: Math.round(totalOVotes),
        totalCounted: Math.round(totalCounted),
        pvMargin: totalCounted > 0 ? ((totalDVotes - totalRVotes) / totalCounted) : 0,
        npvCalledFor: state.npvCallRecord ? state.npvCallRecord.leader : null,
        npvCalledAtMinutes: state.npvCallRecord ? state.npvCallRecord.time : null,
        npvConfidence: state.npvCallRecord ? state.npvCallRecord.confidence : null,
        // Live swing hierarchy (docs/utils/electionNight/liveSwing.js) at
        // this checkpoint - a scrubbable timeline of when the model's own
        // honest signal noticed a national/regional swing away from the
        // priors, useful for reviewing how a given night unfolded.
        swingNational: state.swingEstimate ? state.swingEstimate.national.mean : null,
        swingNationalSigma: state.swingEstimate ? state.swingEstimate.national.sigma : null,
        swingRegions: state.swingEstimate
          ? Object.fromEntries(Array.from(state.swingEstimate.regions.entries())
            .map(([region, r]) => [region, { mean: r.mean, sigma: r.sigma, nObs: r.nObs }]))
          : {}
      },
      units
    };
  }

  /**
   * Check if a log entry should be recorded at the current time.
   * Records at interval boundaries and ensures we don't duplicate entries.
   */
  function shouldRecordLogEntry(timeMinutes) {
    if (!state.prepared) return false;
    if (state.logEntries.length === 0) return true; // Always record first entry
    const interval = state.logInterval || 5;
    // Record if we've crossed an interval boundary
    return timeMinutes >= state.lastLogTime + interval - EPS;
  }

  /**
   * Record a log entry if conditions are met.
   * @param {number} timeMinutes - Current simulation time
   * @param {string} eventType - 'interval' or 'call'
   * @param {object|null} eventData - Optional event-specific data
   */
  function maybeRecordLogEntry(timeMinutes, eventType = 'interval', eventData = null) {
    if (eventType === 'interval' && !shouldRecordLogEntry(timeMinutes)) return;
    const entry = collectLogEntry(timeMinutes, eventType, eventData);
    state.logEntries.push(entry);
    state.lastLogTime = timeMinutes;
    updateDownloadButtons();
  }

  /**
   * Force record a call event log entry (bypasses interval check).
   */
  function recordCallLogEntry(timeMinutes, unitKey, leader) {
    const entry = collectLogEntry(timeMinutes, 'call', { unitKey, leader });
    state.logEntries.push(entry);
    // Don't update lastLogTime so interval entries still work correctly
    updateDownloadButtons();
  }

  /**
   * Force record a national popular vote call event log entry (bypasses interval check).
   */
  function recordNpvCallLogEntry(timeMinutes, leader) {
    const entry = collectLogEntry(timeMinutes, 'npv_call', { leader });
    state.logEntries.push(entry);
    updateDownloadButtons();
  }

  /**
   * Enable/disable download buttons based on whether we have log entries.
   */
  function updateDownloadButtons() {
    const hasEntries = state.logEntries.length > 0;
    if (elements.downloadTxt) elements.downloadTxt.disabled = !hasEntries;
    if (elements.downloadCsv) elements.downloadCsv.disabled = !hasEntries;
  }

  /**
   * Format log entries as a human-readable text file.
   */
  function formatLogAsTxt() {
    const lines = [];
    const year = state.year || getSelectedYear() || 'Unknown';
    const pvLabel = state.targetPvLabel || 'Unknown';

    lines.push('='.repeat(80));
    lines.push('ELECTION NIGHT SIMULATION LOG');
    lines.push('='.repeat(80));
    lines.push(`Year: ${year}`);
    lines.push(`Target PV: ${pvLabel}`);
    lines.push(`Log Interval: ${state.logInterval} minutes`);
    lines.push(`Confidence Threshold: ${state.confidenceThreshold}`);
    lines.push(`Total Entries: ${state.logEntries.length}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('='.repeat(80));
    lines.push('');

    state.logEntries.forEach((entry, idx) => {
      const eventLabel = entry.eventType === 'call'
        ? `[CALL: ${entry.eventData?.unitKey || '?'} for ${entry.eventData?.leader || '?'}]`
        : entry.eventType === 'npv_call'
          ? `[NPV CALL: ${entry.eventData?.leader || '?'}]`
          : '[INTERVAL]';

      lines.push('-'.repeat(80));
      lines.push(`${entry.timeLabel} ${eventLabel}`);
      lines.push('-'.repeat(80));

      const s = entry.summary;
      lines.push(`EV Called:   D: ${s.calledDEV}  R: ${s.calledREV}  O: ${s.calledOEV}`);
      lines.push(`EV Phantom:  D: ${s.phantomDEV}  R: ${s.phantomREV}  O: ${s.phantomOEV}`);
      const pvPct = (Math.abs(s.pvMargin) * 100).toFixed(2);
      const pvDir = s.pvMargin > 0 ? 'D' : (s.pvMargin < 0 ? 'R' : 'TIE');
      lines.push(`Pop Vote:    D: ${s.totalDVotes.toLocaleString()}  R: ${s.totalRVotes.toLocaleString()}  O: ${s.totalOVotes.toLocaleString()}  (${pvDir}+${pvPct}%)`);
      lines.push(`Total Counted: ${s.totalCounted.toLocaleString()}`);
      lines.push(`NPV Called:  ${s.npvCalledFor ? `${s.npvCalledFor} at ${formatTimeLabel(s.npvCalledAtMinutes)} (confidence ${s.npvConfidence.toFixed(2)})` : '-'}`);
      if (s.swingNational != null) {
        const swingPct = Math.abs(s.swingNational * 100).toFixed(2);
        const swingLabel = s.swingNational > 0 ? `R+${swingPct}` : (s.swingNational < 0 ? `D+${swingPct}` : 'EVEN');
        const swingSigmaPct = s.swingNationalSigma != null ? (s.swingNationalSigma * 100).toFixed(2) : '?';
        const regionParts = Object.entries(s.swingRegions || {})
          .map(([region, r]) => `${region}: ${(r.mean * 100 >= 0 ? '+' : '')}${(r.mean * 100).toFixed(1)}pt (n=${r.nObs})`);
        lines.push(`Live Swing:  National ${swingLabel}pt (+/-${swingSigmaPct}pt)${regionParts.length ? '  |  ' + regionParts.join(', ') : ''}`);
      }
      lines.push('');

      // Header for state table
      const header = 'Unit       EV  Report%  Leader  Called  CalledFor  Margin       Conf   D Votes      R Votes      O Votes';
      lines.push(header);
      lines.push('-'.repeat(header.length));

      entry.units.forEach(u => {
        const unitStr = u.unit.padEnd(10);
        const evStr = String(u.ev).padStart(3);
        const reportStr = u.reportingPct.padStart(7);
        const leaderStr = (u.leader || '-').padEnd(6);
        const calledStr = (u.called ? 'Yes' : 'No').padEnd(6);
        const calledForStr = (u.calledFor || '-').padEnd(9);
        const marginStr = (u.marginStr || '-').padEnd(12);
        const confStr = (u.confidence != null ? u.confidence.toFixed(2) : '-').padStart(5);
        const dVotesStr = u.dVotes.toLocaleString().padStart(12);
        const rVotesStr = u.rVotes.toLocaleString().padStart(12);
        const oVotesStr = u.oVotes.toLocaleString().padStart(12);

        lines.push(`${unitStr} ${evStr}  ${reportStr}  ${leaderStr}  ${calledStr}  ${calledForStr}  ${marginStr} ${confStr}  ${dVotesStr} ${rVotesStr} ${oVotesStr}`);
      });

      lines.push('');
    });

    lines.push('='.repeat(80));
    lines.push('END OF LOG');
    lines.push('='.repeat(80));

    return lines.join('\n');
  }

  /**
   * Format log entries as a CSV file.
   */
  function formatLogAsCsv() {
    const rows = [];
    const year = state.year || getSelectedYear() || 'Unknown';

    // CSV header
    rows.push([
      'Time', 'TimeMinutes', 'EventType', 'EventUnit', 'EventLeader',
      'SummaryCalledDEV', 'SummaryCalledREV', 'SummaryCalledOEV',
      'SummaryPhantomDEV', 'SummaryPhantomREV', 'SummaryPhantomOEV',
      'SummaryDVotes', 'SummaryRVotes', 'SummaryOVotes', 'SummaryTotalCounted', 'SummaryPVMargin',
      'SummaryNpvCalledFor', 'SummaryNpvCalledAtMinutes', 'SummaryNpvConfidence',
      'SummarySwingNational', 'SummarySwingNationalSigma',
      'Unit', 'Abbr', 'EV', 'Reporting', 'Leader', 'Called', 'CalledFor',
      'Margin', 'MarginStr', 'Confidence',
      'DVotes', 'RVotes', 'OVotes', 'CountedVotes', 'RemainingVotes',
      'EVAllocD', 'EVAllocR', 'EVAllocO'
    ].join(','));

    state.logEntries.forEach(entry => {
      const s = entry.summary;
      const eventUnit = entry.eventData?.unitKey || '';
      const eventLeader = entry.eventData?.leader || '';

      entry.units.forEach(u => {
        const row = [
          `"${entry.timeLabel}"`,
          entry.time,
          entry.eventType,
          eventUnit,
          eventLeader,
          s.calledDEV, s.calledREV, s.calledOEV,
          s.phantomDEV, s.phantomREV, s.phantomOEV,
          s.totalDVotes, s.totalRVotes, s.totalOVotes, s.totalCounted, s.pvMargin.toFixed(6),
          s.npvCalledFor || '', s.npvCalledAtMinutes != null ? s.npvCalledAtMinutes.toFixed(2) : '', s.npvConfidence != null ? s.npvConfidence.toFixed(4) : '',
          s.swingNational != null ? s.swingNational.toFixed(6) : '', s.swingNationalSigma != null ? s.swingNationalSigma.toFixed(6) : '',
          u.unit,
          u.abbr,
          u.ev,
          u.reporting.toFixed(4),
          u.leader || '',
          u.called ? 1 : 0,
          u.calledFor || '',
          u.margin != null ? u.margin.toFixed(6) : '',
          `"${u.marginStr || ''}"`,
          u.confidence != null ? u.confidence.toFixed(4) : '',
          u.dVotes,
          u.rVotes,
          u.oVotes,
          u.countedVotes,
          u.remainingVotes,
          u.evAllocD,
          u.evAllocR,
          u.evAllocO
        ];
        rows.push(row.join(','));
      });
    });

    return rows.join('\n');
  }

  /**
   * Download the simulation log as a file.
   * @param {'txt'|'csv'} format - File format
   */
  function downloadSimulationLog(format) {
    if (!state.logEntries.length) {
      console.warn('No log entries to download');
      return false;
    }

    try {
      const year = state.year || getSelectedYear() || 'unknown';
      const timestamp = Date.now();
      let content, mimeType, extension;

      if (format === 'csv') {
        content = formatLogAsCsv();
        mimeType = 'text/csv';
        extension = 'csv';
      } else {
        content = formatLogAsTxt();
        mimeType = 'text/plain';
        extension = 'txt';
      }

      const filename = `election-night-${year}-${timestamp}.${extension}`;
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (e) { }
      }, 5000);
      return true;
    } catch (e) {
      console.error('downloadSimulationLog failed', e);
      return false;
    }
  }


  window.resetElectionNightSimulation = function (restorePv = true, hidePanel = false) {
    resetSimulation(restorePv, hidePanel);
  };

  window.prepareElectionNightSimulation = function () {
    if (!state.prepared) prepareSimulation();
  };

  window.seekElectionNightProgress = function (progress) {
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

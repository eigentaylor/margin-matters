# Modularization Roadmap for tester.js and election-night.js

## Current State

**File Sizes:**
- `tester.js`: 4,604 lines
- `election-night.js`: 2,369 lines
- **Total**: 6,973 lines

**Status:** Previous attempt at aggressive modularization broke functionality. This roadmap provides a safe, incremental approach.

---

## Strategy: Incremental, Test-Driven Modularization

### Core Principles
1. **One module at a time** - Extract and test each module before moving to the next
2. **Backward compatibility** - Maintain all existing global APIs during transition
3. **Test after each step** - Verify functionality works before committing
4. **Fallback mechanisms** - New modules should gracefully fall back if not loaded
5. **Keep originals** - Don't delete code until new version is proven

---

## Dependency Analysis

### tester.js Dependencies

#### Already Using Shared Modules (Safe):
- ✅ `window.ElectionConstants` (PV_CAP, EPS, ID_TO_ABBR, SMALL_STATES)
- ✅ `window.EvCalculations.allocateProportionalEVs`

#### Internal Dependencies (Complex):
- `byYear` Map → Used by: init, updateAll, buildPvStops, flip functions
- `evByUnit` Map → Used by: init, updateAll, flip functions
- `stopsByYear` Map → Used by: updateAll, buildPvStops
- `window.updateAll` → Called by: many UI event handlers, external scripts
- `window._byYearMap` → Read by: election-night.js, other scripts
- `window._evByUnitMap` → Read by: external scripts

#### External Dependencies (What tester.js calls):
- `d3` library (map rendering)
- `topojson` library (map data processing)
- `window.ElectionMap` (if available)
- DOM elements: yearSlider, pvSlider, map, various UI elements

### election-night.js Dependencies

#### Already Using Shared Modules (Safe):
- ✅ `window.ElectionConstants` (EPS, NEUTRAL_COLOR, THIRD_PARTY_COLOR, STATE_NAMES)

#### Internal Dependencies (Complex):
- `state` object → Core simulation state, used everywhere
- `elements` object → Cached DOM references
- `window.resetElectionNightSimulation` → Called by: external scripts
- `window.prepareElectionNightSimulation` → Called by: external scripts
- `window.seekElectionNightProgress` → Called by: external scripts

#### External Dependencies (What election-night.js calls):
- `window._byYearMap` (from tester.js)
- `window._evByUnitMap` (from tester.js)
- `window.getUnitFinalVoteTotals` (from tester.js)
- `window.ElectionMap` (if available)
- DOM elements: enToggle, enProgress, demEV, repEV, etc.

---

## Phase 1: Extract Pure Utility Functions (Low Risk)

These functions have no side effects and don't depend on global state.

### 1.1: Data Formatting Module (`docs/utils/dataFormatting.js`)

**Extract from tester.js:**
- ✅ Already exists: `leanStr(x)` → Use `FormattingUtils.leanStr`
- ✅ Already exists: `marginToColor(m, isThirdParty)` → Use `ColorUtils.marginToColor`
- ✅ Already exists: `clampMargin(value)` → Use `FormattingUtils.clampMargin`
- ✅ Already exists: `totalVotesFromRow(row)` → Use `VoteCalculations.totalVotesFromRow`
- `computePvAdjustedBreakdown(row, pvShift, natActualMargin)` → Move to VoteCalculations

**Extract from election-night.js:**
- `formatLean(value)` → Use `FormattingUtils.leanStr`
- `formatUnitLabel(unit)` → Use `FormattingUtils.formatUnitLabel`
- `formatReportingText(reporting)` → New function
- `formatConfidenceText(confidence)` → New function
- `formatMarginText(marginStr, leader)` → New function

**Risk Level:** 🟢 LOW - These are pure functions with no dependencies

**Testing:** Call each function with test data and verify output matches

**Rollback:** Simply don't use the new module; keep inline versions

---

### 1.2: Math/Calculation Module (`docs/utils/mathUtils.js`)

**Extract from tester.js:**
- `clampShare(value)` → Generic clamping
- `getNatMargin(year)` → Needs byYear Map access

**Extract from election-night.js:**
- `clampMargin(value)` → Use existing FormattingUtils
- `computeReportingFraction(st, timeMinutes)` → Extract
- `logisticBias(params, reporting, phaseName)` → Extract

**Risk Level:** 🟢 LOW - Pure math functions

---

## Phase 2: Extract Map Rendering Components (Medium Risk)

### 2.1: Tooltip Module (`docs/utils/tooltipManager.js`)

**Extract from tester.js:**
- `_getMapWrap()` → Already in MapInteraction
- `_ensureTip()` → Already in MapInteraction
- `_placeTipAt(evt)` → Already in MapInteraction
- `showMapTip(evt, text)` → Already in MapInteraction
- `moveMapTip(evt)` → Already in MapInteraction
- `hideMapTip()` → Already in MapInteraction
- `refreshActiveMapTip()` → Already in MapInteraction
- `createUnitTipInfo(unit, opts)` → Extract
- `formatUnitTooltip(unit, opts)` → Extract (large function)

**Risk Level:** 🟡 MEDIUM - Depends on global state (window._curYear, window._curPv)

**Mitigation:** Pass state as parameters instead of reading from window

---

### 2.2: Small State Boxes Module (`docs/utils/smallBoxesRenderer.js`)

**Extract from tester.js:**
- `_defaultSmallBoxesConfig` → Already in MapInteraction
- `setSmallBoxesConfig(patch)` → Already in MapInteraction
- `nudgeSmallBoxes(dx, dy)` → Already in MapInteraction
- `ensureSmallBoxesLayer()` → Extract
- `renderSmallStateBoxes(year, abbrColors, unitColors)` → Extract (200+ lines)

**Extract from election-night.js:**
- `flushSmallBoxes()` → Extract
- `updateSmallBoxes(st, color, metrics)` → Extract

**Risk Level:** 🟡 MEDIUM - Depends on d3 and DOM

**Mitigation:** Ensure d3 is loaded before calling these functions

---

### 2.3: State Labels Module (`docs/utils/stateLabelRenderer.js`)

**Extract from tester.js:**
- `stateLabelsLayer` variable
- `_labelCache` Map
- `_visualCenterCache` Map → Already in MapInteraction
- `_visualCenterStates` Set → Already in MapInteraction
- `setVisualCenterStates(list)` → Already in MapInteraction
- `_computeVisualCenter(feature, abbr)` → Already in MapInteraction
- `ensureStateLabelsLayer()` → Extract (42 lines)
- `updateStateLabels(year)` → Extract (197 lines)
- `getTotalEvForState(year, abbr)` → Extract

**Risk Level:** 🟡 MEDIUM - Complex d3 rendering logic

---

## Phase 3: Extract Data Management (Higher Risk)

### 3.1: Data Loader Module (`docs/utils/dataLoader.js`)

**Extract from tester.js:**
- CSV loading logic from `init()` function
- `byYear` Map initialization
- `evByUnit` Map initialization
- `stopsByYear` Map initialization
- `buildPvStops(year, container, datalist)` function (huge - 810 lines!)

**Risk Level:** 🔴 HIGH - Core data structure, many dependencies

**Approach:**
1. Create `DataLoader` class that encapsulates the Maps
2. Expose same global APIs: `window._byYearMap`, `window._evByUnitMap`, `window._stopsByYear`
3. Add `window.getRowsForYear(year)` helper that external code uses
4. Migrate internal tester.js code to use the new APIs gradually

**Testing:** Must verify all year/PV combinations work correctly

---

### 3.2: EV Calculator Module (`docs/utils/evCalculator.js`)

**Extract from tester.js:**
- `calculateUnitProportionalEVs(unit)` → Depends on data and UI state
- `getUnitFinalVoteTotals(unit, opts)` → Large function (78 lines)
- `calculateUnitVoteTallies(unit)` → Complex function (115 lines)
- Already exists: `allocateProportionalEVs` → Use EvCalculations

**Risk Level:** 🔴 HIGH - Core calculation logic used by many features

**Testing:** Must verify EV totals match across all scenarios

---

## Phase 4: Extract Simulation Logic (Highest Risk)

### 4.1: Election Night Core Module (`docs/utils/electionNightCore.js`)

**Extract from election-night.js:**
- `state` object management
- `prepareSimulation()` function
- `buildStateData(year, pvValue)` function (178 lines!)
- `buildEvAllocations()` function
- `computeMetrics()` function
- `calculateConfidence()` function

**Risk Level:** 🔴 CRITICAL - Core simulation engine

**Approach:** Don't extract until Phases 1-3 are complete and stable

---

### 4.2: Reporting Schedule Module (`docs/utils/reportingScheduleGenerator.js`)

**Extract from election-night.js:**
- `generateReportingSchedule()` function (68 lines)
- `refineReportingScheduleTail()` function (81 lines)
- `createBiasParams()` function
- `computeReportingFraction()` function

**Risk Level:** 🟡 MEDIUM - Self-contained algorithm

---

### 4.3: Call Log Module (`docs/utils/callLogManager.js`)

**Extract from election-night.js:**
- `updateCallLog(currentTime)` function (252 lines!)
- `formatEvAllocationsForLog()` function
- Call log rendering logic

**Risk Level:** 🟡 MEDIUM - UI rendering, less critical path

---

## Phase 5: Extract UI Update Logic (Medium Risk)

### 5.1: Candidate Info Module (`docs/utils/candidateInfoManager.js`)

**Extract from tester.js:**
- `updateCandidateInfo(year)` function (167 lines)
- `getUnitCandidateLastNames(unit, opts)` function (43 lines)

**Risk Level:** 🟡 MEDIUM - UI updates, not on critical path

---

### 5.2: EV Display Module (`docs/utils/evDisplayManager.js`)

**Extract from tester.js and election-night.js:**
- EV bar updating logic
- Popular vote display logic from election-night.js
- `updateEvDisplay()` from election-night.js
- `updatePopularVoteDisplay()` from election-night.js

**Risk Level:** 🟢 LOW - Simple DOM updates

---

## Phase 6: Extract Flip Scenarios (High Risk)

### 6.1: Flip Calculator Module (`docs/utils/flipCalculator.js`)

**Extract from tester.js (lines 3309-4604):**
- This is ~1,300 lines of flip scenario logic
- Includes complex state manipulation
- Heavy DOM interaction

**Risk Level:** 🔴 HIGH - Complex feature with many edge cases

**Approach:** 
1. Extract only after all Phase 1-5 modules are stable
2. Consider keeping in tester.js initially
3. Only extract if file size is still too large after other extractions

---

## Recommended Implementation Order

### Week 1: Low-Risk Utilities
1. ✅ `dataFormatting.js` - Pure formatting functions
2. ✅ `mathUtils.js` - Pure math functions
3. Test thoroughly on index.html

### Week 2: Map Rendering
4. `tooltipManager.js` - Tooltip system
5. `smallBoxesRenderer.js` - Small state boxes
6. Test on index.html and future.html

### Week 3: State Labels
7. `stateLabelRenderer.js` - State label rendering
8. Test all map features work correctly

### Week 4: Reporting Schedule
9. `reportingScheduleGenerator.js` - Election night schedules
10. Test election night simulator thoroughly

### Week 5: Call Log
11. `callLogManager.js` - Call log rendering
12. Test election night call log feature

### Week 6+: Data Management (If needed)
13. Consider `dataLoader.js` only if file size still too large
14. Consider `evCalculator.js` only if file size still too large

**DON'T EXTRACT:**
- Core `updateAll()` function - too central
- Core `init()` function - too central
- Flip scenarios - too complex, extract last if at all

---

## Testing Checklist

After each extraction, verify:

### For tester.js changes:
- [ ] Map renders correctly
- [ ] Year slider updates map colors
- [ ] PV slider adjusts colors properly
- [ ] State clicks navigate to state pages
- [ ] Tooltips show correct information
- [ ] Small state boxes render properly
- [ ] State labels show correct EVs
- [ ] EV totals are accurate
- [ ] All years load correctly
- [ ] URL parameters work (year, pv, flip)
- [ ] Proportional EV toggle works
- [ ] No JavaScript console errors

### For election-night.js changes:
- [ ] Simulation starts/stops correctly
- [ ] Map colors update during simulation
- [ ] EV totals update correctly
- [ ] Call log shows correct calls
- [ ] Progress slider works
- [ ] Speed slider works
- [ ] States are called at appropriate times
- [ ] ME/NE districts work correctly
- [ ] Popular vote displays correctly
- [ ] No JavaScript console errors

---

## Dependency Graph

```
tester.js (4,604 lines)
├── Uses: d3, topojson
├── Exports to window:
│   ├── updateAll() [CRITICAL - called by many external scripts]
│   ├── _byYearMap [CRITICAL - read by election-night.js]
│   ├── _evByUnitMap [read by external scripts]
│   ├── _stopsByYear [read by external scripts]
│   ├── _getNatMargin() [read by external scripts]
│   ├── updateUrl() [read by external scripts]
│   ├── allocateProportionalEVs() [read by external scripts]
│   └── _STOP_EPS [read by external scripts]
├── Internal Data Structures:
│   ├── byYear Map [1,587 lines onwards]
│   ├── evByUnit Map
│   ├── stopsByYear Map
│   ├── stopToEff Map
│   └── stopToUnits Map
└── Major Functions:
    ├── init() [lines 2108-2327] - 220 lines - CRITICAL
    ├── updateAll() [lines 2495-3292] - 798 lines - CRITICAL
    ├── buildPvStops() [lines 1928-2107] - 180 lines
    ├── updateCandidateInfo() [lines 2328-2494] - 167 lines
    ├── renderSmallStateBoxes() [lines 988-1130] - 143 lines
    ├── updateStateLabels() [lines 1218-1414] - 197 lines
    ├── formatUnitTooltip() [lines 553-795] - 243 lines
    └── Flip scenarios [lines 3309-4604] - 1,296 lines

election-night.js (2,369 lines)
├── Uses: d3, window._byYearMap, window._evByUnitMap
├── Exports to window:
│   ├── resetElectionNightSimulation() [CRITICAL]
│   ├── prepareElectionNightSimulation() [CRITICAL]
│   └── seekElectionNightProgress() [CRITICAL]
├── Internal State:
│   ├── state object [lines 113-150] - simulation state
│   └── elements object [lines 152-173] - cached DOM refs
└── Major Functions:
    ├── init() [lines 175-315] - 141 lines
    ├── prepareSimulation() [lines 316-406] - 91 lines
    ├── buildStateData() [lines 609-786] - 178 lines - COMPLEX
    ├── renderAt() [lines 1066-1176] - 111 lines - CRITICAL
    ├── updateCallLog() [lines 1611-1862] - 252 lines
    ├── generateReportingSchedule() [lines 917-984] - 68 lines
    └── computeMetrics() [lines 1177-1270] - 94 lines
```

---

## Risk Mitigation Strategies

### 1. Feature Flags
Add a global flag to enable/disable new modules:
```javascript
window.USE_MODULAR_COMPONENTS = false; // Set to true to test new modules
```

### 2. Dual Implementation
Keep old code commented out next to new code:
```javascript
// Old implementation (keep for rollback)
// const result = oldFunction(data);

// New implementation
const result = window.NewModule ? 
  window.NewModule.newFunction(data) : 
  oldFunction(data); // Fallback
```

### 3. Incremental Testing
Create test HTML page that loads only specific modules:
```html
<!-- test-modular.html -->
<script src="utils/constants.js"></script>
<script src="utils/dataFormatting.js"></script>
<script src="tester-modular.js"></script>
```

### 4. Rollback Plan
For each commit:
1. Tag the working version before changes
2. Keep clear commit messages: "Extract tooltipManager.js from tester.js"
3. Test immediately after each extraction
4. If broken, `git revert` the specific commit

---

## Success Criteria

### Minimum Success (Maintain Functionality):
- All features work exactly as before
- No new bugs introduced
- File structure is cleaner

### Target Success (Improve Maintainability):
- `tester.js` reduced to ~1,500-2,000 lines
- `election-night.js` reduced to ~1,000-1,500 lines
- Shared utility modules are reusable
- Code is easier to understand

### Stretch Success (Maximum Reduction):
- `tester.js` reduced to ~800-1,000 lines
- `election-night.js` reduced to ~600-800 lines
- Well-documented module structure
- Clear separation of concerns

---

## Notes

- **Don't rush**: Previous attempt broke because too much was changed at once
- **Test frequently**: After each extraction, test on actual HTML pages
- **Document dependencies**: Note what each function needs from window/global scope
- **Maintain compatibility**: Keep all existing window.* exports working
- **Version control**: Commit after each working extraction, not all at once


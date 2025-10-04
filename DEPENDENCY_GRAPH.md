# Dependency Graph: tester.js and election-night.js

## Visual Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         External Dependencies                    │
│  d3.js, topojson.js, ElectionMap (optional), DOM elements       │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Shared Utility Modules                      │
│  ✅ constants.js  ✅ colorUtils.js  ✅ formatting.js            │
│  ✅ evCalculations.js  ✅ voteCalculations.js                   │
│  ✅ mapInteraction.js  ✅ urlUtils.js  ✅ electionMap.js        │
└─────────────────────────────────────────────────────────────────┘
                     │                           │
                     ▼                           ▼
        ┌────────────────────────┐    ┌────────────────────────┐
        │    tester.js (4,604)   │◄───│ election-night.js      │
        │                        │    │      (2,369)           │
        │  Core Data & UI Logic  │    │  Simulation Engine     │
        └────────────────────────┘    └────────────────────────┘
                     │
                     │ Provides Data
                     ▼
        ┌────────────────────────┐
        │   Global Window APIs   │
        │  (Used by other pages) │
        └────────────────────────┘
```

## Data Flow: tester.js

```
CSV File (presidential_margins.csv)
         │
         ▼
    init() function
         │
         ├─► Parse CSV data
         │
         ├─► Build Maps:
         │   ├─► byYear (year → rows[])
         │   ├─► evByUnit (year:unit → ev)
         │   └─► stopsByYear (year → stops[])
         │
         ├─► Expose to window:
         │   ├─► window._byYearMap
         │   ├─► window._evByUnitMap
         │   ├─► window._stopsByYear
         │   └─► window.getRowsForYear()
         │
         └─► Build UI:
             ├─► Render map (d3 + topojson)
             ├─► Setup sliders (year, PV)
             └─► Attach event handlers
                      │
                      ▼
              updateAll() function
                      │
                      ├─► Read current state:
                      │   ├─► Year from slider
                      │   ├─► PV from slider/override
                      │   └─► Flip state (if active)
                      │
                      ├─► Calculate colors:
                      │   └─► For each state/unit:
                      │       ├─► Get base margin
                      │       ├─► Apply PV adjustment
                      │       ├─► Apply flip (if needed)
                      │       └─► Convert to color
                      │
                      ├─► Update map:
                      │   ├─► Set state fills
                      │   ├─► Set district fills
                      │   └─► Update labels/EVs
                      │
                      ├─► Update UI:
                      │   ├─► EV totals
                      │   ├─► Small state boxes
                      │   ├─► Candidate info
                      │   └─► URL parameters
                      │
                      └─► Trigger external hooks:
                          └─► election-night.js (if active)
```

## Data Flow: election-night.js

```
User clicks "Start Simulation"
         │
         ▼
  prepareSimulation()
         │
         ├─► Read from tester.js:
         │   ├─► window._byYearMap (get rows for year)
         │   ├─► window._evByUnitMap (get EVs)
         │   └─► Current year, PV from window._curYear, window._curPv
         │
         ├─► For each state/district:
         │   ├─► Calculate final vote totals
         │   ├─► Generate reporting schedule
         │   ├─► Calculate bias parameters
         │   └─► Determine call timing
         │
         └─► Store in state.stateData[]
                      │
                      ▼
              startSimulation()
                      │
                      ├─► Start animation loop (requestAnimationFrame)
                      │
                      └─► tick() called every frame
                               │
                               ▼
                          renderAt(timeMinutes)
                               │
                               ├─► For each state/district:
                               │   ├─► Calculate reporting %
                               │   ├─► Apply vote reporting bias
                               │   ├─► Check if should call state
                               │   ├─► Determine color (blend if uncalled)
                               │   └─► Update map
                               │
                               ├─► Update UI:
                               │   ├─► EV totals
                               │   ├─► Popular vote
                               │   ├─► Progress slider
                               │   ├─► Call log
                               │   └─► Small state boxes
                               │
                               └─► Store snapshot:
                                   └─► window._electionNightSnapshot
                                       (used by tester.js for EV breakdown)
```

## Critical Interdependencies

### tester.js → election-night.js (Data Provider)

```
tester.js EXPORTS:                     election-night.js IMPORTS:
┌──────────────────────────┐          ┌──────────────────────────┐
│ window._byYearMap        │─────────►│ Read rows for year       │
│ window._evByUnitMap      │─────────►│ Get EV counts            │
│ window._stopsByYear      │          │                          │
│ window._curYear          │─────────►│ Current year value       │
│ window._curPv            │─────────►│ Current PV adjustment    │
│ window.getRowsForYear()  │─────────►│ Helper to get data       │
│ window.updateAll()       │          │                          │
└──────────────────────────┘          └──────────────────────────┘
```

### election-night.js → tester.js (State Updates)

```
election-night.js EXPORTS:            tester.js IMPORTS:
┌──────────────────────────┐          ┌──────────────────────────┐
│ window._electionNightActive│────────►│ Check if sim running     │
│ window._electionNightSnapshot│──────►│ Get vote counts for      │
│                          │          │ EV breakdown modal       │
└──────────────────────────┘          └──────────────────────────┘
```

## Function Call Hierarchy

### tester.js Call Tree (Simplified)

```
init() [Lines 2108-2327]
├── Load CSV data
├── buildPvStops() [Lines 1928-2107]
│   └── For each year's data
├── Build d3 map
│   ├── ElectionMap.build()
│   └── Setup state/district handlers
├── Setup UI event listeners
│   ├── yearSlider.addEventListener()
│   ├── pvSlider.addEventListener()
│   └── Various button handlers
└── updateAll() (initial render)

updateAll() [Lines 2495-3292] ⚠️ CRITICAL PATH
├── Read current state (year, PV, flip)
├── getNatMargin(year) [Lines 1918-1927]
├── For each state/district:
│   ├── computePvAdjustedBreakdown() [Lines 1535-1586]
│   ├── marginToColor() [Lines 1496-1513]
│   └── ElectionMap.setStateFill() / setDistrictFill()
├── updateStateLabels(year) [Lines 1218-1414]
│   ├── getTotalEvForState() [Lines 1194-1217]
│   └── d3 rendering of labels
├── renderSmallStateBoxes() [Lines 988-1130]
│   └── d3 rendering of small boxes
├── updateCandidateInfo(year) [Lines 2328-2494]
│   └── DOM updates for candidate names
└── updateUrl() [Lines 1444-1484]

Flip Scenarios [Lines 3309-4604] ⚠️ HIGH COMPLEXITY
├── getCurrentMetric()
├── getFlipScenariosForYearMetric()
├── applyFlip()
│   └── Calls updateAll()
└── Various flip calculation functions
```

### election-night.js Call Tree (Simplified)

```
init() [Lines 175-315]
├── Cache DOM elements
├── Attach event listeners
│   ├── toggle.addEventListener() → startSimulation()
│   ├── reset.addEventListener() → resetSimulation()
│   ├── progress.addEventListener() → seekToProgress()
│   └── speed.addEventListener()
└── Initialize UI labels

prepareSimulation() [Lines 316-406] ⚠️ CRITICAL
├── Read data from window._byYearMap
├── resolvePvValue()
├── buildStateData() [Lines 609-786]
│   ├── For each state/district:
│   │   ├── getUnitFinalVoteTotals() (from tester.js)
│   │   ├── generateReportingSchedule() [Lines 917-984]
│   │   │   └── refineReportingScheduleTail() [Lines 985-1065]
│   │   ├── createBiasParams() [Lines 1952-1971]
│   │   └── buildEvAllocations() [Lines 787-906]
│   └── Store in state.stateData[]
└── Set state.prepared = true

startSimulation() [Lines 554-562]
├── Set state.running = true
└── requestAnimationFrame(tick)

tick() [Lines 576-608]
├── Calculate delta time
├── Advance currentTime
├── renderAt(currentTime) [Lines 1066-1176]
│   ├── For each state/district:
│   │   ├── computeMetrics() [Lines 1177-1270]
│   │   │   ├── computeReportingFraction() [Lines 1995-2036]
│   │   │   ├── logisticBias() [Lines 1972-1994]
│   │   │   └── computeVoteStats() [Lines 1271-1290]
│   │   ├── shouldCallState() [Lines 1351-1366]
│   │   ├── applyColor() [Lines 1917-1925]
│   │   └── updateSmallBoxes() [Lines 1438-1463]
│   ├── updateEvDisplay() [Lines 1464-1559]
│   ├── updatePopularVoteDisplay() [Lines 1560-1588]
│   ├── updateProgressSlider() [Lines 1589-1596]
│   └── updateCallLog() [Lines 1611-1862]
└── requestAnimationFrame(tick) (if still running)
```

## Module Size Analysis

### tester.js - Where the Lines Are

| Section | Lines | % | Complexity | Extract Priority |
|---------|-------|---|------------|------------------|
| Imports/Constants | 1-392 | 8.5% | Low | ✅ Already using modules |
| Tooltip/Map Interaction | 393-971 | 12.6% | Medium | 🟡 Phase 2 |
| Small State Boxes | 972-1193 | 4.8% | Medium | 🟡 Phase 2 |
| State Labels | 1194-1414 | 4.8% | Medium | 🟡 Phase 3 |
| URL/Formatting Utils | 1415-1586 | 3.7% | Low | 🟢 Phase 1 |
| Data Structures | 1587-1917 | 7.2% | Low | - Keep in place |
| PV Stops | 1928-2107 | 3.9% | High | 🔴 Phase 6 (if needed) |
| Init Function | 2108-2327 | 4.8% | High | 🔴 Keep in place |
| Candidate Info | 2328-2494 | 3.6% | Low | 🟢 Phase 5 |
| **updateAll()** | 2495-3292 | **17.3%** | **Critical** | **🔴 NEVER EXTRACT** |
| Flip Scenarios | 3309-4604 | **28.2%** | Very High | 🔴 Phase 6 (last resort) |
| EV Breakdown Modal | scattered | 3.6% | Medium | 🟡 Phase 5 |

**Key Insight:** 
- 28% of the file is flip scenarios (1,296 lines)
- 17% is the critical `updateAll()` function (798 lines)
- Together these are 45% of the file and **should not be extracted early**

### election-night.js - Where the Lines Are

| Section | Lines | % | Complexity | Extract Priority |
|---------|-------|---|------------|------------------|
| Constants | 1-111 | 4.7% | Low | ✅ Already using modules |
| State/Elements | 112-174 | 2.7% | Low | - Keep in place |
| Init Function | 175-315 | 5.9% | Medium | 🔴 Keep in place |
| Prepare Simulation | 316-608 | 12.4% | High | 🔴 Phase 4 (careful) |
| **buildStateData()** | 609-906 | **12.6%** | **High** | 🔴 Phase 4 (critical) |
| Reporting Schedule | 917-1065 | 6.3% | Medium | 🟡 Phase 2 |
| **renderAt()** | 1066-1320 | **10.7%** | **Critical** | **🔴 NEVER EXTRACT** |
| Call Logic | 1321-1427 | 4.5% | Medium | 🟡 Phase 4 |
| Small Boxes | 1428-1463 | 1.5% | Low | 🟡 Phase 2 |
| Display Updates | 1464-1610 | 6.2% | Low | 🟢 Phase 1 |
| **Call Log** | 1611-1862 | **10.6%** | Medium | 🟡 Phase 3 |
| Utility Functions | 1863-2369 | 21.4% | Low-Med | 🟢 Phase 1 |

**Key Insight:**
- 23% is formatting/utility functions (507 lines) - **safe to extract**
- 11% is call log rendering (252 lines) - **safe to extract**
- These alone would reduce file to ~1,600 lines without touching critical logic

## Extraction Impact Estimate

### Conservative Approach (Phases 1-3 only)

**tester.js:**
- Extract tooltips: -250 lines
- Extract small boxes: -200 lines
- Extract state labels: -200 lines
- Extract candidate info: -170 lines
- **New size: ~3,784 lines** (18% reduction)

**election-night.js:**
- Extract utilities: -500 lines
- Extract call log: -250 lines
- Extract reporting schedule: -150 lines
- **New size: ~1,469 lines** (38% reduction)

### Aggressive Approach (All phases)

**tester.js:**
- Conservative extractions: -820 lines
- Extract data loader: -300 lines
- Extract EV calculator: -200 lines
- Extract flip scenarios: -1,000 lines
- **New size: ~2,284 lines** (50% reduction)
- **Risk: HIGH - flip scenarios are very complex**

**election-night.js:**
- Conservative extractions: -900 lines
- Extract simulation core: -400 lines
- **New size: ~1,069 lines** (55% reduction)
- **Risk: VERY HIGH - simulation core is critical**

## Recommendation

**Start with Conservative Approach:**
1. Extract only Phase 1-3 modules (utilities, rendering, UI)
2. Achieve ~30% reduction with low risk
3. Stop if file sizes become manageable (~1,500-2,000 lines)
4. Only proceed to Phases 4-6 if absolutely necessary

**Files will still be large but much more maintainable:**
- tester.js: 4,604 → ~3,000-3,500 lines
- election-night.js: 2,369 → ~1,400-1,600 lines
- Plus 8-12 focused utility modules of 100-300 lines each

This keeps critical orchestration logic intact while extracting reusable components.

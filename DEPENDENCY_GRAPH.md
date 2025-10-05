# Dependency Graph Visualization

## Current State (Before Modularization)

```mermaid
graph TB
    subgraph "Current Architecture"
        T[tester.js<br/>4587 lines<br/>59+ functions]
        E[election-night.js<br/>2343 lines<br/>72+ functions]
        
        T -->|window.allocateProportionalEVs| E
        T -->|duplicate: clampMargin| D1[Duplicated Code]
        E -->|duplicate: clampMargin| D1
        
        style T fill:#f9f,stroke:#333,stroke-width:4px
        style E fill:#f9f,stroke:#333,stroke-width:4px
        style D1 fill:#f66,stroke:#333,stroke-width:2px
    end
```

## Phase 1: Math Utilities (✓ COMPLETED)

```mermaid
graph TB
    subgraph "Phase 1 - Math Utilities"
        T[tester.js]
        E[election-night.js]
        M[utils/mathUtils.js<br/>✓ Created]
        
        T -->|uses| M
        E -->|uses| M
        
        M -->|clampMargin| M
        M -->|clamp01| M
        M -->|clampShare| M
        M -->|clampByte| M
        M -->|clamp| M
        
        style M fill:#9f9,stroke:#333,stroke-width:2px
        style T fill:#ff9,stroke:#333,stroke-width:2px
        style E fill:#ff9,stroke:#333,stroke-width:2px
    end
```

**Functions Extracted:**
- ✓ `clampMargin(value)` - Clamp margin to [-1+ε, 1-ε]
- ✓ `clamp01(x)` - Clamp to [0, 1]
- ✓ `clampShare(value)` - Clamp share to (0, 1]
- ✓ `clampByte(v)` - Clamp to [0, 255] for RGB
- ✓ `clamp(value, min, max)` - Generic clamp

**Status:** ✓ Module created and tested. Ready for integration.

## Phase 2: EV Allocation (NEXT)

```mermaid
graph TB
    subgraph "Phase 2 - EV Allocation"
        T[tester.js]
        E[election-night.js]
        M[utils/mathUtils.js]
        EV[utils/evAllocation.js<br/>TODO]
        
        T -->|uses| M
        E -->|uses| M
        T -->|uses| EV
        E -->|uses| EV
        
        EV -->|allocateProportionalEVs| EV
        EV -->|calculateUnitProportionalEVs| EV
        
        style EV fill:#99f,stroke:#333,stroke-width:2px
        style M fill:#9f9,stroke:#333,stroke-width:2px
    end
```

**Functions to Extract:**
- `allocateProportionalEVs(dVotes, rVotes, oVotes, totalEVs, topThirdPartyShare, thirdPartyResults)`
- `calculateUnitProportionalEVs(unit)` (or refactored version)
- Related helper functions

## Phase 3: Tooltip System (HIGH PRIORITY)

```mermaid
graph TB
    subgraph "Phase 3 - Tooltip System"
        T[tester.js]
        E[election-night.js]
        M[utils/mathUtils.js]
        EV[utils/evAllocation.js]
        TT[utils/tooltipManager.js<br/>TODO]
        
        T -->|uses| M
        E -->|uses| M
        T -->|uses| EV
        E -->|uses| EV
        T -->|uses| TT
        E -->|uses| TT
        
        TT -->|showMapTip| TT
        TT -->|hideMapTip| TT
        TT -->|formatUnitTooltip| TT
        TT -->|createUnitTipInfo| TT
        
        style TT fill:#f99,stroke:#333,stroke-width:2px
        style M fill:#9f9,stroke:#333,stroke-width:2px
        style EV fill:#99f,stroke:#333,stroke-width:2px
    end
```

**Functions to Extract:**
- `showMapTip(evt, text)` - Show tooltip
- `hideMapTip()` - Hide tooltip  
- `moveMapTip(evt)` - Move tooltip
- `formatUnitTooltip(unit, opts)` - Format tooltip with candidate names
- `createUnitTipInfo(unit, opts)` - Create tooltip info object
- Helper functions: `_ensureTip()`, `_placeTipAt(evt)`

**Impact:** This directly addresses the stated problem - candidate names in tooltips only work in tester.js, not election-night.js.

## Phase 4: Formatting Utilities

```mermaid
graph TB
    subgraph "Phase 4 - Formatters"
        T[tester.js]
        E[election-night.js]
        M[utils/mathUtils.js]
        EV[utils/evAllocation.js]
        TT[utils/tooltipManager.js]
        F[utils/formatters.js<br/>TODO]
        
        T & E -->|use| M & EV & TT & F
        
        F -->|formatLeader| F
        F -->|formatMarginText| F
        F -->|formatReportingText| F
        F -->|formatEvAllocationsForLog| F
        
        style F fill:#9ff,stroke:#333,stroke-width:2px
        style TT fill:#f99,stroke:#333,stroke-width:2px
        style M fill:#9f9,stroke:#333,stroke-width:2px
        style EV fill:#99f,stroke:#333,stroke-width:2px
    end
```

**Functions to Extract:**
- `formatLeader(code)` - Format D/R/O leader code
- `formatMarginText(marginStr, leader)` - Format margin with leader
- `formatReportingText(reporting)` - Format reporting percentage
- `formatConfidenceText(confidence)` - Format confidence level
- `formatLean(value)` - Format lean value
- `formatUnitLabel(unit)` - Format unit/state label
- `formatEvAllocationsForLog(callAlloc, finalAlloc)` - Format EV allocations

## Target Architecture (After All Phases)

```mermaid
graph TB
    subgraph "Modularized Architecture"
        T[tester.js<br/>~3500 lines<br/>-25% code]
        E[election-night.js<br/>~1800 lines<br/>-25% code]
        
        M[utils/mathUtils.js<br/>Math utilities]
        EV[utils/evAllocation.js<br/>EV allocation]
        TT[utils/tooltipManager.js<br/>Tooltip system]
        F[utils/formatters.js<br/>Formatters]
        CN[utils/candidateNames.js<br/>Name resolution]
        SS[utils/siteState.js<br/>Existing]
        EM[utils/electionMap.js<br/>Existing]
        
        T --> M
        T --> EV
        T --> TT
        T --> F
        T --> CN
        T --> SS
        T --> EM
        
        E --> M
        E --> EV
        E --> TT
        E --> F
        E --> CN
        E --> SS
        E --> EM
        
        TT --> F
        TT --> CN
        CN --> M
        
        style T fill:#9f9,stroke:#333,stroke-width:2px
        style E fill:#9f9,stroke:#333,stroke-width:2px
        style M fill:#9f9,stroke:#333,stroke-width:2px
        style EV fill:#99f,stroke:#333,stroke-width:2px
        style TT fill:#f99,stroke:#333,stroke-width:2px
        style F fill:#9ff,stroke:#333,stroke-width:2px
        style CN fill:#ff9,stroke:#333,stroke-width:2px
        style SS fill:#ccc,stroke:#333,stroke-width:1px
        style EM fill:#ccc,stroke:#333,stroke-width:1px
    end
```

## Function Dependencies Analysis

### Confirmed Duplicates
- `clampMargin` - ✓ Extracted to mathUtils.js
- `init` - Different implementations, not extractable

### Functions Used But Not Defined (External Dependencies)
**tester.js:** isFinite, Number, parseInt, String, isNaN, parseFloat, proj, setTimeout, fetch
**election-night.js:** isFinite, parseFloat, String, cancelAnimationFrame, requestAnimationFrame, rng, rand, parseInt

### Target Functions Location
| Function | tester.js | election-night.js | Status |
|----------|-----------|-------------------|--------|
| clampMargin | ✓ defined | ✓ defined | ✓ Extracted |
| clamp01 | - | ✓ defined | ✓ Extracted |
| clampByte | - | ✓ defined | ✓ Extracted |
| clampShare | ✓ defined | - | ✓ Extracted |
| allocateProportionalEVs | ✓ defined | used | Phase 2 |
| formatUnitTooltip | ✓ defined | - | Phase 3 |
| showMapTip | ✓ defined | - | Phase 3 |
| hideMapTip | ✓ defined | - | Phase 3 |
| formatLeader | - | ✓ defined | Phase 4 |
| formatMarginText | - | ✓ defined | Phase 4 |

## Benefits of Modularization

### Code Quality
- ✓ Single source of truth for each function
- ✓ Easier to test in isolation
- ✓ Better documentation with JSDoc
- ✓ Clearer dependencies

### Maintainability
- ✓ Features added to modules automatically available everywhere
- ✓ Bug fixes propagate automatically
- ✓ Smaller, more focused files
- ✓ Easier code review

### Consistency
- ✓ Same behavior across all pages
- ✓ Candidate names in tooltips everywhere (Phase 3 goal)
- ✓ Consistent formatting
- ✓ Consistent EV calculations

### Developer Experience
- ✓ IDE autocomplete with JSDoc
- ✓ Easier to understand codebase
- ✓ Faster onboarding for new developers
- ✓ Clear module boundaries

## Implementation Notes

1. **Backward Compatibility**: During transition, modules export to both `window.ModuleName` and individual `window.functionName` globals
2. **No Breaking Changes**: Existing code continues to work during gradual migration
3. **Incremental Adoption**: Each phase can be deployed independently
4. **Testing**: Each module tested in isolation before integration
5. **Documentation**: JSDoc comments for all public functions

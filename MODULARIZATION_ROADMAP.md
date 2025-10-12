# Modularization Roadmap for tester.js and election-night.js

## Problem Statement
`tester.js` (4,587 lines) and `election-night.js` (2,343 lines) are large files with significant code duplication. Features added to one file don't carry over to the other, leading to inconsistent functionality (e.g., candidate last names in tooltips work in tester.js but not in election-night.js).

## Analysis Results

### File Statistics
- **tester.js**: 59 functions, 4,587 lines
- **election-night.js**: 72 functions, 2,343 lines

### Identified Duplication Patterns

1. **Tooltip Functions** (High Priority)
   - tester.js has rich tooltip implementation with: `_ensureTip`, `_placeTipAt`, `showMapTip`, `moveMapTip`, `hideMapTip`, `formatUnitTooltip`, `createUnitTipInfo`
   - election-night.js only has: `triggerTipRefresh`
   - **Issue**: Candidate last names in tooltips only work in tester.js

2. **Math/Clamping Functions** (Easy Win)
   - Both files define identical `clampMargin` function
   - tester.js: `clampMargin`, `clampShare`
   - election-night.js: `clampMargin`, `clamp01`, `clampByte`

3. **EV Allocation Functions** (Medium Priority)
   - tester.js defines: `allocateProportionalEVs`, `calculateUnitProportionalEVs`, `calculateUnitVoteTallies`
   - election-night.js imports/uses: `allocateProportionalEVs` from window global
   - Already partially shared via window global, but not clean module pattern

4. **Formatting Functions** (Medium Priority)
   - tester.js: `formatUnitTooltip`
   - election-night.js: `formatLeader`, `formatMarginText`, `formatReportingText`, `formatConfidenceText`, `formatEvAllocationsForLog`, `formatLean`, `formatUnitLabel`, `formatTimeLabel`
   - Similar patterns but different implementations

5. **Color Functions** (Low Priority)
   - Various color-related functions in both files

## Modularization Phases

### Phase 1: Shared Math Utilities (EASIEST - Start Here)
**Effort**: Low | **Impact**: Medium | **Risk**: Very Low

Extract to: `docs/utils/mathUtils.js`

Functions to extract:
- `clampMargin(value)` - identical in both files
- `clamp01(value)` - from election-night.js
- `clampShare(value)` - from tester.js  
- `clampByte(value)` - from election-night.js

**Why start here**:
- Pure functions with no dependencies
- Easy to test
- Clear API surface
- No DOM interaction
- Already used in multiple places

### Phase 2: EV Allocation Module (MEDIUM - High Value)
**Effort**: Medium | **Impact**: High | **Risk**: Low

Extract to: `docs/utils/evAllocation.js`

Functions to extract:
- `allocateProportionalEVs(dVotes, rVotes, oVotes, totalEVs, topThirdPartyShare, thirdPartyResults)` - already defined in tester.js
- Related helper functions

**Why phase 2**:
- Already partially shared via window global
- Well-defined interface
- High reuse potential
- No DOM dependencies

### Phase 3: Tooltip System (MEDIUM-HIGH - Addresses Core Issue)
**Effort**: Medium-High | **Impact**: Very High | **Risk**: Medium

Extract to: `docs/utils/tooltipManager.js`

Functions to extract from tester.js:
- `_ensureTip()` - get/create tooltip element
- `_placeTipAt(evt)` - position tooltip
- `showMapTip(evt, text)` - show tooltip
- `moveMapTip(evt)` - move tooltip
- `hideMapTip()` - hide tooltip
- `refreshActiveMapTip()` - refresh active tooltip
- `createUnitTipInfo(unit, opts)` - create tooltip info object
- `formatUnitTooltip(unit, opts)` - format tooltip content with candidate names

**Why phase 3**:
- Directly addresses the stated problem (candidate names in tooltips)
- Self-contained system
- Can be gradually adopted by election-night.js

### Phase 4: Formatting Utilities (LOW-MEDIUM)
**Effort**: Medium | **Impact**: Medium | **Risk**: Low

Extract to: `docs/utils/formatters.js`

Functions to extract:
- `formatLeader(code)` - format leader code (D/R/O)
- `formatMarginText(marginStr, leader)` - format margin with leader
- `formatReportingText(reporting)` - format reporting percentage
- `formatConfidenceText(confidence)` - format confidence level
- `formatLean(value)` - format lean value
- `formatUnitLabel(unit)` - format unit/state label
- `formatEvAllocationsForLog(callAlloc, finalAlloc)` - format EV allocations

**Why phase 4**:
- Lower priority but still valuable
- Many small, pure functions
- Easy to extract incrementally

### Phase 5: Candidate Name Resolution (OPTIONAL)
**Effort**: Medium | **Impact**: High | **Risk**: Medium

Extract to: `docs/utils/candidateNames.js`

Extract candidate name lookup logic from `formatUnitTooltip` and related functions.

**Why phase 5**:
- More complex due to data dependencies
- Needs careful testing with historical data
- Can be done after tooltip system is modularized

## Implementation Strategy

### Principles
1. **Start small**: Begin with Phase 1 (math utils) - easiest, lowest risk
2. **Incremental adoption**: Keep old code working, gradually migrate
3. **Backward compatibility**: Maintain window globals during transition
4. **Test as we go**: Manual testing with existing pages
5. **Document dependencies**: Clear JSDoc comments for each module

### Module Pattern
```javascript
// Example module structure
(function(global) {
  'use strict';
  
  function clampMargin(value) {
    if (!isFinite(value)) return 0;
    const LIMIT = 1 - 1e-9;
    if (value > LIMIT) return LIMIT;
    if (value < -LIMIT) return -LIMIT;
    return value;
  }
  
  // Export to global scope
  global.MathUtils = {
    clampMargin,
    clamp01,
    clampShare,
    clampByte
  };
})(window);
```

### Dependency Visualization

```
Current State:
tester.js (4587 lines) ─┐
                        ├─> window.allocateProportionalEVs
election-night.js (2343)─┘

Target State (after Phase 1-3):
tester.js ─────┐
               ├─> utils/mathUtils.js
               ├─> utils/evAllocation.js
               ├─> utils/tooltipManager.js
               │
election-night.js ─┘
```

## Tools Setup

### JSCodeShift
Already installed. Can be used for:
- Automated refactoring of function calls
- Finding all usages of a function
- Renaming functions consistently

Example command:
```bash
npx jscodeshift -t transform-script.js docs/tester.js --dry --print
```

### Dependency Analysis
Use grep/ripgrep to find:
- Function definitions: `grep -n "function functionName"`
- Function calls: `grep -n "functionName("`
- Global exports: `grep -n "window\\."`

## Success Metrics

1. **Code Reuse**: Same tooltip code used in both files
2. **Consistency**: Candidate names appear in both tester.js and election-night.js tooltips
3. **Maintainability**: New features can be added to shared modules
4. **Size Reduction**: Both files should shrink by extracting common code
5. **No Regressions**: All existing functionality continues to work

## Next Steps

1. ✅ Install jscodeshift
2. ✅ Analyze code duplication patterns
3. ✅ Create modularization roadmap
4. → Implement Phase 1: Math utilities
5. → Implement Phase 2: EV allocation  
6. → Implement Phase 3: Tooltip system
7. → Test and verify each phase
8. → Document usage patterns

## Notes

- The existing `docs/utils/siteState.js` provides a good example of the module pattern we should follow
- Keep backward compatibility by maintaining window globals during transition
- Consider adding `use strict` to all new modules
- Add JSDoc comments for better IDE support

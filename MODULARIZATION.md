# Modularization Summary

This document describes the modularization work done to break up the large JavaScript files in the margin-matters project.

## Current Status

### Files and Line Counts

**Original (Backed up in `docs/_archive/`)**:
- `tester.js`: 4,584 lines
- `election-night.js`: 2,369 lines

**Current**:
- `tester.js`: 4,584 lines (still needs reduction)
- `election-night.js`: 2,369 lines (still needs reduction)

**Target**: <1,000 lines each (ideally 500-800)

### What's Been Done

✅ Fixed syntax errors in `index.html` (duplicate script tags, missing closing tags)
✅ Created 7 utility modules (~940 lines extracted):
  - `constants.js` (64 lines)
  - `colorUtils.js` (97 lines)
  - `formatting.js` (84 lines)
  - `evCalculations.js` (128 lines)
  - `voteCalculations.js` (92 lines)
  - `mapInteraction.js` (270 lines) **NEW**
  - `urlUtils.js` (50 lines) **NEW**
✅ Updated HTML files to load modules in correct order
✅ Maintained backward compatibility with fallbacks

## Utility Modules

### 1. `constants.js` - Shared Constants
- `ID_TO_ABBR`: FIPS to state abbreviation mapping
- `STATE_NAMES`: Full state names
- `SMALL_STATES`: Set of small states
- `EPS`, `PV_CAP`: Numeric constants
- `NEUTRAL_COLOR`, `THIRD_PARTY_COLOR`: Default colors

### 2. `colorUtils.js` - Color Manipulation
- `hexToRgb()` / `rgbToHex()` - Color format conversion
- `blendColors()` - Color interpolation
- `marginToColor()` - Election margin to color mapping
- `safeMarginToColor()` - Fallback color conversion

### 3. `formatting.js` - Display Formatting
- `leanStr()` - Format margins as "D+5.3" or "R+2.1"
- `formatMargin()` - Margin display formatting
- `formatUnitLabel()` - State/district label formatting
- `formatVotes()` - Number formatting with commas
- `formatPercent()` - Percentage formatting
- `clampMargin()` / `clamp01()` - Value clamping

### 4. `evCalculations.js` - Electoral Vote Logic
- `allocateProportionalEVs()` - Proportional EV allocation using largest remainder method

### 5. `voteCalculations.js` - Vote Calculations
- `totalVotesFromRow()` - Extract total votes
- `computePvAdjustedBreakdown()` - Calculate PV-adjusted breakdowns

### 6. `mapInteraction.js` - Map & Tooltip Utilities (NEW)
- `setSmallBoxesConfig()` - Configure small state boxes
- `nudgeSmallBoxes()` - Move small state boxes
- `setVisualCenterStates()` - Configure visual center calculation
- `showMapTip()` / `hideMapTip()` - Tooltip management
- `_computeVisualCenter()` - Calculate polygon visual centers

### 7. `urlUtils.js` - URL Parameter Management (NEW)
- `getUrlParams()` - Parse URL parameters
- `updateUrl()` - Update URL with current state

## Next Steps to Reach Target

### For `tester.js` (needs ~3,600 lines reduced):

**High Priority Extractions**:

1. **EV Breakdown Modal** (~800 lines)
   - Functions: `initEvBreakdownModal()`, `updateEvBreakdownTable()`, `getAllEvAllocations()`
   - Self-contained modal logic
   - Create: `utils/evBreakdownModal.js`

2. **Flip Scenarios** (~1,300 lines)
   - All flip calculation and UI update logic
   - Create: `utils/flipScenarios.js`

3. **Data Loading & Initialization** (~1,000 lines)
   - CSV parsing, data structures, stop generation
   - Create: `utils/dataLoader.js`

4. **Remove Duplicate Implementations** (~200 lines)
   - Use `MapInteraction` instead of local tooltip functions
   - Use `UrlUtils` instead of local URL functions
   - Use shared `_computeVisualCenter()` from `MapInteraction`

5. **State Labels & Small Boxes** (~500 lines)
   - Could extend `mapInteraction.js` or create `mapRendering.js`

**Result**: ~800 lines remaining ✅

### For `election-night.js` (needs ~1,400 lines reduced):

**Recommended Extractions**:

1. **Reporting Schedule** (~300 lines)
   - Schedule generation, batch timing
   - Create: `utils/reportingSchedule.js`

2. **Bias Calculation** (~200 lines)
   - Bias parameters, logistic calculations
   - Create: `utils/biasModel.js`

3. **Call Log Rendering** (~400 lines)
   - Call log updates, victory screen, uncalled states
   - Create: `utils/callLog.js`

4. **UI Updates** (~500 lines)
   - EV bar, popular vote display, progress slider
   - Create: `utils/electionNightUI.js`

**Result**: ~970 lines remaining ✅

## Implementation Strategy

1. **One module at a time** - Extract, test, commit
2. **Keep backups** - Originals in `docs/_archive/`
3. **Test thoroughly** - Verify each extraction works correctly
4. **Document dependencies** - Note what globals each module needs
5. **Maintain compatibility** - Keep fallbacks for safety

## Benefits

✅ Code reusability across different map functionalities
✅ Easier maintenance with smaller, focused files
✅ Better flexibility for paths2028, probabilities, etc.
✅ Backward compatible with fallback implementations
✅ No breaking changes to existing functionality

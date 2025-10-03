# Modularization Summary

This document describes the modularization work done to break up the large JavaScript files in the margin-matters project.

## Overview

The following large files have been refactored to use shared utility modules:
- `docs/tester.js` (4568 lines)
- `docs/election-night.js` (2343 lines)
- `docs/utils/electionMap.js` (383 lines)

## New Utility Modules Created

All new modules are located in `docs/utils/` directory:

### 1. `constants.js`
Exports: `ElectionConstants`

Shared constants used across all election scripts:
- `ID_TO_ABBR`: FIPS code to state abbreviation mapping
- `STATE_NAMES`: Full state names
- `SMALL_STATES`: Set of small states for UI display
- `EPS`, `PV_CAP`: Numeric constants
- `NEUTRAL_COLOR`, `THIRD_PARTY_COLOR`: Default colors

### 2. `colorUtils.js`
Exports: `ColorUtils`

Color manipulation and conversion functions:
- `hexToRgb(hex)`: Convert hex color to RGB array
- `rgbToHex(r, g, b)`: Convert RGB to hex color
- `blendColors(a, b, t)`: Interpolate between two colors
- `marginToColor(margin, isThirdParty)`: Convert election margin to color
- `safeMarginToColor(margin, isThird)`: Safe fallback for margin-to-color conversion
- `clampByte(v)`: Clamp value to byte range

### 3. `formatting.js`
Exports: `FormattingUtils`

Formatting utilities for display:
- `leanStr(x)`: Format margin as "D+X.X" or "R+X.X"
- `formatMargin(margin)`: Format margin for display
- `formatUnitLabel(unit)`: Format state/district labels
- `formatVotes(votes)`: Format vote counts with commas
- `formatPercent(value, decimals)`: Format percentage values
- `clampMargin(value)`: Clamp margin to valid range
- `clamp01(x)`: Clamp value to 0-1 range

### 4. `evCalculations.js`
Exports: `EvCalculations`

Electoral vote allocation logic:
- `allocateProportionalEVs(dVotes, rVotes, oVotes, totalEVs, topThirdPartyShare, thirdPartyResults)`: 
  Proportional EV allocation using largest remainder method with support for multiple third parties

### 5. `voteCalculations.js`
Exports: `VoteCalculations`

Vote calculation and manipulation:
- `totalVotesFromRow(row)`: Extract total votes from data row
- `computePvAdjustedBreakdown(row, pvShift, natActualMargin)`: Calculate PV-adjusted vote breakdown

## Modified Files

### `tester.js`
- Updated to use shared constants from `ElectionConstants`
- Updated to use shared utility functions from `ColorUtils`, `FormattingUtils`, `EvCalculations`, and `VoteCalculations`
- Falls back to local implementations if shared modules are not loaded (backward compatibility)

### `election-night.js`
- Updated to use shared constants from `ElectionConstants`
- Updated to use shared utility functions from `ColorUtils` and `FormattingUtils`
- Falls back to local implementations if shared modules are not loaded (backward compatibility)

### `utils/electionMap.js`
- Updated to use `ID_TO_ABBR` from `ElectionConstants` if available
- Falls back to local constant if shared module is not loaded

### HTML Files Updated
The following HTML files have been updated to load utility modules before main scripts:
- `index.html`
- `future.html`
- `paths2028.html`
- `probabilities.html`

Loading order:
1. d3 and topojson (from CDN)
2. Shared utility modules (constants, colorUtils, formatting, evCalculations, voteCalculations, electionMap)
3. Main application scripts (tester.js, election-night.js, etc.)

## Benefits

1. **Code Reusability**: Common functionality is now in one place and can be used by multiple scripts
2. **Maintainability**: Smaller, focused files are easier to understand and modify
3. **Flexibility**: Different map functionalities (paths2028, probabilities, etc.) can use the same core utilities
4. **Backward Compatibility**: All modules include fallback implementations, so the code still works even if modules aren't loaded
5. **No Breaking Changes**: Existing functionality is preserved; this is purely a refactoring

## Testing

The modularized code has been tested to ensure:
- No syntax errors in any module
- HTML files correctly reference all required modules
- Loading order is correct (dependencies before dependents)

## Future Improvements

Potential areas for further modularization:
1. Extract map rendering logic from `tester.js` into a separate module
2. Extract tooltip/hover functionality into a shared module
3. Extract URL parameter handling into a utility module
4. Create a shared module for election night simulation logic that can be reused
5. Extract small state boxes rendering into a separate module

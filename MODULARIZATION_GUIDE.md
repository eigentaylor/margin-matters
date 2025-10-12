# Modularization Guide for Developers

This guide explains the modularization effort for `tester.js` and `election-night.js` and how to use the new shared modules.

## Quick Start

To see the full analysis and roadmap, read these documents:
- **[MODULARIZATION_ROADMAP.md](./MODULARIZATION_ROADMAP.md)** - Detailed 5-phase roadmap
- **[DEPENDENCY_GRAPH.md](./DEPENDENCY_GRAPH.md)** - Visual dependency graphs with Mermaid diagrams
- **[MODULARIZATION_SUMMARY.md](./MODULARIZATION_SUMMARY.md)** - Implementation summary and recommendations

To generate a report, run:
```bash
node generate-report.js
```

## Completed Modules

### Phase 1: Math Utilities ✓

**File**: `docs/utils/mathUtils.js`

**Usage**:
```html
<!-- Add to your HTML -->
<script src="utils/mathUtils.js"></script>
```

```javascript
// Use in your code
const margin = MathUtils.clampMargin(value);
const normalized = MathUtils.clamp01(share);
const rgb = MathUtils.clampByte(colorComponent);

// Or use backward-compatible globals
const margin = clampMargin(value); // Still works!
```

**Functions**:
- `clampMargin(value)` - Clamp margin to [-1+ε, 1-ε]
- `clamp01(x)` - Clamp to [0, 1]
- `clampShare(value)` - Clamp share to (0, 1]
- `clampByte(v)` - Clamp to [0, 255]
- `clamp(value, min, max)` - Generic clamp

**Testing**:
```bash
node test-math-utils.js
```

## Planned Modules

### Phase 2: EV Allocation (Next)

**File**: `docs/utils/evAllocation.js` (planned)

Will extract:
- `allocateProportionalEVs()` and related functions
- Currently shared via `window.allocateProportionalEVs` in tester.js

### Phase 3: Tooltip System (High Priority)

**File**: `docs/utils/tooltipManager.js` (planned)

Will extract:
- `showMapTip()`, `hideMapTip()`, `moveMapTip()`
- `formatUnitTooltip()` - includes candidate name support
- Solves the main issue: candidate names missing in election-night.js tooltips

### Phase 4: Formatters

**File**: `docs/utils/formatters.js` (planned)

Will extract:
- `formatLeader()`, `formatMarginText()`
- `formatReportingText()`, `formatConfidenceText()`
- Other formatting utilities

### Phase 5: Candidate Names

**File**: `docs/utils/candidateNames.js` (planned)

Will extract:
- Candidate name lookup logic
- Last name extraction
- Party-to-candidate mapping

## Tools

### Dependency Analyzer

```bash
node analyze-dependencies.js
```

Outputs:
- Function counts per file
- Common function names (duplication candidates)
- External dependencies
- Target functions for extraction

### Report Generator

```bash
node generate-report.js
```

Generates a formatted report showing:
- Status of each phase
- Functions to extract
- Estimated impact
- Next steps

## Integration Pattern

### Adding a New Module

1. **Create the module** following the existing pattern:
```javascript
(function(global) {
  'use strict';
  
  /**
   * JSDoc comment
   * @param {type} param - description
   * @returns {type} description
   */
  function myFunction(param) {
    // implementation
  }
  
  // Export to global scope
  global.MyModule = {
    myFunction
  };
  
  // Optional: backward compatibility
  if (!global.myFunction) {
    global.myFunction = myFunction;
  }
})(window);
```

2. **Add script tag** to HTML files:
```html
<script src="utils/myModule.js"></script>
```

3. **Test the module** in isolation:
```bash
node test-my-module.js
```

4. **Test integration** with existing pages:
- Load the page in browser
- Verify existing functionality works
- Check browser console for errors

### Backward Compatibility

All modules maintain backward compatibility by exporting to both:
1. Module namespace: `window.ModuleName.functionName()`
2. Global function: `window.functionName()` (if not already defined)

This ensures existing code continues to work without changes.

### Migration Strategy

1. **Phase 1**: Create module, keep old code
2. **Phase 2**: Add script tags to HTML, test
3. **Phase 3**: Gradually update code to use module namespace (optional)
4. **Phase 4**: Remove old duplicate code (future cleanup)

## Problem Being Solved

**Main Issue**: Features added to `tester.js` don't carry over to `election-night.js`

**Example**: Candidate last names appear in tooltips in tester.js but not in election-night.js, because the tooltip formatting code was duplicated and diverged.

**Solution**: Extract tooltip system (Phase 3) into shared module so both files use the same code.

## Benefits

1. **Code Reuse**: Write once, use everywhere
2. **Consistency**: Same behavior across all pages
3. **Maintainability**: Fix bugs once, propagate everywhere
4. **Testability**: Test modules in isolation
5. **Documentation**: JSDoc for better IDE support
6. **Smaller Files**: Both tester.js and election-night.js will shrink by ~25%

## File Structure

```
docs/
├── utils/
│   ├── mathUtils.js          # ✓ Phase 1 (new)
│   ├── evAllocation.js       # Phase 2 (planned)
│   ├── tooltipManager.js     # Phase 3 (planned)
│   ├── formatters.js         # Phase 4 (planned)
│   ├── candidateNames.js     # Phase 5 (planned)
│   ├── siteState.js          # Existing
│   ├── electionMap.js        # Existing
│   └── TrendsChart.js        # Existing
├── tester.js                 # Will shrink after modularization
└── election-night.js         # Will shrink after modularization

analyze-dependencies.js       # ✓ Dependency analyzer
generate-report.js            # ✓ Report generator
MODULARIZATION_ROADMAP.md     # ✓ Detailed roadmap
DEPENDENCY_GRAPH.md           # ✓ Visual graphs
MODULARIZATION_SUMMARY.md     # ✓ Summary
```

## Contributing

When adding features that should work in both tester.js and election-night.js:

1. Check if a relevant module exists in `docs/utils/`
2. If yes, add your feature to the module
3. If no, consider creating a new module or updating the roadmap
4. Always maintain backward compatibility
5. Add JSDoc documentation
6. Test with both files

## Next Steps

1. **Integrate Phase 1**: Add mathUtils.js to HTML pages
2. **Implement Phase 2**: Extract EV allocation module
3. **Implement Phase 3**: Extract tooltip system (HIGH PRIORITY)
   - This will solve the candidate names issue
   - Highest user-visible impact

## Questions?

See the detailed documentation:
- [MODULARIZATION_ROADMAP.md](./MODULARIZATION_ROADMAP.md)
- [DEPENDENCY_GRAPH.md](./DEPENDENCY_GRAPH.md)
- [MODULARIZATION_SUMMARY.md](./MODULARIZATION_SUMMARY.md)

Or run the analysis tools:
```bash
node analyze-dependencies.js
node generate-report.js
```

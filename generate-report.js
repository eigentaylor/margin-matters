#!/usr/bin/env node

/**
 * Generate a simple text-based dependency report
 * Shows which functions from each file could be extracted to modules
 */

const fs = require('fs');
const path = require('path');

console.log(`
╔════════════════════════════════════════════════════════════════╗
║                MODULARIZATION DEPENDENCY REPORT                ║
╔════════════════════════════════════════════════════════════════╝
║
║ Analysis of tester.js and election-night.js
║ Identifying extractable functions for modularization
║
╚════════════════════════════════════════════════════════════════

`);

// Phase 1: Math Utilities (✓ COMPLETE)
console.log('📊 PHASE 1: MATH UTILITIES (✓ COMPLETE)');
console.log('─'.repeat(65));
console.log('Module: docs/utils/mathUtils.js');
console.log('Status: ✓ Created and tested');
console.log('');
console.log('Functions extracted:');
console.log('  ✓ clampMargin(value)     - Clamp margin to [-1+ε, 1-ε]');
console.log('  ✓ clamp01(x)             - Clamp to [0, 1]');
console.log('  ✓ clampShare(value)      - Clamp share to (0, 1]');
console.log('  ✓ clampByte(v)           - Clamp to [0, 255]');
console.log('  ✓ clamp(value, min, max) - Generic clamp');
console.log('');
console.log('Impact: Eliminates duplicate clampMargin in both files');
console.log('Lines saved: ~30 lines');
console.log('');

// Phase 2: EV Allocation
console.log('🗳️  PHASE 2: EV ALLOCATION (NEXT - HIGH VALUE)');
console.log('─'.repeat(65));
console.log('Module: docs/utils/evAllocation.js');
console.log('Status: ⏳ Planned');
console.log('');
console.log('Functions to extract:');
console.log('  □ allocateProportionalEVs()');
console.log('    Source: tester.js (currently shared via window global)');
console.log('    Used by: election-night.js');
console.log('    ~100 lines');
console.log('  □ Helper functions for EV calculations');
console.log('');
console.log('Impact: Formalizes already-shared EV logic into proper module');
console.log('Estimated lines: ~150 lines in new module');
console.log('');

// Phase 3: Tooltip System
console.log('💬 PHASE 3: TOOLTIP SYSTEM (HIGH PRIORITY - FIXES MAIN ISSUE)');
console.log('─'.repeat(65));
console.log('Module: docs/utils/tooltipManager.js');
console.log('Status: ⏳ Planned - addresses core problem');
console.log('');
console.log('Functions to extract from tester.js:');
console.log('  □ showMapTip(evt, text)        - Show tooltip');
console.log('  □ hideMapTip()                 - Hide tooltip');
console.log('  □ moveMapTip(evt)              - Move tooltip');
console.log('  □ formatUnitTooltip(unit, opts) - Format with candidate names ⭐');
console.log('  □ createUnitTipInfo(unit, opts) - Create tooltip info');
console.log('  □ _ensureTip()                 - Get/create tooltip element');
console.log('  □ _placeTipAt(evt)             - Position tooltip');
console.log('  □ refreshActiveMapTip()        - Refresh active tooltip');
console.log('');
console.log('⭐ KEY FEATURE: Candidate last names in tooltips');
console.log('');
console.log('Current state:');
console.log('  ✓ tester.js: Has candidate names in tooltips');
console.log('  ✗ election-night.js: Missing candidate names in tooltips');
console.log('');
console.log('After Phase 3:');
console.log('  ✓ Both files: Candidate names in tooltips');
console.log('  ✓ Consistent tooltip behavior across all pages');
console.log('');
console.log('Impact: Solves the main stated problem');
console.log('Estimated lines: ~200 lines in new module');
console.log('Lines saved: ~150 lines from each file');
console.log('');

// Phase 4: Formatters
console.log('🎨 PHASE 4: FORMATTING UTILITIES (MEDIUM PRIORITY)');
console.log('─'.repeat(65));
console.log('Module: docs/utils/formatters.js');
console.log('Status: ⏳ Planned');
console.log('');
console.log('Functions to extract:');
console.log('  □ formatLeader(code)           - Format D/R/O codes');
console.log('  □ formatMarginText()           - Format margin with leader');
console.log('  □ formatReportingText()        - Format reporting %');
console.log('  □ formatConfidenceText()       - Format confidence level');
console.log('  □ formatLean(value)            - Format lean value');
console.log('  □ formatUnitLabel(unit)        - Format unit/state label');
console.log('  □ formatEvAllocationsForLog()  - Format EV allocations');
console.log('');
console.log('Impact: Consistent formatting across all pages');
console.log('Estimated lines: ~100 lines in new module');
console.log('');

// Phase 5: Candidate Names
console.log('👤 PHASE 5: CANDIDATE NAME RESOLUTION (OPTIONAL)');
console.log('─'.repeat(65));
console.log('Module: docs/utils/candidateNames.js');
console.log('Status: ⏳ Planned - after Phase 3');
console.log('');
console.log('Functions to extract:');
console.log('  □ Candidate name lookup logic');
console.log('  □ Last name extraction');
console.log('  □ Party-to-candidate mapping');
console.log('');
console.log('Impact: Cleaner separation of data vs presentation');
console.log('Estimated lines: ~80 lines in new module');
console.log('');

// Summary
console.log('═'.repeat(65));
console.log('SUMMARY');
console.log('═'.repeat(65));
console.log('');
console.log('Current state:');
console.log('  • tester.js:         4,587 lines');
console.log('  • election-night.js: 2,343 lines');
console.log('  • Total:             6,930 lines');
console.log('');
console.log('After all phases (estimated):');
console.log('  • tester.js:         ~3,400 lines (-25%)');
console.log('  • election-night.js: ~1,750 lines (-25%)');
console.log('  • Shared modules:    ~630 lines (new)');
console.log('  • Net reduction:     ~1,150 lines');
console.log('');
console.log('Benefits:');
console.log('  ✓ Eliminates code duplication');
console.log('  ✓ Candidate names in tooltips everywhere (Phase 3)');
console.log('  ✓ Easier to add features across both files');
console.log('  ✓ Better code organization');
console.log('  ✓ Single source of truth for each function');
console.log('  ✓ Easier testing and maintenance');
console.log('');
console.log('Next steps:');
console.log('  1. Integrate Phase 1 (mathUtils.js) into HTML pages');
console.log('  2. Implement Phase 2 (evAllocation.js)');
console.log('  3. Implement Phase 3 (tooltipManager.js) - HIGH PRIORITY');
console.log('');
console.log('═'.repeat(65));
console.log('');

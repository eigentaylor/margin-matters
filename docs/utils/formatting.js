(function() {
  'use strict';

  // Shared formatting utilities for election data

  // Format a lean/margin value as a string (e.g., "D+5.3" or "R+2.1")
  function leanStr(x) {
    if (!isFinite(x)) return 'ERROR';
    if (Math.abs(x) < 0.00005) return 'EVEN';
    const pct = (Math.abs(x) * 100).toFixed(1);
    return `${x > 0 ? 'D' : 'R'}+${pct}`;
  }

  // Format a margin value for display
  function formatMargin(margin) {
    if (!isFinite(margin)) return 'N/A';
    if (Math.abs(margin) < 0.00005) return 'EVEN';
    const pct = (Math.abs(margin) * 100).toFixed(1);
    return `${margin > 0 ? 'D' : 'R'}+${pct}`;
  }

  // Format a unit label (state or district) for display
  function formatUnitLabel(unit) {
    if (!unit) return '';
    
    // Get state names
    const STATE_NAMES = window.ElectionConstants ? window.ElectionConstants.STATE_NAMES : {};
    
    // Simple state code (e.g., "PA")
    if (/^[A-Z]{2}$/.test(unit)) {
      return STATE_NAMES[unit] || unit;
    }
    
    // At-large district (e.g., "ME-AL")
    if (/-AL$/.test(unit)) {
      const abbr = unit.slice(0, 2);
      return `${STATE_NAMES[abbr] || abbr} at-large`;
    }
    
    // Congressional district (e.g., "ME-01")
    if (/(ME|NE)-0[1-9]$/.test(unit)) {
      const abbr = unit.slice(0, 2);
      const district = unit.slice(3);
      return `${STATE_NAMES[abbr] || abbr} ${district}`;
    }
    
    return unit;
  }

  // Format a number of votes with commas
  function formatVotes(votes) {
    if (!isFinite(votes)) return '0';
    return Math.round(votes).toLocaleString('en-US');
  }

  // Format a percentage value
  function formatPercent(value, decimals = 1) {
    if (!isFinite(value)) return '0.0%';
    return (value * 100).toFixed(decimals) + '%';
  }

  // Clamp a margin to valid range
  function clampMargin(value) {
    if (!isFinite(value)) return 0;
    const LIMIT = 1 - 1e-9;
    if (value > LIMIT) return LIMIT;
    if (value < -LIMIT) return -LIMIT;
    return value;
  }

  // Clamp a value to 0-1 range
  function clamp01(x) {
    if (!isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  // Export to global scope
  const FormattingUtils = {
    leanStr,
    formatMargin,
    formatUnitLabel,
    formatVotes,
    formatPercent,
    clampMargin,
    clamp01
  };

  try {
    window.FormattingUtils = FormattingUtils;
  } catch(e) {
    console.error('[FormattingUtils] Failed to export to window:', e);
  }
})();

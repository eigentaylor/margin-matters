(function() {
  'use strict';

  // URL parameter management for sharing election map states
  // Supports: pv (slider index, numeric PV, or preset name), year, flip modes

  function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const year = params.get('year');
    const pv = params.get('pv');
    const flip = params.get('flip');
    return {
      year: year ? parseInt(year, 10) : null,
      pv: pv,
      flip: flip
    };
  }

  function updateUrl(year, pvIndex, flipMode) {
    if (!year) return;
    const params = new URLSearchParams();
    params.set('year', String(year));
    
    if (pvIndex != null && isFinite(pvIndex)) {
      params.set('pv', String(pvIndex));
    } else if (window._pvOverride != null && isFinite(window._pvOverride)) {
      params.set('pv', String(window._pvOverride));
    }
    
    if (flipMode) params.set('flip', flipMode);
    
    const url = window.location.pathname + '?' + params.toString();
    try {
      window.history.replaceState({}, '', url);
    } catch (e) {
      // Silently fail if history API is not available
    }
  }

  // Export to global scope
  const UrlUtils = {
    getUrlParams,
    updateUrl
  };

  try {
    window.UrlUtils = UrlUtils;
  } catch (e) {
    console.error('[UrlUtils] Failed to export to window:', e);
  }
})();

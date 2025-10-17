// Centralized PV presets used by index.html and future.html
(function () {
  // Array of { value: number, label: string }
  const PRESETS = [
    { value: '', label: 'Select preset…' },
    { value: 0.005, label: 'Gore: D+0.5', year: 2000 },
    { value: 0.021, label: 'Clinton: D+2.1', year: 2016 },
    { value: -0.016, label: 'Trump: R+1.6', year: 2024 },
    { value: 0.045, label: 'Biden: D+4.5', year: 2020 },
    { value: 0.075, label: 'Obama: D+7.5', year: 2008 },
    { value: 0.085, label: 'William Clinton: D+8.5', year: 1996 },
    { value: -0.118, label: 'Grant: R+11.8', year: 1872 },
    { value: -0.154, label: 'Eisenhower: R+15.4', year: 1956 },
    { value: -0.182, label: 'Reagan: R+18.2', year: 1984 },
    { value: 0.226, label: 'Johnson: D+22.6', year: 1964 },
    { value: -0.231, label: 'Nixon: R+23.1', year: 1972 }
  ];

  // Expose presets for other scripts
  window.PV_PRESETS = PRESETS;
  // Also expose them in a format consumed by buildPvStops: an array of { val, name }
  try {
  window._pvExtraPresets = (window._pvExtraPresets && Array.isArray(window._pvExtraPresets)) ? window._pvExtraPresets : PRESETS.filter(p => p.value !== '').map(p => ({ val: Number(p.value), name: (p.label || '').split(':')[0].trim(), year: (p.year != null && isFinite(Number(p.year))) ? Number(p.year) : null }));
    // Default to adding negative mirrors as well
    window._injectNegativePresets = (typeof window._injectNegativePresets !== 'undefined') ? !!window._injectNegativePresets : true;
  } catch (e) { /* ignore */ }

  function populatePvPresetSelect(selectEl) {
    if (!selectEl) return;
    // Remove existing children if any
    while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);
    PRESETS.forEach(p => {
      const opt = document.createElement('option');
      opt.value = (p.value === '') ? '' : String(p.value);
      opt.textContent = p.label;
      if (p.year != null && isFinite(Number(p.year))) opt.dataset.year = String(Number(p.year));
      selectEl.appendChild(opt);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    try {
      const sel = document.getElementById('pvPreset');
      if (sel) populatePvPresetSelect(sel);
    } catch (e) { /* silent */ }
  });
})();

// Centralized PV presets used by index.html and future.html
(function () {
  // Array of { value: number, label: string }
  const PRESETS = [
    { value: '', label: 'Select preset…' },
    { value: 0.005, label: 'Gore: D+0.5' },
    { value: 0.021, label: 'Clinton: D+2.1' },
    { value: -0.016, label: 'Trump: R+1.6' },
    { value: 0.045, label: 'Biden: D+4.5' },
    { value: 0.075, label: 'Obama: D+7.5' },
    { value: 0.085, label: 'William Clinton: D+8.5' },
    { value: -0.118, label: 'Grant: R+11.8' },
    { value: -0.154, label: 'Eisenhower: R+15.4' },
    { value: -0.182, label: 'Reagan: R+18.2' },
    { value: 0.226, label: 'Johnson: D+22.6' },
    { value: -0.231, label: 'Nixon: R+23.1' }
  ];

  // Expose presets for other scripts
  window.PV_PRESETS = PRESETS;

  function populatePvPresetSelect(selectEl) {
    if (!selectEl) return;
    // Remove existing children if any
    while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);
    PRESETS.forEach(p => {
      const opt = document.createElement('option');
      opt.value = (p.value === '') ? '' : String(p.value);
      opt.textContent = p.label;
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

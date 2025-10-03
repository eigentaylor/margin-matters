(function() {
  'use strict';

  // Shared color utilities for election maps and visualizations

  // Get default colors from constants
  const getDefaultColors = () => {
    if (window.ElectionConstants) {
      return {
        neutral: window.ElectionConstants.NEUTRAL_COLOR,
        thirdParty: window.ElectionConstants.THIRD_PARTY_COLOR
      };
    }
    return {
      neutral: '#2f2f2f',
      thirdParty: '#C9A400'
    };
  };

  // Clamp a value to byte range (0-255)
  function clampByte(v) {
    return Math.max(0, Math.min(255, v | 0));
  }

  // Convert hex color to RGB array
  function hexToRgb(hex) {
    if (!hex) return [47, 47, 47];
    let cleaned = hex.replace('#', '');
    if (cleaned.length === 8) cleaned = cleaned.slice(0, 6);
    if (cleaned.length === 3) cleaned = cleaned.split('').map(c => c + c).join('');
    if (cleaned.length !== 6) return [47, 47, 47];
    const num = parseInt(cleaned, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  // Convert RGB to hex color
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => clampByte(v).toString(16).padStart(2, '0')).join('');
  }

  // Blend two colors with interpolation factor t (0-1)
  function blendColors(a, b, t) {
    const rgbA = hexToRgb(a);
    const rgbB = hexToRgb(b);
    const blended = [
      Math.round(rgbA[0] + (rgbB[0] - rgbA[0]) * t),
      Math.round(rgbA[1] + (rgbB[1] - rgbA[1]) * t),
      Math.round(rgbA[2] + (rgbB[2] - rgbA[2]) * t)
    ];
    return rgbToHex(blended[0], blended[1], blended[2]);
  }

  // Convert margin to color (standard D/R color scale)
  function marginToColor(m, isThirdParty = false) {
    const colors = getDefaultColors();
    if (isThirdParty) return colors.thirdParty;
    
    if (m <= -0.20) return '#8B0000'; // Dark red (safe R)
    if (m <= -0.10) return '#B22222'; // Firebrick (likely R)
    if (m <= -0.05) return '#CD5C5C'; // Indian red (lean R)
    if (m < 0) return '#F08080'; // Light coral (tilt R)
    if (m < 0.05) return '#87CEFA'; // Light sky blue (tilt D)
    if (m < 0.10) return '#6495ED'; // Cornflower blue (lean D)
    if (m < 0.20) return '#4169E1'; // Royal blue (likely D)
    return '#00008B'; // Dark blue (safe D)
  }

  // Safe margin to color conversion (with fallback)
  function safeMarginToColor(margin, isThird) {
    const colors = getDefaultColors();
    if (isThird) return colors.thirdParty;
    if (typeof window.marginToColor === 'function') {
      return window.marginToColor(margin, false);
    }
    return marginToColor(margin, false);
  }

  // Export to global scope
  const ColorUtils = {
    clampByte,
    hexToRgb,
    rgbToHex,
    blendColors,
    marginToColor,
    safeMarginToColor,
    getDefaultColors
  };

  try {
    window.ColorUtils = ColorUtils;
  } catch(e) {
    console.error('[ColorUtils] Failed to export to window:', e);
  }
})();

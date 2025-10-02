// Dynamically load and inject the "back to map" and "last updated" elements
(function() {
  function createBackToMap(isInner = false) {
    const prefix = isInner ? '..' : '.';
    
    const backToMapHTML = `
      <div style="margin-top:12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <a class="back" href="${prefix}/index.html">← Back to Map</a>
        <div class="legend" style="font-size:0.85rem" data-last-updated>Last updated: ...</div>
      </div>
    `;
    
    return backToMapHTML;
  }
  
  function injectBackToMap() {
    // Find the placeholder element
    const placeholder = document.getElementById('back-to-map-placeholder');
    if (!placeholder) {
      console.warn('Back to map placeholder not found');
      return;
    }
    
    // Determine if this is an inner page (in a subdirectory)
    const pathParts = window.location.pathname.split('/');
    const isInner = pathParts.length > 2 && pathParts[pathParts.length - 2] !== '';
    
    // Inject the back to map element
    placeholder.innerHTML = createBackToMap(isInner);
  }
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBackToMap);
  } else {
    injectBackToMap();
  }
})();

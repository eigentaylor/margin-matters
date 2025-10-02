// Load and inject the last updated timestamp from last-updated.json
(function() {
  // Determine the correct path based on current location
  const pathParts = window.location.pathname.split('/').filter(p => p);
  const depth = pathParts.length - pathParts.indexOf('docs') - 1;
  const prefix = depth > 0 ? '../'.repeat(depth) : './';
  
  fetch(prefix + 'last-updated.json')
    .then(response => response.json())
    .then(data => {
      const timestamp = data.lastUpdated;
      // Find all elements with data-last-updated attribute and update them
      document.querySelectorAll('[data-last-updated]').forEach(el => {
        el.textContent = 'Last updated: ' + timestamp;
      });
    })
    .catch(err => {
      console.warn('Could not load last-updated.json:', err);
    });
})();

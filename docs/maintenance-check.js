// Maintenance mode check
// This script checks if maintenance mode is enabled and redirects to maintenance page if needed
(function() {
  const MAINTENANCE_ENABLED = false;
  const MAINTENANCE_PASSWORD_HASH = '1970107310';
  
  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }
  
  // Check if we're already on the maintenance page
  const isMaintenancePage = window.location.pathname.endsWith('/maintenance.html');
  
  if (MAINTENANCE_ENABLED && !isMaintenancePage) {
    // Check if user has valid authentication in sessionStorage
    const auth = sessionStorage.getItem('maintenanceAuth');
    
    if (auth !== MAINTENANCE_PASSWORD_HASH) {
      // Redirect to maintenance page with current page as redirect parameter
      const currentPath = window.location.pathname.split('/').pop() || 'index.html';
      window.location.href = 'maintenance.html?redirect=' + encodeURIComponent(currentPath);
    }
  }
  
  // If on maintenance page and already authenticated, redirect to home
  if (isMaintenancePage && sessionStorage.getItem('maintenanceAuth') === MAINTENANCE_PASSWORD_HASH) {
    const urlParams = new URLSearchParams(window.location.search);
    const redirect = urlParams.get('redirect') || 'index.html';
    window.location.href = redirect;
  }
})();

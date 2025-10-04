// Maintenance mode check
// This script checks if maintenance mode is enabled and redirects to maintenance page if needed
(function() {
  const MAINTENANCE_ENABLED = true;
  const MAINTENANCE_PASSWORD_HASH = '-1634889951';
  
  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }
  
  // Determine the correct path to maintenance.html based on current location
  function getMaintenancePath() {
    const path = window.location.pathname;
    const pathParts = path.split('/').filter(p => p);
    // If we're at the site root ("/" or "/index.html"), point to root maintenance.html
    if (pathParts.length === 0) return '/maintenance.html';
    if (pathParts.length === 1 && pathParts[0].includes('.')) return '/maintenance.html';
    // Otherwise assume the first path segment is the project base (e.g. /margin-matters/...) and
    // build an absolute path to the maintenance page within that project so the redirect stays
    // on the project's GitHub Pages site instead of jumping to the user root site.
    const projectBase = '/' + pathParts[0] + '/';
    return projectBase + 'maintenance.html';
  }
  
  // Check if we're already on the maintenance page
  const isMaintenancePage = window.location.pathname.endsWith('/maintenance.html');
  
  if (MAINTENANCE_ENABLED && !isMaintenancePage) {
    // Check if user has valid authentication in sessionStorage
    const auth = sessionStorage.getItem('maintenanceAuth');
    
    if (auth !== MAINTENANCE_PASSWORD_HASH) {
      // Redirect to maintenance page with current page as redirect parameter
      const currentPath = window.location.pathname.split('/').pop() || 'index.html';
      const maintenancePath = getMaintenancePath();
      window.location.href = maintenancePath + '?redirect=' + encodeURIComponent(currentPath);
    }
  }
  
  // If on maintenance page and already authenticated, redirect to home or requested page
  if (isMaintenancePage && sessionStorage.getItem('maintenanceAuth') === MAINTENANCE_PASSWORD_HASH) {
    const urlParams = new URLSearchParams(window.location.search);
    const redirect = urlParams.get('redirect') || 'index.html';
    window.location.href = redirect;
  }
})();

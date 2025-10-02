"""JavaScript template for maintenance mode checking."""

MAINTENANCE_CHECK_JS = """// Maintenance mode check
// This script checks if maintenance mode is enabled and redirects to maintenance page if needed
(function() {
  const MAINTENANCE_ENABLED = {maintenance_enabled};
  const MAINTENANCE_PASSWORD_HASH = '{password_hash}';
  
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
"""

def make_maintenance_check_js(enabled: bool, password: str) -> str:
    """Generate the maintenance check JavaScript with current settings."""
    # Simple hash function for password (matches JavaScript implementation)
    hash_value = 0
    for char in password:
        hash_value = ((hash_value << 5) - hash_value) + ord(char)
        hash_value = hash_value & 0xFFFFFFFF  # Convert to 32-bit integer
        if hash_value > 0x7FFFFFFF:
            hash_value -= 0x100000000
    
    return MAINTENANCE_CHECK_JS.replace(
        '{maintenance_enabled}', 'true' if enabled else 'false'
    ).replace(
        '{password_hash}', str(hash_value)
    )

"""Template for the maintenance mode page."""

MAINTENANCE_PAGE_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Site Maintenance - Margin Matters</title>
<link rel="stylesheet" href="styles.css" />
<link rel="icon" href="favicon.svg" />
<style>
.maintenance-container {
  max-width: 600px;
  margin: 100px auto;
  padding: 40px;
  text-align: center;
}
.maintenance-icon {
  font-size: 4rem;
  margin-bottom: 20px;
}
.maintenance-title {
  font-size: 2rem;
  margin-bottom: 20px;
  color: var(--text);
}
.maintenance-message {
  font-size: 1.2rem;
  margin-bottom: 30px;
  color: var(--muted);
}
.password-form {
  display: flex;
  flex-direction: column;
  gap: 15px;
  margin-top: 30px;
  padding: 20px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.password-input {
  padding: 12px;
  font-size: 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
}
.password-submit {
  padding: 12px 24px;
  font-size: 1rem;
  background: #4169E1;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}
.password-submit:hover {
  background: #2E4FC4;
}
.error-message {
  color: #B22222;
  font-size: 0.9rem;
  display: none;
}
.show-error {
  display: block;
}
</style>
</head>
<body>
<div class="container">
  <div class="maintenance-container card">
    <div class="maintenance-icon">🔧</div>
    <h1 class="maintenance-title">Site Under Maintenance</h1>
    <p class="maintenance-message">
      We're currently performing scheduled maintenance to improve your experience.
      <br />
      We'll be back soon!
    </p>
    
    <div class="password-form">
      <label for="adminPassword" style="font-size: 0.9rem; color: var(--muted);">
        Administrator Access
      </label>
      <input 
        type="password" 
        id="adminPassword" 
        class="password-input" 
        placeholder="Enter password"
        autocomplete="off"
      />
      <button type="button" class="password-submit" onclick="checkPassword()">
        Access Site
      </button>
      <div id="errorMessage" class="error-message">
        Incorrect password. Please try again.
      </div>
    </div>
  </div>
</div>

<script>
// Password stored as a simple hash for basic protection
// This is not cryptographically secure, but provides basic protection for a maintenance mode
const MAINTENANCE_PASSWORD_HASH = '{password_hash}';

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString();
}

function checkPassword() {
  const input = document.getElementById('adminPassword');
  const errorMsg = document.getElementById('errorMessage');
  const password = input.value;
  
  if (simpleHash(password) === MAINTENANCE_PASSWORD_HASH) {
    // Store authentication in sessionStorage (expires when browser/tab closes)
    sessionStorage.setItem('maintenanceAuth', MAINTENANCE_PASSWORD_HASH);
    
    // Redirect to home page or requested page
    const urlParams = new URLSearchParams(window.location.search);
    const redirect = urlParams.get('redirect') || 'index.html';
    window.location.href = redirect;
  } else {
    errorMsg.classList.add('show-error');
    input.value = '';
    input.focus();
  }
}

// Allow Enter key to submit
document.getElementById('adminPassword').addEventListener('keypress', function(e) {
  if (e.key === 'Enter') {
    checkPassword();
  }
});
</script>
</body>
</html>
"""

def make_maintenance_page(password: str) -> str:
    """Generate the maintenance page HTML with the password hash."""
    # Simple hash function for password (matches JavaScript implementation)
    hash_value = 0
    for char in password:
        hash_value = ((hash_value << 5) - hash_value) + ord(char)
        hash_value = hash_value & 0xFFFFFFFF  # Convert to 32-bit integer
        if hash_value > 0x7FFFFFFF:
            hash_value -= 0x100000000
    
    return MAINTENANCE_PAGE_HTML.replace('{password_hash}', str(hash_value))

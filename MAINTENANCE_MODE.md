# Maintenance Mode Feature

This site now includes a maintenance mode feature that allows you to put the site into a "down for maintenance" state when needed. When enabled, users will see a maintenance page and must enter a password to access the site.

## Quick Start

Use the `toggle_maintenance.py` script to enable or disable maintenance mode:

```bash
# Enable maintenance mode with a password
python3 toggle_maintenance.py on your-password

# Disable maintenance mode
python3 toggle_maintenance.py off

# Check current status
python3 toggle_maintenance.py status
```

## How to Enable Maintenance Mode

```bash
python3 toggle_maintenance.py on your-secure-password
```

This will:
- Update `docs/maintenance-check.js` to enable maintenance mode
- Update `docs/maintenance.html` with the password hash
- Update `site_builder/config.py` to match the current state

## How to Disable Maintenance Mode

```bash
python3 toggle_maintenance.py off
```

This will:
- Update `docs/maintenance-check.js` to disable maintenance mode
- Update `site_builder/config.py` to match the current state

## Features

- **Password Protection**: When maintenance mode is enabled, all pages redirect to `maintenance.html`
- **Session-Based Authentication**: Once the correct password is entered, the user can access the site for the duration of their browser session
- **Auto-Redirect**: After successful authentication, users are redirected to the page they originally tried to access
- **Works on All Pages**: The maintenance check applies to all HTML pages (index, state pages, unit pages, etc.)
- **No Build Required**: Simply run the toggle script - no need to rebuild the site

## Command Reference

### Enable Maintenance Mode
```bash
python3 toggle_maintenance.py on [password]
```
If no password is provided, defaults to "margin2024".

### Disable Maintenance Mode
```bash
python3 toggle_maintenance.py off
```

### Check Status
```bash
python3 toggle_maintenance.py status
```

## Security Note

This maintenance mode uses a simple hashing mechanism for basic protection. It's suitable for temporary maintenance periods but is not cryptographically secure for long-term use. The authentication is stored in sessionStorage, which expires when the browser tab/window is closed.

## Files Involved

- `toggle_maintenance.py` - Script to enable/disable maintenance mode
- `docs/maintenance-check.js` - Client-side script that checks maintenance mode and handles redirects
- `docs/maintenance.html` - The maintenance page shown to users
- `site_builder/config.py` - Configuration file (kept in sync by the toggle script)

## Legacy Build Integration

The original implementation included maintenance mode generation in the build pipeline (`site_builder/main.py`). Since the site now uses manually maintained HTML files instead of a full build pipeline, the toggle script directly edits the JavaScript files instead. This is simpler and doesn't require rebuilding the site.


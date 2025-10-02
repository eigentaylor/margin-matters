# Maintenance Mode Feature

This site now includes a maintenance mode feature that allows you to put the site into a "down for maintenance" state when needed. When enabled, users will see a maintenance page and must enter a password to access the site.

## How to Enable Maintenance Mode

1. Open `site_builder/config.py`
2. Set `MAINTENANCE_MODE = True`
3. Optionally, change `MAINTENANCE_PASSWORD` to your desired password
4. Rebuild the site by running: `python3 build_site.py`

## How to Disable Maintenance Mode

1. Open `site_builder/config.py`
2. Set `MAINTENANCE_MODE = False`
3. Rebuild the site by running: `python3 build_site.py`

## Features

- **Password Protection**: When maintenance mode is enabled, all pages redirect to `maintenance.html`
- **Session-Based Authentication**: Once the correct password is entered, the user can access the site for the duration of their browser session
- **Auto-Redirect**: After successful authentication, users are redirected to the page they originally tried to access
- **Works on All Pages**: The maintenance check applies to all HTML pages (index, state pages, unit pages, etc.)

## Default Password

The default password is: `margin2024`

**Important**: Change this password in `site_builder/config.py` before deploying to production!

## Security Note

This maintenance mode uses a simple hashing mechanism for basic protection. It's suitable for temporary maintenance periods but is not cryptographically secure for long-term use. The authentication is stored in sessionStorage, which expires when the browser tab/window is closed.

## Files Added

- `site_builder/maintenance_page.py` - Template for the maintenance page
- `site_builder/maintenance_check.py` - JavaScript generator for maintenance checking
- `docs/maintenance.html` - The maintenance page shown to users
- `docs/maintenance-check.js` - Client-side script that checks maintenance mode and handles redirects

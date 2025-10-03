#!/usr/bin/env python3
"""
Script to enable or disable maintenance mode by directly editing the maintenance-check.js file.
This bypasses the build pipeline since we no longer regenerate pages.

Usage:
    python3 toggle_maintenance.py on [password]     # Enable maintenance mode
    python3 toggle_maintenance.py off                # Disable maintenance mode
    python3 toggle_maintenance.py status             # Check current status
"""

import sys
import re
from pathlib import Path


def simple_hash(password: str) -> str:
    """Calculate the simple hash for a password (matches JavaScript implementation)."""
    hash_value = 0
    for char in password:
        hash_value = ((hash_value << 5) - hash_value) + ord(char)
        hash_value = hash_value & 0xFFFFFFFF  # Convert to 32-bit integer
        if hash_value > 0x7FFFFFFF:
            hash_value -= 0x100000000
    return str(hash_value)


def get_current_status(js_file: Path) -> tuple[bool, str]:
    """Get the current maintenance mode status from maintenance-check.js."""
    if not js_file.exists():
        return False, "unknown"
    
    content = js_file.read_text()
    
    # Extract MAINTENANCE_ENABLED value
    enabled_match = re.search(r'const MAINTENANCE_ENABLED = (true|false);', content)
    if not enabled_match:
        return False, "unknown"
    
    enabled = enabled_match.group(1) == 'true'
    
    # Extract password hash
    hash_match = re.search(r"const MAINTENANCE_PASSWORD_HASH = '([^']+)';", content)
    password_hash = hash_match.group(1) if hash_match else "unknown"
    
    return enabled, password_hash


def enable_maintenance(js_file: Path, password: str):
    """Enable maintenance mode in maintenance-check.js."""
    if not js_file.exists():
        print(f"Error: {js_file} not found!")
        return False
    
    content = js_file.read_text()
    password_hash = simple_hash(password)
    
    # Update MAINTENANCE_ENABLED to true
    content = re.sub(
        r'const MAINTENANCE_ENABLED = false;',
        'const MAINTENANCE_ENABLED = true;',
        content
    )
    
    # Update password hash
    content = re.sub(
        r"const MAINTENANCE_PASSWORD_HASH = '[^']*';",
        f"const MAINTENANCE_PASSWORD_HASH = '{password_hash}';",
        content
    )
    
    js_file.write_text(content)
    print(f"✓ Maintenance mode ENABLED")
    print(f"  Password hash: {password_hash}")
    return True


def disable_maintenance(js_file: Path):
    """Disable maintenance mode in maintenance-check.js."""
    if not js_file.exists():
        print(f"Error: {js_file} not found!")
        return False
    
    content = js_file.read_text()
    
    # Update MAINTENANCE_ENABLED to false
    content = re.sub(
        r'const MAINTENANCE_ENABLED = true;',
        'const MAINTENANCE_ENABLED = false;',
        content
    )
    
    js_file.write_text(content)
    print(f"✓ Maintenance mode DISABLED")
    return True


def update_maintenance_page(html_file: Path, password: str):
    """Update the password hash in maintenance.html."""
    if not html_file.exists():
        print(f"Warning: {html_file} not found, skipping...")
        return False
    
    content = html_file.read_text()
    password_hash = simple_hash(password)
    
    # Update password hash in the maintenance page
    content = re.sub(
        r"const MAINTENANCE_PASSWORD_HASH = '[^']*';",
        f"const MAINTENANCE_PASSWORD_HASH = '{password_hash}';",
        content
    )
    
    html_file.write_text(content)
    return True


def update_config(config_file: Path, enabled: bool, password: str = None):
    """Update the config.py file to match the maintenance mode state."""
    if not config_file.exists():
        print(f"Warning: {config_file} not found, skipping config update...")
        return False
    
    content = config_file.read_text()
    
    # Update MAINTENANCE_MODE
    content = re.sub(
        r'MAINTENANCE_MODE = (True|False)',
        f'MAINTENANCE_MODE = {enabled}',
        content
    )
    
    # Update password if provided
    if password:
        content = re.sub(
            r'MAINTENANCE_PASSWORD = "[^"]*"',
            f'MAINTENANCE_PASSWORD = "{password}"',
            content
        )
    
    config_file.write_text(content)
    return True


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    
    command = sys.argv[1].lower()
    
    # File paths
    docs_dir = Path("docs")
    js_file = docs_dir / "maintenance-check.js"
    html_file = docs_dir / "maintenance.html"
    config_file = Path("site_builder") / "config.py"
    
    if command == "status":
        enabled, password_hash = get_current_status(js_file)
        status_str = "ENABLED" if enabled else "DISABLED"
        print(f"Maintenance mode: {status_str}")
        print(f"Password hash: {password_hash}")
        
    elif command == "on" or command == "enable":
        # Get password from command line or use default
        password = sys.argv[2] if len(sys.argv) > 2 else "margin2024"
        
        if enable_maintenance(js_file, password):
            update_maintenance_page(html_file, password)
            update_config(config_file, True, password)
            print(f"  Password: {password}")
            print(f"\nMaintenance mode is now active!")
            print(f"Users will need to enter the password to access the site.")
        
    elif command == "off" or command == "disable":
        if disable_maintenance(js_file):
            update_config(config_file, False)
            print(f"\nMaintenance mode is now inactive.")
            print(f"Users can access the site normally.")
        
    else:
        print(f"Unknown command: {command}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()

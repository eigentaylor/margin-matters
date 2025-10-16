# Changelog System Guide

This repository now includes an automated changelog system that compiles daily entries into a user-facing changelog page.

## Quick Start

1. Create a new file: `changelog/2025-01-15.md` (use today's date)
2. Add your changes in markdown format
3. Run `python3 build_site.py`
4. View the compiled page at `docs/changelog.html`

## File Format

Each changelog file should be named `YYYY-MM-DD.md` and contain markdown content:

```markdown
## Feature Updates
- Added new visualization for state trends
- Improved performance of interactive charts

## Bug Fixes
- Fixed layout issue on mobile devices
- Corrected data display for Maine districts
```

## Automatic Processing

The build system automatically:
- Compiles all entries into a single changelog page
- Sorts entries by date (newest first)
- Deletes empty changelog files
- Formats dates in a user-friendly way (e.g., "January 15, 2025")

## Markdown Support

The system supports:
- Headings (`## Heading`)
- Lists (`- item`)
- Bold (`**text**`)
- Italic (`*text*`)
- Links (`[text](url)`)
- Code (`` `code` `` and code blocks)

## Where to Find It

- **Source files**: `changelog/*.md`
- **Compilation module**: `site_builder/changelog.py`
- **Generated page**: `docs/changelog.html`
- **User access**: Navigate to "Changelog" in the site header

## Notes

- Empty files are automatically cleaned up, so don't worry about creating placeholder files
- The changelog link is automatically included in the site navigation
- You can have multiple entries per day in a single file
- No special setup needed - just create markdown files and build

For more detailed documentation, see `changelog/README.md`.

# Changelog Directory

This directory contains daily changelog entries that are automatically compiled into the site's changelog page during the build process.

## How to Use

1. **Create a new entry**: Make a markdown file named with the date: `YYYY-MM-DD.md` (e.g., `2025-01-15.md`)
2. **Write your changes**: Add your changelog content in markdown format (see format guide below)
3. **Build the site**: Run `python3 build_site.py` from the repository root
4. **View the result**: The changelog is automatically compiled at `docs/changelog.html`

## Entry Format

Each daily file should contain markdown-formatted text describing changes made that day. Use headings and bullet points for clarity:

```markdown
## Added new feature
- Description of the new feature
- Additional implementation details
- Any important notes

## Fixed bugs
- Bug fix description
- Impact of the fix

## Updated data
- Data update details
```

## Supported Markdown

The simple markdown converter supports:
- **Headings**: `## Heading` and `### Subheading`
- **Lists**: `- item` or `* item`
- **Bold**: `**text**`
- **Italic**: `*text*`
- **Links**: `[text](url)`
- **Code**: `` `code` `` and ``` code blocks ```

## Automatic Features

- **Empty file cleanup**: Blank changelog files are automatically deleted during build, so you can create placeholder files without worry
- **Reverse chronological order**: Entries appear newest-first on the changelog page
- **Date formatting**: Dates are automatically formatted (e.g., "January 15, 2025")

## Example Entry

`2025-01-15.md`:
```markdown
## Site Improvements
- Enhanced mobile responsiveness on state pages
- Improved chart rendering performance
- Fixed navigation menu on small screens

## Data Updates
- Added 2024 general election results
- Corrected historical data for Maine district races
```

This will appear on the changelog page with proper formatting and styling.

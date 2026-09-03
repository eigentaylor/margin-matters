# Repo notes

## Changelog

When making changes to the site (features, fixes, content updates), add an entry to the changelog:

1. Create or append to `changelog/YYYY-MM-DD.md` (today's date) describing the change in markdown.
2. Run `python3 build_site.py` to compile entries into `docs/changelog.html`.

Write entries for the reader, not for a future developer: describe what changed and why it matters to someone using the site (a new toggle, a fixed bug they'd have noticed, a new capability), not internal implementation details (specific CSS properties, function/variable names, library quirks, the debugging journey to get there). It's fine to go into real detail when it's genuinely user-relevant (e.g. exactly how a mechanic now works) - just keep the framing on the observable behavior, not the code. If a change is purely internal tooling with no reader-facing angle at all (a script only the site owner runs), a brief mention of the capability it adds is still fine, but skip narrating its bug-fix history - that belongs in commit messages, not the changelog.

See `CHANGELOG_GUIDE.md` for the full format and conventions.

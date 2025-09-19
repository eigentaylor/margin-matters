# Interactive Explorer (experimental)

A standalone page to explore state trends with dynamic charts. It does not affect the main site. When ready, we can integrate it into the build.

## What it shows

- Line or bar charts for:
  - Presidential margin (state and optional national overlay)
  - Relative margin vs national
  - Change in margin (delta)
  - Third-party share and relative share
  - Two-party margin and relative two-party margin
- Mouse hover tooltips

## Try it locally (Windows PowerShell)

```powershell
cd "./docs"
python -m http.server 8000
```

Then open <http://localhost:8000/trend-viewer.html>

## Notes

- Uses the existing `docs/presidential_margins.csv` file. If you regenerate it, just refresh the page.
- No build step or dependencies; runs in the browser with D3 from a CDN.
- When approved, we can integrate this into the build process and link from the main index.

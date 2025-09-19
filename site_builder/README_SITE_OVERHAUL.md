Title: Margin Matters — Site Refresh Plan (UX, Mobile, IA, and Code Cleanup)
Owner: taylor
Goal: Make the site easy to interpret, cohesive across pages, and great on mobile while keeping power-user features.

==================================================
HIGH-LEVEL IA (Information Architecture)
==================================================
Top Navbar (every page):
- Home
- Trends
- Ranker
- Trend Viewer  ← (visible; no longer hidden)
- Methods
- Data (CSV)

Page purposes:
- Home (index.html): PV/EV sandbox + “flip to win” scenarios (unique feature). Keep focused.
- Trends (NEW landing for state pages or a site-wide view): Interactive chart defaulting to RELATIVE MARGIN, 1968–present, with presets and toggles.
- Ranker (ranker.html): Year-by-year sortable leaderboard of states by metric.
- Trend Viewer (trend-viewer.html): Multi-state comparison (overlay or small multiples). Can be embedded per-state pre-filtered to that state.
- Methods (NEW): Definitions + formulas + examples + data caveats + how PV stops are computed.
- Data (presidential_margins.html): Canonical CSV browser with “Raw CSV” link.

Permalinks (site-wide):
- Encode UI state in query string/hash and standardize keys across pages:
  - yearStart, yearEnd, metric=(margin|relative|delta|twoparty|thirdparty)
  - chart=(line|bar|scatter), denom=(all|twoParty), smooth=(0|2|3), overlay=(nat|none)
  - states=CA,TX,WI
- Add a “Share” button that copies the current URL (deep link).

==================================================
DEFAULTS & PRESETS
==================================================
Defaults:
- Trends/Trend Viewer: metric=relative, yearStart=1968, yearEnd=latest, chart=line, denom=all, smooth=0, overlay=nat
- Home: latest year selected, PV at NPV result, ME/NE districts auto-on when applicable

Era presets (chips):
- 1916–1932, 1932–1964, 1968–1992, 1992–2008, 2008–present, 2012–present, 2016–present, 2020–present
- On click: updates yearStart/yearEnd and rerenders

State page “hero” summary (top, small and dense):
- RESULT (latest): State margin (D+/R+X.X), National margin, Relative margin, 3rd-party share, EVs
- Mini-trend delta vs previous cycle (▲/▼ with value)

==================================================
VISUAL/UX GUIDELINES
==================================================
- Dark theme by default (white text on black) for eye comfort.
- Legend placed BELOW chart (horizontal). Never cover the plot.
- Shaded reference bands on y-axis for quick meaning (e.g., ±2, ±5 pts).
- Outlier labels: auto-annotate up to 3 largest abs values; avoid clutter.
- Unified color semantics:
  - Blue when state is D-tilted, Red when R-tilted relative to national
  - Yellow for Wallace-like or 3rd-party emphasis where applicable
- Hovermode (“x unified” for Plotly or single-year tooltip for D3): one tooltip shows all relevant values for that year.
- Keyboard: ←/→ step years; “f” toggle full-screen; “r” reset zoom; “d” two-party toggle.

==================================================
MOBILE-FIRST BEHAVIOR
==================================================
Controls Drawer:
- On <768px width, collapse controls (metric/denom/chart/smoothing/year range) into a “Filters” bottom sheet or side drawer.
- Drawer contains larger tap targets, radio groups, and a year range slider.
- Keep the main chart above the fold.

Chart container:
- Use width:100%; height:auto; observe-resize to redraw.
- Tight margins/padding on mobile; larger axis font sizes for readability.

Map (Home):
- Increase PV stop badge padding/line-height; ensure 44px min tap targets.
- Tooltips: tap-to-lock on mobile; tap outside to release.

==================================================
REFACTORING / CODE ORGANIZATION
==================================================
Create a shared JS module (utils/siteState.js):
- parseQuery(), updateQuery(partialState), setAndPushState(), debounceRender()
- formatMargin(num) → "D+X.X" | "R+X.X" | "EVEN"
- colorForMargin(value[, isRelativeMode])
- eraPresets (array of {label, start, end})

Create a shared chart module (components/TrendsChart.js):
- Accepts props: data, states[], metric, denom, chart, smooth, yearStart, yearEnd, overlay
- Provides: render(container), update(nextProps), destroy()
- Implements:
  - Metric mapping → column(s)
  - Two-party mode toggles
  - Reference bands
  - Outlier annotations
  - National overlay line for margin/third-party modes
- Supports:
  - Single-state (default) and multi-state overlay
  - Optional “small multiples” mode (grid) for multi-state

Create a “Controls” component (components/Controls.js):
- Desktop: inline panel; Mobile: drawer
- Emits change events with { metric, denom, chart, smooth, yearStart, yearEnd, overlay }

Table module (components/DataTable.js):
- Dynamic columns with toggle groups: Votes | Margins | National | Relative | Two-party | Third-party | EVs
- Defaults to a compact subset; “Show all columns” expands.
- CSV/Copy buttons. State is reflected in URL (visible columns list if practical).

==================================================
PAGE-BY-PAGE WORK
==================================================
index.html (Home)
- Keep PV/EV sandbox. Ensure:
  - Shareable URL for PV, year, flip mode is standardized (same keys)
  - “Explore trends” button on each state tooltip that deep-links to /trends?state=XX
- Accessibility: add aria-labels to paths with EV + latest margin

trends.html (NEW) — or integrate into each /state/XX.html
- Embed TrendsChart with single state preselected (when on /state/XX.html)
- Controls drawer on mobile; inline on desktop
- One-paragraph explainer + link to Methods
- Compact DataTable under chart; “Show all columns” for power users
- Share button

ranker.html
- Keep current functionality; harmonize terminology and color palette
- Add “Open in Trends” link for the selected state/year/metric

trend-viewer.html
- Promote to primary multi-state comparison
- Same TrendsChart component with states[] multi-select (chips)
- Toggle: Overlay vs Small Multiples grid
- Sync hover across panels (if small multiples)
- Preset bundles: Rust Belt, Sun Belt, Blue Wall, etc.

methods.html (NEW)
- Define all metrics with formulas:
  - margin = D% - R%
  - national margin = …
  - relative margin = state margin − national margin
  - delta margin = margin(year) − margin(prev cycle)
  - two-party adjustments
  - third-party share definition/nuances
- Explain PV stops, uniform swing, Wallace/1968 edge-cases, and EV splits (ME/NE)
- Link to Data page and Raw CSV

presidential_margins.html
- Keep as is (fast CSV browser)
- Add consistent breadcrumb/nav at top

==================================================
UI STATE & ROUTING (UNIFIED)
==================================================
URL schema (example):
- /state/CO?metric=relative&denom=all&chart=line&smooth=0&yearStart=1968&yearEnd=2024
- /trend-viewer?states=CA,TX,WI&metric=thirdparty&overlay=nat&chart=line&yearStart=1992
- /trends?state=PA (alias of /state/PA or a state param route)
- /?year=2024&pv=R+1.5&flip=nearest (Home PV sandbox)

Implement:
- On load: parseQuery() → initial UI state
- On change: updateQuery() + debounce chart/table rerender
- Share button: navigator.clipboard.writeText(window.location.href)

==================================================
MOBILE CONTROLS DRAWER (SNIPPET)
==================================================
HTML:
<button id="filtersBtn" class="filters-btn">Filters</button>
<div id="filtersDrawer" class="drawer hidden" aria-hidden="true">
  <!-- Metric, Denominator, Chart type, Smooth, Year range slider, Overlay -->
  <button id="applyFilters">Apply</button>
</div>

CSS (conceptual):
.drawer { position: fixed; bottom: 0; left: 0; right: 0; max-height: 80vh; overflow: auto; background: #111; color: #fff; border-top: 1px solid #333; }
.hidden { display: none; }
.filters-btn { position: sticky; top: 0; z-index: 2; }

JS:
filtersBtn.onclick = () => { drawer.classList.toggle('hidden'); drawer.setAttribute('aria-hidden', drawer.classList.contains('hidden')); };
applyFilters.onclick = () => { /* read controls → updateQuery → re-render */ drawer.classList.add('hidden'); drawer.setAttribute('aria-hidden', 'true'); };

==================================================
CHART RENDERING NOTES (D3 or Plotly)
==================================================
If using Plotly:
- Plotly.newPlot(container, data, layout, { responsive: true })
- layout.legend = { orientation: 'h', y: -0.25 }
- layout.hovermode = 'x unified'; increase hoverlabel font size on mobile
- Add reference bands with shapes[]; national overlay as a thin line
- Downsample when zoomed out (optional), but elections count is small enough usually

If staying D3 (current trend-viewer):
- Use ResizeObserver to rerender on width changes
- Place legend as a separate horizontal flex container below SVG
- Tooltip: tap-to-lock on mobile; one tooltip per x (year)
- Add shaded bands via rects behind series groups
- Simple 3-cycle moving average for smooth option

==================================================
ACCESSIBILITY
==================================================
- All interactive controls keyboard accessible (tabindex, aria-expanded on drawer)
- SVG paths for states: tabindex="0"; aria-label includes “<State Name>, EV <n>, latest margin D+1.5”
- Sufficient contrast for legends, ticks, and tooltips (dark theme)

==================================================
PERFORMANCE
==================================================
- Load CSV once per page and cache; filter client-side
- Avoid re-binding DOM on every control change; separate data prep from draw
- Debounce URL updates and redraws (e.g., 75–125ms)
- For multi-state, avoid unnecessary recalculation of national series

==================================================
CONSISTENCY & THEME
==================================================
- Single color palette module used by index, trend-viewer, ranker
- Single number formatter for margins (D+/R+/EVEN), shares, and EVs
- Standard legend and note blocks across pages
- Shared “era chips” component (same HTML/CSS/behavior)

==================================================
TODO CHECKLIST (PR-FRIENDLY)
==================================================
- [ ] Add Trend Viewer to navbar; create Methods page
- [ ] Create utils/siteState.js (URL/state helpers + formatters + presets)
- [ ] Build components/TrendsChart.js (works in single and multi-state)
- [ ] Build components/Controls.js (desktop inline + mobile drawer)
- [ ] Build components/DataTable.js (column groups + CSV export)
- [ ] Convert /state/XX.html to embed TrendsChart + compact DataTable + hero KPIs
- [ ] Standardize URL query params across index/trend-viewer/ranker/state
- [ ] Add Share button everywhere charts exist
- [ ] Implement era preset chips (shared)
- [ ] Refine mobile styles: bigger tap targets, legend below, unified hover
- [ ] Methods page content (definitions, formulas, PV stop logic, ME/NE notes)
- [ ] Accessibility pass (aria-labels, focus order, contrast)
- [ ] Light regression test on desktop + iOS/Android (Chrome/Safari/Firefox)

Notes:
- Keep index’s PV/flip tool unique; don’t overload it with trend controls.
- Use the TrendsChart as the single “chart system” to reduce cognitive load and maintenance.
- Make everything shareable via URL — power users will love it, casual users can ignore it.

(🌟 Optional later: Add “Small Multiples” mode to Trend Viewer, and a tiny stats box showing correlation to national, mean relative margin, std dev, and number of flips over the selected window.)

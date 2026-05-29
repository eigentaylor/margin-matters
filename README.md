# Margin Matters

Margin Matters is a historical US election analysis and visualization project that combines:

- Data engineering pipelines for presidential datasets.
- Experimental senate dataset work (currently paused).
- A static website in `docs/` with interactive election tools, charts, and explainers.
- Utility scripts for derived datasets (PV stop colors, tipping points, flip scenarios, future projections, keys/NPV deltas).
- Plot-generation scripts for state-level historical trend images.

The repo mixes older one-off scripts with a newer modular site builder and modular frontend utility system.

## Disclaimer

This project is kind of a mess. I'm not a professional coder, so this is kind of a vibe coded disaster area. It's mostly just a personal project for me.

## What This Project Tries To Answer

At a high level, the project helps answer questions like:

- How has each state leaned relative to the nation over time?
- What EV map would result from a hypothetical national popular vote shift?
- Which states are tipping-point states in each cycle?
- How many votes would it take to flip an Electoral College result?
- Which states are bellwethers or unusually close under user-defined thresholds?
- How might state relative margins evolve in synthetic future scenarios?

## High-Level Architecture

```mermaid
flowchart TD
    A[election_data/* raw and merged inputs] --> B[build_presidential_margins.py]
    B --> D[presidential_margins.csv]
  A --> C[build_senate_margins.py (optional/paused)]
  C --> E[senate_margins.csv (experimental)]

    D --> F[build_stop_colors.py]
    F --> G[docs/stop_colors.csv]

    D --> H[build_flip_results.py]
    H --> I[docs/flip_results.csv + docs/flip_details.csv]

    G --> J[build_tipping_points.py]
    D --> J
    J --> K[docs/tipping_points.csv]

    D --> L[plot_state_trends.py / do_all_plots.py]
    L --> M[plots/*.png]

    D --> N[build_site.py]
    E --> N
    M --> N
    N --> O[site_builder.main.build_site]
    O --> P[docs/ static site pages and assets]

    P --> Q[Local serve via run_localhost.py or npm start]
```

## Repository Tour

### Core datasets and outputs

- `presidential_margins.csv`: Main engineered presidential dataset used by site and analysis scripts.
- `senate_margins.csv`: Experimental senate dataset from an unfinished pipeline (kept for future work).
- `docs/presidential_margins.csv`: Website copy of presidential margins CSV.
- `docs/senate_margins.csv`: Optional website copy of senate CSV when senate mode is manually enabled.
- `docs/stop_colors.csv`: Per-year PV stop and winner-color dataset for interactive map behavior.
- `docs/tipping_points.csv`: Derived per-year tipping-point and tie tipping-point summary.
- `docs/flip_results.csv` and `docs/flip_details.csv`: Minimal-vote flip scenario summaries and details.

### Build and orchestration scripts

- `build_site.py`: Thin wrapper for `site_builder.main.build_site()`; also tries to generate stop colors first.
- `build_presidential_margins.py`: Main presidential feature engineering pipeline.
- `build_senate_margins.py`: Partial senate pipeline (legacy+new source blending; currently not a primary workflow).
- `build_stop_colors.py`: Computes map PV stops and per-unit winner colors.
- `build_tipping_points.py`: Derives tipping-point rows from stop colors + presidential margins.
- `build_flip_results.py`: Knapsack-based vote-flip computation across years.

### Site source and generated output

- `docs/`: Main static web app (HTML/CSS/JS, derived CSVs, plots copy, and generated pages).
- `site_builder/`: Modular Python package that generates/updates parts of the site.

### Analysis, tools, and utilities

- `plot_state_trends.py`, `do_all_plots.py`: PNG chart generation.
- `generate_future_rel_margins.py`: Brownian-bridge synthetic projection paths.
- `toggle_maintenance.py`: Maintenance mode toggle that directly edits JS/HTML/config.
- `compare_extend.py`: CSV compare/extend helper.
- `add_npv_deltas.py`: Adds NPV delta columns to keys CSV.
- `tools/`: Scrapers and validation helpers for data acquisition/verification.
- `tests/unitInfo.test.mjs`: JS test for unit-info behavior.

## The Data Model (Presidential)

`build_presidential_margins.py` consumes Wikipedia-derived combined election rows and computes a rich feature set per `(year, abbr)` electoral unit.

Common fields include:

- `year`, `abbr`, `source_url`
- Votes and shares: `D_votes`, `R_votes`, `T_votes`, `third_party_votes`, `total_votes`, `D_share`, `R_share`
- Margin metrics:
  - `pres_margin` (raw D-R over total votes)
  - `two_party_margin`
  - `national_margin`
  - `relative_margin` (state margin minus national margin)
  - delta columns (year-over-year to prior cycle)
- Third-party metrics:
  - `top_third_party_share`
  - `third_party_share`
  - national/relative third-party shares
- Electoral metadata:
  - `electoral_votes` including special ME/NE district handling
- Candidate metadata and notes for historical edge cases

Important implementation details handled in pipeline logic:

- Historical anomalies for specific years/states (for example 1876 CO, 1868 FL, 1864 LA, 1948 AL, 1960 AL).
- ME/NE at-large and district EV assignment rules by year.
- Third-party vote treatment and bucketed metrics.

## Senate Data Status (Paused)

Senate support exists in the codebase, but it is not currently a maintained, first-class workflow.

Current state:

- Uses legacy candidate-level file for years `< 2022` and newer combined source for `>= 2022`.
- Parses candidate result dictionaries and classifies party buckets (`D`emocrat, `R`epublican, `T`hird-party).
- Computes winner, runner-up, bucket totals, and national aggregates by year.
- Produces output in the same spirit as presidential margins for potential future integration.

By default, senate views are disabled, and most contributors should ignore senate paths unless intentionally reviving that work.

## Website Structure (`docs/`)

The site includes many specialized pages. The header navigation in `docs/header.js` links to major tools such as:

- `index.html`: Main interactive election tester with PV/EV behavior.
- `state-pages.html`: State page directory.
- `trend-viewer.html`: Trend exploration.
- `ranker.html`: Ranking/ordering style exploration.
- `bellwether-explorer.html`: Bellwether and close-state visual analysis.
- `histograms.html`: Flexible histogram visualizer over numeric metrics.
- `shift-vectors.html`, `paths2028.html`, `future.html`, `probabilities.html`, `laplace.html`, `keys.html`, `census.html`, `methods.html`.
- `presidential_margins.html`: Data browser for CSV outputs.

### Frontend modular utilities (`docs/utils/`)

This folder is the current direction for de-duplicating logic across large frontend scripts (`docs/tester.js`, `docs/election-night.js`, etc.).

Key modules include:

- `mathUtils.js`: Shared clamp/math helpers.
- `evAllocation.js`: Shared EV allocation logic.
- `tooltipManager.js`: Tooltip creation/placement/refresh behavior.
- `candidateNames.js`, `candidateInfo.js`: Candidate lookup/presentation helpers.
- `atLargeAggregator.js`, `voteMath.js`: ME/NE at-large aggregation and PV-adjusted vote calculations.
- `unitInfo.js`, `pvStops.js`, `pvTools.js`, `flipScenarios.js`: Core map/tester mechanics.
- `siteState.js`, `testerInit.js`, `testerUpdate.js`, `electionNightUi.js`: State management and UI flows.
- `colorUtils.js`, `formatters.js`, `randomUtils.js`, `constants.js`: Shared utility support.

## Build and Run

## 1) Python environment

Use your preferred Python environment manager. The repo includes `requirements.txt`.

Typical setup:

```bash
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 2) JavaScript tooling (lint and static serving)

```bash
npm install
```

Useful package scripts from `package.json`:

- `npm run start`: Serve `docs/` on port 8080.
- `npm run serve`: Serve workspace root on port 8080.
- `npm run lint`: Lint docs + site builder JS.
- `npm run lint:fix`: Lint with auto-fixes.
- `npm run lint:docs`: Lint docs JS only.

## 3) Typical data/site regeneration flow

A practical end-to-end sequence:

```bash
python build_presidential_margins.py
python build_stop_colors.py
python build_flip_results.py
python build_tipping_points.py
python build_site.py
```

If you are explicitly working on senate data (currently paused), run this separately:

```bash
python build_senate_margins.py
```

Then run locally:

```bash
python run_localhost.py
# or: npm run start
```

## VS Code task shortcuts available in this workspace

- Build flip results CSVs
- Build site with new PV totals
- Lint docs JS

## Site Builder Package (`site_builder/`)

`site_builder` is the newer modular backend for site generation.

Notable files:

- `site_builder/main.py`
  - Ensures output dirs/assets.
  - Writes favicon and `last-updated.json`.
  - Reads CSVs and builds page artifacts.
  - Copies plots and data into docs output.
  - Compiles changelog page.
- `site_builder/pages.py`
  - Builds state pages, district pages, national pages, and data views.
  - Uses shared templates and table renderers.
- `site_builder/templates.py`, `site_builder/tables.py`
  - HTML templates and table rendering utilities.
- `site_builder/changelog.py`
  - Aggregates markdown changelog entries into website page.
- `site_builder/config.py`
  - Paths, constants, footer text, explanation text, maintenance flags.

Important reality of this repository today:

- Some pages are pipeline-generated.
- Some pages are manually maintained in `docs/` and use dynamic JS header/footer inserts.
- The codebase intentionally supports both while transitioning.

## Maintenance Mode

There is a direct toggle script:

```bash
python toggle_maintenance.py on my-password
python toggle_maintenance.py off
python toggle_maintenance.py status
```

This updates:

- `docs/maintenance-check.js`
- `docs/maintenance.html` (password hash)
- `site_builder/config.py` (state sync)

No full site rebuild is required for the toggle itself.

## Plot Generation

Two plot generators exist with overlapping purpose:

- `plot_state_trends.py`
- `do_all_plots.py`

Both generate per-state PNGs into `plots/` used by state/unit pages.

`do_all_plots.py` contains a broader plotting toolkit with helper functions and styling primitives for:

- Pres vs national margins
- Relative margins
- Third-party share and deltas
- Two-party variants

## Flip Scenario Computation

`build_flip_results.py` computes "minimum popular votes to flip" outcomes by year.

Core approach:

- Build per-year electoral units with D/R/T winners and vote margins.
- Compute votes needed for runner-up party to pluralize each unit.
- Solve a 0/1 knapsack optimization for minimum total votes (or alternate margin-based cost).
- Produce summary and detailed outputs in `docs/`.

This powers pages and analysis around EV fragility and vote-efficiency tradeoffs.

## Tipping Point Computation

`build_tipping_points.py` uses `docs/stop_colors.csv` and `docs/presidential_margins.csv` to derive:

- The election tipping-point unit
- The first tie-tipping unit where applicable
- Both effective PV and raw margin contexts

It includes fallback logic to resolve `EVEN` stop placeholders to nearest concrete state row.

## Other Useful Scripts

- `compare_extend.py`: Compare two election CSVs and build constrained-range extensions.
- `congressional_district_pres_data.py`: District-focused data handling helper.
- `check_1972.py`: Year-specific sanity checks.
- `add_npv_deltas.py`: Post-process keys data with delta fields.
- `generate_future_rel_margins.py`: Synthetic future path generator (Brownian bridge with PCA-factorized noise).

## Testing and Quality

Current quality tooling in repo:

- ESLint for JS (`eslint.config.mjs` + package scripts).
- At least one JS test file in `tests/unitInfo.test.mjs`.
- Multiple documentation and implementation summary files that track major feature work and modularization efforts.

Recommended basic checks before shipping changes:

```bash
npm run lint
python build_site.py
python run_localhost.py
```

And if data pipeline changes were made:

```bash
python build_presidential_margins.py
python build_stop_colors.py
python build_flip_results.py
python build_tipping_points.py
```

## Configuration and Conventions

`params.py` is the primary knob-set for many thresholds and display conventions:

- Swing thresholds and color categories.
- Final margin bucket cutoffs.
- Mapping dictionaries (`ABBR_TO_STATE`).
- Feature toggles (for example `INTERACTIVE_TESTER`, `INCLUDE_SENATE`).
- Optional table column ordering.

`utils.py` contains shared formatting and margin-category helpers used by plotting/build scripts.

## Historical and Transitional Context

This is a mature, actively evolved codebase with both legacy and modularized layers:

- Legacy scripts still perform real work.
- New modular layers exist in both Python (`site_builder`) and JS (`docs/utils`).
- Several markdown files document specific initiatives:
  - `README_MODULARIZATION.md`
  - `MODULARIZATION_GUIDE.md`
  - `MODULARIZATION_ROADMAP.md`
  - `MODULARIZATION_SUMMARY.md`
  - `IMPLEMENTATION_SUMMARY.md`
  - `README_BELLWETHER_EXPLORER.md`
  - `MAINTENANCE_MODE.md`

## Known Caveats

- Data quality depends on source scraping and historical reconciliation choices; some rows include explicit handlings for edge cases.
- Some docs in repo describe planned/experimental states that may differ from current production behavior.
- Not all generated assets are rebuilt on every command; follow the pipeline sequence when uncertain.
- Senate integration is intentionally de-emphasized right now and should be treated as experimental/paused.

## Suggested Onboarding Path For New Contributors

(you brave soul)

1. Read this README fully.
2. Read `params.py` and `build_presidential_margins.py` to understand metric definitions.
3. Run full local build sequence once.
4. Open the site locally and click through key pages.
5. Review modularization docs to understand current frontend architecture direction.
6. Make one small data change and trace it to site output.

## Attribution and Licensing Notes

The site footer text points to Wikipedia as a major data source and references CC BY-SA context. Verify attribution and downstream licensing requirements for any redistribution.

## Project Status Snapshot

- Core data-to-site pipeline: functional.
- Interactive pages: broad and feature-rich.
- Architecture: in active migration toward shared modules and lower duplication.
- Best contribution style: incremental, testable changes with careful regression checks across both legacy and modular paths.

# Bellwether & Close States Explorer

A new interactive visualization tool for exploring bellwether states and close states across U.S. presidential election history (1864-2024).

## Features

### Two Analysis Categories

1. **Bellwether States**: States with relative margins close to the national popular vote margin
   - Default threshold: 0.05 (5 percentage points)
   - Adjustable range: 0.01 to 0.10
   - These states track closely with the national mood

2. **Close States**: States with small raw presidential margins
   - Default threshold: 0.01 (1 percentage point)
   - Adjustable range: 0.001 to 0.05
   - These are competitive "tipping point" states

### Three Visualization Modes

1. **Bar Graph (Count Over Years)**
   - Shows how the number of bellwether/close states has changed from 1864 to 2024
   - Smooth animations when changing thresholds
   - Every 4th year labeled on x-axis for clarity
   - Bar color indicates category (blue for bellwether, red for close)

2. **Histogram (Margin Distribution)**
   - Shows distribution of state margins for a selected year
   - X-axis labeled appropriately:
     - Bellwethers: "NAT. MARGIN" at 0 (relative to national margin)
     - Close States: "EVEN" at 0 (raw margin)
   - Hover over bars to see:
     - Count of states in bin
     - List of states with their margins (up to 10 shown)
   - Center line marks the zero point
   - Bars colored by party lean (blue for D, red for R, accent for center)

3. **Table (Detailed List)**
   - Sortable columns (click headers to sort)
   - For **Bellwether States** showing specific year (not 2024):
     - State abbreviation
     - Relative margin for selected year
     - 2024 Status: ✓ if still bellwether in 2024, ✗ if not
     - Margin change from selected year to 2024 (with D/R lean direction)
     - 2024 relative margin
     - Electoral votes
   - For **Close States**:
     - State abbreviation
     - Presidential margin
     - Vote difference (formatted with commas)
     - Electoral votes
   - Rows fade in with staggered animation

### Interactive Controls

- **Year Selector**: Choose a specific year or "All Years"
- **Category Selector**: Switch between Bellwether and Close States
- **Threshold Sliders**: 
  - Smoothly adjust what counts as a bellwether or close state
  - Real-time value display
  - Instant visualization updates with animations
- **Display Type**: Switch between visualizations with smooth transitions

## Technical Implementation

### Data Source
- Loads from `presidential_margins.csv`
- Filters out:
  - NATIONAL aggregate rows
  - Congressional districts (except ME-AL and NE-AL at-large)

### Key Metrics Used
- **Relative Margin** (`relative_margin`): State margin minus national margin
  - Positive = more Democratic than nation
  - Negative = more Republican than nation
- **Presidential Margin** (`pres_margin`): Raw D% - R% in state
- **Formatted Strings**: Uses pre-formatted strings from CSV for display

### Animations
- All visualizations use D3.js transitions (800ms duration)
- Bar charts: bars grow from bottom
- Histograms: bars grow from bottom, tooltip on hover
- Tables: rows fade in with 20ms stagger

### Browser Compatibility
- Requires modern browser with ES6+ support
- Uses D3.js v7 from CDN
- Responsive design adapts to screen width

## Usage

Navigate to the page via the site header menu: **Bellwether Explorer**

### Example Workflows

1. **Find 2024 bellwether states**:
   - Year: 2024
   - Category: Bellwether States
   - Threshold: 0.05 (default)
   - Display: Table
   - Result: Shows PA, WI, MI, GA, AZ, NV, NC, NH sorted by margin

2. **See how bellwethers have changed over time**:
   - Year: All Years
   - Category: Bellwether States
   - Display: Bar Graph
   - Adjust threshold slider to see how count changes
   - Notice peaks in certain eras (e.g., 1992 had many bellwethers)

3. **Analyze a specific close election**:
   - Year: 2000
   - Category: Close States
   - Display: Histogram
   - Shows famous close states like FL, NM, WI, IA, OR, NH

4. **Track a state's bellwether status**:
   - Year: 1992 (when many states were bellwethers)
   - Category: Bellwether States
   - Display: Table
   - See which 1992 bellwethers are still bellwethers in 2024

## Files

- `docs/bellwether-explorer.html` - Main HTML page
- `docs/bellwether-explorer.js` - JavaScript logic and visualizations
- `docs/header.js` - Updated to include navigation link

## Future Enhancements (Potential)

- Export table data as CSV
- Share specific configurations via URL parameters
- Add "compare two years" mode
- Historical bellwether tracking (states that were bellwethers in multiple elections)
- State detail cards with historical context

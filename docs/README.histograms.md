# Interactive Histograms

This page provides interactive histogram visualizations for exploring the distribution of presidential election data from the `presidential_margins.csv` dataset.

## URL: `/histograms.html`

## Features

### Two View Modes

1. **Single Year Distribution** (default)
   - Shows the distribution of a selected field across all states/units for a specific year
   - Example: Distribution of presidential margins in 2024

2. **Time Series for State/Field**
   - Shows the distribution of a selected field for a specific state across all years
   - Example: Distribution of California's presidential margins from 1864-2024

### Available Fields

The page supports visualization of all numeric fields from the dataset:

**Margin Fields:**
- Presidential Margin
- Presidential Margin Delta
- National Margin
- National Margin Delta
- Relative Margin
- Relative Margin Delta
- Median Margin Delta
- Median Delta Distance

**Two-Party Fields:**
- Two-Party Margin
- Two-Party Margin Delta
- Two-Party National Margin
- Two-Party National Margin Delta
- Two-Party Relative Margin
- Two-Party Relative Margin Delta

**Vote Share Fields:**
- Democratic Vote Share
- Republican Vote Share
- Third Party Share
- Third Party National Share
- Third Party Relative Share
- Top Third Party Share

**Vote Count Fields:**
- Democratic Votes
- Republican Votes
- Total Votes
- Third Party Votes
- Electoral Votes

**Delta Fields:**
- Democratic Vote Delta
- Republican Vote Delta
- Total Vote Delta

### Interactive Features

1. **Hover Tooltips**
   - Hover over histogram bars to see detailed information
   - Shows which states/units or years fall within each bin
   - Displays formatted values from the CSV's `_str` fields when available

2. **Reference Lines**
   - **Median Line** (green dashed): Shows the median value
   - **Average Line** (yellow/amber dashed): Shows the mean value
   - **Zero Line** (white dashed): Shows the zero point for margin fields
   - **Popular Vote Line** (pink dashed): Shows the national value when applicable

3. **Color-Coded Bars**
   - **Blue bars**: Democratic advantage (positive values for margin fields)
   - **Red bars**: Republican advantage (negative values for margin fields)
   - **Gray bars**: Neutral or non-partisan fields

4. **Animated Transitions**
   - Smooth animations when changing years, fields, or view modes
   - Bars animate in height and position for a polished experience

### URL Sharing

The page supports URL parameters for sharing specific visualizations:

- `mode`: View mode (`year` or `timeseries`)
- `year`: Selected year (for single year mode)
- `state`: Selected state/unit (for time series mode)
- `field`: Selected field name

**Example URLs:**
- `/histograms.html?mode=year&year=2024&field=pres_margin`
- `/histograms.html?mode=timeseries&state=PA&field=relative_margin`

The **Copy Share URL** button makes it easy to share specific histogram views.

### Dark Mode Styling

The page uses the site's standard dark mode theme:
- Dark background (#0b0b0b)
- Light text (#f5f5f5)
- Consistent with other site pages
- Responsive layout adapts to different screen sizes

## Usage Examples

1. **View 2024 Presidential Margins:**
   - Select "Single Year Distribution"
   - Choose year: 2024
   - Choose field: Presidential Margin
   - See distribution of margins across all states

2. **View Pennsylvania's Historical Performance:**
   - Select "Time Series for State/Field"
   - Choose state: PA
   - Choose field: Relative Margin
   - See how PA has performed relative to the nation over time

3. **Analyze Third-Party Impact:**
   - Select "Single Year Distribution"
   - Choose year: 1992 (or any year)
   - Choose field: Third Party Share
   - See which states had the most third-party voting

## Technical Details

- Built with D3.js v7 for visualization
- Uses D3's `d3.bin()` to automatically create histogram bins
- Bin count adapts to data size (max 20 bins, or sqrt of data size)
- Responsive SVG sizing
- Efficient data filtering and transformation

## Navigation

The Histograms page is accessible from the main navigation menu, located between "Trend Viewer" and "Shift Vectors".

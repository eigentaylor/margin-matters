# Interactive Histograms - Usage Examples

## Quick Start URLs

Try these pre-configured URLs to explore different aspects of the data:

### Presidential Margins

**2024 Presidential Margins Distribution**
```
/histograms.html?mode=year&year=2024&field=pres_margin
```
See how states voted in 2024 relative to each other.

**2020 Presidential Margins Distribution**
```
/histograms.html?mode=year&year=2020&field=pres_margin
```
Compare with 2020's distribution.

**Historical Swing: 2016**
```
/histograms.html?mode=year&year=2016&field=pres_margin
```
The year of Trump's upset victory.

### State Time Series

**Pennsylvania Across History**
```
/histograms.html?mode=timeseries&state=PA&field=relative_margin
```
How has PA performed relative to the nation over time?

**California's Evolution**
```
/histograms.html?mode=timeseries&state=CA&field=pres_margin
```
See California's shift from red to blue.

**National Popular Vote Over Time**
```
/histograms.html?mode=timeseries&state=NATIONAL&field=pres_margin
```
Distribution of national margins across all elections.

### Third-Party Impact

**1992: Ross Perot Year**
```
/histograms.html?mode=year&year=1992&field=third_party_share
```
Massive third-party impact with Ross Perot.

**1968: George Wallace**
```
/histograms.html?mode=year&year=1968&field=third_party_share
```
Regional third-party strength in the South.

**2016: Third Party Distribution**
```
/histograms.html?mode=year&year=2016&field=third_party_share
```
Johnson and Stein's combined impact.

### Relative Margins

**2024 Relative to National Popular Vote**
```
/histograms.html?mode=year&year=2024&field=relative_margin
```
Which states were most/least representative of the nation?

**Swing States Analysis**
```
/histograms.html?mode=year&year=2020&field=relative_margin
```
Find the states closest to the national average.

### Two-Party Margins

**2024 Two-Party Margins**
```
/histograms.html?mode=year&year=2024&field=two_party_margin
```
Margins excluding third-party votes.

**Historical Two-Party Distribution**
```
/histograms.html?mode=year&year=1984&field=two_party_margin
```
Reagan's landslide in two-party terms.

### Vote Counts

**2024 Electoral Vote Distribution**
```
/histograms.html?mode=year&year=2024&field=electoral_votes
```
How electoral votes are distributed among states.

**Total Votes by State (2024)**
```
/histograms.html?mode=year&year=2024&field=total_votes
```
See voter turnout distribution.

### Deltas (Change Over Time)

**Margin Changes from 2016 to 2020**
```
/histograms.html?mode=year&year=2020&field=pres_margin_delta
```
Which states swung most between elections?

**Median Margin Delta Distribution**
```
/histograms.html?mode=year&year=2024&field=median_margin_delta
```
How each state compares to the median state.

## Interactive Features to Try

1. **Hover over bars** to see which states are in each bin
2. **Change the field** dropdown to explore different metrics
3. **Switch between view modes** to see both spatial and temporal distributions
4. **Click "Copy Share URL"** to save interesting visualizations
5. **Notice the reference lines**:
   - Green dashed = Median
   - Yellow dashed = Average
   - White dashed = Zero (for margin fields)
   - Pink dashed = National/Popular Vote (when applicable)

## Advanced Usage

### Compare Elections

Look at the same field across different years to see how distributions change:
- 1984: Reagan landslide
- 2000: Bush v Gore (very close)
- 2008: Obama's coalition
- 2016: Trump's upset
- 2020: Biden's win
- 2024: Latest results

### Analyze State Trends

Use time series mode to see how individual states have evolved:
- **FL**: Longtime swing state
- **TX**: Trending bluer
- **OH**: Trending redder
- **GA**: Recent competitive state
- **AZ**: Demographic change impact

### Find Patterns

- Which states have the most consistent margins?
- Which states have the most volatile margins?
- When was third-party voting at its peak?
- Which states are most predictive of the winner?
- How has polarization changed over time?

## Tips

1. Start with recent elections (2020, 2024) to understand current patterns
2. Compare 2016 to 2020 to see which states flipped
3. Use relative_margin to find swing states
4. Use time series mode to track individual states
5. Share interesting findings using the URL copy feature

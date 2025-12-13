"""
Build a tipping point dataset for each election year 1864-2024.

For each year, this identifies:
1. The tipping point state (the state that tips the election from one winner to another)
2. The tie tipping point state (if there is one - the state that tips from a win to an EC tie)
3. The effective_pv (relative margin) for each tipping point

In cases like 2020:
- PA was the tipping point from an R win to an EC tie (tie tipping point)
- WI was the tipping point from an EC tie to a D win (tipping point)

The output includes the relative margin (effective_pv) and raw margin (pres_margin) for each tipping point state.
"""

import csv
import os
from collections import defaultdict


def parse_float(x, default=0.0):
    """Safely parse a float from a string."""
    try:
        return float(x)
    except Exception:
        return default


def load_stop_colors(path):
    """Load the stop_colors.csv file."""
    with open(path, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def load_presidential_margins(path):
    """Load the presidential_margins.csv file and index by (year, abbr)."""
    margins = {}
    with open(path, newline='', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            try:
                year = int(row.get('year') or 0)
                abbr = row.get('abbr', '')
                if year > 0 and abbr:
                    margins[(year, abbr)] = row
            except Exception:
                continue
    return margins


def find_nearest_state_row(rows, target_stop, direction='both'):
    """
    Find the nearest actual state row (not EVEN) to the target stop value.
    
    Args:
        rows: List of stop_colors rows for a given year
        target_stop: The stop value to search near
        direction: 'both' (search both directions), 'up' (larger stop), 'down' (smaller stop)
    
    Returns:
        The nearest row that is an actual state (not EVEN)
    """
    # Sort rows by stop value
    sorted_rows = sorted(
        [r for r in rows if r.get('unit') and r.get('unit') != 'EVEN'],
        key=lambda r: parse_float(r.get('stop', 0))
    )
    
    if not sorted_rows:
        return None
    
    # Find closest row
    best_row = None
    best_dist = float('inf')
    
    for row in sorted_rows:
        stop_val = parse_float(row.get('stop', 0))
        dist = abs(stop_val - target_stop)
        
        if direction == 'up' and stop_val < target_stop:
            continue
        if direction == 'down' and stop_val > target_stop:
            continue
            
        if dist < best_dist:
            best_dist = dist
            best_row = row
    
    return best_row


def build_tipping_points(stop_colors_rows, margins_by_year_abbr):
    """
    Build tipping point dataset from stop_colors.csv.
    
    Returns a list of dicts with:
    - year
    - tipping_point_state
    - tipping_point_effective_pv
    - tipping_point_pres_margin
    - tie_tipping_point_state (if exists)
    - tie_tipping_point_effective_pv (if exists)
    - tie_tipping_point_pres_margin (if exists)
    - tipping_point_winner
    - tie_tipping_point_winner
    """
    # Group by year
    by_year = defaultdict(list)
    for row in stop_colors_rows:
        try:
            year = int(row.get('year') or 0)
        except Exception:
            continue
        if year > 0:
            by_year[year].append(row)
    
    results = []
    
    for year in sorted(by_year.keys()):
        rows = by_year[year]
        
        # Find the tipping point row (IS_TIPPING_POINT = true)
        tipping_point_row = None
        for row in rows:
            if row.get('IS_TIPPING_POINT') == 'true':
                tipping_point_row = row
                break
        
        # If tipping point is EVEN, find the nearest actual state
        if tipping_point_row and tipping_point_row.get('unit') == 'EVEN':
            target_stop = parse_float(tipping_point_row.get('stop', 0))
            nearest = find_nearest_state_row(rows, target_stop)
            if nearest:
                tipping_point_row = nearest
            else:
                tipping_point_row = None  # No valid state found
        
        # Find the first tie stop row (IS_FIRST_TIE_STOP = true)
        tie_stop_row = None
        for row in rows:
            if row.get('IS_FIRST_TIE_STOP') == 'true':
                tie_stop_row = row
                break
        
        # If tie stop is EVEN, find the nearest actual state
        if tie_stop_row and tie_stop_row.get('unit') == 'EVEN':
            target_stop = parse_float(tie_stop_row.get('stop', 0))
            nearest = find_nearest_state_row(rows, target_stop)
            if nearest:
                tie_stop_row = nearest
            else:
                tie_stop_row = None  # No valid state found
        
        # Build result entry
        result = {
            'year': year,
            'tipping_point_state': '',
            'tipping_point_effective_pv': '',
            'tipping_point_pres_margin': '',
            'tipping_point_winner': '',
            'tie_tipping_point_state': '',
            'tie_tipping_point_effective_pv': '',
            'tie_tipping_point_pres_margin': '',
            'tie_tipping_point_winner': '',
        }
        
        if tipping_point_row:
            abbr = tipping_point_row.get('unit', '')
            result['tipping_point_state'] = abbr
            result['tipping_point_effective_pv'] = tipping_point_row.get('effective_pv', '')
            result['tipping_point_winner'] = tipping_point_row.get('winner', '')
            # Get pres_margin from presidential_margins.csv
            margin_row = margins_by_year_abbr.get((year, abbr))
            if margin_row:
                result['tipping_point_pres_margin'] = margin_row.get('pres_margin', '')
        
        if tie_stop_row:
            abbr = tie_stop_row.get('unit', '')
            result['tie_tipping_point_state'] = abbr
            result['tie_tipping_point_effective_pv'] = tie_stop_row.get('effective_pv', '')
            result['tie_tipping_point_winner'] = tie_stop_row.get('winner', '')
            # Get pres_margin from presidential_margins.csv
            margin_row = margins_by_year_abbr.get((year, abbr))
            if margin_row:
                result['tie_tipping_point_pres_margin'] = margin_row.get('pres_margin', '')
        
        results.append(result)
    
    return results


def format_margin(val):
    """Format a margin value as a lean string (e.g., 'D+3.5' or 'R+2.1')."""
    if val == '' or val is None:
        return ''
    try:
        v = float(val)
    except Exception:
        return ''
    
    if abs(v) < 0.00005:  # essentially 0
        return 'EVEN'
    
    if v > 0:
        return f"D+{abs(v)*100:.2f}"
    else:
        return f"R+{abs(v)*100:.2f}"


def main():
    root = os.path.dirname(__file__)
    stop_colors_path = os.path.join(root, 'docs', 'stop_colors.csv')
    pres_margins_path = os.path.join(root, 'docs', 'presidential_margins.csv')
    
    if not os.path.exists(stop_colors_path):
        print(f"Error: {stop_colors_path} not found")
        return
    
    if not os.path.exists(pres_margins_path):
        print(f"Error: {pres_margins_path} not found")
        return
    
    # Load stop colors data
    stop_colors_rows = load_stop_colors(stop_colors_path)
    
    # Load presidential margins data
    margins_by_year_abbr = load_presidential_margins(pres_margins_path)
    
    # Build tipping points
    tipping_points = build_tipping_points(stop_colors_rows, margins_by_year_abbr)
    
    # Add formatted margin strings
    for tp in tipping_points:
        tp['tipping_point_effective_pv_str'] = format_margin(tp['tipping_point_effective_pv'])
        tp['tipping_point_pres_margin_str'] = format_margin(tp['tipping_point_pres_margin'])
        tp['tie_tipping_point_effective_pv_str'] = format_margin(tp['tie_tipping_point_effective_pv'])
        tp['tie_tipping_point_pres_margin_str'] = format_margin(tp['tie_tipping_point_pres_margin'])
    
    # Write output
    outfile = os.path.join(root, 'docs', 'tipping_points.csv')
    fieldnames = [
        'year',
        'tipping_point_state',
        'tipping_point_effective_pv',
        'tipping_point_effective_pv_str',
        'tipping_point_pres_margin',
        'tipping_point_pres_margin_str',
        'tipping_point_winner',
        'tie_tipping_point_state',
        'tie_tipping_point_effective_pv',
        'tie_tipping_point_effective_pv_str',
        'tie_tipping_point_pres_margin',
        'tie_tipping_point_pres_margin_str',
        'tie_tipping_point_winner',
    ]
    
    with open(outfile, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in tipping_points:
            writer.writerow(row)
    
    print(f"Wrote {len(tipping_points)} rows to {outfile}")
    
    # Print summary
    print("\nTipping Point Summary:")
    print("-" * 100)
    for tp in tipping_points:
        year = tp['year']
        tp_state = tp['tipping_point_state']
        tp_rel_margin = tp['tipping_point_effective_pv_str']
        tp_raw_margin = tp['tipping_point_pres_margin_str']
        tie_state = tp['tie_tipping_point_state']
        tie_rel_margin = tp['tie_tipping_point_effective_pv_str']
        tie_raw_margin = tp['tie_tipping_point_pres_margin_str']
        
        if tie_state and tie_state != tp_state:
            print(f"{year}: Tipping={tp_state} (rel: {tp_rel_margin}, raw: {tp_raw_margin}), Tie={tie_state} (rel: {tie_rel_margin}, raw: {tie_raw_margin})")
        elif tp_state:
            print(f"{year}: Tipping={tp_state} (rel: {tp_rel_margin}, raw: {tp_raw_margin})")
        else:
            print(f"{year}: No tipping point found")


if __name__ == '__main__':
    main()

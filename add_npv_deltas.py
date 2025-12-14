#!/usr/bin/env python3
"""
Add NPV delta columns to keys_with_npv.csv
Calculates the change in NPV metrics from one election to the next
"""

import csv
from pathlib import Path


def format_pct_delta(value, direction_type='raw'):
    """Format a delta value as a percentage string with direction"""
    if value is None or value == '':
        return ''
    
    try:
        val = float(value)
    except (ValueError, TypeError):
        return ''
    
    abs_pct = abs(val * 100)
    
    if direction_type == 'raw':
        # For raw NPV delta: positive = more Democratic, negative = more Republican
        if val > 0:
            return f"{abs_pct:.2f}% D+"
        elif val < 0:
            return f"{abs_pct:.2f}% R+"
        else:
            return "EVEN"
    else:  # incumbent_relative
        # For incumbent delta: positive = incumbent improved, negative = incumbent worsened
        if val > 0:
            return f"{abs_pct:.2f}% Incumbent+"
        elif val < 0:
            return f"{abs_pct:.2f}% Challenger+"
        else:
            return "EVEN"


def main():
    input_file = Path('docs/keys_with_npv.csv')
    output_file = Path('docs/keys_with_npv.csv')
    
    # Read all rows
    with open(input_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    # Read presidential margins to get national delta by year
    pres_file = Path('docs/presidential_margins.csv')
    pres_deltas = {}
    if pres_file.exists():
        with open(pres_file, 'r', encoding='utf-8') as pf:
            pres_reader = csv.DictReader(pf)
            for prow in pres_reader:
                try:
                    y = int(prow.get('year'))
                except (TypeError, ValueError):
                    continue
                # Try a few plausible field names for the national delta
                nd = None
                for key in ('national_delta', 'national_margin_delta', 'national_margin_change', 'national_margin'):
                    if key in prow and prow[key] not in (None, ''):
                        try:
                            nd = float(prow[key])
                            break
                        except (ValueError, TypeError):
                            continue
                pres_deltas[y] = nd
    
    # Add new columns to fieldnames (insert after the base NPV columns)
    new_fieldnames = []
    for field in fieldnames:
        new_fieldnames.append(field)
        if field == 'npv_raw_pct':
            new_fieldnames.extend(['npv_raw_delta', 'npv_raw_delta_pct'])
        elif field == 'npv_incumbent_relative_pct':
            new_fieldnames.extend(['npv_incumbent_relative_delta', 'npv_incumbent_relative_delta_pct'])
    
    # Sort by year to ensure proper ordering
    rows.sort(key=lambda x: int(x['year']))
    
    # Calculate deltas
    prev_row = None
    for row in rows:
        # Initialize new columns
        row['npv_raw_delta'] = ''
        row['npv_raw_delta_pct'] = ''
        row['npv_incumbent_relative_delta'] = ''
        row['npv_incumbent_relative_delta_pct'] = ''
        
        if prev_row is not None and prev_row['year'] != row['year']:
            # Calculate npv_raw_delta
            try:
                current_raw = float(row['npv_raw'])
                prev_raw = float(prev_row['npv_raw'])
                raw_delta = current_raw - prev_raw
                row['npv_raw_delta'] = str(raw_delta)
                row['npv_raw_delta_pct'] = format_pct_delta(raw_delta, 'raw')
            except (ValueError, TypeError, KeyError):
                pass

            # Calculate npv_incumbent_relative_delta
            # Prefer using national delta from presidential_margins.csv (flipped by incumbent party)
            try:
                year = int(row['year'])
            except (KeyError, TypeError, ValueError):
                year = None

            inc_delta_val = None
            if year is not None and year in pres_deltas and pres_deltas[year] is not None:
                try:
                    incumbent = row.get('incumbent_party', '').strip()
                    sign = 1
                    if incumbent.upper().startswith('R'):
                        sign = -1
                    elif incumbent.upper().startswith('D'):
                        sign = 1
                    else:
                        # unknown incumbent; default to positive
                        sign = 1
                    inc_delta_val = pres_deltas[year] * sign
                except Exception:
                    inc_delta_val = None

            # Fallback: compute difference from previous npv_incumbent_relative
            if inc_delta_val is None:
                try:
                    current_inc = float(row['npv_incumbent_relative'])
                    prev_inc = float(prev_row['npv_incumbent_relative'])
                    inc_delta_val = current_inc - prev_inc
                except (ValueError, TypeError, KeyError):
                    inc_delta_val = None

            if inc_delta_val is not None:
                row['npv_incumbent_relative_delta'] = str(inc_delta_val)
                row['npv_incumbent_relative_delta_pct'] = format_pct_delta(inc_delta_val, 'incumbent_relative')
        
        prev_row = row
    
    # Write back to CSV
    with open(output_file, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=new_fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    
    print(f"✓ Added NPV delta columns to {output_file}")
    print(f"  - Added {len([f for f in new_fieldnames if f not in fieldnames])} new columns")
    print(f"  - Processed {len(rows)} rows")


if __name__ == '__main__':
    main()

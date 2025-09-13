#!/usr/bin/env python3
"""
compare_extend.py

Small CLI tool to:
- compare two CSV files on shared keys (default: year + state_po) and report cell-level discrepancies
- extend/create a new CSV for a given year range (start year .. 2024) using a larger source file

Usage examples (PowerShell):
    python compare_extend.py check --a presidential_margins.csv --b 1900_2024_election_results.fixed.csv --out diffs.csv
    python compare_extend.py extend --source 1900_2024_election_results.fixed.csv --start-year 1972 --out presidential_margins_1972_2024.csv

The script uses only Python stdlib (csv, argparse) so no extra dependencies are required.
"""
import argparse
import csv
import sys
from collections import OrderedDict


def read_csv_dict(path, key_cols):
    """Read CSV into dict keyed by tuple(key_cols). Returns (data_dict, header)
    data_dict maps key -> row dict (column->value)
    """
    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames or []
        data = {}
        for row in reader:
            try:
                key = tuple(row[c].strip() for c in key_cols)
            except KeyError:
                raise KeyError(f"Key column(s) {key_cols} not found in {path}")
            data[key] = row
    return data, header


def is_number(s):
    try:
        float(s)
        return True
    except Exception:
        return False


def compare_files(path_a, path_b, key_cols, out_path=None):
    a, ha = read_csv_dict(path_a, key_cols)
    b, hb = read_csv_dict(path_b, key_cols)

    shared_keys = sorted(set(a.keys()) & set(b.keys()))
    if not shared_keys:
        print("No common (year,state) keys found between the two files.")
        return 0

    common_columns = [c for c in ha if c in hb]
    # Exclude key columns from per-cell comparison
    comp_columns = [c for c in common_columns if c not in key_cols]

    diffs = []
    # add a row for the filenames being compared
    diffs.append({
        'key': 'FILENAMES',
        'column': 'comparison',
        'a_value': path_a,
        'b_value': path_b,
        'diff': 'N/A',
    })
    for key in shared_keys:
        row_a = a[key]
        row_b = b[key]
        for col in comp_columns:
            va = (row_a.get(col) or '').strip()
            vb = (row_b.get(col) or '').strip()
            if va == vb:
                continue
            # numeric tolerant compare
            if is_number(va) and is_number(vb):
                try:
                    fa = float(va)
                    fb = float(vb)
                    diff = int((fa - fb))
                    if abs(diff) <= 1e-6:
                        continue
                except Exception:
                    pass
            diffs.append({
                'key': '|'.join(key),
                'column': col,
                'a_value': va,
                'b_value': vb,
                'diff': diff if (is_number(va) and is_number(vb)) else 'N/A',
                
            })

    print(f"Compared {len(shared_keys)} shared rows; found {len(diffs)} differing cells across {len(comp_columns)} compared columns.")

    if out_path:
        with open(out_path, 'w', newline='', encoding='utf-8') as outf:
            writer = csv.DictWriter(outf, fieldnames=['key', 'column', 'a_value', 'b_value', 'diff'])
            writer.writeheader()
            for d in diffs:
                writer.writerow(d)
        print(f"Wrote discrepancies to {out_path}")

    # Also print a small summary sample
    for d in diffs[:20]:
        print(d['key'], d['column'], 'A=', d['a_value'], 'B=', d['b_value'])

    return len(diffs)


def extend_file(source, start_year, out_path, end_year=2024, desired_cols=None):
    # default desired cols (preferential order)
    preferred = [
        'year', 'state_po', 'state', 'overall_winner', 'overall_runner_up',
        'winner_state', 'electoral_votes', 'winner_votes', 'loser_votes', 'totalvotes',
        'D_votes', 'R_votes', 'T_votes', 'votes_to_flip', 'votes_to_win'
    ]
    if desired_cols:
        desired = [c.strip() for c in desired_cols.split(',') if c.strip()]
    else:
        desired = preferred

    with open(source, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames or []
        available = set(header)
        chosen = [c for c in desired if c in available]
        # always include the key columns
        for k in ('year', 'state_po'):
            if k in available and k not in chosen:
                chosen.insert(0, k)

        if 'year' not in available:
            raise KeyError('source file does not contain a "year" column')

        rows = []
        for row in reader:
            y = row.get('year')
            try:
                yi = int(str(y).strip())
            except Exception:
                # skip rows with missing or malformed year
                continue
            if yi < int(start_year) or yi > int(end_year):
                continue
            outrow = OrderedDict((c, row.get(c, '')) for c in chosen)
            rows.append(outrow)

    # sort rows by year then state_po if available
    def sort_key(r):
        y = int(r.get('year') or 0)
        s = r.get('state_po') or r.get('state') or ''
        return (y, s)

    rows.sort(key=sort_key)

    with open(out_path, 'w', newline='', encoding='utf-8') as outf:
        writer = csv.DictWriter(outf, fieldnames=chosen)
        writer.writeheader()
        for r in rows:
            writer.writerow(r)

    print(f"Wrote {len(rows)} rows to {out_path} (years {start_year}..{end_year}). Columns: {', '.join(chosen)}")
    return len(rows)


def main():
    p = argparse.ArgumentParser(description='Compare or extend election CSVs')
    sub = p.add_subparsers(dest='cmd')

    pa = sub.add_parser('check', help='Compare two CSVs and list discrepancies')
    pa.add_argument('--a', required=True, help='First CSV file (A)')
    pa.add_argument('--b', required=True, help='Second CSV file (B)')
    pa.add_argument('--keys', default='year,abbr', help='Comma-separated key columns (default: year,abbr)')
    pa.add_argument('--out', help='Optional path to write CSV of discrepancies')

    pe = sub.add_parser('extend', help='Create new CSV using a larger source file for a year range (start..2024)')
    pe.add_argument('--source', required=True, help='Source CSV (the larger file)')
    pe.add_argument('--start-year', required=True, type=int, help='Start year to include (inclusive)')
    pe.add_argument('--out', required=True, help='Output CSV path')
    pe.add_argument('--cols', help='Optional comma-separated list of columns to keep (in order)')
    pe.add_argument('--end-year', type=int, default=2024, help='End year (default: 2024)')

    args = p.parse_args()
    if args.cmd == 'check':
        keys = [k.strip() for k in args.keys.split(',') if k.strip()]
        try:
            diffs = compare_files(args.a, args.b, keys, out_path=args.out)
            sys.exit(0 if diffs == 0 else 2)
        except Exception as e:
            print('Error:', e)
            sys.exit(3)
    elif args.cmd == 'extend':
        try:
            n = extend_file(args.source, args.start_year, args.out, end_year=args.end_year, desired_cols=args.cols)
            sys.exit(0)
        except Exception as e:
            print('Error:', e)
            sys.exit(4)
    else:
        p.print_help()


if __name__ == '__main__':
    main()

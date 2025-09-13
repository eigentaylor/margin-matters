#!/usr/bin/env python3
"""Generate `election_data/electoral_college.csv`.

Reads `election_data/Electoral_College_to_2020.csv` (Year,State,Votes)
and `2024_info.csv` to obtain state abbreviations and 2024 EVs.

Output columns: year,abbr,state,electoral_votes
Includes historical rows (abbr filled when found) and a 2024 row per state
using `evs_2024` from `2024_info.csv`.
"""
import csv
import os
import re

ROOT = os.path.dirname(__file__)
EC_SRC = os.path.join(ROOT, 'election_data', 'Electoral_College_to_2020.csv')
INFO_2024 = os.path.join(ROOT, '2024_info.csv')
OUT = os.path.join(ROOT, 'election_data', 'electoral_college.csv')


def normalize(name: str) -> str:
    if name is None:
        return ''
    s = name.strip().lower()
    # remove punctuation like periods and commas
    s = re.sub(r"[\.,\'\"]", '', s)
    s = re.sub(r"\s+", ' ', s)
    return s


def load_2024_info(path):
    """Return list of rows and mappings for state->abbr and state->evs_2024."""
    mapping_abbr = {}
    mapping_evs = {}
    rows = []
    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for r in reader:
            state = r.get('state') or r.get('State') or ''
            abbr = r.get('abbr') or r.get('Abbr') or r.get('state_abbr') or ''
            evs = r.get('evs_2024') or r.get('evs') or ''
            try:
                evs_int = int(evs) if evs != '' else ''
            except Exception:
                # leave as raw if non-integer
                evs_int = evs
            norm = normalize(state)
            mapping_abbr[norm] = abbr
            mapping_evs[norm] = evs_int
            rows.append({'state': state, 'abbr': abbr, 'evs_2024': evs_int})

    # add common alternate for DC, as source file uses 'D.C.' sometimes
    mapping_abbr.setdefault(normalize('d.c.'), mapping_abbr.get(normalize('district of columbia'), 'DC'))
    mapping_evs.setdefault(normalize('d.c.'), mapping_evs.get(normalize('district of columbia'), '3'))
    return rows, mapping_abbr, mapping_evs


def build():
    rows_out = []

    info_rows, abbr_map, evs_map = load_2024_info(INFO_2024)

    # read historical electoral college file
    with open(EC_SRC, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for r in reader:
            year = r.get('Year') or r.get('year')
            state = r.get('State') or r.get('state')
            votes = r.get('Votes') or r.get('votes') or ''
            abbr = ''
            if state:
                abbr = abbr_map.get(normalize(state), '')
                # handle D.C. variant explicitly
                if not abbr and normalize(state) in ('d c', 'd.c', 'd.c.', 'dc'):
                    abbr = 'DC'

            rows_out.append({'year': year, 'abbr': abbr, 'state': state, 'electoral_votes': votes})

    # Add 2024 rows from info_rows (avoid duplicates if any)
    seen_2024_states = set()
    for info in info_rows:
        state = info['state']
        abbr = info['abbr']
        evs = info['evs_2024']
        norm = normalize(state)
        if norm in seen_2024_states:
            continue
        seen_2024_states.add(norm)
        rows_out.append({'year': '2024', 'abbr': abbr, 'state': state, 'electoral_votes': str(evs)})

    # write output
    # sort rows by abbr, year
    rows_out.sort(key=lambda x: (x['abbr'], x['year']))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', newline='', encoding='utf-8') as f:
        fieldnames = ['year', 'abbr', 'state', 'electoral_votes']
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows_out:
            writer.writerow(r)

    print(f'Wrote {len(rows_out)} rows to {OUT}')


if __name__ == '__main__':
    build()

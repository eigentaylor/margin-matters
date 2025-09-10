import csv
import os
from collections import defaultdict

import params
import utils


def safe_int(x):
    try:
        return int(x)
    except Exception:
        return 0


def safe_float(x):
    try:
        return float(x)
    except Exception:
        return 0.0


def main(two_party_margin=False):
    root = os.path.dirname(__file__)
    infile = os.path.join(root, "election_data", "state_totals_by_year.csv")
    old_margins = os.path.join(root, "presidential_margins_old.csv")
    outfile = os.path.join(root, "presidential_margins.csv")

    rows = []
    years = set()
    with open(infile, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for r in reader:
            r2 = dict(r)
            r2['year'] = int(r['year'])
            r2['D_votes'] = safe_int(r.get('D_votes', 0))
            r2['R_votes'] = safe_int(r.get('R_votes', 0))
            r2['T_votes'] = safe_int(r.get('T_votes', 0))
            r2['total_votes'] = safe_int(r.get('total_votes', 0))
            # capture electoral_votes if present
            r2['electoral_votes'] = safe_int(r.get('electoral_votes', 0))
            rows.append(r2)
            years.add(r2['year'])

    # index by (abbr) -> list of rows sorted by year
    by_state = defaultdict(list)
    by_year = defaultdict(list)
    for r in rows:
        by_state[r['abbr']].append(r)
        by_year[r['year']].append(r)

    for abbr, lst in by_state.items():
        lst.sort(key=lambda x: x['year'])

    # compute pres_margin for all rows and national_margin per year
    national_margin_by_year = {}
    for year, lst in by_year.items():
        for r in lst:
            if two_party_margin:
                total = r['D_votes'] + r['R_votes']
            else:
                total = r['total_votes'] if r['total_votes'] != 0 else 1
                r['two_party_margin'] = (r['D_votes'] - r['R_votes']) / (r['D_votes'] + r['R_votes']) if (r['D_votes'] + r['R_votes']) > 0 else 0.0
            r['pres_margin'] = (r['D_votes'] - r['R_votes']) / total
        # find national row
        national = next((x for x in lst if x['abbr'] == 'NATIONAL'), None)
        if national:
            national_margin_by_year[year] = national['pres_margin']

    # Prepare output rows sorted by year then abbr
    years_sorted = sorted(years)
    out_rows = []

    # If old margins file exists, read electoral votes for 2024 to override
    override_ev_2024 = {}
    if os.path.exists(old_margins):
        with open(old_margins, newline='', encoding='utf-8') as f:
            r = csv.DictReader(f)
            for row in r:
                try:
                    yr = int(row.get('year', '0'))
                except Exception:
                    continue
                if yr == 2024:
                    ab = row.get('abbr')
                    ev = safe_int(row.get('electoral_votes', 0))
                    override_ev_2024[ab] = ev

    # helper to get previous margin for a state
    for year in years_sorted:
        # build quick map for this year
        year_map = {r['abbr']: r for r in by_year[year]}
        for abbr, r in sorted(year_map.items()):
            pres = r.get('pres_margin', 0.0)
            national = national_margin_by_year.get(year, 0.0)
            relative = pres - national

            # find previous year for this state
            prev_pres = None
            prev_relative = None
            prev_national = None

            # prev state pres: look up previous year row for same abbr
            prev_years = [y for y in years_sorted if y < year]
            if prev_years:
                prev_year = prev_years[-1]
                prev_map = {x['abbr']: x for x in by_year.get(prev_year, [])}
                prev_row = prev_map.get(abbr)
                if prev_row is not None:
                    prev_pres = prev_row.get('pres_margin', None)
                    prev_national = national_margin_by_year.get(prev_year, None)
                    if not params.USE_TWO_PARTY_MARGIN:
                        prev_two_party = prev_row.get('two_party_margin', None)
                    if prev_pres is not None and prev_national is not None:
                        prev_relative = prev_pres - prev_national

            pres_delta = pres - prev_pres if prev_pres is not None else None
            national_prev = prev_national if prev_national is not None else None
            national_delta = national - national_prev if national_prev is not None else None
            relative_delta = relative - prev_relative if prev_relative is not None else None
            if not params.USE_TWO_PARTY_MARGIN and prev_pres is not None and prev_two_party is not None:
                r['two_party_margin_delta'] = r['two_party_margin'] - prev_two_party

            # electoral_votes not present in source; assume 0
            electoral_votes = r.get('electoral_votes', 0)

            out = {
                'year': year,
                'abbr': abbr,
                'D_votes': r['D_votes'],
                'R_votes': r['R_votes'],
                'T_votes': r['T_votes'],
                'total_votes': r['total_votes'],
                'electoral_votes': electoral_votes,
                'pres_margin': f"{pres:.12f}",
                'pres_margin_delta': f"{pres_delta:.12f}" if pres_delta is not None else '0',
                'pres_margin_str': utils.lean_str(pres),
                'pres_margin_delta_str': utils.lean_str(pres_delta),
                'national_margin': f"{national:.12f}",
                'national_margin_delta': f"{national_delta:.12f}" if national_delta is not None else '0',
                'national_margin_str': utils.lean_str(national),
                'national_margin_delta_str': utils.lean_str(national_delta),
                'relative_margin': f"{relative:.12f}",
                'relative_margin_delta': f"{relative_delta:.12f}" if relative_delta is not None else '0',
                'relative_margin_str': utils.lean_str(relative),
                'relative_margin_delta_str': utils.lean_str(relative_delta),
            }
            if not two_party_margin:
                out['two_party_margin'] = r.get('two_party_margin', 0.0)
                out['two_party_margin_str'] = utils.lean_str(out['two_party_margin'])
                out['two_party_margin_delta'] = r.get('two_party_margin_delta', 0.0)
                out['two_party_margin_delta_str'] = utils.lean_str(out['two_party_margin_delta'])
            out_rows.append(out)

    # write CSV
    fieldnames = [
        'year', 'abbr', 'D_votes', 'R_votes', 'T_votes', 'total_votes', 'electoral_votes',
        'pres_margin', 'pres_margin_delta', 'pres_margin_str', 'pres_margin_delta_str',
        'national_margin', 'national_margin_delta', 'national_margin_str', 'national_margin_delta_str',
        'relative_margin', 'relative_margin_delta', 'relative_margin_str', 'relative_margin_delta_str'
    ]
    if not two_party_margin:
        fieldnames += ['two_party_margin', 'two_party_margin_str', 'two_party_margin_delta', 'two_party_margin_delta_str']

    with open(outfile, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in out_rows:
            # apply 2024 overrides from old margins if present
            if r['year'] == 2024 and r['abbr'] in override_ev_2024:
                r['electoral_votes'] = override_ev_2024[r['abbr']]
            writer.writerow(r)

    print(f"Wrote {len(out_rows)} rows to {outfile}")


if __name__ == '__main__':
    two_party_margin = params.USE_TWO_PARTY_MARGIN
    print(f"Using two-party margin: {two_party_margin}")
    main(two_party_margin=two_party_margin)

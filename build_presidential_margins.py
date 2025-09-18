import csv
import os
from collections import defaultdict
from params import COLORS
import utils


THIRD_PARTY_WINS = {
    1960: ['MS'],
    1968: ['AL', 'AR', 'GA', 'LA', 'MS'],
}

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


def main():
    root = os.path.dirname(__file__)
    # use the combined wikipedia-derived totals as requested
    infile = os.path.join(root, "election_data", "wikipedia", "wikipedia_presidential_elections_combined.csv")
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
    national_margins_by_year = {}
    for year, lst in by_year.items():
        for r in lst:
            two_party_total = r['D_votes'] + r['R_votes']
            total = r['total_votes'] if r['total_votes'] != 0 else 1
            r['two_party_margin'] = (r['D_votes'] - r['R_votes']) / two_party_total if two_party_total > 0 else 0.0
            r['pres_margin'] = (r['D_votes'] - r['R_votes']) / total
            r['third_party_share'] = (r['T_votes'] / total) if total > 0 else 0.0
        # find national row
        national_margin = next((x for x in lst if x['abbr'] == 'NATIONAL'), None)
        if national_margin:
            national_margins_by_year[year] = {
                'margin': national_margin['pres_margin'],
                'two_party_margin': national_margin['two_party_margin'],
                'third_party_share': national_margin['third_party_share'],
                }

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

    # load historical electoral college allocations
    electoral_map = {}  # key: (year, abbr) -> electoral_votes
    ec_file = os.path.join(root, "election_data", "Electoral_College.csv")
    if os.path.exists(ec_file):
        with open(ec_file, newline='', encoding='utf-8') as f:
            rdr = csv.DictReader(f)
            for row in rdr:
                try:
                    y = int(row.get('year') or 0)
                except Exception:
                    y = 0
                ab = row.get('abbr')
                ev = safe_int(row.get('electoral_votes', 0))
                if ab:
                    electoral_map[(y, ab)] = ev

    def compute_electoral_votes(year, abbr):
        # Special handling for Maine (ME) and Nebraska (NE) which have district allocations
        base = abbr.split('-')[0]
        # Maine: starting 1972, ME-AL gets 2, ME-01/02 get 1; else ME-AL gets all and districts 0
        if base == 'ME':
            total = electoral_map.get((year, 'ME'), 0)
            if abbr == 'ME-AL':
                return 2 if year >= 1972 else total
            if abbr.startswith('ME-'):
                return 1 if year >= 1972 else 0
            return total
        # Nebraska: starting 1992, NE-AL gets 2, NE-01/02/03 get 1; else NE-AL gets all and districts 0
        if base == 'NE':
            total = electoral_map.get((year, 'NE'), 0)
            if abbr == 'NE-AL':
                return 2 if year >= 1992 else total
            if abbr.startswith('NE-'):
                return 1 if year >= 1992 else 0
            return total
        # default: try exact match then try base abbr (strip district)
        ev = electoral_map.get((year, abbr))
        if ev is None:
            ev = electoral_map.get((year, base), 0)
        return ev or 0

    # helper to get previous margin for a state
    for year in years_sorted:
        # build quick map for this year
        year_map = {r['abbr']: r for r in by_year[year]}
        for abbr, r in sorted(year_map.items()):
            pres = r.get('pres_margin', 0.0)
            national_margin = national_margins_by_year.get(year, 0.0)
            relative_pres = pres - national_margin['margin'] if national_margin else pres
            
            third_party = r.get('third_party_share', 0.0)
            third_party_national = national_margins_by_year.get(year, {}).get('third_party_share', 0.0)
            third_party_relative = third_party - third_party_national

            two_party_margin = r.get('two_party_margin', 0.0)
            two_party_national = national_margins_by_year.get(year, {}).get('two_party_margin', 0.0)
            two_party_relative = two_party_margin - two_party_national

            # find previous year for this state
            prev_pres = None
            prev_relative = None
            prev_national = None
            prev_two_party = None
            prev_two_party_relative = None
            prev_two_party_national = None
            prev_row = None

            # prev state pres: look up previous year row for same abbr
            prev_years = [y for y in years_sorted if y < year]
            if prev_years:
                prev_year = prev_years[-1]
                prev_map = {x['abbr']: x for x in by_year.get(prev_year, [])}
                prev_row = prev_map.get(abbr)
                if prev_row is not None:
                    prev_pres = prev_row.get('pres_margin', None)
                    prev_national = national_margins_by_year.get(prev_year, None)
                    prev_two_party = prev_row.get('two_party_margin', None)
                    prev_relative = prev_row.get('pres_margin', None) - prev_national['margin'] if prev_national else None
                    
                    prev_two_party = prev_row.get('two_party_margin', None)
                    prev_two_party_national = prev_national.get('two_party_margin', None) if prev_national else None
                    prev_two_party_relative = prev_row.get('two_party_margin', None) - prev_two_party_national if prev_two_party_national else None

            pres_delta = pres - prev_pres if prev_pres is not None else None
            #national_prev = prev_national if prev_national is not None else None
            national_delta = national_margin['margin'] - prev_national['margin'] if prev_national else None
            relative_delta = relative_pres - prev_relative if prev_relative is not None else None
            two_party_pres_delta = two_party_margin - prev_two_party if prev_two_party is not None else None
            two_party_relative_delta = two_party_relative - prev_two_party_relative if prev_two_party_relative is not None else None
            two_party_national_delta = two_party_national - prev_two_party_national if prev_two_party_national is not None else None

            # determine electoral votes from Electoral_College.csv (with ME/NE special-casing)
            electoral_votes = compute_electoral_votes(year, abbr) or r.get('electoral_votes', 0)

            # compute vote deltas (difference from previous available year for this abbr)
            if prev_row is not None:
                D_delta = r['D_votes'] - prev_row.get('D_votes', 0)
                R_delta = r['R_votes'] - prev_row.get('R_votes', 0)
                #T_delta = r['T_votes'] - prev_row.get('T_votes', 0)
                total_delta = r['total_votes'] - prev_row.get('total_votes', 0)
            else:
                D_delta = 0
                R_delta = 0
                #T_delta = 0
                total_delta = 0

            out = {
                'year': year,
                'abbr': abbr,
                'D_votes': r['D_votes'],
                'R_votes': r['R_votes'],
                'D_delta': D_delta,
                'R_delta': R_delta,
                #'T_delta': T_delta,
                'total_delta': total_delta,
                'T_votes': r['T_votes'],
                'total_votes': r['total_votes'],
                'electoral_votes': electoral_votes,
                
                'pres_margin': f"{pres:.12f}",
                'pres_margin_delta': f"{pres_delta:.12f}" if pres_delta is not None else '0',
                # Default pres margin string is D+/R+ based on pres value. It may be overridden
                # for historic third-party wins below.
                'pres_margin_str': utils.lean_str(pres),
                'pres_margin_delta_str': utils.lean_str(pres_delta),
                
                'national_margin': f"{national_margin['margin']:.12f}",
                'national_margin_delta': f"{national_delta:.12f}" if national_delta is not None else '0',
                'national_margin_str': utils.lean_str(national_margin['margin']),
                'national_margin_delta_str': utils.lean_str(national_delta),
                
                'relative_margin': f"{relative_pres:.12f}",
                'relative_margin_delta': f"{relative_delta:.12f}" if relative_delta is not None else '0',
                'relative_margin_str': utils.lean_str(relative_pres),
                'relative_margin_delta_str': utils.lean_str(relative_delta),
                
                'two_party_margin': r.get('two_party_margin', 0.0),
                'two_party_margin_str': utils.lean_str(r.get('two_party_margin', 0.0)),
                'two_party_margin_delta': two_party_pres_delta if two_party_pres_delta is not None else 0.0,
                'two_party_margin_delta_str': utils.lean_str(two_party_pres_delta) if two_party_pres_delta is not None else '0.0',
                
                'two_party_national_margin': two_party_national if two_party_national is not None else 0.0,
                'two_party_national_margin_str': utils.lean_str(two_party_national) if two_party_national is not None else '0.0',
                'two_party_national_margin_delta': two_party_national_delta if two_party_national_delta is not None else 0.0,
                'two_party_national_margin_delta_str': utils.lean_str(two_party_national_delta) if two_party_national_delta is not None else '0.0',
                
                'two_party_relative_margin': two_party_relative if two_party_relative is not None else 0.0,
                'two_party_relative_margin_str': utils.lean_str(two_party_relative) if two_party_relative is not None else '0.0',
                'two_party_relative_margin_delta': two_party_relative_delta if two_party_relative_delta is not None else 0.0,
                'two_party_relative_margin_delta_str': utils.lean_str(two_party_relative_delta) if two_party_relative_delta is not None else '0.0',
                
                'third_party_share': third_party if third_party is not None else 0.0,
                'third_party_share_str': utils.lean_str(third_party, third_party=True) if third_party is not None else '0.0',
                'third_party_national_share': third_party_national if third_party_national is not None else 0.0,
                'third_party_national_share_str': utils.lean_str(third_party_national, third_party=True) if third_party_national is not None else '0.0',
                'third_party_relative_share': third_party_relative if third_party_relative is not None else 0.0,
                'third_party_relative_share_str': utils.lean_str(third_party_relative, third_party=True) if third_party_relative is not None else '0.0',
                # color will be assigned below based on the winner
                'color': None,
            }
            # Determine winner and color
            try:
                dv = int(r['D_votes'])
                rv = int(r['R_votes'])
                tv = int(r['T_votes'])
            except Exception:
                dv = r.get('D_votes', 0)
                rv = r.get('R_votes', 0)
                tv = r.get('T_votes', 0)

            # winner letter: 'D', 'R', or 'T' (largest raw votes)
            if tv > dv and tv > rv:
                winner = 'T'
            elif dv > rv:
                winner = 'D'
            elif rv > dv:
                winner = 'R'
            else:
                # tie or no votes: fallback to 'T' if third party equals, otherwise D for non-negative pres
                if tv == dv == rv:
                    winner = 'T'
                else:
                    # prefer D when pres >= 0 else R
                    winner = 'D' if pres >= 0 else 'R'

            out['color'] = COLORS.get(winner, 'transparent')

            # If this is a historic third-party win entry, override pres_margin_str to show T margin
            # defined as T_votes minus the larger of D/R, expressed as percentage like 'T+X.X'
            try:
                if year in THIRD_PARTY_WINS and abbr in THIRD_PARTY_WINS.get(year, []):
                    tot = r['total_votes'] if r['total_votes'] else 1
                    lead_major = max(dv, rv)
                    t_margin = (tv - lead_major) / tot if tot > 0 else 0.0
                    # Format as T+/- with one decimal percentage (consistent with other margin strings)
                    sign = '+' if t_margin >= 0 else '-'
                    out['pres_margin_str'] = f"T{sign}{abs(t_margin * 100):.1f}"
            except Exception:
                # If anything goes wrong, leave the default pres_margin_str
                pass
            out_rows.append(out)

    # write CSV
    fieldnames = [
        'year', 'abbr', 'D_votes', 'R_votes', 'T_votes', 'total_votes', 'electoral_votes',
    'D_delta', 'R_delta', 'total_delta',
        'pres_margin', 'pres_margin_delta', 'pres_margin_str', 'pres_margin_delta_str',
        'national_margin', 'national_margin_delta', 'national_margin_str', 'national_margin_delta_str',
        'relative_margin', 'relative_margin_delta', 'relative_margin_str', 'relative_margin_delta_str',
        'third_party_share', 'third_party_share_str', 'third_party_national_share', 'third_party_national_share_str', 'third_party_relative_share', 'third_party_relative_share_str',
        'two_party_margin', 'two_party_margin_str', 'two_party_margin_delta', 'two_party_margin_delta_str',
        'two_party_national_margin', 'two_party_national_margin_str', 'two_party_national_margin_delta', 'two_party_national_margin_delta_str',
        'two_party_relative_margin', 'two_party_relative_margin_str', 'two_party_relative_margin_delta', 'two_party_relative_margin_delta_str',
        'color',
    ]

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
    main()

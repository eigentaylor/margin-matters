import csv
import os
from collections import defaultdict
from params import COLORS
import utils
import json
import ast


THIRD_PARTY_WINS = {
    1892: ['KS', 'CO', 'ID', 'NV', 'ND'],
    #1912: ['CA', 'MN', 'SD', 'MI', 'WA', 'PA'],
    1912: ['UT', 'VT'],
    1924: ['WI'],
    1948: ['LA', 'MS', 'SC'], # AL too, technically, but we handle that specially
    1960: ['MS'],
    1968: ['AL', 'AR', 'GA', 'LA', 'MS'],
}

def get_candidate_names(year):

    names_by_year = {
        2024: ('Donald Trump', 'Kamala Harris'),
        2020: ('Donald Trump', 'Joe Biden'),
        2016: ('Donald Trump', 'Hillary Clinton'),
        2012: ('Mitt Romney', 'Barack Obama'),
        2008: ('John McCain', 'Barack Obama'),
        2004: ('George W. Bush', 'John Kerry'),
        2000: ('George W. Bush', 'Al Gore'),
        1996: ('Bob Dole', 'Bill Clinton'),
        1992: ('George H.W. Bush', 'Bill Clinton'),
        1988: ('George H.W. Bush', 'Michael Dukakis'),
        1984: ('Ronald Reagan', 'Walter Mondale'),
        1980: ('Ronald Reagan', 'Jimmy Carter'),
        1976: ('Gerald Ford', 'Jimmy Carter'),
        1972: ('Richard Nixon', 'George McGovern'),
        1968: ('Richard Nixon', 'Hubert Humphrey'),
        1964: ('Barry Goldwater', 'Lyndon B. Johnson'),
        1960: ('Richard Nixon', 'John F. Kennedy'),
        1956: ('Dwight D. Eisenhower', 'Adlai Stevenson'),
        1952: ('Dwight D. Eisenhower', 'Adlai Stevenson'),
        1948: ('Thomas E. Dewey', 'Harry S. Truman'),
        1944: ('Thomas E. Dewey', 'Franklin D. Roosevelt'),
        1940: ('Wendell Willkie', 'Franklin D. Roosevelt'),
        1936: ('Alf Landon', 'Franklin D. Roosevelt'),
        1932: ('Herbert Hoover', 'Franklin D. Roosevelt'),
        1928: ('Herbert Hoover', 'Al Smith'),
        1924: ('Calvin Coolidge', 'John W. Davis'),
        1920: ('Warren G. Harding', 'James M. Cox'),
        1916: ('Charles Evans Hughes', 'Woodrow Wilson'),
        1912: ('Theodore Roosevelt', 'Woodrow Wilson'), # Bull Moose Roosevelt was the main opponent
        1908: ('William Howard Taft', 'William Jennings Bryan'),
        1904: ('Theodore Roosevelt', 'Alton B. Parker'),
        1900: ('William McKinley', 'William Jennings Bryan'),
        1896: ('William McKinley', 'William Jennings Bryan'),
        1892: ('Benjamin Harrison', 'Grover Cleveland'),
        1888: ('Benjamin Harrison', 'Grover Cleveland'),
        1884: ('James G. Blaine', 'Grover Cleveland'),
        1880: ('James A. Garfield', 'Winfield Scott Hancock'),
        1876: ('Rutherford B. Hayes', 'Samuel J. Tilden'),
        1872: ('Ulysses S. Grant', 'Horace Greeley'),
        1868: ('Ulysses S. Grant', 'Horatio Seymour'),
        1864: ('Abraham Lincoln', 'George B. McClellan'),
    }
    return names_by_year.get(year, ('Republican', 'Democratic'))

NOTES = {
    # special notes for certain years/states
    (1876, 'CO'): "In 1876, Colorado's 3 electoral votes were awarded to Hayes (R) as there was no popular election for president in the state; the state legislature appointed electors who voted for Hayes.",
    (1868, 'FL'): "In 1868, Florida's 3 electoral votes were awarded to Grant (R) as there was no popular election for president in the state; the state legislature appointed electors who voted for Grant.",
    (1864, 'LA'): "In 1864, Louisiana's 7 electoral votes were awarded to Lincoln (R) as there was no popular election for president in the state; the state legislature appointed electors who voted for Lincoln.",
    (1912, None): "In 1912, the main opposition to Wilson (D) was Theodore Roosevelt of the Progressive Party (Bull Moose), who we consider the de facto Republican candidate for margin purposes, with Taft as a third-party candidate.",
    (1948, 'AL'): "In 1948, Truman was not on the ballot in Alabama; the Democratic column represents a Dixiecrat slate. We copy the third-party votes to the D_votes column to reflect that this still indicates a Democratic-leaning outcome.",
    (1960, 'AL'): "Voters in Alabama voted for electors individually, with 5 pledged to Kennedy (D) and 6 unpledged; we count D_votes and T_votes based on the highest vote-getting elector in each category, as Wikipedia does.",
    (2024, 'NE-01'): "NE-01 is the only electoral unit which had a more democratic raw margin compared to 2020. This is likely due in part to the redrawing of the district to include more of Omaha's suburbs.",
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
            # New: total third-party votes and per-candidate breakdown
            r2['third_party_votes'] = safe_int(r.get('third_party_votes', 0))
            r2['third_party_results'] = r.get('third_party_results', '')
            r2['top_third_party_share'] = r2['T_votes'] / r2['total_votes'] if r2['total_votes'] > 0 else 0.0
            # capture electoral_votes if present
            r2['electoral_votes'] = safe_int(r.get('electoral_votes', 0))
            rows.append(r2)
            years.add(r2['year'])
            if (r2['year'] == 1876 and r2['abbr'] == 'CO') or (r2['year'] == 1868 and r2['abbr'] == 'FL') or (r2['year'] == 1864 and r2['abbr'] == 'LA'):
                # Special case: in 1876, Colorado's 3 electoral votes were awarded to Hayes (R)
                # despite Tilden (D) winning the popular vote there. This was due to a disputed
                # result and a controversial decision by the Electoral Commission. We will
                # manually adjust the D and R votes to reflect this outcome, which also
                # avoids a tie in the data that would complicate margin calculations.
                # the same thing happened in Florida (FL) in 1868, and Louisiana in 1864 so handle that too
                abbr = r2['abbr']
                r2['D_votes'] = 0
                r2['R_votes'] = 1  # dummy non-zero to avoid tie logic
                r2['total_votes'] = 1
                r2['electoral_votes'] = 3 if abbr != 'LA' else 7 # LA had 7 EVs in 1864 while FL had 3 in 1868 and CO had 3 in 1876

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
            # Use total third-party votes (not max single candidate) for share
            tp_total_votes = r.get('third_party_votes', None)
            if tp_total_votes is None:
                tp_total_votes = r.get('T_votes', 0)  # fallback for older files
            r['third_party_share'] = (tp_total_votes / total) if total > 0 else 0.0
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
            if year == 1948 and abbr == 'AL':
                # In 1948 AL, the Democratic column represents a Dixiecrat slate; we want third-party share to include those votes
                # Use total third-party votes plus D to capture that intent
                total = r.get('total_votes', 1) or 1
                third_party = (r.get('third_party_votes', 0) + r.get('D_votes', 0)) / total
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
                'D_share': r['D_votes'] / r['total_votes'] if r['total_votes'] > 0 else 0.0,
                'R_votes': r['R_votes'],
                'R_share': r['R_votes'] / r['total_votes'] if r['total_votes'] > 0 else 0.0,
                'third_party_votes': r.get('third_party_votes', 0),
                'D_delta': D_delta,
                'R_delta': R_delta,
                #'T_delta': T_delta,
                'total_delta': total_delta,
                'T_votes': r['T_votes'],
                'total_votes': r['total_votes'],
                'electoral_votes': electoral_votes,
                'third_party_results': r.get('third_party_results', ''),
                
                'D_candidate': get_candidate_names(year)[1],
                'R_candidate': get_candidate_names(year)[0],
                # top_third_party will be filled in below after parsing third_party_results
                'top_third_party': '',
                'top_third_party_share': r.get('top_third_party_share', 0.0),
                
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
                
                'top_third_party_share_str': utils.lean_str(r.get('top_third_party_share', 0.0), third_party=True),
                
                'third_party_share': third_party if third_party is not None else 0.0,
                'third_party_share_str': utils.lean_str(third_party, third_party=True) if third_party is not None else '0.0',
                'third_party_national_share': third_party_national if third_party_national is not None else 0.0,
                'third_party_national_share_str': utils.lean_str(third_party_national, third_party=True) if third_party_national is not None else '0.0',
                'third_party_relative_share': third_party_relative if third_party_relative is not None else 0.0,
                'third_party_relative_share_str': utils.lean_str(third_party_relative, third_party=True) if third_party_relative is not None else '0.0',
                # color will be assigned below based on the winner
                'color': None,
                'special_case_notes': NOTES.get((year, abbr), '') or NOTES.get((year, None), ''),
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
            if (tv > dv and tv > rv) or (year in [1948, 1960] and abbr == 'AL'):
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

                # Special-case: Colorado (CO) in 1876 did not hold a popular election
                # for president; the state's electors cast their votes for Rutherford B. Hayes (Republican).
                # Force the winner to R and ensure 3 electoral votes so the site consistently
                # colors CO red and awards the Republican 3 EVs for 1876.
                # the same thing happened in Florida (FL) in 1868, so handle that too
                if (year == 1876 and abbr == 'CO') or (year == 1868 and abbr == 'FL'):
                    winner = 'R'
                    r_votes = 1 # dummy non-zero to avoid tie logic
                    # ensure the output electoral_votes reflects 3 EVs
                    try:
                        ev_val = int(out.get('electoral_votes', 0))
                    except Exception:
                        ev_val = 0
                    if ev_val < 3:
                        out['electoral_votes'] = 3

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
                elif year == 1948 and abbr == 'AL':
                    # Strom Thurmond (Dixiecrat) won AL; show his margin vs Dewey (D - R) / total but displayed as T+X.X
                    tot = r['total_votes'] if r['total_votes'] else 1
                    d_margin = (dv - rv) / tot if tot > 0 else 0.0
                    out['pres_margin_str'] = f"T{sign}{abs(d_margin * 100):.1f}"
            except Exception:
                # If anything goes wrong, leave the default pres_margin_str
                pass
            # parse third_party_results to determine the top third-party candidate name
            try:
                tpr = r.get('third_party_results', '') or ''
                top_name = ''
                top_votes = 0
                if tpr:
                    # the field in the CSV looks like a Python dict (double-quoted keys) or JSON-like
                    # try json.loads first, fall back to ast.literal_eval
                    parsed = None
                    try:
                        parsed = json.loads(tpr)
                    except Exception:
                        try:
                            parsed = ast.literal_eval(tpr)
                        except Exception:
                            parsed = None
                    if isinstance(parsed, dict):
                        for name, val in parsed.items():
                            if 'Other' in name:
                                continue
                            try:
                                v = int(val)
                            except Exception:
                                try:
                                    v = int(str(val))
                                except Exception:
                                    v = 0
                            if v > top_votes:
                                top_votes = v
                                top_name = name
                # Special-case 1948 AL where the D column holds Thurmond's votes; ensure label present
                if year == 1948 and abbr == 'AL' and not top_name:
                    top_name = 'Strom Thurmond'
                out['top_third_party'] = top_name if top_name else 'None'
            except Exception:
                print(f"Warning: failed to parse third_party_results for {year} {abbr}: {r.get('third_party_results', '')}")
                out['top_third_party'] = 'None'
            out_rows.append(out)

    # write CSV
    fieldnames = [
        'year', 'abbr', 'D_votes', 'R_votes', 'electoral_votes', 'T_votes',
        'D_share', 'R_share', 
        'D_candidate', 'R_candidate',
        'top_third_party_share', 'top_third_party', 'third_party_votes', 'total_votes', 'third_party_results',
        'D_delta', 'R_delta', 'total_delta',
        'pres_margin', 'pres_margin_delta',
        'national_margin', 'national_margin_delta',
        'relative_margin', 'relative_margin_delta',
        'third_party_share', 'third_party_national_share', 'third_party_relative_share',
        'two_party_margin', 'two_party_margin_delta',
        'two_party_national_margin', 'two_party_national_margin_delta',
        'two_party_relative_margin', 'two_party_relative_margin_delta',
        'color',
        'pres_margin_str', 'pres_margin_delta_str',
        'national_margin_str', 'national_margin_delta_str',
        'relative_margin_str', 'relative_margin_delta_str',
        'top_third_party_share_str',
        'third_party_share_str', 'third_party_national_share_str', 'third_party_relative_share_str',
        'two_party_margin_str', 'two_party_margin_delta_str',
        'two_party_national_margin_str', 'two_party_national_margin_delta_str',
        'two_party_relative_margin_str', 'two_party_relative_margin_delta_str',
        'special_case_notes'
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

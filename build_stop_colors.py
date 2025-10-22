import csv
import os
from collections import defaultdict
import traceback
from typing import Dict, List, Tuple

import params


EPS = 1e-4
PV_CAP = params.TESTER_PV_CAP  # max abs PV shift to consider
STOP_KEY_PREC = 6  # decimals for stop key matching in JS


def parse_float(x, default=0.0):
    try:
        return float(x)
    except Exception:
        return default


def load_margins(path_candidates: List[str]) -> List[Dict]:
    for p in path_candidates:
        if os.path.exists(p):
            with open(p, newline='', encoding='utf-8') as f:
                return list(csv.DictReader(f))
    raise FileNotFoundError("presidential_margins.csv not found in expected locations")


def build_stop_rows(rows: List[Dict]) -> List[Dict]:
    # Group by year and build stops mirroring tester.js logic
    by_year: Dict[int, List[Dict]] = defaultdict(list)
    for r in rows:
        try:
            y = int(r.get('year') or 0)
        except Exception:
            continue
        if not y:
            continue
        by_year[y].append(r)

    out: List[Dict] = []
    for year, lst in by_year.items():
        if year == 2020:
            pass
        # Extract nat margin
        nat = None
        for r in lst:
            if r.get('abbr') in ('NATIONAL', 'NAT'):
                nat = parse_float(r.get('national_margin'))
                break
        if nat is None:
            # fallback: average of national_margin fields if present
            ms = [parse_float(r.get('national_margin')) for r in lst if r.get('national_margin')]
            nat = sum(ms) / len(ms) if ms else 0.0

        # Build stops
        stops_set = set([0.0])
        if abs(nat) <= PV_CAP:
            stops_set.add(nat)

        stop_to_units: Dict[float, List[str]] = defaultdict(list)
        stop_to_eff: Dict[float, float] = {}

        # EVEN and Actual effs
        stop_to_eff[0.0] = 0.0
        stop_to_eff[nat] = nat

        # helper to classify and append an output row for a single unit/stop
        def classify_and_append(s: float, eff: float, r: Dict):
            abbr = r.get('abbr')
            nat = parse_float(r.get('national_margin'))
            total_votes = parse_float(r.get('total_votes'))
            third_party_total = parse_float(r.get('third_party_votes'))
            if total_votes <= 0:
                return
            
            # Get base vote counts
            d_votes_base = parse_float(r.get('D_votes'))
            r_votes_base = parse_float(r.get('R_votes'))
            o_votes_base = parse_float(r.get('T_votes'))  # Top third party votes (stays constant)
            
            # Calculate two-party votes the same way as JavaScript: total - all_third_party
            two_party_votes = total_votes - third_party_total
            if two_party_votes <= 0:
                return
            
            # Calculate adjusted votes at the effective PV
            # PV shift is relative to national margin
            pv_shift = eff - nat
            
            # Base two-party margin
            base_d_share = d_votes_base / two_party_votes
            base_margin = 2 * base_d_share - 1
            
            # Target two-party margin after PV shift
            target_margin = base_margin + pv_shift
            target_d_share = (target_margin + 1) / 2
            
            # Calculate adjusted raw votes
            d_votes = two_party_votes * target_d_share
            r_votes = two_party_votes * (1 - target_d_share)
            o_votes = o_votes_base  # Third party votes stay constant
            
            # Determine current leader
            if d_votes > r_votes and d_votes > o_votes:
                winner = 'D'
            elif r_votes > d_votes and r_votes > o_votes:
                winner = 'R'
            elif o_votes > d_votes and o_votes > r_votes:
                winner = 'T'
            else:
                # Tie or very close - use the side of the stop relative to national
                side = 1 if (s - nat) >= 0 else -1
                winner = 'D' if side >= 0 else 'R'
            # Use canonical palette for CSV exports to ensure consistent colors
            color_name = 'BLUE' if winner == 'D' else ('RED' if winner == 'R' else 'YELLOW')
            CANON = {'D': '#1e4bd1', 'R': '#b22222', 'T': '#C9A400'}
            color_css = CANON.get(winner) or params.COLORS.get(winner, 'transparent')
            
            out.append({
                'year': year,
                'stop': f"{s:.12f}",
                'stop_key': f"{s:.{STOP_KEY_PREC}f}",
                'effective_pv': f"{eff:.12f}",
                'unit': abbr,
                'winner': winner,
                'result_color_name': color_name,
                'color_css': color_css,
            })

        for r in lst:
            abbr = r.get('abbr')
            if not abbr or abbr in ('NATIONAL', 'NAT'):
                continue
            
            total_votes = parse_float(r.get('total_votes'))
            third_party_total = parse_float(r.get('third_party_votes'))
            if total_votes == 0:
                # skip zero-vote states
                continue
            
            # Get base vote counts
            d_votes_base = parse_float(r.get('D_votes'))
            r_votes_base = parse_float(r.get('R_votes'))
            o_votes_base = parse_float(r.get('T_votes'))  # Top third party votes (stays constant)
            
            # Use the same calculation as JavaScript: two_party = total - all_third_party
            two_party_votes = total_votes - third_party_total
            if two_party_votes <= 0:
                continue
            
            nat = parse_float(r.get('national_margin'))
            
            # Calculate base two-party margin
            base_d_share = d_votes_base / two_party_votes
            base_margin = 2 * base_d_share - 1
            
            # Helper function to determine winner at a given PV margin
            def get_winner_at_pv(pv_margin):
                pv_shift = pv_margin - nat
                target_margin = base_margin + pv_shift
                d = two_party_votes * (target_margin + 1) / 2
                r = two_party_votes * (1 - (target_margin + 1) / 2)
                o = o_votes_base
                
                if d > r and d > o:
                    return 'D'
                elif r > d and r > o:
                    return 'R'
                elif o > d and o > r:
                    return 'T'
                else:
                    # Tie - use side relative to national
                    return 'D' if (pv_margin - nat) >= 0 else 'R'
            
            # Helper to check if a stop changes the winner
            def stop_changes_winner(stop):
                # Check winner just before and just after the stop
                before = get_winner_at_pv(stop - 0.0001)
                after = get_winner_at_pv(stop + 0.0001)
                return before != after
            
            # Generate stops for ALL pairwise transitions between D, R, and O
            # We need to find PV margins where any two become equal
            
            # Stop 1: D = R (two-party flip)
            target_margin_dr = 0
            pv_shift_dr = target_margin_dr - base_margin
            stop_dr = nat + pv_shift_dr
            
            if abs(stop_dr) <= PV_CAP and stop_changes_winner(stop_dr):
                stops_set.add(stop_dr)
                stop_to_units[stop_dr].append(abbr)
                sgn = 1.0 if (stop_dr - nat) > 0 else (-1.0 if (stop_dr - nat) < 0 else 1.0)
                eff = stop_to_eff.setdefault(stop_dr, stop_dr + sgn * EPS)
                classify_and_append(stop_dr, eff, r)
            
            # Stop 2: D = O (D reaches third party)
            if o_votes_base > 0:
                # D = two_party * (target_margin + 1) / 2 = o_votes_base
                target_margin_do = 2 * o_votes_base / two_party_votes - 1
                pv_shift_do = target_margin_do - base_margin
                stop_do = nat + pv_shift_do
                
                if abs(stop_do) <= PV_CAP and stop_changes_winner(stop_do):
                    stops_set.add(stop_do)
                    stop_to_units[stop_do].append(abbr)
                    sgn = 1.0 if (stop_do - nat) > 0 else (-1.0 if (stop_do - nat) < 0 else 1.0)
                    eff = stop_to_eff.setdefault(stop_do, stop_do + sgn * EPS)
                    classify_and_append(stop_do, eff, r)
            
            # Stop 3: R = O (R reaches third party)
            if o_votes_base > 0:
                # R = two_party * (1 - (target_margin + 1) / 2) = o_votes_base
                target_margin_ro = 2 * (1 - o_votes_base / two_party_votes) - 1
                pv_shift_ro = target_margin_ro - base_margin
                stop_ro = nat + pv_shift_ro
                
                if abs(stop_ro) <= PV_CAP and stop_changes_winner(stop_ro):
                    stops_set.add(stop_ro)
                    stop_to_units[stop_ro].append(abbr)
                    sgn = 1.0 if (stop_ro - nat) > 0 else (-1.0 if (stop_ro - nat) < 0 else 1.0)
                    eff = stop_to_eff.setdefault(stop_ro, stop_ro + sgn * EPS)
                    classify_and_append(stop_ro, eff, r)

        # Ensure any stop without eff gets a small nudge toward D side
        for s in list(stops_set):
            if s not in stop_to_eff:
                print(f"Debug: {year} stop {s} missing eff, adding small nudge")
                stop_to_eff[s] = s + EPS

        # --- Compute EV totals at each stop so we can mark tie/tipping stops ---
        # Build sorted list of stops for deterministic behavior
        stops_list = sorted(stops_set)

        # compute total EV available for the year (sum of ev for non-NATIONAL rows)
        total_ev = 0
        for rr in lst:
            abbr_rr = rr.get('abbr')
            if not abbr_rr or abbr_rr in ('NATIONAL', 'NAT'):
                continue
            ev_val = int(parse_float(rr.get('electoral_votes') or rr.get('EV') or 0))
            total_ev += ev_val
        if total_ev <= 0:
            total_ev = 538

        # helper to compute winner at pv for a given row (reuse earlier logic)
        def winner_for_row_at_pv(rrow, pv_margin):
            two_party_votes = parse_float(rrow.get('total_votes')) - parse_float(rrow.get('third_party_votes'))
            if two_party_votes <= 0:
                # fallback to margin-based
                # compute base margin and use sign
                d_votes_base = parse_float(rrow.get('D_votes'))
                r_votes_base = parse_float(rrow.get('R_votes'))
                if d_votes_base >= r_votes_base:
                    return 'D'
                return 'R'
            d_votes_base = parse_float(rrow.get('D_votes'))
            r_votes_base = parse_float(rrow.get('R_votes'))
            o_votes_base = parse_float(rrow.get('T_votes'))
            nat_local = parse_float(rrow.get('national_margin'))
            base_d_share = d_votes_base / two_party_votes
            base_margin = 2 * base_d_share - 1
            pv_shift = pv_margin - nat_local
            target_margin = base_margin + pv_shift
            target_d_share = (target_margin + 1) / 2
            d = two_party_votes * target_d_share
            r = two_party_votes * (1 - target_d_share)
            o = o_votes_base
            if d > r and d > o:
                return 'D'
            elif r > d and r > o:
                return 'R'
            elif o > d and o > r:
                return 'T'
            else:
                # Tie: use side of pv relative to national
                return 'D' if (pv_margin - nat_local) >= 0 else 'R'

        # compute EV tallies at each stop
        stop_ev_totals = {}
        for s in stops_list:
            eff = stop_to_eff.get(s, s)
            d_ev = 0
            r_ev = 0
            o_ev = 0
            for rr in lst:
                abbr_rr = rr.get('abbr')
                if not abbr_rr or abbr_rr in ('NATIONAL', 'NAT'):
                    continue
                ev_val = int(parse_float(rr.get('electoral_votes') or rr.get('EV') or 0))
                w = winner_for_row_at_pv(rr, eff)
                if abbr_rr == 'AL' and year == 1960:
                    d_ev += 5 # special case: AL 1960 had 5 pledged EVs for Kennedy
                    o_ev += 6 # special case: AL 1960 had 6 unpledged EVs for Byrd
                    continue
                if w == 'D':
                    d_ev += ev_val
                elif w == 'R':
                    r_ev += ev_val
                else:
                    o_ev += ev_val
            stop_ev_totals[s] = (d_ev, r_ev, o_ev)

        # decide tipping point and tie stops using Actual-start algorithm
        # find actual index (stop nearest to national margin 'nat')
        actual_idx = None
        for ii, s in enumerate(stops_list):
            if abs(s - nat) <= EPS:
                actual_idx = ii
                break
        if actual_idx is None:
            # nearest to national margin
            best = 0
            best_abs = abs(stops_list[0] - nat)
            for ii in range(1, len(stops_list)):
                a = abs(stops_list[ii] - nat)
                if a < best_abs:
                    best_abs = a
                    best = ii
            actual_idx = best

        EPS_EV = 0.5
        tipping_index = None
        tie_index = None
        EVs_to_win = total_ev // 2 + 1
        # compute actual outcome
        s_actual = stops_list[actual_idx]
        d_actual, r_actual, _ = stop_ev_totals.get(s_actual, (0, 0, 0))
        if abs(d_actual - r_actual) <= EPS_EV:
            # actual is tie: search symmetrically outward for first tie or flip
            maxdist = max(actual_idx, len(stops_list) - 1 - actual_idx)
            for dist in range(1, maxdist + 1):
                cand_idxs = []
                left = actual_idx - dist
                right = actual_idx + dist
                if left >= 0: cand_idxs.append(left)
                if right < len(stops_list): cand_idxs.append(right)
                found = False
                for ci in cand_idxs:
                    ss = stops_list[ci]
                    d_ev, r_ev, _ = stop_ev_totals.get(ss, (0, 0, 0))
                    if abs(d_ev - r_ev) <= EPS_EV or (d_ev > r_ev + EPS_EV) or (r_ev > d_ev + EPS_EV):
                        tipping_index = ci
                        found = True
                        break
                if found:
                    break
        else:
            # actual has a winner; search against that winner until flip
            winner_actual = 'D' if d_actual > r_actual else 'R'
            runner_up = 'R' if winner_actual == 'D' else 'D'
            dir = -1 if winner_actual == 'D' else 1
            ii = actual_idx + dir
            while 0 <= ii < len(stops_list):
                ss = stops_list[ii]
                d_ev, r_ev, _ = stop_ev_totals.get(ss, (0, 0, 0))
                # check for tie or flip
                if d_ev < EVs_to_win and r_ev < EVs_to_win:
                    if tie_index is None and 0 <= ii < len(stops_list):
                        print(f"Debug: {year} tie stop at index {ii} is {stops_list[ii]}")
                        tie_index = ii
                runner_up_ev = r_ev if runner_up == 'R' else d_ev
                winner_ev = d_ev if winner_actual == 'D' else r_ev
                if winner_ev > EVs_to_win:
                    cur_winner = winner_actual
                elif runner_up_ev > EVs_to_win:
                    cur_winner = runner_up
                else:
                    cur_winner = None
                cur_winner = runner_up if runner_up_ev >= EVs_to_win else winner_actual
                if cur_winner == runner_up:
                    tipping_index = ii
                    break
                ii += dir

        # Build flag maps for quick lookup
        tie_stops = set()
        tipping_stops = set()
        #no_majority_stops = set()
        evs_by_stop = defaultdict(lambda: defaultdict(lambda: (0, 0, 0)))
        first_tie_stop = None
        for s, (d_ev, r_ev, o_ev) in stop_ev_totals.items():
            evs_by_stop[year][abbr] = (d_ev, r_ev, o_ev)
            # if abs(d_ev - r_ev) <= EPS_EV:
            #     if tie_index is not None and 0 <= tie_index < len(stops_list):
            #         print(f"Debug: {year} tie stop at index {tie_index} is {stops_list[tie_index]}")
            #     tie_stops.add(s)
            if d_ev < EVs_to_win and r_ev < EVs_to_win:
                #no_majority_stops.add(s)
                if tie_index is not None and 0 <= tie_index < len(stops_list):
                    first_tie_stop = stops_list[tie_index]
                tie_stops.add(s)
        if tipping_index is not None and 0 <= tipping_index < len(stops_list):
            tipping_stops.add(stops_list[tipping_index])

        # annotate previously appended rows for this year
        for row in out:
            if int(row.get('year') or 0) != year:
                continue
            # stop stored in row['stop'] as high-precision string
            sval = float(row.get('stop') or 0.0)
            row['IS_TIE_STOP'] = 'true' if any(abs(sval - ts) <= 10**(-STOP_KEY_PREC) for ts in tie_stops) else 'false'
            row['IS_TIPPING_POINT'] = 'true' if any(abs(sval - ts) <= 10**(-STOP_KEY_PREC) for ts in tipping_stops) else 'false'
            row['IS_FIRST_TIE_STOP'] = 'true' if (first_tie_stop and abs(sval - first_tie_stop) <= 10**(-STOP_KEY_PREC)) else 'false'
            #row['ELECTORAL_VOTE_TOTALS'] = str(evs_by_stop[year].get(row.get('unit')))
            # row['IS_NO_MAJORITY_STOP'] = 'true' if any(abs(sval - ts) <= 10**(-STOP_KEY_PREC) for ts in no_majority_stops) else 'false'

    # No additional winner pass needed; rows appended inline above
    # sort by year, stop
    out.sort(key=lambda r: (int(r.get('year') or 0), float(r.get('stop') or 0.0)))
    return out


def main():
    root = os.path.dirname(__file__)
    # Prefer root CSV, fall back to docs CSV
    rows = load_margins([
        os.path.join(root, 'presidential_margins.csv'),
        os.path.join(root, 'docs', 'presidential_margins.csv'),
    ])
    out_rows = build_stop_rows(rows)

    # Ensure docs exists
    docs_dir = os.path.join(root, 'docs')
    os.makedirs(docs_dir, exist_ok=True)
    outfile = os.path.join(docs_dir, 'stop_colors.csv')
    with open(outfile, 'w', newline='', encoding='utf-8') as f:
        fieldnames = ['year', 'stop', 'stop_key', 'effective_pv', 'unit', 'winner', 'result_color_name', 'color_css', 'IS_TIE_STOP', 'IS_TIPPING_POINT', 'IS_FIRST_TIE_STOP']#, 'IS_NO_MAJORITY_STOP']
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in out_rows:
            w.writerow(r)
    print(f"Wrote {len(out_rows)} rows to {outfile}")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        traceback.print_exc()
        print(f"Error occurred: {e}")

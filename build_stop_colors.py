import csv
import os
from collections import defaultdict
import traceback
from typing import Dict, List, Tuple

import numpy as np

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

    # No additional winner pass needed; rows appended inline above
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
        w = csv.DictWriter(f, fieldnames=['year', 'stop', 'stop_key', 'effective_pv', 'unit', 'winner', 'result_color_name', 'color_css'])
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

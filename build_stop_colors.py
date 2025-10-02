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
            if total_votes <= 0:
                return
            
            # Get base vote counts
            d_votes_base = parse_float(r.get('D_votes'))
            r_votes_base = parse_float(r.get('R_votes'))
            o_votes_base = parse_float(r.get('T_votes'))  # Top third party votes (stays constant)
            
            # Calculate two-party votes and apply PV adjustment
            two_party_votes = d_votes_base + r_votes_base
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

            color_name = 'BLUE' if winner == 'D' else ('RED' if winner == 'R' else 'YELLOW')
            color_css = params.COLORS.get(winner, 'transparent')
            if color_css == 'deepskyblue':
                color_css = 'blue' # darker blue for visibility
            
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
            if total_votes == 0:
                # skip zero-vote states
                continue
            
            # Get base vote counts
            d_votes_base = parse_float(r.get('D_votes'))
            r_votes_base = parse_float(r.get('R_votes'))
            o_votes_base = parse_float(r.get('T_votes'))  # Top third party votes (stays constant)
            
            two_party_votes = d_votes_base + r_votes_base
            if two_party_votes <= 0:
                continue
            
            nat = parse_float(r.get('national_margin'))
            
            # Calculate base two-party margin
            base_d_share = d_votes_base / two_party_votes
            base_margin = 2 * base_d_share - 1
            
            # Sort parties by vote count to determine current winner and runner-up
            parties = [
                ('D', d_votes_base),
                ('R', r_votes_base),
                ('O', o_votes_base)
            ]
            parties.sort(key=lambda x: x[1], reverse=True)
            
            current_leader = parties[0][0]
            current_leader_votes = parties[0][1]
            second_place = parties[1][0]
            second_place_votes = parties[1][1]
            third_place = parties[2][0]
            third_place_votes = parties[2][1]
            
            # Calculate stops for different transitions:
            # 1. When current leader loses to second place (two-party flip or leader to third party)
            # 2. When second place overtakes third place
            
            # Transition 1: Calculate PV where current leader ties with second place
            if current_leader != second_place:
                if second_place == 'O':
                    # Leader (D or R) loses to third party O
                    # We need adjusted_leader_votes = o_votes_base
                    if current_leader == 'D':
                        # D is leader, we want D to drop to O
                        # D = two_party * (target_margin + 1) / 2 = o_votes_base
                        # target_margin = 2 * o_votes_base / two_party - 1
                        target_margin = 2 * o_votes_base / two_party_votes - 1
                    else:
                        # R is leader, we want R to drop to O
                        # R = two_party * (1 - (target_margin + 1) / 2) = o_votes_base
                        # 1 - (target_margin + 1) / 2 = o_votes_base / two_party
                        # (target_margin + 1) / 2 = 1 - o_votes_base / two_party
                        # target_margin = 2 * (1 - o_votes_base / two_party) - 1
                        target_margin = 2 * (1 - o_votes_base / two_party_votes) - 1
                    
                    pv_shift = target_margin - base_margin
                    stop = nat + pv_shift
                    
                    if abs(stop) <= PV_CAP:
                        stops_set.add(stop)
                        stop_to_units[stop].append(abbr)
                        sgn = 1.0 if (stop - nat) > 0 else (-1.0 if (stop - nat) < 0 else 1.0)
                        eff = stop_to_eff.setdefault(stop, stop + sgn * EPS)
                        classify_and_append(stop, eff, r)
                        
                elif current_leader in ('D', 'R') and second_place in ('D', 'R'):
                    # Two-party flip: D and R swap
                    # At the flip point: D_votes = R_votes
                    # two_party * (target_margin + 1) / 2 = two_party * (1 - (target_margin + 1) / 2)
                    # This means target_margin = 0
                    target_margin = 0
                    pv_shift = target_margin - base_margin
                    stop = nat + pv_shift
                    
                    if abs(stop) <= PV_CAP:
                        stops_set.add(stop)
                        stop_to_units[stop].append(abbr)
                        sgn = 1.0 if (stop - nat) > 0 else (-1.0 if (stop - nat) < 0 else 1.0)
                        eff = stop_to_eff.setdefault(stop, stop + sgn * EPS)
                        classify_and_append(stop, eff, r)
            
            # Transition 2: Check if third place can catch up to second place
            if third_place == 'O' and o_votes_base > 0 and second_place in ('D', 'R'):
                # Second place (D or R) could drop to meet O
                # At the flip: adjusted_second_place = o_votes_base
                target_margin = 2 * o_votes_base / two_party_votes - 1
                
                # But we need to check which direction: is second place D or R?
                if second_place == 'D':
                    # D is second place, so current leader is R
                    # As we shift toward D (increase margin), D goes up
                    # We want D = o_votes_base
                    # This is the same formula
                    pass
                else:
                    # R is second place, so current leader is D
                    # As we shift toward R (decrease margin), R goes up
                    # We want R = o_votes_base
                    # R = two_party * (1 - (target_margin + 1) / 2) = o_votes_base
                    # 1 - (target_margin + 1) / 2 = o_votes_base / two_party
                    # (target_margin + 1) / 2 = 1 - o_votes_base / two_party
                    # target_margin = 2 * (1 - o_votes_base / two_party) - 1
                    target_margin = 2 * (1 - o_votes_base / two_party_votes) - 1
                
                pv_shift = target_margin - base_margin
                stop = nat + pv_shift
                
                # Only add this stop if it's different from the leader-second transition
                # and if second place can realistically reach third place
                if abs(stop) <= PV_CAP and abs(second_place_votes - o_votes_base) < current_leader_votes:
                    stops_set.add(stop)
                    stop_to_units[stop].append(abbr)
                    sgn = 1.0 if (stop - nat) > 0 else (-1.0 if (stop - nat) < 0 else 1.0)
                    eff = stop_to_eff.setdefault(stop, stop + sgn * EPS)
                    classify_and_append(stop, eff, r)

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

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
            rm = parse_float(r.get('relative_margin'))
            nat = parse_float(r.get('national_margin'))
            
            # Get raw vote counts
            d_votes = parse_float(r.get('D_votes', 0))
            r_votes = parse_float(r.get('R_votes', 0))
            t_votes = parse_float(r.get('T_votes', 0))
            total_votes = parse_float(r.get('total_votes', 0))
            
            if total_votes <= 0:
                total_votes = d_votes + r_votes + t_votes
            
            if total_votes <= 0:
                # No votes, fallback to margin-based logic
                m = rm + eff
                if m > 0:
                    winner = 'D'
                elif m < 0:
                    winner = 'R'
                else:
                    side = 1 if (s - nat) >= 0 else -1
                    winner = 'D' if side >= 0 else 'R'
            else:
                # Calculate adjusted vote shares using actual votes
                # The PV shift (eff - nat) represents a national shift that affects D and R equally
                # Third party votes stay constant
                tp_share = t_votes / total_votes
                two_party_total = d_votes + r_votes
                
                if two_party_total > 0:
                    # Current two-party margin
                    current_two_party_margin = (d_votes - r_votes) / two_party_total
                    # Adjust by PV shift (eff - nat gives the shift from original national margin)
                    adjusted_two_party_margin = current_two_party_margin + (eff - nat)
                    # Clamp to valid range
                    adjusted_two_party_margin = max(-1, min(1, adjusted_two_party_margin))
                    
                    # Convert back to shares
                    d_two_party_share = (adjusted_two_party_margin + 1) / 2
                    r_two_party_share = 1 - d_two_party_share
                    
                    # Apply to total votes
                    d_adjusted = total_votes * (1 - tp_share) * d_two_party_share
                    r_adjusted = total_votes * (1 - tp_share) * r_two_party_share
                    t_adjusted = t_votes  # Third party votes unchanged
                else:
                    # No two-party votes, only third party
                    d_adjusted = 0
                    r_adjusted = 0
                    t_adjusted = t_votes
                
                # Determine winner by who has most votes
                if d_adjusted > r_adjusted and d_adjusted > t_adjusted:
                    winner = 'D'
                elif r_adjusted > d_adjusted and r_adjusted > t_adjusted:
                    winner = 'R'
                elif t_adjusted > d_adjusted and t_adjusted > r_adjusted:
                    winner = 'T'
                else:
                    # Tie or near-tie, use margin as tiebreaker
                    m = rm + eff
                    if m > 0:
                        winner = 'D'
                    elif m < 0:
                        winner = 'R'
                    else:
                        winner = 'T' if t_adjusted > 0 else 'D'

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
            rm = parse_float(r.get('relative_margin'))
            if parse_float(r.get('total_votes')) == 0:
                # skip zero-vote states
                continue
            t = parse_float(r.get('T_votes')) / parse_float(r.get('total_votes')) if r.get('total_votes') else 0.0
            d = parse_float(r.get('D_votes')) / parse_float(r.get('total_votes')) if r.get('total_votes') else 0.0
            r_ = parse_float(r.get('R_votes')) / parse_float(r.get('total_votes')) if r.get('total_votes') else 0.0
            a = 3 * t - 1
            nat = parse_float(r.get('national_margin'))
            if abbr == 'AL' and year == 1948:
                a = 0.0
            if a > 0:# and not (year == 1948 and abbr == 'AL'):
                #nD = -rm + a
                nD = nat + 2 * (t - d)
                #nR = -rm - a
                nR = nat + 2 * (r_ - t)
                if abs(nD) <= PV_CAP:
                    stops_set.add(nD)
                    stop_to_units[nD].append(abbr)
                    # nudge inside the yellow window
                    sgn = 1.0 if (nD - nat) > 0 else (-1.0 if (nD - nat) < 0 else 1.0)
                    eff = stop_to_eff.setdefault(nD, nD + sgn * EPS)
                    classify_and_append(nD, eff, r)
                if abs(nR) <= PV_CAP:
                    stops_set.add(nR)
                    stop_to_units[nR].append(abbr)
                    sgn = 1.0 if (nR - nat) > 0 else (-1.0 if (nR - nat) < 0 else 1.0)
                    eff = stop_to_eff.setdefault(nR, nR + sgn * EPS)
                    classify_and_append(nR, eff, r)
            else:
                val = -rm
                if abs(val) <= PV_CAP:
                    stops_set.add(val)
                    stop_to_units[val].append(abbr)
                    sgn = 1.0 if (val - nat) > 0 else (-1.0 if (val - nat) < 0 else 1.0)
                    eff = stop_to_eff.setdefault(val, val + sgn * EPS)
                    classify_and_append(val, eff, r)

        # Ensure any stop without eff gets a small nudge toward D side
        for s in list(stops_set):
            if s not in stop_to_eff:
                print(f"Debug: {year} stop {s} missing eff, adding small nudge")
                stop_to_eff[s] = s + EPS
        
        # Ensure every unit is classified at EVEN (0.0) and national margin
        for r in lst:
            abbr = r.get('abbr')
            if not abbr or abbr in ('NATIONAL', 'NAT'):
                continue
            if parse_float(r.get('total_votes')) == 0:
                continue
            
            # Classify at EVEN (0.0)
            if 0.0 not in [s for s, u in [(s, u) for s in stops_set for u in stop_to_units.get(s, []) if u == abbr]]:
                classify_and_append(0.0, 0.0 + EPS, r)
            
            # Classify at national margin
            if nat is not None and abs(nat) <= PV_CAP:
                nat_found = False
                for s in stops_set:
                    if abs(s - nat) < 1e-9 and abbr in stop_to_units.get(s, []):
                        nat_found = True
                        break
                if not nat_found:
                    classify_and_append(nat, nat, r)

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

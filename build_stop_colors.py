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
    # Group by year and build stops based on where winner changes when adjusting votes by PV
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

        # For each unit, find PV values where winner changes
        all_stops = set([0.0])  # Always include EVEN
        if abs(nat) <= PV_CAP:
            all_stops.add(nat)  # Always include actual national margin
        
        unit_stop_info = {}  # unit -> list of (stop, eff, winner)
        
        for r in lst:
            abbr = r.get('abbr')
            if not abbr or abbr in ('NATIONAL', 'NAT'):
                continue
            
            # Get raw vote counts
            d_votes = parse_float(r.get('D_votes', 0))
            r_votes = parse_float(r.get('R_votes', 0))
            t_votes = parse_float(r.get('T_votes', 0))
            total_votes = parse_float(r.get('total_votes', 0))
            
            if total_votes <= 0:
                total_votes = d_votes + r_votes + t_votes
            
            if total_votes <= 0:
                continue
            
            # Calculate initial percentages
            d_pct = d_votes / total_votes
            r_pct = r_votes / total_votes
            t_pct = t_votes / total_votes
            
            # Function to get winner at a given PV shift
            def get_winner_at_pv(pv):
                # Adjust D and R percentages by PV
                d_pct_adj = d_pct + pv / 2
                r_pct_adj = r_pct - pv / 2
                # T stays constant
                t_pct_adj = t_pct
                
                # Convert to vote counts
                d_votes_adj = d_pct_adj * total_votes
                r_votes_adj = r_pct_adj * total_votes
                t_votes_adj = t_pct_adj * total_votes
                
                # Find winner
                if d_votes_adj > r_votes_adj and d_votes_adj > t_votes_adj:
                    return 'D'
                elif r_votes_adj > d_votes_adj and r_votes_adj > t_votes_adj:
                    return 'R'
                elif t_votes_adj > d_votes_adj and t_votes_adj > r_votes_adj:
                    return 'T'
                else:
                    # Tie - use margin as tiebreaker
                    margin = d_pct_adj - r_pct_adj
                    return 'D' if margin >= 0 else 'R'
            
            # Find critical PV values where winner changes
            unit_stops = []
            
            # Check at EVEN (0.0)
            winner_at_0 = get_winner_at_pv(0.0)
            unit_stops.append((0.0, 0.0 + EPS, winner_at_0))
            all_stops.add(0.0)
            
            # Check at national margin
            if abs(nat) <= PV_CAP:
                winner_at_nat = get_winner_at_pv(nat)
                unit_stops.append((nat, nat, winner_at_nat))
                all_stops.add(nat)
            
            # Find PV where D and R tie (D_votes_adj = R_votes_adj)
            # d_pct + pv/2 = r_pct - pv/2
            # pv = r_pct - d_pct
            pv_dr_tie = (r_pct - d_pct) * total_votes / total_votes  # simplifies to r_pct - d_pct
            pv_dr_tie = r_pct - d_pct
            if abs(pv_dr_tie) <= PV_CAP:
                winner_before = get_winner_at_pv(pv_dr_tie - 0.001)
                winner_after = get_winner_at_pv(pv_dr_tie + 0.001)
                if winner_before != winner_after:
                    unit_stops.append((pv_dr_tie, pv_dr_tie + EPS * (1 if pv_dr_tie >= 0 else -1), winner_after))
                    all_stops.add(pv_dr_tie)
            
            # Find PV where D and T tie (D_votes_adj = T_votes)
            # (d_pct + pv/2) * total = t_pct * total
            # d_pct + pv/2 = t_pct
            # pv = 2 * (t_pct - d_pct)
            pv_dt_tie = 2 * (t_pct - d_pct)
            if abs(pv_dt_tie) <= PV_CAP:
                winner_before = get_winner_at_pv(pv_dt_tie - 0.001)
                winner_after = get_winner_at_pv(pv_dt_tie + 0.001)
                if winner_before != winner_after:
                    unit_stops.append((pv_dt_tie, pv_dt_tie + EPS * (1 if pv_dt_tie >= 0 else -1), winner_after))
                    all_stops.add(pv_dt_tie)
            
            # Find PV where R and T tie (R_votes_adj = T_votes)
            # (r_pct - pv/2) * total = t_pct * total
            # r_pct - pv/2 = t_pct
            # pv = 2 * (r_pct - t_pct)
            pv_rt_tie = 2 * (r_pct - t_pct)
            if abs(pv_rt_tie) <= PV_CAP:
                winner_before = get_winner_at_pv(pv_rt_tie - 0.001)
                winner_after = get_winner_at_pv(pv_rt_tie + 0.001)
                if winner_before != winner_after:
                    unit_stops.append((pv_rt_tie, pv_rt_tie + EPS * (1 if pv_rt_tie >= 0 else -1), winner_after))
                    all_stops.add(pv_rt_tie)
            
            unit_stop_info[abbr] = unit_stops
        
        # Now generate output rows for each unit at each stop
        for r in lst:
            abbr = r.get('abbr')
            if not abbr or abbr in ('NATIONAL', 'NAT'):
                continue
            
            d_votes = parse_float(r.get('D_votes', 0))
            r_votes = parse_float(r.get('R_votes', 0))
            t_votes = parse_float(r.get('T_votes', 0))
            total_votes = parse_float(r.get('total_votes', 0))
            
            if total_votes <= 0:
                total_votes = d_votes + r_votes + t_votes
            
            if total_votes <= 0:
                continue
            
            d_pct = d_votes / total_votes
            r_pct = r_votes / total_votes
            t_pct = t_votes / total_votes
            
            # Generate entry for each stop this unit should have
            for stop, eff, winner in unit_stop_info.get(abbr, []):
                color_name = 'BLUE' if winner == 'D' else ('RED' if winner == 'R' else 'YELLOW')
                color_css = params.COLORS.get(winner, 'transparent')
                if color_css == 'deepskyblue':
                    color_css = 'blue'
                
                out.append({
                    'year': year,
                    'stop': f"{stop:.12f}",
                    'stop_key': f"{stop:.{STOP_KEY_PREC}f}",
                    'effective_pv': f"{eff:.12f}",
                    'unit': abbr,
                    'winner': winner,
                    'result_color_name': color_name,
                    'color_css': color_css,
                })

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

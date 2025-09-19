import csv
import os
from collections import defaultdict
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
        stop_to_eff[0.0] = 0.0 + EPS
        stop_to_eff[nat] = nat

        # helper to classify and append an output row for a single unit/stop
        def classify_and_append(s: float, eff: float, r: Dict):
            abbr = r.get('abbr')
            rm = parse_float(r.get('relative_margin'))
            tp = parse_float(r.get('third_party_share'))
            nat = parse_float(r.get('national_margin'))
            original_margins = {
                'D': parse_float(r['D_votes']) / parse_float(r.get('total_votes')) if r.get('total_votes') else 0,
                'R': parse_float(r['R_votes']) / parse_float(r.get('total_votes')) if r.get('total_votes') else 0,
                'T': parse_float(r['T_votes']) / parse_float(r.get('total_votes')) if r.get('total_votes') else 0,
            }
            original_winner = max(original_margins, key=lambda k: original_margins.get(k, 0))
            a_local = 3 * tp - 1
            winner = None
            # Use a tighter interior epsilon than the nudge so boundary nudges remain inside the window
            INNER = EPS
            if a_local > 0 and False:
                nD_local = -rm + a_local
                nR_local = -rm - a_local
                nD_approximated_margins = {'D': original_margins['D'] + nD_local / 2, 'R': original_margins['R'] - nD_local / 2, 'T': original_margins['T']}
                nR_approximated_margins = {'D': original_margins['D'] + nR_local / 2, 'R': original_margins['R'] - nR_local / 2, 'T': original_margins['T']}
                if eff > (nR_local + INNER) and eff < (nD_local - INNER):
                    winner = 'T'
            else:
                approximated_margins = {'D': original_margins['D'] + (eff - nat) / 2, 'R': original_margins['R'] - (eff - nat) / 2, 'T': original_margins['T']}
                new_winner = max(approximated_margins.items(), key=lambda item: item[1])[0]
                if abbr == 'AL' and year == 1948:
                    pass
                if new_winner == original_winner:
                    print(f"Debug: {year} {abbr} winner unchanged at stop {s} eff {eff}: {original_winner}")
                    pass
                if a_local > 0:
                    pass
                winner = max(approximated_margins, key=lambda k: approximated_margins[k])
            if winner is None:
                m = rm + eff
                if m > 0:
                    winner = 'D'
                elif m < 0:
                    winner = 'R'
                else:
                    side = 1 if (s - nat) >= 0 else -1
                    winner = 'D' if side >= 0 else 'R'

            color_name = 'BLUE' if winner == 'D' else ('RED' if winner == 'R' else 'YELLOW')
            color_css = params.COLORS.get(winner, 'transparent')
            if color_css == 'deepskyblue':
                color_css = 'blue' # darker blue for visibility
            if color_name == 'YELLOW':
                pass
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
            t = parse_float(r.get('third_party_share'))
            a = 3 * t - 1
            if abbr == 'AL' and year == 1948:
                a = 0.0
            if a > 0:# and not (year == 1948 and abbr == 'AL'):
                nD = -rm + a
                nR = -rm - a
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
    main()

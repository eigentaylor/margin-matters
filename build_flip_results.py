"""
Compute minimal popular votes needed to flip the Electoral College outcome per year
and, if fewer votes suffice to break the majority (so no candidate reaches 270),
record that as well. Outputs easy-to-load CSVs under docs/.

Input: docs/presidential_margins.csv (contains per-unit D/R/T votes, total_votes, electoral_votes)

Outputs:
- docs/flip_results.csv: one row per year with classic/no_majority totals and counts
- docs/flip_details.csv: per-year per-unit chosen flips for each mode

Notes:
- We treat units as states plus ME/NE districts (use abbr as-is, including ME-01, etc.).
- For a unit won by party P in the original results, votes_to_flip = floor((winner_votes - runner_up_votes)/2) + 1.
- We solve a 0/1 knapsack minimizing votes flipped to reach target EVs.
"""

from __future__ import annotations

import csv
import math
import os
from collections import defaultdict

DOCS_CSV = os.path.join('docs', 'presidential_margins.csv')
OUT_SUMMARY = os.path.join('docs', 'flip_results.csv')
OUT_DETAILS = os.path.join('docs', 'flip_details.csv')


def load_rows(path: str):
    rows = []
    with open(path, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            # normalize numeric fields
            def num(k, default=0):
                v = r.get(k)
                if v is None or v == '':
                    return default
                try:
                    return float(v)
                except Exception:
                    return default
            row = {
                'year': int(float(r['year'])),
                'abbr': r['abbr'],
                'D_votes': int(num('D_votes', 0)),
                'R_votes': int(num('R_votes', 0)),
                'T_votes': int(num('T_votes', 0)),
                'total_votes': int(num('total_votes', 0)),
                'electoral_votes': int(num('electoral_votes', 0)),
            }
            # derive winner by votes among D/R/T; ties break toward current winner label if present
            d, r_, t = row['D_votes'], row['R_votes'], row['T_votes']
            if d >= r_ and d >= t:
                row['party_win'] = 'D'
                row['winner_votes'] = d
                row['runner_up_votes'] = max(r_, t)
            elif r_ >= d and r_ >= t:
                row['party_win'] = 'R'
                row['winner_votes'] = r_
                row['runner_up_votes'] = max(d, t)
            else:
                row['party_win'] = 'T'
                row['winner_votes'] = t
                row['runner_up_votes'] = max(d, r_)
            rows.append(row)
    return rows


def group_by_year(rows):
    by = defaultdict(list)
    for r in rows:
        by[r['year']].append(r)
    return dict(by)


def compute_knapsack(units, target_ev):
    """
    units: list of dicts with keys {abbr, ev, votes_to_flip, total_votes}
    target_ev: minimal electoral votes to accumulate from flipped units

    Returns (chosen_units, min_votes, achieved_ev)
    """
    if target_ev <= 0:
        return [], 0, 0
    max_ev = sum(u['ev'] for u in units)
    if target_ev > max_ev:
        return [], math.inf, 0

    # DP over EV count minimizing votes flipped
    INF = 10**18
    dp = [INF] * (max_ev + 1)
    dp[0] = 0
    choice = [None] * (max_ev + 1)

    # sort by efficiency (votes_to_flip per EV) to aid reconstruction deterministically
    units_sorted = sorted(units, key=lambda u: (u['votes_to_flip'] / max(1, u['ev']), u['abbr']))
    for idx, u in enumerate(units_sorted):
        ev = u['ev']
        vt = u['votes_to_flip']
        for v in range(max_ev, ev - 1, -1):
            cand = dp[v - ev] + vt
            if cand < dp[v]:
                dp[v] = cand
                choice[v] = idx

    # find best v >= target_ev
    best_v, best_cost = 0, INF
    for v in range(target_ev, max_ev + 1):
        if dp[v] < best_cost:
            best_cost = dp[v]
            best_v = v

    if best_cost >= INF:
        return [], math.inf, 0

    # reconstruct
    chosen = []
    cur = best_v
    while cur > 0 and choice[cur] is not None:
        idx = choice[cur]
        u = units_sorted[idx]
        chosen.append(u)
        cur -= u['ev']

    return chosen, best_cost, best_v


def analyze_year(rows_for_year):
    # Determine aggregate party EVs using winner labels per unit
    ev_by_party = defaultdict(int)
    total_ev = 0
    for r in rows_for_year:
        ev = int(r['electoral_votes'] or 0)
        total_ev += ev
        ev_by_party[r['party_win']] += ev
    need = total_ev // 2 + 1

    # Determine top two parties by EVs (treat non-D/R as 'T')
    winner_party = max(ev_by_party.items(), key=lambda kv: kv[1])[0]
    winner_ev = ev_by_party[winner_party]
    # pick runner-up as the better of the other two party sums
    others = {p: v for p, v in ev_by_party.items() if p != winner_party}
    if others:
        runner_party = max(others.items(), key=lambda kv: kv[1])[0]
        runner_ev = others[runner_party]
    else:
        runner_party, runner_ev = ('D' if winner_party != 'D' else 'R'), 0

    # Build candidate flipping set: units not currently won by runner_party
    units = []
    for r in rows_for_year:
        if r['party_win'] == runner_party:
            continue
        ev = int(r['electoral_votes'] or 0)
        if ev <= 0:
            continue
        # minimal popular votes to change unit winner to runner_party
        margin = int(r['winner_votes'] - r['runner_up_votes'])
        votes_to_flip = margin // 2 + 1
        units.append({
            'year': r['year'],
            'abbr': r['abbr'],
            'ev': ev,
            'votes_to_flip': votes_to_flip,
            'total_votes': int(r['total_votes'] or 0),
            'from_party': r['party_win'],
        })

    # Mode classic: make runner reach need
    target_ev_classic = max(0, need - runner_ev)
    chosen_c, cost_c, ev_c = compute_knapsack(units, target_ev_classic)

    # Mode no_majority: reduce winner below need by flipping from the winner regardless of runner gains
    # Equivalent to flipping at least winner_ev - (need - 1) EV away from winner
    target_away = max(0, winner_ev - (need - 1))
    # restrict to units currently held by winner_party (those flips reduce winner's EV)
    units_from_winner = [u for u in units if u['from_party'] == winner_party]
    chosen_n, cost_n, ev_n = compute_knapsack(units_from_winner, target_away)

    return {
        'winner_party': winner_party,
        'winner_ev': winner_ev,
        'runner_party': runner_party,
        'runner_ev': runner_ev,
        'need': need,
        'classic': {'cost': int(cost_c if math.isfinite(cost_c) else -1), 'ev': ev_c, 'units': chosen_c},
        'no_majority': {'cost': int(cost_n if math.isfinite(cost_n) else -1), 'ev': ev_n, 'units': chosen_n},
        'total_ev': total_ev,
    }


def main():
    rows = load_rows(DOCS_CSV)
    by = group_by_year(rows)

    # Build outputs
    summary_rows = []
    detail_rows = []

    for year in sorted(by.keys()):
        year_rows = by[year]
        res = analyze_year(year_rows)

        summary_rows.append({
            'year': year,
            'winner_party': res['winner_party'],
            'winner_ev': res['winner_ev'],
            'runner_party': res['runner_party'],
            'runner_ev': res['runner_ev'],
            'need': res['need'],
            'classic_min_votes': res['classic']['cost'],
            'classic_ev': res['classic']['ev'],
            'classic_states': len(res['classic']['units']),
            'no_majority_min_votes': res['no_majority']['cost'],
            'no_majority_ev': res['no_majority']['ev'],
            'no_majority_states': len(res['no_majority']['units']),
            'total_ev': res['total_ev'],
        })

        # per-unit details for each mode
        for mode in ('classic', 'no_majority'):
            for u in res[mode]['units']:
                detail_rows.append({
                    'year': year,
                    'mode': mode,
                    'abbr': u['abbr'],
                    'ev': u['ev'],
                    'votes_to_flip': u['votes_to_flip'],
                    'pct_of_state_votes': round(100.0 * (u['votes_to_flip'] / u['total_votes']) if u['total_votes'] else 0.0, 3),
                })

    # write CSVs
    os.makedirs('docs', exist_ok=True)
    with open(OUT_SUMMARY, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=[
            'year','winner_party','winner_ev','runner_party','runner_ev','need',
            'classic_min_votes','classic_ev','classic_states',
            'no_majority_min_votes','no_majority_ev','no_majority_states','total_ev'
        ])
        w.writeheader()
        w.writerows(summary_rows)

    with open(OUT_DETAILS, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['year','mode','abbr','ev','votes_to_flip','pct_of_state_votes'])
        w.writeheader()
        w.writerows(detail_rows)

    print(f"Wrote {OUT_SUMMARY} ({len(summary_rows)} years) and {OUT_DETAILS} ({len(detail_rows)} rows)")


if __name__ == '__main__':
    main()

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
- When we need to award a unit to a specific party (e.g., the national EV runner-up), we move enough votes to give that party a popular-vote plurality: floor((winner_votes - target_votes)/2) + 1.
- We solve a 0/1 knapsack minimizing votes flipped (or total margin) to reach target EVs.
"""

from __future__ import annotations

import csv
import math
import os
from collections import defaultdict

import numpy as np

DOCS_CSV = os.path.join('presidential_margins.csv')
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


def compute_knapsack(units, target_ev, cost_func=None):
    """
    units: list of dicts with keys {abbr, ev, votes_needed, total_votes}
    target_ev: minimal electoral votes to accumulate from flipped units

    Returns (chosen_units, min_votes, achieved_ev)
    """
    if target_ev <= 0:
        return [], 0, 0
    
    n = len(units)
    if n == 0 or target_ev > sum(u['ev'] for u in units):
        return [], math.inf, 0

    # Default cost by votes; allow alternate cost via cost_func (e.g., margin percentage)
    if cost_func is None:
        cost_func = lambda u: int(u['votes_needed'])

    # Precompute costs for deterministic ordering and DP
    unit_costs = {id(u): int(cost_func(u)) for u in units}

    # Sort by efficiency for deterministic results (use cost per EV as tie-breaker)
    units_sorted = sorted(
        units,
        key=lambda u: ((unit_costs[id(u)] / max(1, u['ev'])), u['abbr'])
    )
    
    # Use 2D DP: dp[i][v] = min votes to get exactly v EVs using first i items
    INF = 10**18
    max_ev = sum(u['ev'] for u in units_sorted)
    
    # Initialize DP table
    dp = [[INF] * (max_ev + 1) for _ in range(n + 1)]
    dp[0][0] = 0
    
    # Fill DP table
    for i in range(1, n + 1):
        u = units_sorted[i - 1]
        ev = u['ev']
        votes = unit_costs[id(u)]
        
        for v in range(max_ev + 1):
            # Don't take item i
            dp[i][v] = dp[i - 1][v]
            
            # Take item i (if possible)
            if v >= ev and dp[i - 1][v - ev] != INF:
                dp[i][v] = min(dp[i][v], dp[i - 1][v - ev] + votes)
    
    # Find best solution with at least target_ev EVs
    best_v, best_cost = 0, INF
    for v in range(target_ev, max_ev + 1):
        if dp[n][v] < best_cost:
            best_cost = dp[n][v]
            best_v = v
    
    if best_cost >= INF:
        return [], math.inf, 0
    
    # Reconstruct solution
    chosen = []
    i, v = n, best_v
    while i > 0 and v > 0:
        # Check if we took item i
        if dp[i][v] != dp[i - 1][v]:
            # We took item i
            u = units_sorted[i - 1]
            chosen.append(u)
            v -= u['ev']
        i -= 1
    
    return chosen, best_cost, best_v


def compute_knapsack_exact(units, target_ev, cost_func=None):
    """
    Like compute_knapsack but requires exactly target_ev (not at least).
    Returns (chosen_units, min_votes, achieved_ev) where achieved_ev == target_ev on success,
    or ([], inf, 0) if exact target cannot be reached.
    """
    if target_ev <= 0:
        return [], 0, 0

    n = len(units)
    if n == 0 or target_ev > sum(u['ev'] for u in units):
        return [], math.inf, 0

    INF = 10**18
    max_ev = sum(u['ev'] for u in units)

    # Default cost
    if cost_func is None:
        cost_func = lambda u: int(u['votes_needed'])

    unit_costs = {id(u): int(cost_func(u)) for u in units}

    # Sort for deterministic behaviour
    units_sorted = sorted(
        units,
        key=lambda u: ((unit_costs[id(u)] / max(1, u['ev'])), u['abbr'])
    )

    dp = [[INF] * (max_ev + 1) for _ in range(n + 1)]
    dp[0][0] = 0

    for i in range(1, n + 1):
        u = units_sorted[i - 1]
        ev = u['ev']
        votes = unit_costs[id(u)]
        for v in range(max_ev + 1):
            dp[i][v] = dp[i - 1][v]
            if v >= ev and dp[i - 1][v - ev] != INF:
                dp[i][v] = min(dp[i][v], dp[i - 1][v - ev] + votes)

    if dp[n][target_ev] >= INF:
        return [], math.inf, 0

    # Reconstruct
    chosen = []
    i, v = n, target_ev
    while i > 0 and v > 0:
        if dp[i][v] != dp[i - 1][v]:
            u = units_sorted[i - 1]
            chosen.append(u)
            v -= u['ev']
        i -= 1

    return chosen, dp[n][target_ev], target_ev


def analyze_year(rows_for_year, metric: str = 'votes'):
    # Determine aggregate party EVs using winner labels per unit
    ev_by_party = defaultdict(int)
    total_ev = 0
    year = rows_for_year[0]['year'] if rows_for_year else 0
    
    for r in rows_for_year:
        # compute base EV from the data, but allow overrides for historical anomalies
        ev = int(r['electoral_votes'] or 0)

        # Special-case: Colorado in 1876 had no popular-vote returns here; treat it as
        # having 3 electoral votes and awarded to the Republican (Hayes). Exclude it
        # from flip consideration later by not adding it to the generic ev_by_party loop.
        if year == 1876 and r['abbr'] == 'CO':
            ev = 3
            total_ev += ev
            ev_by_party['R'] += ev
            # skip the normal processing for this row
            continue

        total_ev += ev

        # Special case for Alabama 1960: if AL won by D or T, allocate 5 D + 6 O instead of 11 to winner
        if year == 1960 and r['abbr'] == 'AL' and r['party_win'] in ('D', 'T'):
            ev_by_party['D'] += 5
            ev_by_party['T'] += 6  # Use 'T' for Others/third-party
        elif year == 1948 and r['abbr'] == 'AL' and r['party_win'] in ('D', 'T'):
            ev_by_party['T'] += 11  # All 11 to Dixiecrats (Strom Thurmond)
        else:
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
        # Do not consider Colorado 1876 as a flippable unit; its EVs were assigned to R above.
        if year == 1876 and r['abbr'] == 'CO':
            continue
        if year == 1868 and r['abbr'] == 'FL':
            # Florida 1868 had no popular vote returns here; treat it as having 3 electoral votes
            # and awarded to the Republican (Grant). Exclude it from flip consideration later.
            continue
        if year == 1864 and r['abbr'] == 'LA':
            # Louisiana 1864 had no popular vote returns here; treat it as having 7 electoral votes
            # and awarded to the Republican (Lincoln). Exclude it from flip consideration later.
            continue
        if year == 1960 and r['abbr'] == 'AL':
            # Alabama 1960 is split 5 D + 6 O if won by D or T, so cannot be flipped as a unit
            continue

        if r['party_win'] == runner_party:
            continue
        ev = int(r['electoral_votes'] or 0)
        if ev <= 0:
            continue
        party_votes = {
            'D': r['D_votes'],
            'R': r['R_votes'],
            'T': r['T_votes'],
        }
        winner_votes = r['winner_votes']
        runner_votes = party_votes.get(runner_party, 0)
        margin_to_runner = winner_votes - runner_votes
        # Base votes needed to overtake the current winner in this unit
        votes_to_runner = max(0, margin_to_runner // 2 + 1)
        # Quick-fix: ensure the runner will exceed any other party (including third-party)
        # after the transfer. Compute the highest competing party votes (any party
        # other than the runner) and require runner final votes > that value.
        highest_T_competitor = party_votes.get('T', 0) if runner_party != 'T' else 0
        # if the highest competitor is D or R, the votes needed to runner already covers it
        need_to_pass_competitor = max(0, highest_T_competitor - runner_votes + 1)
        votes_to_runner = max(votes_to_runner, need_to_pass_competitor)

        other_parties = [p for p in party_votes if p != r['party_win']]
        best_other_votes = max(party_votes[p] for p in other_parties) if other_parties else 0
        margin_to_best_other = winner_votes - best_other_votes
        votes_to_best_other = max(0, margin_to_best_other // 2 + 1)

        units.append({
            'year': r['year'],
            'abbr': r['abbr'],
            'ev': ev,
            'total_votes': int(r['total_votes'] or 0),
            'from_party': r['party_win'],
            'votes_to_runner': votes_to_runner,
            'votes_to_best_other': votes_to_best_other,
        })

    # Define cost function by metric
    # votes: raw votes_to_flip
    # margin: minimize total thousandths of percent (0.001%) of state votes moved across chosen units
    if metric == 'margin':
        def cost_func(u):
            tv = max(1, int(u['total_votes'] or 0))
            # thousandths of a percent units: round(1000 * pct) == round(100000 * fraction)
            return int(round(100000 * (int(u['votes_needed']) / tv)))
    else:
        def cost_func(u):
            return int(u['votes_needed'])

    # Mode classic: make runner reach the electoral-vote majority (need).
    # Ensure the runner's EVs after flips will be >= need (the majority threshold).
    target_ev_classic = max(0, need - runner_ev)
    units_classic = [
        {
            'year': u['year'],
            'abbr': u['abbr'],
            'ev': u['ev'],
            'total_votes': u['total_votes'],
            'from_party': u['from_party'],
            'votes_needed': max(0, int(u['votes_to_runner'])),
            'target_party': runner_party,
        }
        for u in units
    ]
    chosen_c, cost_c, ev_c = compute_knapsack(units_classic, target_ev_classic, cost_func)
    # Defensive check: if the knapsack returned a solution that doesn't actually
    # bring the runner to the majority threshold, treat it as infeasible.
    if ev_c and (runner_ev + ev_c) < need:
        chosen_c, cost_c, ev_c = [], math.inf, 0

    # Mode no_majority: reduce winner below need by flipping from the winner regardless of runner gains
    # Equivalent to flipping at least winner_ev - (need - 1) EV away from winner
    target_away = max(0, winner_ev - (need - 1))
    # restrict to units currently held by winner_party (those flips reduce winner's EV)
    units_from_winner = [
        {
            'year': u['year'],
            'abbr': u['abbr'],
            'ev': u['ev'],
            'total_votes': u['total_votes'],
            'from_party': u['from_party'],
            'votes_needed': max(0, int(u['votes_to_best_other'])),
            'target_party': 'any',
        }
        for u in units
        if u['from_party'] == winner_party
    ]
    chosen_n, cost_n, ev_n = compute_knapsack(units_from_winner, target_away, cost_func)
    # Defensive check: ensure the chosen flips actually reduce the winner below the majority
    # (i.e., winner_ev - ev_n <= need - 1). If not, mark infeasible.
    if ev_n and (winner_ev - ev_n) > (need - 1):
        chosen_n, cost_n, ev_n = [], math.inf, 0

    # Mode tie: look for an exact set of EVs to give runner exactly total_ev/2 (tie).
    # Only possible if total_ev is even and target_ev_tie > 0.
    tie_result = ([], math.inf, 0)
    if total_ev % 2 == 0:
        target_ev_tie = total_ev // 2 - runner_ev
        if target_ev_tie > 0:
            # units available to flip to runner are those not currently won by runner
            units_for_tie = [
                {
                    'year': u['year'],
                    'abbr': u['abbr'],
                    'ev': u['ev'],
                    'total_votes': u['total_votes'],
                    'from_party': u['from_party'],
                    'votes_needed': max(0, int(u['votes_to_runner'])),
                    'target_party': runner_party,
                }
                for u in units
            ]
            tie_result = compute_knapsack_exact(units_for_tie, target_ev_tie, cost_func)
            # Defensive check: ensure the exact-knapsack produced the expected tie EVs.
            if tie_result[2] != 0 and tie_result[2] != target_ev_tie:
                tie_result = ([], math.inf, 0)
    chosen_t, cost_t, ev_t = tie_result

    return {
        'winner_party': winner_party,
        'winner_ev': winner_ev,
        'runner_party': runner_party,
        'runner_ev': runner_ev,
        'need': need,
        'classic': {'cost': int(cost_c if math.isfinite(cost_c) else -1), 'ev': ev_c, 'units': chosen_c},
        'no_majority': {'cost': int(cost_n if math.isfinite(cost_n) else -1), 'ev': ev_n, 'units': chosen_n},
        'tie': {'cost': int(cost_t if math.isfinite(cost_t) else -1), 'ev': ev_t, 'units': chosen_t},
        'total_ev': total_ev,
        'metric': metric,
    }


def main():
    rows = load_rows(DOCS_CSV)
    by = group_by_year(rows)

    # Build outputs
    summary_rows = []
    detail_rows = []

    for year in sorted(by.keys()):
        if year == 2024:
            pass
        year_rows = by[year]
        for metric in ('votes', 'margin'):
            res = analyze_year(year_rows, metric=metric)

            summary_rows.append({
                'year': year,
                'metric': metric,
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
                'tie_min_votes': res['tie']['cost'],
                'tie_ev': res['tie']['ev'],
                'tie_states': len(res['tie']['units']),
                'total_ev': res['total_ev'],
            })

            # per-unit details for each mode (include tie)
            for mode in ('classic', 'no_majority', 'tie'):
                for u in res[mode]['units']:
                    detail_rows.append({
                        'year': year,
                        'metric': metric,
                        'mode': mode,
                        'abbr': u['abbr'],
                        'ev': u['ev'],
                        'votes_to_flip': u['votes_needed'],
                        'pct_of_state_votes': round(100.0 * (u['votes_needed'] / u['total_votes']) if u['total_votes'] else 0.0, 3),
                    })

    # write CSVs
    os.makedirs('docs', exist_ok=True)
    with open(OUT_SUMMARY, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=[
            'year','metric','winner_party','winner_ev','runner_party','runner_ev','need',
            'classic_min_votes','classic_ev','classic_states',
            'no_majority_min_votes','no_majority_ev','no_majority_states',
            'tie_min_votes','tie_ev','tie_states','total_ev'
        ])
        w.writeheader()
        w.writerows(summary_rows)

    with open(OUT_DETAILS, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['year','metric','mode','abbr','ev','votes_to_flip','pct_of_state_votes'])
        w.writeheader()
        w.writerows(detail_rows)

    print(f"Wrote {OUT_SUMMARY} ({len(summary_rows)} years) and {OUT_DETAILS} ({len(detail_rows)} rows)")


if __name__ == '__main__':
    main()

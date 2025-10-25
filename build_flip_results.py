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


def is_district(abbr):
    """Check if a unit is a congressional district (ME-01, NE-02, etc.)"""
    return '-' in abbr and abbr.split('-')[1] not in ['AL']


def get_state_from_district(abbr):
    """Get the state abbreviation from a district (ME-01 -> ME)"""
    if is_district(abbr):
        return abbr.split('-')[0]
    return None


def compute_post_flip_state(rows_for_year, flipped_units, year):
    """
    Compute the state of popular votes and EV distribution after applying flips.
    
    Args:
        rows_for_year: List of state/district data for the year
        flipped_units: List of units that were flipped (from analyze_year result)
        year: Election year
        
    Returns:
        Dict with post-flip statistics including popular votes and EV breakdown
    """
    # Create a mapping of abbr to flipped unit
    flipped_map = {u['abbr']: u for u in flipped_units}
    
    # Track total popular votes and EV by party after flips
    popular_votes_after = {'D': 0, 'R': 0, 'T': 0}
    ev_after = {'D': 0, 'R': 0, 'T': 0}
    
    # States that had districts flipped (for tracking at-large implications)
    states_with_flipped_districts = set()
    
    for r in rows_for_year:
        abbr = r['abbr']
        
        # Add popular votes (unchanged)
        popular_votes_after['D'] += r['D_votes']
        popular_votes_after['R'] += r['R_votes']
        popular_votes_after['T'] += r['T_votes']
        
        # Determine EV allocation after flips
        ev = int(r['electoral_votes'] or 0)
        
        # Handle historical special cases first
        if year == 1876 and abbr == 'CO':
            ev_after['R'] += 3
            continue
        if year == 1868 and abbr == 'FL':
            continue
        if year == 1864 and abbr == 'LA':
            continue
        if year == 1960 and abbr == 'AL':
            if abbr in flipped_map:
                # Would need special handling but we exclude AL 1960 from flipping
                pass
            elif r['party_win'] in ('D', 'T'):
                ev_after['D'] += 5
                ev_after['T'] += 6
            else:
                ev_after[r['party_win']] += ev
            continue
        if year == 1948 and abbr == 'AL' and r['party_win'] in ('D', 'T'):
            ev_after['T'] += 11
            continue
        
        # Check if this unit was flipped
        if abbr in flipped_map:
            target_party = flipped_map[abbr]['target_party']
            ev_after[target_party] += ev
            
            # Track if this is a district flip
            if is_district(abbr):
                state = get_state_from_district(abbr)
                if state:
                    states_with_flipped_districts.add(state)
        else:
            # No flip, use original winner
            ev_after[r['party_win']] += ev
    
    return {
        'popular_votes_after': popular_votes_after,
        'ev_after': ev_after,
        'states_with_flipped_districts': list(states_with_flipped_districts),
    }


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
    # Track which states have districts for handling -AL independence issue
    states_with_districts = set()
    for r in rows_for_year:
        if is_district(r['abbr']):
            state = get_state_from_district(r['abbr'])
            if state:
                states_with_districts.add(state)
    
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
        
        # For margin metric, exclude -AL units when there are districts for that state
        # because -AL is not independent from the districts
        abbr = r['abbr']
        is_al = abbr.endswith('-AL')
        if metric == 'margin' and is_al:
            state = abbr.split('-')[0]
            if state in states_with_districts:
                # Skip this -AL unit for margin metric as it's not independent
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
        votes_to_runner = max(0, margin_to_runner // 2 + 1)

        # For each potential target party, compute votes needed to flip to that party
        votes_to_party = {}
        best_other_party = None
        best_other_votes_count = 0
        for target_party in ['D', 'R', 'T']:
            if target_party == r['party_win']:
                continue
            target_votes = party_votes.get(target_party, 0)
            margin = winner_votes - target_votes
            votes_needed = max(0, margin // 2 + 1)
            votes_to_party[target_party] = votes_needed
            if target_votes > best_other_votes_count:
                best_other_votes_count = target_votes
                best_other_party = target_party
        
        votes_to_best_other = votes_to_party.get(best_other_party, 0) if best_other_party else 0

        units.append({
            'year': r['year'],
            'abbr': r['abbr'],
            'ev': ev,
            'total_votes': int(r['total_votes'] or 0),
            'from_party': r['party_win'],
            'votes_to_runner': votes_to_runner,
            'votes_to_best_other': votes_to_best_other,
            'best_other_party': best_other_party,
            'votes_to_party': votes_to_party,
            'party_votes': party_votes,
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

    # Mode classic: make runner reach need
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
            'party_votes': u['party_votes'],
        }
        for u in units
    ]
    chosen_c, cost_c, ev_c = compute_knapsack(units_classic, target_ev_classic, cost_func)

    # Mode no_majority: reduce winner below need by flipping from the winner regardless of runner gains
    # Equivalent to flipping at least winner_ev - (need - 1) EV away from winner
    target_away = max(0, winner_ev - (need - 1))
    # We can flip units currently held by winner_party to any other party,
    # OR flip units held by other parties to third parties if that's more efficient
    # Build units for all states that could reduce winner's EV (directly or indirectly)
    units_from_winner = []
    for u in units:
        # If winner_party holds this unit, we can flip it to best_other
        if u['from_party'] == winner_party:
            units_from_winner.append({
                'year': u['year'],
                'abbr': u['abbr'],
                'ev': u['ev'],
                'total_votes': u['total_votes'],
                'from_party': u['from_party'],
                'votes_needed': max(0, int(u['votes_to_best_other'])),
                'target_party': u.get('best_other_party', 'any'),
                'party_votes': u['party_votes'],
            })
    chosen_n, cost_n, ev_n = compute_knapsack(units_from_winner, target_away, cost_func)

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
                    'party_votes': u['party_votes'],
                }
                for u in units
            ]
            tie_result = compute_knapsack_exact(units_for_tie, target_ev_tie, cost_func)
    chosen_t, cost_t, ev_t = tie_result
    
    # Compute post-flip states for each mode
    classic_post = compute_post_flip_state(rows_for_year, chosen_c, year) if chosen_c else None
    no_majority_post = compute_post_flip_state(rows_for_year, chosen_n, year) if chosen_n else None
    tie_post = compute_post_flip_state(rows_for_year, chosen_t, year) if chosen_t else None

    return {
        'winner_party': winner_party,
        'winner_ev': winner_ev,
        'runner_party': runner_party,
        'runner_ev': runner_ev,
        'need': need,
        'classic': {
            'cost': int(cost_c if math.isfinite(cost_c) else -1), 
            'ev': ev_c, 
            'units': chosen_c,
            'post_flip': classic_post,
        },
        'no_majority': {
            'cost': int(cost_n if math.isfinite(cost_n) else -1), 
            'ev': ev_n, 
            'units': chosen_n,
            'post_flip': no_majority_post,
        },
        'tie': {
            'cost': int(cost_t if math.isfinite(cost_t) else -1), 
            'ev': ev_t, 
            'units': chosen_t,
            'post_flip': tie_post,
        },
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

            summary_row = {
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
            }
            
            # Add post-flip EV breakdowns for each mode
            for mode in ['classic', 'no_majority', 'tie']:
                post = res[mode].get('post_flip')
                if post:
                    ev_after = post['ev_after']
                    summary_row[f'{mode}_ev_d_after'] = ev_after['D']
                    summary_row[f'{mode}_ev_r_after'] = ev_after['R']
                    summary_row[f'{mode}_ev_t_after'] = ev_after['T']
                else:
                    summary_row[f'{mode}_ev_d_after'] = ''
                    summary_row[f'{mode}_ev_r_after'] = ''
                    summary_row[f'{mode}_ev_t_after'] = ''
            
            summary_rows.append(summary_row)

            # per-unit details for each mode (include tie)
            for mode in ('classic', 'no_majority', 'tie'):
                for u in res[mode]['units']:
                    detail_rows.append({
                        'year': year,
                        'metric': metric,
                        'mode': mode,
                        'abbr': u['abbr'],
                        'ev': u['ev'],
                        'from_party': u.get('from_party', ''),
                        'to_party': u.get('target_party', ''),
                        'votes_to_flip': u['votes_needed'],
                        'pct_of_state_votes': round(100.0 * (u['votes_needed'] / u['total_votes']) if u['total_votes'] else 0.0, 3),
                    })

    # write CSVs
    os.makedirs('docs', exist_ok=True)
    with open(OUT_SUMMARY, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=[
            'year','metric','winner_party','winner_ev','runner_party','runner_ev','need',
            'classic_min_votes','classic_ev','classic_states',
            'classic_ev_d_after','classic_ev_r_after','classic_ev_t_after',
            'no_majority_min_votes','no_majority_ev','no_majority_states',
            'no_majority_ev_d_after','no_majority_ev_r_after','no_majority_ev_t_after',
            'tie_min_votes','tie_ev','tie_states',
            'tie_ev_d_after','tie_ev_r_after','tie_ev_t_after',
            'total_ev'
        ])
        w.writeheader()
        w.writerows(summary_rows)

    with open(OUT_DETAILS, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['year','metric','mode','abbr','ev','from_party','to_party','votes_to_flip','pct_of_state_votes'])
        w.writeheader()
        w.writerows(detail_rows)

    print(f"Wrote {OUT_SUMMARY} ({len(summary_rows)} years) and {OUT_DETAILS} ({len(detail_rows)} rows)")


if __name__ == '__main__':
    main()

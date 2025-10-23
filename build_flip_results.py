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
from itertools import product
from typing import Any, Callable

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


COMPOUND_STATES = {'ME', 'NE'}


def votes_needed(winner_votes: int, challenger_votes: int) -> int:
    margin = max(0, int(winner_votes) - int(challenger_votes))
    if margin <= 0:
        return 0
    return margin // 2 + 1


def margin_cost(votes: int, total_votes: int) -> int:
    total = max(1, int(total_votes))
    return int(round(100000 * (int(votes) / total)))


def prepare_compound_state(state_rows, runner_party, winner_party) -> dict[str, Any] | None:
    if not state_rows:
        return None
    state = state_rows[0]['abbr'].split('-')[0]
    info = {
        'state': state,
        'districts': [],
        'al': None
    }
    for row in state_rows:
        parties = {
            'D': row['D_votes'],
            'R': row['R_votes'],
            'T': row['T_votes'],
        }
        winner = row['party_win']
        winner_votes = parties.get(winner, 0)
        runner_votes = parties.get(runner_party, 0)
        others = [parties[p] for p in parties if p != winner]
        best_other_votes = max(others) if others else 0
        entry = {
            'abbr': row['abbr'],
            'state': state,
            'ev': int(row['electoral_votes'] or 0),
            'total_votes': int(row['total_votes'] or 0),
            'winner_party': winner,
            'votes_to_runner': votes_needed(winner_votes, runner_votes) if runner_party else 0,
            'votes_to_best_other': votes_needed(winner_votes, best_other_votes),
            'party_votes': parties
        }
        if row['abbr'].endswith('-AL'):
            info['al'] = entry
        else:
            info['districts'].append(entry)
    return info


def make_detail(unit, votes_needed_value, target_party):
    return {
        'abbr': unit['abbr'],
        'ev': unit['ev'],
        'votes_needed': int(votes_needed_value),
        'total_votes': unit['total_votes'],
        'from_party': unit['winner_party'],
        'target_party': target_party
    }


def dedupe_options(options):
    best = {}
    for opt in options:
        key = (opt['ev'], tuple(sorted(u['abbr'] for u in opt['units'])))
        if key not in best or opt['cost'] < best[key]['cost']:
            best[key] = opt
    return list(best.values())


def generate_compound_options(
    state_info: dict[str, Any] | None,
    votes_field: str,
    target_party: str,
    metric: str,
    eligible_unit: Callable[[dict[str, Any]], bool] | None = None,
) -> list[dict[str, Any]]:
    default = [{'ev': 0, 'cost': 0, 'votes': 0, 'units': []}]
    if not state_info:
        return default

    districts = []
    for d in state_info['districts']:
        if d.get(votes_field, 0) <= 0:
            continue
        if eligible_unit and not eligible_unit(d):
            continue
        districts.append(d)

    al_info = state_info.get('al')
    if al_info and (al_info.get(votes_field, 0) <= 0 or (eligible_unit and not eligible_unit(al_info))):
        al_info = None
    options = [{'ev': 0, 'cost': 0, 'votes': 0, 'units': []}]

    def calc_cost_value(votes, total):
        if metric == 'margin':
            return margin_cost(votes, total)
        return int(votes)

    # District-only combinations
    n = len(districts)
    for mask in range(1, 1 << n):
        selected = [districts[i] for i in range(n) if mask & (1 << i)]
        base_votes = sum(unit[votes_field] for unit in selected)
        if base_votes <= 0:
            continue
        base_cost = sum(calc_cost_value(unit[votes_field], unit['total_votes']) for unit in selected)
        details = [make_detail(unit, unit[votes_field], target_party) for unit in selected]
        options.append({
            'ev': sum(unit['ev'] for unit in selected),
            'cost': base_cost,
            'votes': base_votes,
            'units': details
        })

    # Combinations that include the at-large unit
    if al_info and al_info.get(votes_field, 0) > 0:
        for mask in range(1 << n):
            selected = [districts[i] for i in range(n) if mask & (1 << i)]
            base_votes = sum(unit[votes_field] for unit in selected)
            base_cost = sum(calc_cost_value(unit[votes_field], unit['total_votes']) for unit in selected)
            base_ev = sum(unit['ev'] for unit in selected)
            base_details = [make_detail(unit, unit[votes_field], target_party) for unit in selected]

            extra = max(0, al_info[votes_field] - base_votes)
            total_votes = base_votes + extra
            if total_votes <= 0:
                continue

            details = base_details + [make_detail(al_info, extra, target_party)]
            cost = base_cost + calc_cost_value(extra, al_info['total_votes'])
            options.append({
                'ev': base_ev + al_info['ev'],
                'cost': cost,
                'votes': total_votes,
                'units': details
            })

    return dedupe_options(options)

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
    ev_by_party = defaultdict(int)
    total_ev = 0
    year = rows_for_year[0]['year'] if rows_for_year else 0

    for row in rows_for_year:
        ev = int(row['electoral_votes'] or 0)
        if year == 1876 and row['abbr'] == 'CO':
            ev = 3
            total_ev += ev
            ev_by_party['R'] += ev
            continue

        total_ev += ev

        if year == 1960 and row['abbr'] == 'AL' and row['party_win'] in ('D', 'T'):
            ev_by_party['D'] += 5
            ev_by_party['T'] += 6
        elif year == 1948 and row['abbr'] == 'AL' and row['party_win'] in ('D', 'T'):
            ev_by_party['T'] += 11
        else:
            ev_by_party[row['party_win']] += ev

    need = total_ev // 2 + 1
    winner_party = max(ev_by_party.items(), key=lambda kv: kv[1])[0]
    winner_ev = ev_by_party[winner_party]
    others = {p: v for p, v in ev_by_party.items() if p != winner_party}
    if others:
        runner_party, runner_ev = max(others.items(), key=lambda kv: kv[1])
    else:
        runner_party, runner_ev = ('D' if winner_party != 'D' else 'R'), 0

    compound_rows = defaultdict(list)
    unit_entries = []

    def skip_unit(row):
        if year == 1876 and row['abbr'] == 'CO':
            return True
        if year == 1868 and row['abbr'] == 'FL':
            return True
        if year == 1864 and row['abbr'] == 'LA':
            return True
        if year == 1960 and row['abbr'] == 'AL':
            return True
        return False

    for row in rows_for_year:
        if skip_unit(row):
            continue
        state_code = row['abbr'].split('-')[0]
        if state_code in COMPOUND_STATES:
            compound_rows[state_code].append(row)
            continue

        ev = int(row['electoral_votes'] or 0)
        if ev <= 0:
            continue

        party_votes = {
            'D': row['D_votes'],
            'R': row['R_votes'],
            'T': row['T_votes'],
        }
        winner_votes = party_votes.get(row['party_win'], 0)
        runner_votes = party_votes.get(runner_party, 0)
        votes_to_runner = 0 if row['party_win'] == runner_party else votes_needed(winner_votes, runner_votes)
        other_votes = [party_votes[p] for p in party_votes if p != row['party_win']]
        best_other_votes = max(other_votes) if other_votes else 0
        votes_to_best_other = votes_needed(winner_votes, best_other_votes)

        unit_entries.append({
            'year': row['year'],
            'abbr': row['abbr'],
            'ev': ev,
            'total_votes': int(row['total_votes'] or 0),
            'from_party': row['party_win'],
            'votes_to_runner': votes_to_runner,
            'votes_to_best_other': votes_to_best_other,
        })

    runner_units = [
        {
            'year': entry['year'],
            'abbr': entry['abbr'],
            'ev': entry['ev'],
            'total_votes': entry['total_votes'],
            'from_party': entry['from_party'],
            'votes_needed': entry['votes_to_runner'],
            'target_party': runner_party,
        }
        for entry in unit_entries
        if entry['votes_to_runner'] > 0 and entry['ev'] > 0
    ]

    winner_units = [
        {
            'year': entry['year'],
            'abbr': entry['abbr'],
            'ev': entry['ev'],
            'total_votes': entry['total_votes'],
            'from_party': entry['from_party'],
            'votes_needed': entry['votes_to_best_other'],
            'target_party': 'any',
        }
        for entry in unit_entries
        if entry['from_party'] == winner_party and entry['votes_to_best_other'] > 0 and entry['ev'] > 0
    ]

    if metric == 'margin':
        def cost_func(unit):
            return margin_cost(unit['votes_needed'], unit['total_votes'])
    else:
        def cost_func(unit):
            return int(unit['votes_needed'])

    target_ev_classic = max(0, need - runner_ev)
    target_away = max(0, winner_ev - (need - 1))
    target_ev_tie = None
    if total_ev % 2 == 0:
        target_ev_tie = total_ev // 2 - runner_ev

    compound_info = {
        state: prepare_compound_state(compound_rows.get(state, []), runner_party, winner_party)
        for state in COMPOUND_STATES
    }

    runner_opts_me = generate_compound_options(compound_info.get('ME'), 'votes_to_runner', runner_party, metric)
    runner_opts_ne = generate_compound_options(compound_info.get('NE'), 'votes_to_runner', runner_party, metric)
    eligible_winner = lambda unit: unit['winner_party'] == winner_party
    no_majority_opts_me = generate_compound_options(compound_info.get('ME'), 'votes_to_best_other', 'any', metric, eligible_unit=eligible_winner)
    no_majority_opts_ne = generate_compound_options(compound_info.get('NE'), 'votes_to_best_other', 'any', metric, eligible_unit=eligible_winner)

    def merge_options(option_tuple):
        total_cost = 0
        total_ev = 0
        units = []
        for opt in option_tuple:
            total_cost += opt['cost']
            total_ev += opt['ev']
            units.extend(dict(u) for u in opt['units'])
        return total_cost, total_ev, units

    classic_best = {'cost': math.inf, 'ev': 0, 'units': []}
    for opt_me, opt_ne in product(runner_opts_me, runner_opts_ne):
        combo_cost, combo_ev, combo_units = merge_options((opt_me, opt_ne))
        remaining = max(0, target_ev_classic - combo_ev)
        chosen_rest, rest_cost, rest_ev = compute_knapsack(runner_units, remaining, cost_func)
        if not math.isfinite(rest_cost):
            continue
        total_ev_combo = combo_ev + rest_ev
        if total_ev_combo < target_ev_classic:
            continue
        total_cost_combo = combo_cost + rest_cost
        total_units = combo_units + [dict(u) for u in chosen_rest]
        if total_cost_combo < classic_best['cost']:
            classic_best = {'cost': total_cost_combo, 'ev': total_ev_combo, 'units': total_units}

    no_majority_best = {'cost': math.inf, 'ev': 0, 'units': []}
    for opt_me, opt_ne in product(no_majority_opts_me, no_majority_opts_ne):
        combo_cost, combo_ev, combo_units = merge_options((opt_me, opt_ne))
        remaining = max(0, target_away - combo_ev)
        chosen_rest, rest_cost, rest_ev = compute_knapsack(winner_units, remaining, cost_func)
        if not math.isfinite(rest_cost):
            continue
        total_ev_combo = combo_ev + rest_ev
        if total_ev_combo < target_away:
            continue
        total_cost_combo = combo_cost + rest_cost
        total_units = combo_units + [dict(u) for u in chosen_rest]
        if total_cost_combo < no_majority_best['cost']:
            no_majority_best = {'cost': total_cost_combo, 'ev': total_ev_combo, 'units': total_units}

    if target_ev_tie is None or target_ev_tie <= 0:
        tie_best = {'cost': 0, 'ev': 0, 'units': []}
    else:
        tie_best = {'cost': math.inf, 'ev': 0, 'units': []}
        for opt_me, opt_ne in product(runner_opts_me, runner_opts_ne):
            combo_cost, combo_ev, combo_units = merge_options((opt_me, opt_ne))
            if combo_ev > target_ev_tie:
                continue
            remaining = target_ev_tie - combo_ev
            chosen_rest, rest_cost, rest_ev = compute_knapsack_exact(runner_units, remaining, cost_func)
            if not math.isfinite(rest_cost):
                continue
            total_ev_combo = combo_ev + rest_ev
            if total_ev_combo != target_ev_tie:
                continue
            total_cost_combo = combo_cost + rest_cost
            total_units = combo_units + [dict(u) for u in chosen_rest]
            if total_cost_combo < tie_best['cost']:
                tie_best = {'cost': total_cost_combo, 'ev': total_ev_combo, 'units': total_units}

    def finalize(result):
        if not math.isfinite(result['cost']):
            return {'cost': -1, 'ev': 0, 'units': []}
        return {
            'cost': int(result['cost']),
            'ev': result['ev'],
            'units': [dict(u) for u in result['units']]
        }

    return {
        'winner_party': winner_party,
        'winner_ev': winner_ev,
        'runner_party': runner_party,
        'runner_ev': runner_ev,
        'need': need,
        'classic': finalize(classic_best),
        'no_majority': finalize(no_majority_best),
        'tie': finalize(tie_best),
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

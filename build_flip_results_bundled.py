#!/usr/bin/env python3
"""
build_flip_results_bundled.py

Compute minimal popular votes (or margin %) needed to:
  1) FLIP the Electoral College outcome (classic: give the original loser ≥270 EV)
  2) FORCE A TIE (exactly 269–269)
  3) NO MAJORITY (reduce original winner to ≤269 EV)

Key fix implemented: **ME/NE bundling.**
- Treat ME and NE as *state-bundled options* rather than independent AL/district items.
- Enumerate subsets of districts and account for statewide (AL) requirements using the *same moved votes*,
  so AL and districts are not double-counted and remain arithmetically consistent.

INPUT
- docs/presidential_margins.csv (fallback: /mnt/data/presidential_margins.csv)
  Expected columns per row:
    year, abbr, D_votes, R_votes, T_votes, total_votes, electoral_votes
  The file should include ME-01/02 (and 03 for NE) and ME-AL/NE-AL rows for district and statewide tallies.

OUTPUTS
- docs/flip_results.csv
    Columns:
      year,metric,mode,total_votes_moved,units_chosen,ev_gained,runner_party
      (For mode=no_majority, ev_gained means EV removed from the winner.)
- docs/flip_details.csv
    Columns:
      year,metric,mode,abbr,ev,votes_to_flip,pct_of_state_votes

USAGE
  python build_flip_results_bundled.py

Notes
- "metric" ∈ {"votes","margin"}
- For "margin", costs are normalized by the relevant statewide total (for bundled) or unit total (for others).
- votes_to_runner formula: floor((winner_votes - runner_votes)/2) + 1, if runner is not already the winner; else 0.
- We only model D and R as EV-relevant parties.
"""

from __future__ import annotations

import csv
from collections import defaultdict
from dataclasses import dataclass
from math import floor
from pathlib import Path
from typing import Dict, List, Tuple

IN_PRIMARY = Path('docs/presidential_margins.csv')
IN_FALLBACK = Path('/mnt/data/presidential_margins.csv')
OUT_SUMMARY = Path('docs/flip_results.csv')
OUT_DETAILS = Path('docs/flip_details.csv')

# --------- Data containers ---------

@dataclass
class UnitRow:
    year: int
    abbr: str
    D_votes: int
    R_votes: int
    T_votes: int
    total_votes: int
    electoral_votes: int

def read_rows() -> List[UnitRow]:
    src = IN_PRIMARY if IN_PRIMARY.exists() else IN_FALLBACK
    rows: List[UnitRow] = []
    with open(src, 'r', newline='', encoding='utf-8') as f:
        r = csv.DictReader(f)
        for w in r:
            def to_int(key: str, default: int=0) -> int:
                v = w.get(key, '')
                try:
                    return int(float(v))
                except Exception:
                    return default
            rows.append(UnitRow(
                year=to_int('year'),
                abbr=w['abbr'],
                D_votes=to_int('D_votes'),
                R_votes=to_int('R_votes'),
                T_votes=to_int('T_votes'),
                total_votes=to_int('total_votes'),
                electoral_votes=to_int('electoral_votes'),
            ))
    return rows

def winner_party(row: UnitRow) -> str:
    # Pick the plurality among D/R/T. T breaks toward neither, but we only flip between D and R.
    parties = {'D': row.D_votes, 'R': row.R_votes, 'T': row.T_votes}
    return max(parties, key=parties.get)

def votes_to_runner(row: UnitRow, runner: str) -> int:
    parties = {'D': row.D_votes, 'R': row.R_votes, 'T': row.T_votes}
    w = max(parties, key=parties.get)
    if w == runner:
        return 0
    return max(0, floor((parties[w] - parties.get(runner, 0)) / 2) + 1)

# --------- Option items for knapsack ---------

@dataclass
class Option:
    key: str           # abbr or bundle label
    ev: int
    votes_cost: int
    margin_cost_1e5: int  # integer of (moved_votes / denom) * 100000
    denom_votes: int      # for pct reporting
    flipped_ev_to_runner: bool  # True for classic/tie; For no_majority semantics differ
    describe: str        # display which sub-contests flip, e.g. 'NE{01,AL}'

def build_regular_options(rows: List[UnitRow], runner: str, metric: str) -> List[Option]:
    # Regular (non-ME/NE) units: just flip the entire unit.
    opts: List[Option] = []
    for r in rows:
        # Skip ME/NE parts here; handled by bundle builder.
        if r.abbr.startswith('NE-') or r.abbr.startswith('ME-'):
            continue
        w = winner_party(r)
        if w == runner:
            continue
        vcost = votes_to_runner(r, runner)
        if vcost <= 0 or r.electoral_votes <= 0:
            continue
        denom = max(1, r.total_votes)
        mcost = round(100000 * (vcost / denom))
        opts.append(Option(
            key=r.abbr,
            ev=r.electoral_votes,
            votes_cost=vcost,
            margin_cost_1e5=mcost,
            denom_votes=denom,
            flipped_ev_to_runner=True,
            describe=r.abbr
        ))
    return opts

def build_bundle_options(state_rows: List[UnitRow], runner: str, metric: str) -> List[Option]:
    """
    Build bundled options for ME or NE.
    Subsets of districts are enumerated. Statewide (AL) threshold may require extra
    votes beyond district flips; these are charged once using the statewide denominator.
    """
    # Separate AL and districts
    al_row = next((r for r in state_rows if r.abbr.endswith('-AL')), None)
    drows = [r for r in state_rows if not r.abbr.endswith('-AL')]
    if not al_row or not drows:
        return []

    al_w = winner_party(al_row)
    # runner is 'D' or 'R'
    al_vcost = votes_to_runner(al_row, runner)
    statewide_total = max(1, al_row.total_votes)
    al_ev = al_row.electoral_votes

    # District info
    dinfo = []
    for dr in drows:
        dw = winner_party(dr)
        base = votes_to_runner(dr, runner)  # 0 if runner already wins
        dinfo.append((dr, dw, base))

    # Enumerate subsets
    n = len(dinfo)
    state_code = al_row.abbr.split('-')[0]  # 'ME' or 'NE'
    opts: List[Option] = []
    for mask in range(1 << n):
        base_votes = 0
        ev_gain = 0
        flipped_tags: List[str] = []
        # district flips
        for i in range(n):
            if mask & (1 << i):
                dr, dw, vtr = dinfo[i]
                base_votes += vtr
                if winner_party(dr) != runner and dr.electoral_votes > 0:
                    ev_gain += dr.electoral_votes
                flipped_tags.append(dr.abbr.split('-')[-1])  # '01', '02', ...
        # extra votes to win AL if needed
        extra = max(0, al_vcost - base_votes) if winner_party(al_row) != runner else 0
        total_moved = base_votes + extra

        # Check AL flip
        al_flips = (winner_party(al_row) != runner and total_moved >= al_vcost)
        if al_flips and al_ev > 0:
            ev_gain += al_ev
            flipped_tags.append('AL')

        if ev_gain <= 0 or total_moved <= 0:
            # ignore zero-ev or zero-cost options
            continue

        # Cost for "votes" and "margin"
        mcost = round(100000 * (total_moved / statewide_total))
        label = f"{state_code}{{" + ",".join(sorted(flipped_tags)) + "}}"
        opts.append(Option(
            key=label,
            ev=ev_gain,
            votes_cost=total_moved,
            margin_cost_1e5=mcost,
            denom_votes=statewide_total,  # for % reporting use statewide
            flipped_ev_to_runner=True,
            describe=label
        ))
    return opts

# --------- Knapsack solvers ---------

def knapsack_min_cost_at_least(items: List[Option], target_ev: int, metric: str) -> Tuple[int, List[int]]:
    """
    Minimize cost to achieve sum(ev) >= target_ev.
    Returns (min_cost, indices chosen). If no solution (target_ev<=0), returns (0, []).
    """
    if target_ev <= 0:
        return 0, []
    # DP over EV with large sentinel
    INF = 10**18
    max_ev = sum(it.ev for it in items)
    target_ev = min(target_ev, max_ev)
    # cost array and predecessor for reconstruction
    cost = [INF] * (target_ev + 1)
    prev = [(-1, -1)] * (target_ev + 1)  # (prev_ev, item_index)
    cost[0] = 0
    for idx, it in enumerate(items):
        it_cost = it.votes_cost if metric == 'votes' else it.margin_cost_1e5
        # Iterate backwards to avoid reuse
        for ev in range(target_ev, -1, -1):
            new_ev = min(target_ev, ev + it.ev)
            new_cost = cost[ev] + it_cost
            if new_cost < cost[new_ev]:
                cost[new_ev] = new_cost
                prev[new_ev] = (ev, idx)
    # reconstruct at target_ev
    chosen: List[int] = []
    ev = target_ev
    while ev > 0 and prev[ev][0] != -1:
        pev, idx = prev[ev]
        chosen.append(idx)
        ev = pev
    chosen.reverse()
    return cost[target_ev], chosen

def knapsack_min_cost_exact(items: List[Option], exact_ev: int, metric: str) -> Tuple[int, List[int]]:
    """
    Minimize cost to achieve sum(ev) == exact_ev.
    Returns (min_cost, indices chosen). If exact_ev==0 returns (0, []).
    If impossible, returns (INF, []).
    """
    INF = 10**18
    if exact_ev == 0:
        return 0, []
    max_ev = sum(it.ev for it in items)
    if exact_ev > max_ev:
        return INF, []
    cost = [INF] * (exact_ev + 1)
    prev = [(-1, -1)] * (exact_ev + 1)
    cost[0] = 0
    for idx, it in enumerate(items):
        it_cost = it.votes_cost if metric == 'votes' else it.margin_cost_1e5
        for ev in range(exact_ev, -1, -1):
            if cost[ev] == INF:
                continue
            new_ev = ev + it.ev
            if new_ev <= exact_ev:
                new_cost = cost[ev] + it_cost
                if new_cost < cost[new_ev]:
                    cost[new_ev] = new_cost
                    prev[new_ev] = (ev, idx)
    if cost[exact_ev] == INF:
        return INF, []
    chosen: List[int] = []
    ev = exact_ev
    while ev > 0 and prev[ev][0] != -1:
        pev, idx = prev[ev]
        chosen.append(idx)
        ev = pev
    chosen.reverse()
    return cost[exact_ev], chosen

# --------- Per-year analysis ---------

def analyze_year(year_rows: List[UnitRow], metric: str):
    """
    Returns:
      summary_rows: list of dicts for OUT_SUMMARY
      detail_rows: list of dicts for OUT_DETAILS
    """
    # EV tallies
    ev_D = 0
    ev_R = 0
    for r in year_rows:
        if r.electoral_votes <= 0:
            continue
        w = winner_party(r)
        if w == 'D':
            ev_D += r.electoral_votes
        elif w == 'R':
            ev_R += r.electoral_votes
        # ignore T for EV

    # Determine current winner and loser
    if ev_D == ev_R:
        # Already a tie: flipping outcome means giving either side a majority; treat D as winner by convention.
        cur_winner, cur_loser = ('D', 'R') if ev_D >= ev_R else ('R', 'D')
    else:
        cur_winner, cur_loser = ('D', 'R') if ev_D > ev_R else ('R', 'D')

    # Build options for cur_loser to gain EV
    # 1) Regular state options (exclude ME/NE parts)
    options: List[Option] = build_regular_options(year_rows, cur_loser, metric)

    # 2) Bundles for ME and NE
    by_state: Dict[str, List[UnitRow]] = defaultdict(list)
    for r in year_rows:
        st = r.abbr.split('-')[0]
        by_state[st].append(r)
    for st in ('ME', 'NE'):
        srows = [r for r in by_state.get(st, []) if r.abbr.startswith(st+'-')]
        if srows:
            options.extend(build_bundle_options(srows, cur_loser, metric))

    # ---------- Modes ----------
    summary_rows = []
    detail_rows = []

    def write_solution(mode: str, min_cost: int, chosen_idx: List[int], runner_party: str):
        # Convert selected options to details
        if min_cost == 10**18:
            scost = None
        else:
            scost = min_cost
        units = [options[i] for i in chosen_idx]
        total_ev = sum(u.ev for u in units)
        total_votes = sum(u.votes_cost for u in units)
        # rows
        summary_rows.append({
            'year': year_rows[0].year,
            'metric': metric,
            'mode': mode,
            'total_votes_moved': total_votes,
            'units_chosen': len(units),
            'ev_gained': total_ev,
            'runner_party': runner_party,
        })
        for u in units:
            pct = u.votes_cost / max(1, u.denom_votes)
            detail_rows.append({
                'year': year_rows[0].year,
                'metric': metric,
                'mode': mode,
                'abbr': u.describe,
                'ev': u.ev,
                'votes_to_flip': u.votes_cost,
                'pct_of_state_votes': f"{pct:.6f}",
            })

    # Classic: make the loser reach ≥270 EV
    loser_cur_ev = ev_D if cur_loser == 'D' else ev_R
    need_ev = max(0, 270 - loser_cur_ev)
    min_cost, chosen = knapsack_min_cost_at_least(options, need_ev, metric)
    write_solution('classic', min_cost, chosen, cur_loser)

    # Tie: make the loser reach exactly 269 EV
    need_ev_tie = max(0, 269 - loser_cur_ev)
    min_cost_tie, chosen_tie = knapsack_min_cost_exact(options, need_ev_tie, metric)
    write_solution('tie', min_cost_tie, chosen_tie, cur_loser)

    # No majority: reduce winner to ≤269 EV
    winner_cur_ev = ev_D if cur_winner == 'D' else ev_R
    need_remove = max(0, winner_cur_ev - 269)
    # Flipping a unit both removes from winner and adds to loser, but for "no majority" we're indifferent who gets them.
    min_cost_nomaj, chosen_nomaj = knapsack_min_cost_at_least(options, need_remove, metric)
    write_solution('no_majority', min_cost_nomaj, chosen_nomaj, cur_loser)

    return summary_rows, detail_rows

def main():
    rows = read_rows()
    by_year: Dict[int, List[UnitRow]] = defaultdict(list)
    for r in rows:
        by_year[r.year].append(r)

    OUT_SUMMARY.parent.mkdir(parents=True, exist_ok=True)
    OUT_DETAILS.parent.mkdir(parents=True, exist_ok=True)

    all_summary = []
    all_details = []
    for year in sorted(by_year):
        for metric in ('votes','margin'):
            srows, drows = analyze_year(by_year[year], metric)
            all_summary.extend(srows)
            all_details.extend(drows)

    with open(OUT_SUMMARY, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=[
            'year','metric','mode','total_votes_moved','units_chosen','ev_gained','runner_party'
        ])
        w.writeheader()
        w.writerows(all_summary)

    with open(OUT_DETAILS, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=[
            'year','metric','mode','abbr','ev','votes_to_flip','pct_of_state_votes'
        ])
        w.writeheader()
        w.writerows(all_details)

    print(f"Wrote {OUT_SUMMARY} ({len(all_summary)} rows) and {OUT_DETAILS} ({len(all_details)} rows).")

if __name__ == '__main__':
    main()

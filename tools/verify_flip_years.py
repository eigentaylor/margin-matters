import csv
from collections import defaultdict

YEARS = [1892, 1912, 1924]

summary = {}
with open('docs/flip_results.csv', newline='', encoding='utf-8') as f:
    r = csv.DictReader(f)
    for row in r:
        y = int(row['year'])
        if y in YEARS and row['metric'] == 'votes':
            summary[y] = row

# load details grouped by year/mode
details = defaultdict(lambda: defaultdict(list))
with open('docs/flip_details.csv', newline='', encoding='utf-8') as f:
    r = csv.DictReader(f)
    for row in r:
        y = int(row['year'])
        mode = row['mode']
        metric = row['metric']
        if y in YEARS and metric == 'votes':
            details[y][mode].append(row)


def to_int(v):
    try:
        return int(v)
    except Exception:
        return 0

for y in YEARS:
    print('YEAR', y)
    if y not in summary:
        print('  No summary (votes metric) found')
        continue
    s = summary[y]
    winner = s['winner_party']
    runner = s['runner_party']
    winner_ev = to_int(s['winner_ev'])
    runner_ev = to_int(s['runner_ev'])
    need = to_int(s['need'])
    total_ev = to_int(s['total_ev'])
    classic_ev = to_int(s['classic_ev'])
    classic_min_votes = to_int(s['classic_min_votes'])
    no_majority_ev = to_int(s['no_majority_ev'])
    no_majority_min_votes = to_int(s['no_majority_min_votes'])

    print(f"  total_ev={total_ev}, need={need}, winner={winner}({winner_ev}), runner={runner}({runner_ev})")
    print(f"  classic: ev={classic_ev}, min_votes={classic_min_votes}")
    print(f"  no_majority: ev={no_majority_ev}, min_votes={no_majority_min_votes}")

    # verify classic
    reach = runner_ev + classic_ev
    ok_classic = reach >= need
    print(f"  runner + classic = {runner_ev} + {classic_ev} = {reach} -> {'OK' if ok_classic else 'FAIL'}")

    # verify no_majority: winner_ev - no_majority_ev <= need - 1
    if no_majority_ev > 0:
        new_winner = winner_ev - no_majority_ev
        ok_no_majority = new_winner <= (need - 1)
        print(f"  winner - no_majority = {winner_ev} - {no_majority_ev} = {new_winner} -> {'OK' if ok_no_majority else 'FAIL'}")
    else:
        print('  no_majority: no solution')

    # list classic units
    cls_units = details[y].get('classic', [])
    print('  classic units:')
    sum_ev = 0
    sum_votes = 0
    for u in cls_units:
        ev = to_int(u['ev'])
        v = to_int(u['votes_to_flip'])
        sum_ev += ev
        sum_votes += v
        print(f"    {u['abbr']}: ev={ev}, votes_to_flip={v}, pct={u['pct_of_state_votes']}")
    print(f"  classic units sum_ev={sum_ev}, sum_votes={sum_votes}")

    # list no_majority units
    nm_units = details[y].get('no_majority', [])
    print('  no_majority units:')
    sum_ev = 0
    sum_votes = 0
    for u in nm_units:
        ev = to_int(u['ev'])
        v = to_int(u['votes_to_flip'])
        sum_ev += ev
        sum_votes += v
        print(f"    {u['abbr']}: ev={ev}, votes_to_flip={v}, pct={u['pct_of_state_votes']}")
    print(f"  no_majority units sum_ev={sum_ev}, sum_votes={sum_votes}")

    print()

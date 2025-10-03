import csv
import json
from math import floor

CSV_PATH = r"e:\coding projects\state-trends\docs\presidential_margins.csv"


def parse_int(v):
    try:
        return int(float(v))
    except:
        return 0


def allocate_proportional(dVotes, rVotes, oVotes, totalEVs, thirdPartyResults):
    total = dVotes + rVotes + oVotes
    if total <= 0 or totalEVs <= 0:
        return {'D': 0, 'R': 0, 'O': 0, 'thirdParties': {}}

    thirdPartiesAllocated = {}
    # thirdPartyResults expected as a dict or None
    if thirdPartyResults and isinstance(thirdPartyResults, dict):
        entries = [(name, int(v)) for name, v in thirdPartyResults.items() if name not in ('Other', 'Others')]
        if len(entries) > 0:
            parties = [{'name': 'D', 'votes': dVotes}, {'name': 'R', 'votes': rVotes}]
            for name, votes in entries:
                parties.append({'name': name, 'votes': votes, 'isThird': True})

            allocated = {}
            remainders = []
            totalAllocated = 0
            for p in parties:
                share = p['votes'] / total
                quota = int(floor(share * totalEVs))
                remainder = (share * totalEVs) - quota
                if p.get('isThird'):
                    thirdPartiesAllocated[p['name']] = quota
                else:
                    allocated[p['name']] = quota
                totalAllocated += quota
                remainders.append({'name': p['name'], 'remainder': remainder, 'isThird': p.get('isThird', False)})

            remaining = totalEVs - totalAllocated
            remainders.sort(key=lambda x: x['remainder'], reverse=True)
            for i in range(min(remaining, len(remainders))):
                r = remainders[i]
                if r['isThird']:
                    thirdPartiesAllocated[r['name']] = thirdPartiesAllocated.get(r['name'], 0) + 1
                else:
                    allocated[r['name']] = allocated.get(r['name'], 0) + 1

            # compute aggregate O as sum of third parties
            return {'D': allocated.get('D', 0), 'R': allocated.get('R', 0), 'O': sum(thirdPartiesAllocated.values()), 'thirdParties': thirdPartiesAllocated}

    # fallback: aggregate O
    dShare = dVotes / total
    rShare = rVotes / total
    oShare = oVotes / total

    dQuota = int(floor(dShare * totalEVs))
    rQuota = int(floor(rShare * totalEVs))
    oQuota = int(floor(oShare * totalEVs))

    allocated = {'D': dQuota, 'R': rQuota, 'O': oQuota}
    remaining = totalEVs - (dQuota + rQuota + oQuota)
    if remaining > 0:
        remainders = [
            {'party': 'D', 'remainder': (dShare * totalEVs) - dQuota},
            {'party': 'R', 'remainder': (rShare * totalEVs) - rQuota},
            {'party': 'O', 'remainder': (oShare * totalEVs) - oQuota}
        ]
        remainders.sort(key=lambda x: x['remainder'], reverse=True)
        for i in range(remaining):
            allocated[remainders[i]['party']] += 1

    return {'D': allocated['D'], 'R': allocated['R'], 'O': allocated['O'], 'thirdParties': {}}


def build_ev_allocation_election_night(row):
    # Emulate election-night buildEvAllocations in non-proportional mode (winner-take-all)
    ev = parse_int(row.get('electoral_votes', 0))
    abbr = row.get('abbr')
    d = parse_int(row.get('D_votes', 0))
    r = parse_int(row.get('R_votes', 0))
    t = parse_int(row.get('T_votes', 0))
    # Special-case for 1960 AL and MS as in election-night.js
    if row.get('year') == '1960' and abbr in ('AL', 'MS'):
        # determine stateWinner; here we treat D as winner if d > r
        stateWinner = 'D' if d > r else 'R'
        if stateWinner != 'R':
            if abbr == 'AL':
                return {'D': min(ev, 5), 'R': 0, 'O': max(0, ev - min(ev,5))}
            if abbr == 'MS':
                return {'D': 0, 'R': 0, 'O': ev}
            # (original code only special-cased AL and MS)
        else:
            return {'D': 0, 'R': ev, 'O': 0}

    # General winner-take-all: assign to the highest vote getter among D, R, or Third
    if d >= r and d >= t:
        return {'D': ev, 'R': 0, 'O': 0}
    elif r > d and r >= t:
        return {'D': 0, 'R': ev, 'O': 0}
    else:
        return {'D': 0, 'R': 0, 'O': ev}


def main():
    rows = []
    with open(CSV_PATH, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get('year') == '1960':
                rows.append(row)

    prop_O_total = 0
    en_noprop_O_total = 0
    en_prop_special_O_total = 0

    print('State allocations (1960) for AL and MS, LA, AR and totals:')
    for r in rows:
        abbr = r.get('abbr')
        ev = parse_int(r.get('electoral_votes', 0))
        d = parse_int(r.get('D_votes', 0))
        rep = parse_int(r.get('R_votes', 0))
        t = parse_int(r.get('T_votes', 0))
        tp_json = r.get('third_party_results', '')
        tp = {}
        if tp_json and tp_json.strip() not in ('{}', ''):
            try:
                tp = json.loads(tp_json)
            except Exception:
                tp = {}

        prop = allocate_proportional(d, rep, t, ev, tp)
        prop_O_total += prop.get('O', 0)

        en_noprop = build_ev_allocation_election_night(r)
        en_noprop_O_total += en_noprop.get('O', 0)

        # Election-night proportional mode with special-case first (special-case overrides even if proportional)
        en_prop = None
        if r.get('year') == '1960' and abbr in ('AL', 'MS'):
            en_prop = build_ev_allocation_election_night(r)
        else:
            en_prop = allocate_proportional(d, rep, t, ev, tp)
        en_prop_special_O_total += en_prop.get('O', 0)

        if abbr in ('AL', 'MS', 'LA', 'AR'):
            print(f"{abbr}: ev={ev} D={d} R={rep} T={t} thirdParties={tp} -> prop_O={prop.get('O')} en_noprop_O={en_noprop.get('O')} en_prop_special_O={en_prop.get('O')}")

    print('\nTotals:')
    print(f'Proportional (table) total O EVs = {prop_O_total}')
    print(f'Election-night (winner-take-all with 1960 special-case) total O EVs = {en_noprop_O_total}')
    print(f'Election-night (proportional except 1960 special-case) total O EVs = {en_prop_special_O_total}')


if __name__ == '__main__':
    main()

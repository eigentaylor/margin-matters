import csv
from collections import defaultdict

def num(v):
    try:
        return int(float(v))
    except:
        return 0

path = 'docs/presidential_margins.csv'
by = defaultdict(lambda: defaultdict(int))

with open(path, newline='', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        year = int(float(r['year']))
        ev = num(r.get('electoral_votes',0))
        d = num(r.get('D_votes',0))
        rr = num(r.get('R_votes',0))
        t = num(r.get('T_votes',0))
        if d >= rr and d >= t:
            party='D'
        elif rr >= d and rr >= t:
            party='R'
        else:
            party='T'
        by[year][party] += ev
        by[year]['total'] += ev

for year in sorted(by.keys()):
    if by[year].get('T',0) > 0:
        print(year, dict(by[year]))

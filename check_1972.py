import csv

total_ev = 0
states = []
with open('docs/flip_details.csv', 'r') as f:
    for row in csv.DictReader(f):
        if row['year'] == '1972' and row['mode'] == 'no_majority':
            ev = int(row['ev'])
            total_ev += ev
            states.append(f"{row['abbr']}({ev})")

print(f'Total EV: {total_ev}')
print(f'States ({len(states)}): {" ".join(states)}')
print(f'Expected: 252 EVs')
print(f'Difference: {total_ev - 252}')

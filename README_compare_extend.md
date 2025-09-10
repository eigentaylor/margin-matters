compare_extend.py
==================

Small helper script to compare two election CSVs and to create an extended CSV for a given year range up to 2024.

Usage (PowerShell examples)

- Compare files and write differences:

```powershell
python compare_extend.py check --a presidential_margins.csv --b 1900_2024_election_results.fixed.csv --out diffs.csv
```

- Create an extended copy of the larger file starting from 1972 through 2024:

```powershell
python compare_extend.py extend --source 1900_2024_election_results.fixed.csv --start-year 1972 --out presidential_margins_1972_2024.csv
```

Notes
- The script uses the tuple (year, state_po) as the default key when comparing rows. You can override via --keys on the check command.
- The extend command picks reasonable default columns (year, state_po, state, winner columns, vote counts). Use --cols to specify exact columns to keep (comma-separated).
- No external dependencies required beyond Python 3.

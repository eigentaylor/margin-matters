"""Aggregate district-level presidential results into state totals and national totals.

Creates: election_data/state_totals_by_year.csv

Output columns: year,abbr,D_votes,R_votes,T_votes,total_votes

Special rules:
- For every state, create one combined row per year (abbr = state), except ME/NE where the combined row is named ME-AL / NE-AL.
- For ME and NE, also keep each congressional-district row (abbr = ME-01, ME-02, ...), padding numeric districts to two digits.
- Add a row per year with abbr = NATIONAL that sums all states.
- All vote fields are integers in the output.
"""
from pathlib import Path
import pandas as pd


IN_CSVS = [
    Path("election_data/presidential_elections_by_district_1968-2020.csv"),
    Path("election_data/presidential_2024.csv"),
]
OUT_CSV = Path("election_data/state_totals_by_year.csv")


def pad_district(d):
    """Return district string padded to two digits for numeric districts, or unchanged for 'AL' or other strings."""
    if pd.isna(d):
        return d
    s = str(d)
    if s.upper() == "AL":
        return "AL"
    try:
        n = int(s)
        return f"{n:02d}"
    except Exception:
        return s


def main():
    # Read all available input CSVs and concatenate
    parts = []
    for p in IN_CSVS:
        if p.exists():
            parts.append(pd.read_csv(p, dtype={"year": int, "state": str, "district": str}))
    if not parts:
        raise FileNotFoundError(f"No input CSVs found among: {IN_CSVS}")
    df = pd.concat(parts, ignore_index=True)

    # Ensure numeric vote columns and convert to ints (remove any .0)
    vote_cols = ["D_votes", "R_votes", "T_votes", "total_votes"]
    for c in vote_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0).astype(int)

    # Combined state totals (one row per state per year)
    state_sums = (
        df.groupby(["year", "state"], sort=False)[vote_cols]
        .sum()
        .reset_index()
    )

    # For ME and NE: combined row should be named ME-AL / NE-AL
    state_sums["abbr"] = state_sums.apply(
        lambda r: f"{r['state']}-AL" if r["state"] in ("ME", "NE") else r["state"],
        axis=1,
    )

    combined = state_sums[["year", "abbr"] + vote_cols]

    # Keep district rows only for ME and NE (but drop the AL row to avoid double-counting the combined one)
    me_ne = df[df["state"].isin(("ME", "NE"))].copy()
    me_ne["district_padded"] = me_ne["district"].apply(pad_district)
    # drop the AL rows here because combined already contains the statewide AL row
    me_ne = me_ne[me_ne["district_padded"] != "AL"]
    me_ne["abbr"] = me_ne["state"] + "-" + me_ne["district_padded"].astype(str)
    me_ne = me_ne[["year", "abbr"] + vote_cols]

    # NATIONAL row per year (sum of state combined rows)
    national = (
        state_sums.groupby("year")[vote_cols].sum().reset_index()
    )
    national["abbr"] = "NATIONAL"
    national = national[["year", "abbr"] + vote_cols]

    # Final assembly: combined (all states), plus ME/NE district rows, plus national
    final = pd.concat([combined, me_ne, national], ignore_index=True)

    # Ensure integer dtypes (should already be ints)
    for c in vote_cols:
        final[c] = final[c].astype(int)

    # Sort for readability: year asc, abbr (NATIONAL last)
    final = final.sort_values(by=["year", "abbr"], key=lambda col: col.astype(str))

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    final.to_csv(OUT_CSV, index=False)

    print(f"Wrote {OUT_CSV} with {len(final):,} rows")
    print(final.head(20).to_string(index=False))


if __name__ == "__main__":
    main()

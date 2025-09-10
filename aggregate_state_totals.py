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

    # Compute number of districts per state/year (exclude 'AL' combined rows).
    # Pad district values first so numeric districts are normalized.
    df["district_padded"] = df["district"].apply(pad_district)
    # Count unique numeric districts per (year, state) excluding 'AL' and NaNs
    district_counts = (
        df[df["district_padded"].notna() & (df["district_padded"] != "AL")]
        .groupby(["year", "state"])["district_padded"]
        .nunique()
        .reset_index()
        .rename(columns={"district_padded": "num_districts"})
    )

    # merge district_counts into state_sums to compute electoral votes
    state_sums = state_sums.merge(district_counts, on=["year", "state"], how="left")
    # where we don't have per-district rows, assume at least 1 district so EV >= 3
    state_sums["num_districts"] = state_sums["num_districts"].fillna(1).astype(int)
    state_sums["electoral_votes"] = state_sums["num_districts"] + 2

    # For ME and NE: combined row should be named ME-AL / NE-AL
    state_sums["abbr"] = state_sums.apply(
        lambda r: f"{r['state']}-AL" if r["state"] in ("ME", "NE") else r["state"],
        axis=1,
    )

    # Force combined ME-AL and NE-AL to always have exactly 2 electoral votes
    # (the statewide "-AL" rows should represent the two at-large electors)
    state_sums.loc[state_sums["abbr"].isin(["ME-AL", "NE-AL"]), "electoral_votes"] = 2

    combined = state_sums[["year", "abbr"] + vote_cols + ["electoral_votes"]]

    # Keep district rows only for ME and NE (but drop the AL row to avoid double-counting the combined one)
    me_ne = df[df["state"].isin(("ME", "NE"))].copy()
    me_ne["district_padded"] = me_ne["district"].apply(pad_district)
    # drop the AL rows here because combined already contains the statewide AL row
    me_ne = me_ne[me_ne["district_padded"] != "AL"]
    me_ne["abbr"] = me_ne["state"] + "-" + me_ne["district_padded"].astype(str)
    me_ne = me_ne[["year", "abbr"] + vote_cols]
    # district rows (ME/NE) each carry 1 electoral vote for the district
    me_ne["electoral_votes"] = 1

    # NATIONAL row per year (sum of state combined rows)
    national = (
        state_sums.groupby("year")[vote_cols].sum().reset_index()
    )
    national["abbr"] = "NATIONAL"
    # national electoral votes = sum of state electoral votes
    national_ev = state_sums.groupby("year")["electoral_votes"].sum().reset_index()
    national = national.merge(national_ev, on="year", how="left")
    national = national[["year", "abbr"] + vote_cols + ["electoral_votes"]]

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

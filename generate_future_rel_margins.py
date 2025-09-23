#!/usr/bin/env python3
"""
Brownian-Bridge Presidential Margin Path Generator (2024→2048)

Generates plausible quadrennial state/district relative margins for 2028–2048
by simulating a Brownian bridge (mean-zero wander that returns to the endpoint)
around a straight trend between 2024 and a plausible 2048 target.

Inputs
------
- presidential_margins.csv  (columns: abbr, year, relative_margin, total_votes)
  * Exclude any national rows like "US"/"USA"/"National" — this module does that.
  * Relative margin is assumed to be D−R in the user's consistent convention.

Outputs
-------
- prototype_brownian_bridge_2024_to_2048.csv
  Columns: abbr, rel_2024, rel_2048_target, 2028, 2032, 2036, 2040, 2044
  (The path value at 2048 equals rel_2048_target by construction.)

How to run
----------
$ python generate_brownian_bridge_paths.py \
    --input presidential_margins.csv \
    --output prototype_brownian_bridge_2024_to_2048.csv \
    --seed 20250922
"""

import argparse
import numpy as np
import pandas as pd
from typing import Dict, Tuple
import margin_matters

try:
    import statsmodels.api as sm
    _HAVE_SM = True
except Exception:
    _HAVE_SM = False


def softclip(x, L):
    """Smoothly squash values toward ±L without hard caps."""
    x = np.asarray(x, float)
    return L * np.tanh(x / L)


def is_district(abbr):
    return "-" in abbr and not abbr.endswith("-AL")


def wavg(values, weights):
    values = np.asarray(values, float)
    weights = np.asarray(weights, float)
    return np.average(values, weights=weights) if values.size > 0 and weights.sum() > 0 else np.nan


def compute_slopes_2000_2024(hist):
    out = []
    for abbr, g in hist.groupby("abbr"):
        y = g["relative_margin"].astype(float).values
        x = g["year"].astype(float).values
        if len(np.unique(x)) < 2:
            out.append({"abbr": abbr, "intercept": float(y[-1]) if len(y) else 0.0, "slope": 0.0})
            continue
        if _HAVE_SM:
            X = sm.add_constant(x)
            model = sm.OLS(y, X, missing="drop").fit()
            intercept, slope = float(model.params[0]), float(model.params[1])
        else:
            slope, intercept = np.polyfit(x, y, deg=1)
        out.append({"abbr": abbr, "intercept": intercept, "slope": slope})
    return pd.DataFrame(out)


def build_2048_targets(df, years_ahead=24, shrink=0.8, soft_delta_L=0.33, rng=None):
    if rng is None:
        rng = np.random.default_rng(20250922)

    hist = df[(df["year"] >= 2000) & (df["year"] <= 2024)].copy()
    slopes = compute_slopes_2000_2024(hist)
    base2024 = df[df["year"] == 2024][["abbr", "relative_margin", "total_votes"]].copy()

    merged = base2024.merge(slopes, on="abbr", how="left").fillna({"slope": 0.0})
    drift = rng.standard_t(df=4, size=len(merged)) * 0.02
    proj_raw = merged["relative_margin"] + merged["slope"] * years_ahead * shrink + drift

    center = np.average(proj_raw, weights=merged["total_votes"])
    proj_raw = proj_raw - center

    delta = proj_raw - merged["relative_margin"]
    delta_soft = softclip(delta, L=soft_delta_L)

    merged["rel_2048_target"] = merged["relative_margin"] + delta_soft
    return merged[["abbr", "relative_margin", "rel_2048_target", "total_votes"]]


def build_pca_loadings(hist, k=3):
    wide = hist.pivot(index="abbr", columns="year", values="relative_margin").dropna(axis=0, how="any")
    X = wide.values
    X = X - X.mean(axis=1, keepdims=True)
    U, s, Vt = np.linalg.svd(X, full_matrices=False)
    L = U[:, :k] * s[:k]
    norms = np.linalg.norm(L, axis=1, keepdims=True) + 1e-12
    L = L / norms
    return dict(zip(wide.index.tolist(), L)), k


def state_sigma_map(hist):
    hist_sorted = hist.sort_values(["abbr", "year"]).copy()
    hist_sorted["rel_delta"] = hist_sorted.groupby("abbr")["relative_margin"].diff()
    s = hist_sorted.groupby("abbr")["rel_delta"].std().fillna(0.02)
    return s.to_dict()


def hump_early(u):
    return np.exp(-((u - 0.35) / 0.20) ** 2)


def simulate_bridge_paths(df, rng, soft_delta_L=0.33, soft_value_L=0.95,
                          years_ahead=24, shrink=0.8, n_steps=240,
                          beta=0.8, alpha=0.45, kappa=0.25,
                          global_scale=1.05, k_factors=3):
    hist = df[(df["year"] >= 2000) & (df["year"] <= 2024)].copy()
    merged = build_2048_targets(df, years_ahead, shrink, soft_delta_L, rng).copy()
    base2024 = merged[["abbr", "relative_margin", "total_votes"]].rename(columns={"relative_margin": "rel_2024"})
    merged = merged.rename(columns={"relative_margin": "rel_2024"})

    load_map, k = build_pca_loadings(hist, k=k_factors)
    sigma_hist = state_sigma_map(hist)

    t_grid = (np.arange(0, n_steps + 1) / n_steps) ** beta
    dt = np.diff(t_grid)
    coarse_years = [2024, 2028, 2032, 2036, 2040, 2044, 2048]
    coarse_u = np.array([(y - 2024) / 24 for y in coarse_years])

    Z = rng.normal(0.0, 1.0, size=(n_steps, k))

    records = []
    for _, row in merged.iterrows():
        a = row["abbr"]
        y0 = float(row["rel_2024"])
        yT = float(row["rel_2048_target"])
        total = yT - y0

        sigma0 = float(sigma_hist.get(a, 0.02))
        sigma = global_scale * sigma0
        step_std = sigma * np.sqrt(dt) * (1.0 + kappa * hump_early(t_grid[1:]))

        Li = load_map.get(a, None)
        if Li is None:
            Li = np.zeros(k)
            Li[0] = 1.0

        proj = Z @ Li
        idio = rng.normal(0.0, 1.0, size=n_steps)

        inc = step_std * (alpha * proj + np.sqrt(max(1e-9, 1.0 - alpha**2)) * idio)
        W = np.cumsum(inc)
        B = W - t_grid[1:] * W[-1]

        straight = y0 + total * t_grid[1:]
        path = straight + B

        idxs = [np.argmin(np.abs(t_grid - u)) for u in coarse_u[1:]]
        values = [y0] + [float(path[i - 1]) for i in idxs]
        values = [float(softclip(v, L=soft_value_L)) for v in values]
        values[-1] = float(softclip(yT, L=soft_value_L))

        for year, val in zip(coarse_years[1:], values[1:]):
            records.append({"abbr": a, "year": year, "rel_value": val})

    paths = pd.DataFrame.from_records(records)
    wide_paths = paths.pivot(index="abbr", columns="year", values="rel_value").reset_index()
    out = merged[["abbr", "rel_2024", "rel_2048_target"]].merge(wide_paths, on="abbr", how="outer")
    cols = ["abbr", "rel_2024", "rel_2048_target", 2028, 2032, 2036, 2040, 2044]
    out = out[cols]
    return out


def apply_at_large_averages(out, df_source_2024):
    out = out.copy()
    me_d = sorted([a for a in df_source_2024["abbr"].unique() if a.startswith("ME-") and a != "ME-AL"])
    ne_d = sorted([a for a in df_source_2024["abbr"].unique() if a.startswith("NE-") and a != "NE-AL"])
    w_me = df_source_2024.set_index("abbr").loc[me_d, "total_votes"] if len(me_d) > 0 else pd.Series(dtype=float)
    w_ne = df_source_2024.set_index("abbr").loc[ne_d, "total_votes"] if len(ne_d) > 0 else pd.Series(dtype=float)

    year_cols = [c for c in out.columns if isinstance(c, int)]
    for prefix, dlist, wts in [("ME", me_d, w_me), ("NE", ne_d, w_ne)]:
        if len(dlist) == 0:
            continue
        if set(dlist).issubset(set(out["abbr"])):
            v2024 = wavg(out.set_index("abbr").loc[dlist, "rel_2024"], [wts.get(d, 1.0) for d in dlist])
            v2048 = wavg(out.set_index("abbr").loc[dlist, "rel_2048_target"], [wts.get(d, 1.0) for d in dlist])
            if (out["abbr"] == f"{prefix}-AL").any():
                out.loc[out["abbr"] == f"{prefix}-AL", "rel_2024"] = v2024
                out.loc[out["abbr"] == f"{prefix}-AL", "rel_2048_target"] = v2048
            else:
                out.loc[len(out)] = {"abbr": f"{prefix}-AL", "rel_2024": v2024, "rel_2048_target": v2048}
        for y in year_cols:
            if set(dlist).issubset(set(out["abbr"])) and y in out.columns:
                v = wavg(out.set_index("abbr").loc[dlist, y], [wts.get(d, 1.0) for d in dlist])
                if (out["abbr"] == f"{prefix}-AL").any():
                    out.loc[out["abbr"] == f"{prefix}-AL", y] = v
                else:
                    out = pd.concat([out, pd.DataFrame([{"abbr": f"{prefix}-AL", y: v}])], ignore_index=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=None)
    ap.add_argument("--output", default="future_brownian/prototype_brownian_bridge_2024_to_2048.csv")
    ap.add_argument("--seed", type=int, default=20250922)
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)

    if args.input is None:
        df = margin_matters.load()
    else:
        df = pd.read_csv(args.input)
    df = df[~df["abbr"].isin(["US", "USA", "National"])].copy()
    df["relative_margin"] = df["relative_margin"].astype(float)
    df["total_votes"] = df["total_votes"].astype(float)

    out = simulate_bridge_paths(df, rng)
    df2024 = df[df["year"] == 2024][["abbr", "total_votes"]].copy()
    out = apply_at_large_averages(out, df2024)

    out.to_csv(args.output, index=False)
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()

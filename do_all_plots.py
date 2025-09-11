import argparse
import os
from typing import List, Tuple

from statsmodels.nonparametric.smoothers_lowess import lowess
from scipy.interpolate import UnivariateSpline
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

import utils


SPECIAL_1968_STATES = {"GA", "AL", "LA", "MS", "AR"}


def _color_by_sign(values: np.ndarray, years: np.ndarray, state: str, positive_color="deepskyblue", negative_color="red",
                   special_year: int | None = None, special_color="yellow") -> List[str]:
    colors: List[str] = []
    for v, y in zip(values, years):
        if special_year is not None and y == special_year and state in SPECIAL_1968_STATES:
            colors.append(special_color)
        else:
            colors.append(positive_color if v > 0 else negative_color)
    return colors


def _apply_axes_styling(ax, years: np.ndarray, y_label: str, title: str, zero_line: bool = True, y_tick_as_lean: bool = True,
                        lean_is_third_party: bool = False):
    ax.set_title(title)
    ax.set_xlabel("Year")
    ax.set_ylabel(y_label)
    if y_tick_as_lean:
        y_vals = ax.get_yticks()
        ax.set_yticks(y_vals)
        ax.set_yticklabels([utils.lean_str(v, third_party=lean_is_third_party) for v in y_vals], color="white")
    ax.grid(True, alpha=0.3)
    if zero_line:
        ax.axhline(0, color="red", linestyle="--", linewidth=1)
    ax.set_xticks(years)
    ax.set_xticklabels(years, rotation=45)


def _line_margins(ax, years: np.ndarray, state_values: np.ndarray | None, nat_values: np.ndarray,
                  state_label: str, nat_label: str, state: str, label_points: bool = False,
                  special_year_for_state: int | None = 1968):
    # National
    nat_colors = _color_by_sign(nat_values, years, state="", positive_color="deepskyblue", negative_color="red",
                                special_year=None)
    ax.plot(years, nat_values, label=nat_label, marker="o", color="magenta", linestyle="--")
    ax.scatter(years, nat_values, c=nat_colors, s=40, zorder=2, label=f"{nat_label} Results")

    # State (optional)
    if state_values is not None:
        pres_colors = _color_by_sign(state_values, years, state, special_year=special_year_for_state)
        ax.plot(years, state_values, label=state_label, marker="o", linestyle="-", color="lime")
        ax.scatter(years, state_values, c=pres_colors, s=60, zorder=3, label=f"{state_label} Results")

    if label_points and nat_values is not None:
        for (x, y) in zip(years, nat_values):
            ax.text(
                x,
                y + (0.01 if y > 0 else -0.01),
                f"{utils.lean_str(y)}",
                fontsize=9,
                ha="center",
                va="bottom" if y > 0 else "top",
                color="white",
                zorder=10,
                bbox=dict(facecolor="black", alpha=0.7, edgecolor="none", boxstyle="round,pad=0.3"),
            )


def _bar_values(ax, years: np.ndarray, values: np.ndarray, title: str, y_label: str, state: str,
                lean_is_third_party: bool = False, special_year_for_state: int | None = None):
    x_idx = np.arange(len(values))
    if lean_is_third_party:
        # we color yellow if special year and state in 1968 special states, else magenta
        special_color = "yellow"
        other_color = "cyan"
        colors = [special_color if (year == special_year_for_state and state in SPECIAL_1968_STATES) else other_color for year in years]
    else:
        colors = _color_by_sign(values, years, state, special_year=special_year_for_state)
    bars = ax.bar(x_idx, values, width=0.4, color=colors)
    ax.bar_label(bars, labels=[utils.lean_str(v, third_party=lean_is_third_party) for v in values], padding=3,
                 fontsize=8, color="white")
    ax.set_title(title)
    ax.set_xlabel("Year")
    ax.set_ylabel(y_label)
    y_vals = ax.get_yticks()
    ax.set_yticks(y_vals)
    ax.set_yticklabels([utils.lean_str(y, third_party=lean_is_third_party) for y in y_vals], color="white")
    ax.grid(True, alpha=0.3)
    ax.axhline(0, color="red", linestyle="--", linewidth=1)
    ax.set_xticks(x_idx)
    ax.set_xticklabels(years, rotation=45)
    #ax.legend()


def _bar_deltas(ax, years: np.ndarray, deltas: np.ndarray, title: str, y_label: str):
    # Filter out placeholder zeros
    if deltas.size and deltas[0] == 0:
        years_for_delta = years[1:]
        deltas = deltas[1:]
    else:
        years_for_delta = years
    mask = deltas != 0
    deltas = deltas[mask]
    years_for_delta = years_for_delta[mask]

    x_idx = np.arange(len(deltas))
    colors = ["deepskyblue" if d > 0 else "red" for d in deltas]
    bars = ax.bar(x_idx, deltas, width=0.4, color=colors)
    ax.bar_label(bars, labels=[utils.lean_str(v) for v in deltas], padding=3, fontsize=8, color="white")
    ax.set_title(title)
    ax.set_xlabel("Year")
    ax.set_ylabel(y_label)
    y_vals = ax.get_yticks()
    ax.set_yticks(y_vals)
    ax.set_yticklabels([utils.lean_str(y) for y in y_vals], color="white")
    ax.grid(True, alpha=0.3)
    ax.axhline(0, color="red", linestyle="--", linewidth=1)
    ax.set_xticks(x_idx)
    ax.set_xticklabels(years_for_delta, rotation=45)


def _build_plot1(state: str, df: pd.DataFrame, out_dir: str, nat_only: bool = False):
    # 3x1: margins line, 3rd-Party share line, pres_margin_delta bar
    fig, axes = plt.subplots(3, 1, figsize=(14, 12), constrained_layout=True)
    ax1, ax2, ax3 = axes

    years = df["year"].to_numpy()
    order = np.argsort(years)
    years = years[order]

    # 1) total margin line (state + nation unless nat_only)
    state_margin = None if nat_only else df["pres_margin"].to_numpy()[order]
    nat_margin = df["national_margin"].to_numpy()[order]
    _line_margins(
        ax1,
        years,
        state_margin,
        nat_margin,
        state_label="Presidential Margin",
        nat_label="National Margin",
        state=state,
        label_points=nat_only,  # label points only for NAT
        special_year_for_state=1968,
    )
    _apply_axes_styling(ax1, years, y_label="Margin", title=f"{state} Margins")

    # 2) 3rd-party vote share line (state + nation unless nat_only)
    if "third_party_share" in df.columns:
        state_3p = None if nat_only else df["third_party_share"].to_numpy()[order]
        nat_3p = df["third_party_national_share"].to_numpy()[order]
        # Plot national
        ax2.plot(years, nat_3p, label="National 3rd-Party Share", marker="o", color="magenta", linestyle="--")
        ax2.scatter(years, nat_3p, c=["magenta"] * len(years), s=40, zorder=2)
        # Plot state
        if state_3p is not None:
            ax2.plot(years, state_3p, label="State 3rd-Party Share", marker="o", linestyle="-", color="lime")
            # Highlight 1968 winner states by a yellow marker
            scatter_colors = [
                ("yellow" if (y == 1968 and state in SPECIAL_1968_STATES) else 
                 ("deepskyblue" if v > 0 else "red")) 
                for v, y in zip(state_margin if state_margin is not None else [], years)
            ]
            ax2.scatter(years, state_3p, c=scatter_colors, s=60, zorder=3)
        else:
            # label text only if no state 3rd-party data
            for (x, y) in zip(years, nat_3p):
                ax2.text(
                    x,
                    y + 0.01,
                    f"{utils.lean_str(y, third_party=True)}",
                    fontsize=9,
                    ha="center",
                    va="bottom",
                    color="white",
                    zorder=10,
                    bbox=dict(facecolor="black", alpha=0.7, edgecolor="none", boxstyle="round,pad=0.3"),
                )
        ax2.legend()
        _apply_axes_styling(ax2, years, y_label="Third-Party Share", title=f"{state} 3rd-Party Vote Share",
                            zero_line=False, y_tick_as_lean=True, lean_is_third_party=True)
    else:
        ax2.text(0.5, 0.5, "No 3rd-Party share columns", ha="center")

    # 3) pres_margin deltas bar
    _bar_deltas(ax3, years, df["pres_margin_delta"].to_numpy()[order],
                title=f"{state} Change in Presidential Margin", y_label="Delta")

    fig.savefig(os.path.join(out_dir, f"{state}_plot1.png"))
    print(f"Saved {state}_plot1.png")
    plt.close(fig)


def _build_plot2(state: str, df: pd.DataFrame, out_dir: str, include_LOESS: bool = True, include_SPLINE: bool = True):
    # 3x1: relative_margin bar, relative 3rd-Party margin bar, relative margin deltas bar
    fig, axes = plt.subplots(3, 1, figsize=(14, 12), constrained_layout=True)
    ax1, ax2, ax3 = axes

    years = df["year"].to_numpy()
    order = np.argsort(years)
    years = years[order]
    rel_sorted = df["relative_margin"].to_numpy()[order]

    # 1) relative_margin bar (special yellow on 1968 for target states)
    rel = df["relative_margin"].to_numpy()[order]
    _bar_values(ax1, years, rel, title=f"{state} Relative Margins", y_label="Relative Margin", state=state,
                lean_is_third_party=False, special_year_for_state=1968)

    if include_LOESS or include_SPLINE:
        # Prepare dense x for plotting
        x_indices = np.arange(len(years))
        x_dense = np.linspace(x_indices.min(), x_indices.max(), 500)

        # LOESS
        if include_LOESS:
            try:
                frac = 0.6 if len(x_indices) >= 8 else max(0.25, 3 / max(4, len(x_indices)))
                loess_res = lowess(rel_sorted, x_indices, frac=frac, return_sorted=True)
                x_loess = loess_res[:, 0]
                y_loess = loess_res[:, 1]
                y_dense_loess = np.interp(x_dense, x_loess, y_loess)
                ax1.plot(x_dense, y_dense_loess, linestyle='--', color='cyan', 
                         label='LOESS')
            except Exception as e:
                print(f"Could not compute LOESS for {state}: {e}")

        # Spline with optional regularization (s parameter)
        if include_SPLINE:
            try:
                # s=0 yields interpolation; larger s yields smoother curve. When
                # regularization is requested, increase s proportional to n.
                n = len(x_indices)
                # Regularization is always applied
                s_val = max(1e-3, 0.5 * n)
                spline = UnivariateSpline(x_indices, rel_sorted, s=s_val)
                y_dense_spline = spline(x_dense)
                ax1.plot(x_dense, y_dense_spline, linestyle='-.', color='orange',
                         label='Spline')
            except Exception as e:
                print(f"Could not compute Spline for {state}: {e}")

        # Refresh legend so newly-added curves appear
        ax1.legend()

    # 2) relative third-party margin bar
    if "third_party_relative_share" in df.columns:
        rel_3p = df["third_party_relative_share"].to_numpy()[order]
        _bar_values(ax2, years, rel_3p, title=f"{state} Relative 3rd-Party Share", y_label="Relative 3rd-Party Share",
                    state=state, lean_is_third_party=True, special_year_for_state=1968)
    else:
        ax2.text(0.5, 0.5, "No 3rd-Party relative columns", ha="center")

    # 3) relative margin deltas bar
    _bar_deltas(ax3, years, df["relative_margin_delta"].to_numpy()[order],
                title=f"{state} Change in Relative Margin", y_label="Delta")

    fig.savefig(os.path.join(out_dir, f"{state}_plot2.png"))
    print(f"Saved {state}_plot2.png")
    plt.close(fig)


def _build_plot3_two_party(state: str, df: pd.DataFrame, out_dir: str, nat_only: bool = False):
    # 2x2: use ONLY two-party columns
    fig = plt.figure(figsize=(16, 14))
    if nat_only: # 2x1
        gs = fig.add_gridspec(2, 1, height_ratios=[1, 1])
    else: # 2x2
        gs = fig.add_gridspec(2, 2, height_ratios=[1, 1])
    ax_tl = fig.add_subplot(gs[0, 0])  # top-left line
    ax_bl = fig.add_subplot(gs[1, 0])  # bottom-left bar (delta of margin)
    if not nat_only:
        ax_tr = fig.add_subplot(gs[0, 1])  # top-right bar (relative)
        ax_br = fig.add_subplot(gs[1, 1])  # bottom-right bar (delta of relative)

    years = df["year"].to_numpy()
    order = np.argsort(years)
    years = years[order]

    # Top-left: line plot two-party margins
    state_margin = None if nat_only else df["two_party_margin"].to_numpy()[order]
    nat_margin = df["two_party_national_margin"].to_numpy()[order]
    _line_margins(
        ax_tl,
        years,
        state_margin,
        nat_margin,
        state_label="Two-Party Margin",
        nat_label="Nat Two-Party Margin",
        state=state,
        label_points=nat_only,  # label points only for NAT
        special_year_for_state=None,
    )
    _apply_axes_styling(ax_tl, years, y_label="Two-Party Margin", title=f"{state} Two Party Margins")

    if nat_only:
        # Only national line + national deltas requested for NAT
        #ax_tr.axis("off")
        _bar_deltas(ax_bl, years, df["two_party_national_margin_delta"].to_numpy()[order],
                    title=f"{state} Change in Nat Two-Party Margin", y_label="Delta")
        #ax_br.axis("off")
    else:
        # Top-right: relative two-party bar
        _bar_values(ax_tr, years, df["two_party_relative_margin"].to_numpy()[order],
                    title=f"{state} Relative Two-Party Margin", y_label="Relative Margin", state=state)
        # Bottom-left: two-party margin delta
        _bar_deltas(ax_bl, years, df["two_party_margin_delta"].to_numpy()[order],
                    title=f"{state} Change in Two-Party Margin", y_label="Delta")
        # Bottom-right: two-party relative delta
        _bar_deltas(ax_br, years, df["two_party_relative_margin_delta"].to_numpy()[order],
                    title=f"{state} Change in Rel. Two-Party Margin", y_label="Delta")

    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, f"{state}_plot3_two_party.png"))
    print(f"Saved {state}_plot3_two_party.png")
    plt.close(fig)


def main(start_year: int | None = None, end_year: int | None = 2024, clear_old_files: bool = False):
    plt.style.use("dark_background")
    df = pd.read_csv("presidential_margins.csv")

    # Filter by year range if provided
    if start_year is not None:
        df = df[df["year"] >= start_year]
    if end_year is not None:
        df = df[df["year"] <= end_year]

    base_output_dir = "plots"
    output_dir = base_output_dir
    if not (start_year is None and (end_year is None or end_year == 2024)):
        if start_year is not None and end_year is not None:
            suffix = f"{start_year}_{end_year}"
        elif start_year is not None:
            suffix = f"{start_year}_plus"
        else:
            suffix = f"up_to_{end_year}"
        output_dir = os.path.join(base_output_dir, suffix)

    os.makedirs(output_dir, exist_ok=True)

    if clear_old_files:
        for file in os.listdir(output_dir):
            path = os.path.join(output_dir, file)
            if os.path.isfile(path) and (file.endswith(".png") or file.endswith(".svg")):
                os.remove(path)

    # NATIONAL first (two plots)
    nat_df = df[df["abbr"] == "NATIONAL"].copy()
    if not nat_df.empty:
        _build_plot1("NAT", nat_df, output_dir, nat_only=True)
        _build_plot3_two_party("NAT", nat_df, output_dir, nat_only=True)

    # States
    for state in sorted(x for x in df["abbr"].unique() if x != "NATIONAL"):
        state_df = df[df["abbr"] == state].copy()
        if state_df.empty:
            continue
        _build_plot1(state, state_df, output_dir)
        _build_plot2(state, state_df, output_dir)
        _build_plot3_two_party(state, state_df, output_dir)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build new plot set (plot1, plot2, plot3_two_party) per state + NAT")
    parser.add_argument("--start-year", type=int, default=None)
    parser.add_argument("--end-year", type=int, default=2024)
    parser.add_argument("--clear", action="store_true", help="Clear output directory images before writing")
    args = parser.parse_args()

    main(start_year=args.start_year, end_year=args.end_year, clear_old_files=args.clear)
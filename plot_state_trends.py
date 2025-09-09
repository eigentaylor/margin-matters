import pandas as pd
import matplotlib.pyplot as plt
import os
from matplotlib.ticker import FixedLocator, FuncFormatter
import numpy as np
from statsmodels.nonparametric.smoothers_lowess import lowess
from scipy.interpolate import UnivariateSpline
import argparse

import utils

# Option to enable subplot mode
subplot_mode = True  # Set to True for subplot, False for single plot

# Optional: only include data from this year onward (None means use all years)
start_year = None  # e.g. 2000 to only plot years >= 2000
# Optional end year (None means up to the latest available)
end_year = None  # e.g. 2024 to limit to years <= 2024
if end_year is None:
    end_year = 2024

# LOESS smoothing configuration: require a minimum number of points
loess_min_points = 3

# Option: include delta subplot (bottom row merged). If True, figure is 2x2 with bottom row merged
include_deltas = True

# Option: merge the bottom delta subplot into a single wide axis (default True).
# If False, bottom-left will show pres_margin_delta and bottom-right will show relative_margin_delta.
merge_delta_subplot = False

# Option to enable house margins
plot_house_margins = False  # Set to True to include house margins
house_on_same_plot = False  # Set to True to plot house and pres on the same plot

def main(start_year=None, end_year=None, plot_house_margins=False,
         use_loess: bool = True, use_linear: bool = False,
         use_spline: bool = True, spline_regularization: bool = True,
         clear_old_files: bool = False):
    # Read presidential margins
    df = pd.read_csv('presidential_margins.csv')

    # Read house margins if enabled
    if plot_house_margins:
        house_df = pd.read_csv('house_margins.csv')
        house_df = house_df[house_df['year'] <= 2024]  # Only use years <= 2024

    # Ensure base output directory exists
    base_output_dir = 'plots'

    # If a year filter is provided, create a subdirectory to avoid clobbering the default outputs
    if start_year is None and (end_year is None or end_year == 2024):
        output_dir = base_output_dir
    else:
        if start_year is not None and end_year is not None:
            suffix = f"{start_year}_{end_year}"
        elif start_year is not None:
            suffix = f"{start_year}_plus"
        else:
            suffix = f"up_to_{end_year}"
        output_dir = os.path.join(base_output_dir, suffix)

    os.makedirs(output_dir, exist_ok=True)

    # Clear only files in the chosen output directory
    if clear_old_files:
        for file in os.listdir(output_dir):
            file_path = os.path.join(output_dir, file)
            if os.path.isfile(file_path):
                os.remove(file_path)

    # Get unique states
    states = df['abbr'].unique()

    plt.style.use('dark_background')
    # No parametric fit function required; we'll use LOESS smoothing from statsmodels

    def create_figure_axes(include_deltas, merge_bottom: bool = True, figsize=(16, 6)):
        """Create figure and axes.
        If include_deltas is True and merge_bottom is True, return three axes (ax_line, ax_bar, ax_delta).
        If include_deltas is True and merge_bottom is False, return ax_delta as a tuple (ax_delta_left, ax_delta_right).
        Otherwise return (ax_line, ax_bar, None) with a 1x2 layout.
        """
        if include_deltas:
            fig = plt.figure(figsize=(16, 10))
            gs = fig.add_gridspec(2, 2, height_ratios=[1, 1])
            ax_line = fig.add_subplot(gs[0, 0])
            ax_bar = fig.add_subplot(gs[0, 1])
            if merge_bottom:
                ax_delta = fig.add_subplot(gs[1, :])
                return fig, (ax_line, ax_bar, ax_delta)
            else:
                ax_delta_left = fig.add_subplot(gs[1, 0])
                ax_delta_right = fig.add_subplot(gs[1, 1])
                return fig, (ax_line, ax_bar, (ax_delta_left, ax_delta_right))
        else:
            fig, axes = plt.subplots(1, 2, figsize=figsize)
            return fig, (axes[0], axes[1], None)


    def style_line_axis(ax, years, pres_margin, national_margin, state):
        pres_colors = ['deepskyblue' if m > 0 else 'red' for m in pres_margin]
        nat_colors = ['deepskyblue' if m > 0 else 'red' for m in national_margin]
        ax.plot(years, pres_margin, label='Presidential Margin', marker='o', linestyle='-', color='gray')
        ax.scatter(years, pres_margin, c=pres_colors, s=60, zorder=3, label='Pres Results')
        ax.plot(years, national_margin, label='National Margin', marker='o', color='gold')
        ax.scatter(years, national_margin, c=nat_colors, s=40, zorder=2, label='Nat Results')
        ax.set_title(f'{state} Presidential Margins')
        ax.set_xlabel('Year')
        ax.set_ylabel('Margin')
        y_vals = ax.get_yticks()
        ax.set_yticks(y_vals)
        ax.set_yticklabels([utils.lean_str(y_val) for y_val in y_vals], color='white')
        ax.legend()
        ax.grid(True, alpha=0.3)
        ax.axhline(0, color='red', linestyle='--', linewidth=1)
        ax.set_xticks(years)
        ax.set_xticklabels(years, rotation=45)
        return pres_colors


    def style_bar_axis(ax, x_indices, relative_margin, pres_colors, years, show_linear_fit: bool = False):
        # Optionally show a line of best fit
        if show_linear_fit:
            try:
                z = np.polyfit(x_indices, relative_margin, 1)
                p = np.poly1d(z)
                ax.plot(x_indices, p(x_indices), linestyle='--', color='yellow', label='Line of Best Fit')
            except Exception:
                pass

        bars = ax.bar(x_indices, relative_margin, width=0.4, label='Pres Relative Margin', color=pres_colors)
        ax.bar_label(bars, labels=[utils.lean_str(v) for v in relative_margin], padding=3, fontsize=8, color='white')
        ax.set_title(f'{state} Relative Margins')
        ax.set_xlabel('Year')
        ax.set_ylabel('Relative Margin')
        y_vals = ax.get_yticks()
        ax.set_yticks(y_vals)
        ax.set_yticklabels([utils.lean_str(y_val) if y_val != 0 else "NAT. MARGIN" for y_val in y_vals], color='white')
        ax.legend()
        ax.grid(True, alpha=0.3)
        ax.axhline(0, color='red', linestyle='--', linewidth=1)
        ax.set_xticks(x_indices)
        ax.set_xticklabels(years, rotation=45)


    def plot_delta_axis(ax, x_indices, deltas, years_for_delta):
        # x_indices and years_for_delta should align with deltas
        if len(deltas) == 0:
            ax.text(0.5, 0.5, 'No delta data', ha='center')
            return
        colors = ['deepskyblue' if d > 0 else 'red' for d in deltas]
        # Bars styled like the relative-margin bar plot
        bars = ax.bar(x_indices, deltas, width=0.4, label='Delta Relative Margin', color=colors)
        ax.bar_label(bars, labels=[utils.lean_str(v) for v in deltas], padding=3, fontsize=8, color='white')
        ax.set_title(f'{state} Change in Relative Margin')
        ax.set_xlabel('Year')
        ax.set_ylabel('Delta Relative Margin')
        y_vals = ax.get_yticks()
        ax.set_yticklabels([utils.lean_str(y_val) if y_val != 0 else "NAT. MARGIN" for y_val in y_vals], color='white')
        ax.legend()
        ax.grid(True, alpha=0.3)
        ax.axhline(0, color='red', linestyle='--', linewidth=1)
        ax.set_xticks(x_indices)
        ax.set_xticklabels(years_for_delta, rotation=45)

    # --- NATIONAL summary plot -------------------------------------------------
    # Create a left line plot of the raw national margins and a right bar plot of
    # the year-to-year deltas. Keep styling similar to the state plots and write
    # the file to the same `output_dir` as the state images.
    try:
        # Aggregate national margin by year (use mean in case of duplicates)
        national_series = df.groupby('year')['national_margin'].mean().sort_index()
        nat_deltas = np.diff(np.asarray(national_series.values))
        mask = None
        mask = np.ones(len(national_series), dtype=bool)  # Initialize mask as all True
        if start_year is not None:
            mask &= national_series.index.values >= start_year
        if end_year is not None:
            mask &= national_series.index.values <= end_year
        if mask is not None:
            national_series = national_series[mask]
            nat_deltas = nat_deltas[mask[1:]]  # Align deltas with filtered years
        nat_years = national_series.index.values
        nat_margins = national_series.values

        if len(nat_years) == 0:
            print('No national data available to plot.')
        else:
            # compute year-to-year deltas
            years_for_delta = nat_years[1:] if start_year is None else nat_years

            # create a simple 1x2 layout (line | bar)
            fig_n, (ax_n_line, ax_n_bar, _) = create_figure_axes(False, figsize=(12, 6))

            # Left: raw national margins (reuse style_line_axis by passing the same
            # series as both pres_margin and national_margin so labels/styles match)
            pres_colors_nat = style_line_axis(ax_n_line, nat_years, nat_margins, nat_margins, 'NATIONAL')

            # Right: bar plot of deltas only (styled similarly to delta plotting)
            if len(nat_deltas) == 0:
                ax_n_bar.text(0.5, 0.5, 'No delta data', ha='center')
            else:
                x_idx = np.arange(len(nat_deltas))
                colors = ['deepskyblue' if d > 0 else 'red' for d in nat_deltas]
                bars = ax_n_bar.bar(x_idx, nat_deltas, width=0.4, label='National Margin Delta', color=colors)
                ax_n_bar.bar_label(bars, labels=[utils.lean_str(v) for v in nat_deltas], padding=3, fontsize=8, color='white')
                ax_n_bar.set_title('Change in National Margin')
                ax_n_bar.set_xlabel('Year')
                ax_n_bar.set_ylabel('Delta')
                y_vals = ax_n_bar.get_yticks()
                ax_n_bar.set_yticks(y_vals)
                ax_n_bar.set_yticklabels([utils.lean_str(y_val) if y_val != 0 else '0' for y_val in y_vals], color='white')
                ax_n_bar.axhline(0, color='red', linestyle='--', linewidth=1)
                ax_n_bar.grid(True, alpha=0.3)
                ax_n_bar.set_xticks(x_idx)
                ax_n_bar.set_xticklabels(years_for_delta, rotation=45)

            plt.tight_layout()
            nat_filename = 'NATIONAL_trend.png'
            fig_n.savefig(os.path.join(output_dir, nat_filename))
            plt.close(fig_n)
            print(f'Wrote national summary plot to {os.path.join(output_dir, nat_filename)}')
    except Exception as e:
        print(f'Could not create NATIONAL plot: {e}')

    for state in states:
        state_df = df[df['abbr'] == state]
        # Apply start_year / end_year filters if provided
        if start_year is not None:
            state_df = state_df[state_df['year'] >= start_year]
        if end_year is not None:
            state_df = state_df[state_df['year'] <= end_year]

        # Skip states with no data in the requested range
        if state_df.empty:
            print(f"Skipping {state}: no data in requested year range")
            continue
        years = state_df['year']
        pres_margin = state_df['pres_margin']
        national_margin = state_df['national_margin']
        relative_margin = state_df['relative_margin']
        relative_margin_deltas = state_df['relative_margin_delta']
        pres_margin_deltas = state_df['pres_margin_delta']

        if plot_house_margins:
            house_state_df = house_df[house_df['abbr'] == state]
            house_years = house_state_df['year']
            house_margin = house_state_df['house_margin']
            house_national_margin = house_state_df['national_margin']
            house_relative_margin = house_state_df['relative_margin']
        # Create figure & axes using the centralized helper; prefer subplot styling
        if subplot_mode:
            fig, (ax_line, ax_bar, ax_delta) = create_figure_axes(include_deltas, merge_bottom=merge_delta_subplot)
        else:
            fig, (ax_line, ax_bar, ax_delta) = create_figure_axes(False, figsize=(10, 6))

        # Sort data by year for consistent plotting and fitting
        order = np.argsort(years.values)
        years_sorted = years.values[order]
        pres_sorted = pres_margin.values[order]
        nat_sorted = national_margin.values[order]
        rel_sorted = relative_margin.values[order]
        deltas_sorted = relative_margin_deltas.values[order]
        pres_deltas_sorted = pres_margin_deltas.values[order]

        # Line plot (top-left)
        pres_colors = style_line_axis(ax_line, years_sorted, pres_sorted, nat_sorted, state)

        # Bar plot (top-right)
        x_indices = np.arange(len(rel_sorted))
        style_bar_axis(ax_bar, x_indices, rel_sorted, pres_colors, years_sorted, show_linear_fit=use_linear)

        # Smoothing / comparison options: LOESS, spline
        if len(x_indices) >= loess_min_points:
            # Prepare dense x for plotting
            x_dense = np.linspace(x_indices.min(), x_indices.max(), 500)

            # LOESS
            if use_loess:
                try:
                    frac = 0.6 if len(x_indices) >= 8 else max(0.25, 3 / max(4, len(x_indices)))
                    loess_res = lowess(rel_sorted, x_indices, frac=frac, return_sorted=True)
                    x_loess = loess_res[:, 0]
                    y_loess = loess_res[:, 1]
                    y_dense_loess = np.interp(x_dense, x_loess, y_loess)
                    ax_bar.plot(x_dense, y_dense_loess, linestyle='--', color='cyan', label='LOESS')
                except Exception as e:
                    print(f"Could not compute LOESS for {state}: {e}")

            # Spline with optional regularization (s parameter)
            if use_spline:
                try:
                    # s=0 yields interpolation; larger s yields smoother curve. When
                    # regularization is requested, increase s proportional to n.
                    n = len(x_indices)
                    if spline_regularization:
                        s_val = max(1e-3, 0.5 * n)
                    else:
                        s_val = 0.0
                    spline = UnivariateSpline(x_indices, rel_sorted, s=s_val)
                    y_dense_spline = spline(x_dense)
                    ax_bar.plot(x_dense, y_dense_spline, linestyle='-.', color='magenta', label='Spline')
                except Exception as e:
                    print(f"Could not compute Spline for {state}: {e}")

            # Refresh legend so newly-added curves appear
            ax_bar.legend()
        else:
            print(f"Skipping smoothing for {state}: not enough points (need {loess_min_points}, have {len(x_indices)})")

        # Delta subplot handling (merged or separated) if requested
        if include_deltas and ax_delta is not None:
            # compute year-to-year deltas and skip placeholder zeros
            years_for_delta = years_sorted[1:] if deltas_sorted.size > 0 and deltas_sorted[0] == 0 else years_sorted
            # Align deltas with years_for_delta (years_for_delta may drop the first year)
            if len(years_for_delta) == len(deltas_sorted):
                rel_deltas_for_years = deltas_sorted
                pres_deltas_for_years = pres_deltas_sorted
            else:
                # assume years_for_delta == years_sorted[1:]
                rel_deltas_for_years = deltas_sorted[1:]
                pres_deltas_for_years = pres_deltas_sorted[1:]

            # Apply mask to drop placeholder zeros
            mask = rel_deltas_for_years != 0
            rel_deltas_filtered = rel_deltas_for_years[mask]
            pres_deltas_filtered = pres_deltas_for_years[mask]
            years_filtered = years_for_delta[mask]
            x_idx_delta = np.arange(len(rel_deltas_filtered))

            # If bottom delta axes are merged, ax_delta is a single axis
            if isinstance(ax_delta, tuple):
                ax_delta_left, ax_delta_right = ax_delta
                # left: pres_margin_delta
                colors_left = ['deepskyblue' if d > 0 else 'red' for d in pres_deltas_filtered]
                bars_l = ax_delta_left.bar(x_idx_delta, pres_deltas_filtered, width=0.4, color=colors_left)
                ax_delta_left.bar_label(bars_l, labels=[utils.lean_str(v) for v in pres_deltas_filtered], padding=3, fontsize=8, color='white')
                y_vals_left = ax_delta_left.get_yticks()
                ax_delta_left.set_yticks(y_vals_left)
                ax_delta_left.set_yticklabels([utils.lean_str(y_val) if y_val != 0 else '0' for y_val in y_vals_left], color='white')
                ax_delta_left.set_title(f'{state} Change in Presidential Margin')
                ax_delta_left.set_xticks(x_idx_delta)
                ax_delta_left.set_xticklabels(years_filtered, rotation=45)
                ax_delta_left.axhline(0, color='red', linestyle='--', linewidth=1)
                ax_delta_left.grid(True, alpha=0.3)

                # right: relative_margin_delta
                colors_right = ['deepskyblue' if d > 0 else 'red' for d in rel_deltas_filtered]
                bars_r = ax_delta_right.bar(x_idx_delta, rel_deltas_filtered, width=0.4, color=colors_right)
                ax_delta_right.bar_label(bars_r, labels=[utils.lean_str(v) for v in rel_deltas_filtered], padding=3, fontsize=8, color='white')
                y_vals_right = ax_delta_right.get_yticks()
                ax_delta_right.set_yticks(y_vals_right)
                ax_delta_right.set_yticklabels([utils.lean_str(y_val) if y_val != 0 else '0' for y_val in y_vals_right], color='white')
                ax_delta_right.set_title(f'{state} Change in Relative Margin')
                ax_delta_right.set_xticks(x_idx_delta)
                ax_delta_right.set_xticklabels(years_filtered, rotation=45)
                ax_delta_right.axhline(0, color='red', linestyle='--', linewidth=1)
                ax_delta_right.grid(True, alpha=0.3)
            else:
                # merged single axis: show relative margin delta (backwards-compatible)
                plot_delta_axis(ax_delta, x_idx_delta, rel_deltas_filtered, years_filtered)

        # Finalize and save
        plt.tight_layout()
        filename = f'{state}_trend.png'
        fig.savefig(os.path.join(output_dir, filename))
        print(f'Wrote {state} plot to {os.path.join(output_dir, filename)}')
        plt.close(fig)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Plot state trends with smoothing options')
    parser.add_argument('--start-year', type=int, default=None)
    parser.add_argument('--end-year', type=int, default=2024)
    parser.add_argument('--no-loess', dest='use_loess', action='store_false', help='Disable LOESS smoothing')
    parser.add_argument('--linear', dest='use_linear', action='store_true', help='Enable linear best-fit line')
    parser.add_argument('--no-spline', dest='use_spline', action='store_false', help='Disable spline smoothing')
    parser.add_argument('--no-spline-regularization', dest='spline_regularization', action='store_false', help='Disable spline regularization (use interpolation)')
    args = parser.parse_args()

    main(start_year=args.start_year, end_year=args.end_year, plot_house_margins=plot_house_margins,
         use_loess=args.use_loess, use_linear=args.use_linear,
         use_spline=args.use_spline, spline_regularization=args.spline_regularization)

    # main(start_year=2000, end_year=args.end_year, plot_house_margins=plot_house_margins,
    #      use_loess=args.use_loess, use_linear=args.use_linear,
    #      use_spline=args.use_spline, spline_regularization=args.spline_regularization)
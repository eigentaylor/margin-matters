"""
Run PCA across states for multiple metrics from presidential_margins.csv

For each metric (e.g., pres_margin, pres_margin_delta, relative_margin, etc.), this script:
  - pivots data to a matrix of Years x States
  - imputes missing values (per-state mean) and standardizes features (states)
  - fits PCA and saves:
	  * scree plot (with cumulative variance)
	  * component loadings (csv + text summary)
	  * time series plots of component scores
  - computes varimax-rotated components for k = 2..K and saves under pca/varimax/<metric>/k_components:
	  * rotated loadings (csv + text summary of extremes)
	  * rotated scores (csv) and time-series plot

Usage (from repo root):
  python -m pca.do_pca
Optional args:
  --metrics pres_margin relative_margin  (subset of metrics)
  --max-components 10                    (limit components)
  --top-n 10                             (top N states in text summaries)
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Tuple

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler

import matplotlib.pyplot as plt
import seaborn as sns


REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_CSV = REPO_ROOT / "presidential_margins.csv"
OUT_ROOT = REPO_ROOT / "pca"


def ensure_dir(p: Path) -> None:
	p.mkdir(parents=True, exist_ok=True)


def varimax(Phi: np.ndarray, gamma: float = 1.0, q: int = 50, tol: float = 1e-6) -> Tuple[np.ndarray, np.ndarray]:
	"""Orthogonal varimax rotation.

	Parameters
	----------
	Phi : array, shape (n_features, n_components)
		Loadings matrix (variables x components)
	gamma : float
		Kaiser normalization parameter; 1.0 for Varimax, 0.0 for Quartimax
	q : int
		Maximum number of iterations
	tol : float
		Convergence tolerance

	Returns
	-------
	(Phi_rot, R)
		Rotated loadings and the rotation matrix
	"""
	p, k = Phi.shape
	R = np.eye(k)
	d_old = 0.0
	for _ in range(q):
		Lambda = Phi @ R  # (p x k)
		u, s, vh = np.linalg.svd(
			Phi.T @ (Lambda ** 3 - (gamma / p) * Lambda @ np.diag(np.sum(Lambda ** 2, axis=0)))
		)
		R = u @ vh
		d = np.sum(s)
		if d_old != 0 and d - d_old < tol:
			break
		d_old = d
	return Phi @ R, R


@dataclass
class PcaResult:
	metric: str
	years: np.ndarray
	states: List[str]
	components: np.ndarray  # (k x p)
	scores: np.ndarray      # (n_years x k)
	explained_var_ratio: np.ndarray
	loadings: np.ndarray    # (p x k)


def pick_metrics(df: pd.DataFrame, selected: Iterable[str] | None) -> List[str]:
	# Prefer explicit, stable list
	default_metrics = [
		"pres_margin",
		"pres_margin_delta",
		"relative_margin",
		"relative_margin_delta",
		"two_party_margin",
		"two_party_margin_delta",
		"two_party_relative_margin",
		"two_party_relative_margin_delta",
		"third_party_share",
		"third_party_relative_share",
	]
	cols = set(df.columns)
	metrics = [m for m in default_metrics if m in cols]

	if selected:
		selected = list(selected)
		missing = [m for m in selected if m not in cols]
		if missing:
			raise ValueError(f"Requested metrics not in CSV: {missing}")
		metrics = [m for m in selected if m in metrics or m in cols]

	if not metrics:
		raise ValueError("No metrics found to analyze.")
	return metrics


def make_matrix(df: pd.DataFrame, metric: str) -> Tuple[np.ndarray, np.ndarray, List[str]]:
	# Exclude national row; keep all sub-state labels as distinct variables
	mask = (df["abbr"].astype(str).str.upper() != "NATIONAL") & (~df["abbr"].astype(str).str.contains('0'))
	sdf = df.loc[mask, ["year", "abbr", metric]].copy()
	pv = sdf.pivot(index="year", columns="abbr", values=metric).sort_index()
	years = pv.index.to_numpy()
	states = list(pv.columns.astype(str))
	X = pv.to_numpy(dtype=float)
	return X, years, states


def fit_pca(X: np.ndarray, max_components: int | None = None) -> Tuple[PCA, np.ndarray, np.ndarray]:
	# Impute per-feature (state) mean, then standardize features
	imputer = SimpleImputer(strategy="mean")
	X_imp = imputer.fit_transform(X)
	scaler = StandardScaler(with_mean=True, with_std=True)
	X_std = scaler.fit_transform(X_imp)

	n_years, n_states = X_std.shape
	n_comp = min(n_years, n_states)
	if max_components is not None:
		n_comp = min(n_comp, int(max_components))

	pca = PCA(n_components=n_comp, svd_solver="full")
	scores = pca.fit_transform(X_std)  # (n_years x k)
	# Loadings as correlations between variables and components (since X is standardized)
	# components_: (k x p). explained_variance_: (k,)
	loadings = (pca.components_.T * np.sqrt(pca.explained_variance_))  # (p x k)
	return pca, scores, loadings


def save_scree(metric_dir: Path, evr: np.ndarray, title: str) -> None:
	ensure_dir(metric_dir)
	plt.figure(figsize=(8, 5))
	idx = np.arange(1, len(evr) + 1)
	cum = np.cumsum(evr)
	plt.bar(idx, evr, color="#4C72B0", alpha=0.75, label="Individual")
	plt.plot(idx, cum, marker="o", color="#55A868", label="Cumulative")
	plt.xticks(idx)
	plt.yticks(np.arange(0, 1.05, 0.05))
	plt.xlabel("Principal Component")
	plt.ylabel("Variance Explained")
	plt.title(title)
	plt.legend()
	plt.tight_layout()
	plt.savefig(metric_dir / "scree.png", dpi=150)
	plt.close()


def save_loadings(metric_dir: Path, states: List[str], loadings: np.ndarray, top_n: int, prefix: str = "") -> None:
	ensure_dir(metric_dir)
	k = loadings.shape[1]
	cols = [f"PC{i+1}" for i in range(k)]
	df_load = pd.DataFrame(loadings, index=states, columns=cols)
	df_load.to_csv(metric_dir / f"{prefix}loadings.csv", index=True)

	# Text summary with top +/- contributors per component
	lines = []
	for i in range(k):
		comp = df_load.iloc[:, i].sort_values(ascending=False)
		pos = comp.head(top_n)
		neg = comp.tail(top_n)
		lines.append(f"Component {i+1}\nTop +{top_n}:\n{pos.to_string()}\nTop -{top_n}:\n{neg.to_string()}\n")
	(metric_dir / f"{prefix}loadings.txt").write_text("\n".join(lines), encoding="utf-8")


def save_scores_plot(metric_dir: Path, years: np.ndarray, scores: np.ndarray, n_plot: int = 5, prefix: str = "") -> None:
	ensure_dir(metric_dir)
	n_comp = scores.shape[1]
	m = min(n_plot, n_comp)
	plt.figure(figsize=(10, 6))
	for i in range(m):
		plt.plot(years, scores[:, i], label=f"PC{i+1}")
	plt.xlabel("Year")
	plt.xticks(years, rotation=45)
	plt.ylabel("Score")
	plt.title("Component scores over time")
	plt.legend(ncol=2)
	plt.tight_layout()
	plt.savefig(metric_dir / f"{prefix}scores_plot.png", dpi=150)
	plt.close()


def save_scores_csv(metric_dir: Path, years: np.ndarray, scores: np.ndarray, prefix: str = "") -> None:
	ensure_dir(metric_dir)
	cols = [f"PC{i+1}" for i in range(scores.shape[1])]
	df_scores = pd.DataFrame(scores, index=years, columns=cols)
	df_scores.index.name = "year"
	df_scores.to_csv(metric_dir / f"{prefix}scores.csv")


def save_loading_heatmap(metric_dir: Path, states: List[str], loadings: np.ndarray, prefix: str = "") -> None:
	ensure_dir(metric_dir)
	plt.figure(figsize=(max(8, loadings.shape[1] * 0.6), max(6, len(states) * 0.12)))
	df_load = pd.DataFrame(loadings, index=states, columns=[f"PC{i+1}" for i in range(loadings.shape[1])])
	sns.heatmap(df_load, cmap="coolwarm", center=0, cbar_kws={"label": "Loading"})
	plt.title("Component loadings (heatmap)")
	plt.tight_layout()
	plt.savefig(metric_dir / f"{prefix}loadings_heatmap.png", dpi=150)
	plt.close()


def do_metric(metric: str, df: pd.DataFrame, out_root: Path, max_components: int | None, top_n: int) -> None:
	print(f"Processing metric: {metric}")
	X, years, states = make_matrix(df, metric)
	pca, scores, loadings = fit_pca(X, max_components=max_components)
	evr = pca.explained_variance_ratio_

	# Save core PCA outputs
	metric_dir = out_root / "output" / metric
	ensure_dir(metric_dir)
	save_scree(metric_dir, evr, f"Scree plot – {metric}")
	save_loadings(metric_dir, states, loadings, top_n=top_n)
	save_scores_csv(metric_dir, years, scores)
	save_scores_plot(metric_dir, years, scores)
	save_loading_heatmap(metric_dir, states, loadings)

	# Varimax rotations for k = 2..K
	var_root = out_root / "varimax" / metric
	ensure_dir(var_root)

	full_k = pca.n_components_
	for k in range(2, full_k + 1):
		# Fit PCA with k components, then rotate
		pca_k = PCA(n_components=k, svd_solver="full")
		# Reuse same pre-processing as fit_pca
		imputer = SimpleImputer(strategy="mean")
		X_imp = imputer.fit_transform(X)
		scaler = StandardScaler(with_mean=True, with_std=True)
		X_std = scaler.fit_transform(X_imp)
		scores_k = pca_k.fit_transform(X_std)
		# Loadings: variables x components
		load_k = (pca_k.components_.T * np.sqrt(pca_k.explained_variance_))
		load_rot, R = varimax(load_k)
		# Rotate components and scores consistently
		comps_rot = (R.T @ pca_k.components_)  # (k x p)
		scores_rot = scores_k @ R  # (n_years x k)

		k_dir = var_root / f"{k}_components"
		ensure_dir(k_dir)

		# Save files
		(k_dir / "summary.txt").write_text(
			"\n".join([
				f"Metric: {metric}",
				f"Components (k): {k}",
				f"Explained variance (unrotated): {np.round(pca_k.explained_variance_ratio_, 6).tolist()}",
				f"Cumulative (unrotated): {np.round(np.cumsum(pca_k.explained_variance_ratio_), 6).tolist()}",
			]),
			encoding="utf-8",
		)

		save_loadings(k_dir, states, load_rot, top_n=top_n, prefix="rot_")
		save_scores_csv(k_dir, years, scores_rot, prefix="rot_")
		save_scores_plot(k_dir, years, scores_rot, n_plot=min(5, k), prefix="rot_")
		save_loading_heatmap(k_dir, states, load_rot, prefix="rot_")


def parse_args() -> argparse.Namespace:
	ap = argparse.ArgumentParser(description="PCA on presidential_margins metrics")
	ap.add_argument("--metrics", nargs="*", help="Subset of metrics to process")
	ap.add_argument("--max-components", type=int, default=None, help="Cap number of components")
	ap.add_argument("--top-n", type=int, default=10, help="Top N states to list in summaries")
	return ap.parse_args()


def main() -> None:
	args = parse_args()
	df = pd.read_csv(DATA_CSV)
	metrics = pick_metrics(df, args.metrics)

	for m in metrics:
		do_metric(m, df, OUT_ROOT, max_components=args.max_components, top_n=args.top_n)

	print("Done.")


if __name__ == "__main__":
	main()

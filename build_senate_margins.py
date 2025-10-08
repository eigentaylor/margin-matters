import csv
import json
import os
import shutil
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from params import COLORS
import utils


INFILE_RELATIVE = os.path.join("election_data", "wikipedia_senate", "wikipedia_senate_combined.csv")
OUTFILE = "senate_margins.csv"
DOCS_OUTFILE = os.path.join("docs", "senate_margins.csv")


def safe_int(value) -> int:
    """Convert a value to int, falling back to 0."""
    if value is None:
        return 0
    try:
        if isinstance(value, str) and value.strip() == "":
            return 0
        return int(float(value))
    except Exception:
        return 0


def classify_party(party_raw: Optional[str]) -> str:
    """Return 'D', 'R', or 'T' depending on the party string."""
    if not party_raw:
        return "T"
    party = party_raw.lower()
    if "dem" in party:
        return "D"
    if "rep" in party or "gop" in party:
        return "R"
    return "T"


def parse_results(raw_results: str) -> Dict[str, Dict[str, Optional[float]]]:
    """Parse the JSON results string into a dict."""
    if not raw_results:
        return {}
    try:
        parsed = json.loads(raw_results)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    # As a fallback, attempt to interpret as a Python literal
    try:
        import ast

        parsed = ast.literal_eval(raw_results)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return {}


def aggregate_vote_totals(results: Dict[str, Dict[str, Optional[float]]]) -> Tuple[int, int, int, Dict[str, Dict[str, Optional[float]]]]:
    """Return totals for D, R, and third-party votes along with per-candidate classification."""
    d_total = 0
    r_total = 0
    third_total = 0
    classified = {}

    for candidate, data in results.items():
        votes = safe_int(data.get("votes"))
        party_label = data.get("party") or ""
        bucket = classify_party(party_label)
        classified[candidate] = {
            "party": party_label,
            "votes": votes,
            "pct": data.get("pct"),
            "bucket": bucket,
        }
        if bucket == "D":
            d_total += votes
        elif bucket == "R":
            r_total += votes
        else:
            third_total += votes

    return d_total, r_total, third_total, classified


def top_candidate_in_bucket(classified: Dict[str, Dict[str, Optional[float]]], bucket: str) -> Tuple[str, int, Optional[str]]:
    best_name = "None"
    best_votes = 0
    best_party_label: Optional[str] = None
    for candidate, data in classified.items():
        if data.get("bucket") != bucket:
            continue
        votes = safe_int(data.get("votes"))
        if votes > best_votes:
            best_votes = votes
            best_name = candidate
            best_party_label = data.get("party")
    return best_name, best_votes, best_party_label


def compute_winner(classified: Dict[str, Dict[str, Optional[float]]], total_votes: int) -> Tuple[str, str]:
    winner_name = ""
    winner_votes = -1
    winner_bucket = "T"
    for candidate, data in classified.items():
        votes = safe_int(data.get("votes"))
        if votes > winner_votes:
            winner_votes = votes
            winner_name = candidate
            winner_bucket = data.get("bucket") or "T"
    if winner_votes <= 0 and total_votes > 0:
        # if no winner identified but votes exist, default to tie -> treat as third party for color fallbacks
        winner_bucket = "T"
    return winner_name, winner_bucket


def build_base_entries(rows: List[Dict[str, str]]) -> List[Dict[str, object]]:
    entries = []
    for row in rows:
        year = safe_int(row.get("year"))
        state = row.get("state") or ""
        abbr = row.get("abbr") or ""
        race_class = row.get("class") or ""
        race_type = row.get("race_type") or "regular"
        round_label = row.get("round") or "General"
        caption = row.get("caption") or ""
        source_url = row.get("source_url") or ""
        total_votes = safe_int(row.get("total_votes"))
        raw_results = row.get("results") or ""

        parsed_results = parse_results(raw_results)
        d_total, r_total, third_total, classified = aggregate_vote_totals(parsed_results)
        top_d_name, top_d_votes, _ = top_candidate_in_bucket(classified, "D")
        top_r_name, top_r_votes, _ = top_candidate_in_bucket(classified, "R")

        top_third_name, top_third_votes, top_third_party = top_candidate_in_bucket(classified, "T")

        winner_name, winner_bucket = compute_winner(classified, total_votes)
        runner_up = row.get("runner_up") or ""

        entry = {
            "year": year,
            "state": state,
            "abbr": abbr,
            "class": race_class,
            "race_type": race_type,
            "round": round_label,
            "caption": caption,
            "source_url": source_url,
            "total_votes": total_votes,
            "D_votes": d_total,
            "R_votes": r_total,
            "T_votes": third_total,
            "D_candidate": top_d_name,
            "R_candidate": top_r_name,
            "winner": winner_name or (row.get("winner") or ""),
            "runner_up": runner_up,
            "winner_bucket": winner_bucket,
            "classified_results": classified,
            "raw_results": parsed_results,
            "top_third_party": top_third_name if top_third_name != "None" else "None",
            "top_third_party_votes": top_third_votes,
            "top_third_party_label": top_third_party or "",
        }

        entries.append(entry)
    return entries


def compute_national_stats(entries: List[Dict[str, object]]) -> Dict[int, Dict[str, float]]:
    stats: Dict[int, Dict[str, float]] = {}
    grouped: Dict[int, List[Dict[str, object]]] = defaultdict(list)
    for entry in entries:
        grouped[entry["year"]].append(entry)

    years_sorted = sorted(grouped.keys())
    prev_year = None
    for year in years_sorted:
        lst = grouped[year]
        d_sum = sum(e["D_votes"] for e in lst)
        r_sum = sum(e["R_votes"] for e in lst)
        t_sum = sum(e["T_votes"] for e in lst)
        total_sum = sum(e["total_votes"] for e in lst) or 1

        sen_margin = (d_sum - r_sum) / total_sum if total_sum else 0.0
        two_party_total = d_sum + r_sum
        two_party_margin = (d_sum - r_sum) / two_party_total if two_party_total else 0.0
        third_party_share = t_sum / total_sum if total_sum else 0.0

        stats[year] = {
            "D_votes": d_sum,
            "R_votes": r_sum,
            "T_votes": t_sum,
            "total_votes": total_sum,
            "margin": sen_margin,
            "two_party_margin": two_party_margin,
            "third_party_share": third_party_share,
            "prev_year": prev_year,
        }
        prev_year = year
    return stats


def enrich_entries(entries: List[Dict[str, object]], national_stats: Dict[int, Dict[str, float]]) -> None:
    years_sorted = sorted(national_stats.keys())
    prev_national = {year: national_stats[national_stats[year]["prev_year"]]["margin"] if national_stats[year]["prev_year"] is not None else None for year in years_sorted}
    prev_two_party_national = {year: national_stats[national_stats[year]["prev_year"]]["two_party_margin"] if national_stats[year]["prev_year"] is not None else None for year in years_sorted}

    for entry in entries:
        year = entry["year"]
        total_votes = entry.get("total_votes", 0) or 0
        d_votes = entry.get("D_votes", 0) or 0
        r_votes = entry.get("R_votes", 0) or 0
        t_votes = entry.get("T_votes", 0) or 0
        top_third_votes = entry.get("top_third_party_votes", 0) or 0

        total_votes = total_votes or (d_votes + r_votes + t_votes)
        total_votes = total_votes or 1

        entry["total_votes"] = total_votes

        d_share = d_votes / total_votes if total_votes else 0.0
        r_share = r_votes / total_votes if total_votes else 0.0
        third_share = t_votes / total_votes if total_votes else 0.0
        top_third_share = top_third_votes / total_votes if total_votes else 0.0

        entry["D_share"] = d_share
        entry["R_share"] = r_share
        entry["third_party_share"] = third_share
        entry["top_third_party_share"] = top_third_share
        entry["third_party_votes"] = t_votes

        sen_margin_val = (d_votes - r_votes) / total_votes if total_votes else 0.0
        entry["sen_margin_val"] = sen_margin_val

        two_party_total = d_votes + r_votes
        two_party_margin = (d_votes - r_votes) / two_party_total if two_party_total else 0.0
        entry["two_party_margin"] = two_party_margin

        national = national_stats.get(year) or {"margin": 0.0, "two_party_margin": 0.0, "third_party_share": 0.0}
        entry["national_margin_val"] = national["margin"]
        entry["two_party_national_margin"] = national["two_party_margin"]
        entry["third_party_national_share"] = national["third_party_share"]

        relative_margin_val = sen_margin_val - national["margin"]
        entry["relative_margin_val"] = relative_margin_val

        two_party_relative_margin = two_party_margin - national["two_party_margin"]
        entry["two_party_relative_margin"] = two_party_relative_margin

        third_party_relative_share = third_share - national["third_party_share"]
        entry["third_party_relative_share"] = third_party_relative_share

        prev_year = national.get("prev_year")
        entry["national_margin_delta_val"] = (national["margin"] - prev_national[year]) if prev_national.get(year) is not None else None
        entry["two_party_national_margin_delta"] = (national["two_party_margin"] - prev_two_party_national[year]) if prev_two_party_national.get(year) is not None else None

        top_third_party_details = {
            name: {
                "party": data.get("party"),
                "votes": data.get("votes"),
                "pct": data.get("pct"),
            }
            for name, data in entry["classified_results"].items()
            if data.get("bucket") == "T"
        }
        entry["third_party_results"] = json.dumps(top_third_party_details, ensure_ascii=False)
        entry["results_json"] = json.dumps(entry["raw_results"], ensure_ascii=False)

        # Assign colors
        winner_bucket = entry.get("winner_bucket")
        entry["winner_party"] = winner_bucket
        entry["color"] = COLORS.get(winner_bucket, "transparent")

        entry["special_case_notes"] = "Special election" if (entry.get("race_type") == "special") else ""

        entry["top_third_party_share_str"] = utils.lean_str(top_third_share, third_party=True)
        entry["third_party_share_str"] = utils.lean_str(third_share, third_party=True)
        entry["third_party_national_share_str"] = utils.lean_str(national["third_party_share"], third_party=True)
        entry["third_party_relative_share_str"] = utils.lean_str(third_party_relative_share, third_party=True)

    # Compute deltas per seat
    grouped_keys: Dict[Tuple[str, str], List[Dict[str, object]]] = defaultdict(list)
    for entry in entries:
        key = (entry.get("abbr"), entry.get("class") or "Unknown")
        grouped_keys[key].append(entry)

    for key, lst in grouped_keys.items():
        lst.sort(key=lambda e: (e.get("year", 0), e.get("race_type"), e.get("round")))
        prev_entry = None
        for entry in lst:
            if prev_entry is None:
                entry["D_delta"] = 0
                entry["R_delta"] = 0
                entry["total_delta"] = 0
                entry["sen_margin_delta_val"] = None
                entry["relative_margin_delta_val"] = None
                entry["two_party_margin_delta_val"] = None
                entry["two_party_relative_margin_delta_val"] = None
            else:
                entry["D_delta"] = entry["D_votes"] - prev_entry["D_votes"]
                entry["R_delta"] = entry["R_votes"] - prev_entry["R_votes"]
                entry["total_delta"] = entry["total_votes"] - prev_entry["total_votes"]
                entry["sen_margin_delta_val"] = entry["sen_margin_val"] - prev_entry["sen_margin_val"]
                entry["relative_margin_delta_val"] = entry["relative_margin_val"] - prev_entry["relative_margin_val"]
                entry["two_party_margin_delta_val"] = entry["two_party_margin"] - prev_entry["two_party_margin"]
                entry["two_party_relative_margin_delta_val"] = entry["two_party_relative_margin"] - prev_entry["two_party_relative_margin"]
            prev_entry = entry


def build_national_entries(national_stats: Dict[int, Dict[str, float]]) -> List[Dict[str, object]]:
    national_rows: List[Dict[str, object]] = []
    years_sorted = sorted(national_stats.keys())
    prev_stats: Optional[Dict[str, float]] = None
    for year in years_sorted:
        stats = national_stats[year]
        d_votes = stats["D_votes"]
        r_votes = stats["R_votes"]
        t_votes = stats["T_votes"]
        total_votes = stats["total_votes"]

        sen_margin = stats["margin"]
        two_party_margin = stats["two_party_margin"]
        third_party_share = stats["third_party_share"]

        sen_margin_delta_val = None
        two_party_margin_delta_val = None
        third_party_relative_share = 0.0
        if prev_stats is not None:
            sen_margin_delta_val = sen_margin - prev_stats["margin"]
            two_party_margin_delta_val = two_party_margin - prev_stats["two_party_margin"]
        national_rows.append({
            "year": year,
            "state": "United States",
            "abbr": "NATIONAL",
            "class": "",
            "race_type": "national",
            "round": "Aggregate",
            "caption": "National aggregate",
            "source_url": "",
            "total_votes": total_votes,
            "D_votes": d_votes,
            "R_votes": r_votes,
            "T_votes": t_votes,
            "D_share": d_votes / total_votes if total_votes else 0.0,
            "R_share": r_votes / total_votes if total_votes else 0.0,
            "third_party_share": third_party_share,
            "top_third_party_share": 0.0,
            "third_party_votes": t_votes,
            "sen_margin_val": sen_margin,
            "relative_margin_val": 0.0,
            "two_party_margin": two_party_margin,
            "two_party_relative_margin": 0.0,
            "third_party_relative_share": third_party_relative_share,
            "D_delta": (d_votes - prev_stats["D_votes"]) if prev_stats else 0,
            "R_delta": (r_votes - prev_stats["R_votes"]) if prev_stats else 0,
            "total_delta": (total_votes - prev_stats["total_votes"]) if prev_stats else 0,
            "sen_margin_delta_val": sen_margin_delta_val,
            "relative_margin_delta_val": 0.0 if prev_stats else None,
            "two_party_margin_delta_val": two_party_margin_delta_val,
            "two_party_relative_margin_delta_val": 0.0 if prev_stats else None,
            "national_margin_val": sen_margin,
            "two_party_national_margin": two_party_margin,
            "third_party_national_share": third_party_share,
            "national_margin_delta_val": sen_margin_delta_val,
            "two_party_national_margin_delta": two_party_margin_delta_val,
            "winner": "Democratic Party" if sen_margin > 0 else ("Republican Party" if sen_margin < 0 else "Split"),
            "runner_up": "Republican Party" if sen_margin > 0 else ("Democratic Party" if sen_margin < 0 else "Split"),
            "winner_bucket": "D" if sen_margin > 0 else ("R" if sen_margin < 0 else "T"),
            "D_candidate": "Democratic total",
            "R_candidate": "Republican total",
            "top_third_party": "Various",
            "top_third_party_votes": 0,
            "top_third_party_label": "",
            "third_party_results": json.dumps({}, ensure_ascii=False),
            "results_json": json.dumps({}, ensure_ascii=False),
            "special_case_notes": "",
        })
        prev_stats = stats
    return national_rows


def format_entry(entry: Dict[str, object]) -> Dict[str, object]:
    sen_margin_val = entry.get("sen_margin_val", 0.0) or 0.0
    sen_margin_delta_val = entry.get("sen_margin_delta_val")
    national_margin_val = entry.get("national_margin_val", 0.0) or 0.0
    national_margin_delta_val = entry.get("national_margin_delta_val")
    relative_margin_val = entry.get("relative_margin_val", 0.0) or 0.0
    relative_margin_delta_val = entry.get("relative_margin_delta_val")
    two_party_margin_val = entry.get("two_party_margin", 0.0) or 0.0
    two_party_margin_delta_val = entry.get("two_party_margin_delta_val")
    two_party_national_margin_val = entry.get("two_party_national_margin", 0.0) or 0.0
    two_party_national_margin_delta_val = entry.get("two_party_national_margin_delta")
    two_party_relative_margin_val = entry.get("two_party_relative_margin", 0.0) or 0.0
    two_party_relative_margin_delta_val = entry.get("two_party_relative_margin_delta_val")

    formatted = {
        "year": entry.get("year"),
        "state": entry.get("state", ""),
        "abbr": entry.get("abbr", ""),
        "class": entry.get("class", ""),
        "race_type": entry.get("race_type", ""),
        "round": entry.get("round", ""),
        "caption": entry.get("caption", ""),
        "D_votes": entry.get("D_votes", 0),
        "R_votes": entry.get("R_votes", 0),
        "T_votes": entry.get("T_votes", 0),
        "D_share": entry.get("D_share", 0.0),
        "R_share": entry.get("R_share", 0.0),
        "D_candidate": entry.get("D_candidate", "None"),
        "R_candidate": entry.get("R_candidate", "None"),
        "winner": entry.get("winner", ""),
        "winner_party": entry.get("winner_party", entry.get("winner_bucket", "T")),
        "runner_up": entry.get("runner_up", ""),
        "top_third_party_share": entry.get("top_third_party_share", 0.0),
        "top_third_party": entry.get("top_third_party", "None"),
        "third_party_votes": entry.get("third_party_votes", entry.get("T_votes", 0)),
        "total_votes": entry.get("total_votes", 0),
        "third_party_results": entry.get("third_party_results", json.dumps({}, ensure_ascii=False)),
        "D_delta": entry.get("D_delta", 0),
        "R_delta": entry.get("R_delta", 0),
        "total_delta": entry.get("total_delta", 0),
        "sen_margin": f"{sen_margin_val:.12f}",
        "sen_margin_delta": f"{sen_margin_delta_val:.12f}" if sen_margin_delta_val is not None else "0",
        "national_margin": f"{national_margin_val:.12f}",
        "national_margin_delta": f"{national_margin_delta_val:.12f}" if national_margin_delta_val is not None else "0",
        "relative_margin": f"{relative_margin_val:.12f}",
        "relative_margin_delta": f"{relative_margin_delta_val:.12f}" if relative_margin_delta_val is not None else "0",
        "third_party_share": entry.get("third_party_share", 0.0),
        "third_party_national_share": entry.get("third_party_national_share", 0.0),
        "third_party_relative_share": entry.get("third_party_relative_share", 0.0),
        "two_party_margin": two_party_margin_val,
        "two_party_margin_delta": two_party_margin_delta_val if two_party_margin_delta_val is not None else 0.0,
        "two_party_national_margin": two_party_national_margin_val,
        "two_party_national_margin_delta": two_party_national_margin_delta_val if two_party_national_margin_delta_val is not None else 0.0,
        "two_party_relative_margin": two_party_relative_margin_val,
        "two_party_relative_margin_delta": two_party_relative_margin_delta_val if two_party_relative_margin_delta_val is not None else 0.0,
        "color": entry.get("color", "transparent"),
        "sen_margin_str": utils.lean_str(sen_margin_val),
        "sen_margin_delta_str": utils.lean_str(sen_margin_delta_val),
        "national_margin_str": utils.lean_str(national_margin_val),
        "national_margin_delta_str": utils.lean_str(national_margin_delta_val),
        "relative_margin_str": utils.lean_str(relative_margin_val),
        "relative_margin_delta_str": utils.lean_str(relative_margin_delta_val),
        "top_third_party_share_str": entry.get("top_third_party_share_str", utils.lean_str(entry.get("top_third_party_share", 0.0), third_party=True)),
        "third_party_share_str": entry.get("third_party_share_str", utils.lean_str(entry.get("third_party_share", 0.0), third_party=True)),
        "third_party_national_share_str": entry.get("third_party_national_share_str", utils.lean_str(entry.get("third_party_national_share", 0.0), third_party=True)),
        "third_party_relative_share_str": entry.get("third_party_relative_share_str", utils.lean_str(entry.get("third_party_relative_share", 0.0), third_party=True)),
        "two_party_margin_str": utils.lean_str(two_party_margin_val),
        "two_party_margin_delta_str": utils.lean_str(two_party_margin_delta_val),
        "two_party_national_margin_str": utils.lean_str(two_party_national_margin_val),
        "two_party_national_margin_delta_str": utils.lean_str(two_party_national_margin_delta_val),
        "two_party_relative_margin_str": utils.lean_str(two_party_relative_margin_val),
        "two_party_relative_margin_delta_str": utils.lean_str(two_party_relative_margin_delta_val),
        "top_third_party_votes": entry.get("top_third_party_votes", 0),
        "special_case_notes": entry.get("special_case_notes", ""),
        "source_url": entry.get("source_url", ""),
        "results_json": entry.get("results_json", json.dumps({}, ensure_ascii=False)),
    }
    return formatted


def write_output(entries: List[Dict[str, object]], national_rows: List[Dict[str, object]], outfile_path: str) -> None:
    years_sorted = sorted({e["year"] for e in entries})
    entries_by_year: Dict[int, List[Dict[str, object]]] = defaultdict(list)
    for entry in entries:
        entries_by_year[entry["year"]].append(entry)

    national_by_year = {row["year"]: row for row in national_rows}

    fieldnames = [
        "year",
        "state",
        "abbr",
        "class",
        "race_type",
        "round",
        "caption",
        "D_votes",
        "R_votes",
        "T_votes",
        "D_share",
        "R_share",
        "D_candidate",
        "R_candidate",
        "winner",
        "winner_party",
        "runner_up",
        "top_third_party_share",
        "top_third_party",
        "third_party_votes",
        "total_votes",
        "third_party_results",
        "D_delta",
        "R_delta",
        "total_delta",
        "sen_margin",
        "sen_margin_delta",
        "national_margin",
        "national_margin_delta",
        "relative_margin",
        "relative_margin_delta",
        "third_party_share",
        "third_party_national_share",
        "third_party_relative_share",
        "two_party_margin",
        "two_party_margin_delta",
        "two_party_national_margin",
        "two_party_national_margin_delta",
        "two_party_relative_margin",
        "two_party_relative_margin_delta",
        "color",
        "sen_margin_str",
        "sen_margin_delta_str",
        "national_margin_str",
        "national_margin_delta_str",
        "relative_margin_str",
        "relative_margin_delta_str",
        "top_third_party_share_str",
        "third_party_share_str",
        "third_party_national_share_str",
        "third_party_relative_share_str",
        "two_party_margin_str",
        "two_party_margin_delta_str",
        "two_party_national_margin_str",
        "two_party_national_margin_delta_str",
        "two_party_relative_margin_str",
        "two_party_relative_margin_delta_str",
        "top_third_party_votes",
        "special_case_notes",
        "source_url",
        "results_json",
    ]

    with open(outfile_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for year in years_sorted:
            national_row = national_by_year.get(year)
            if national_row:
                writer.writerow(format_entry(national_row))
            for entry in sorted(entries_by_year[year], key=lambda e: (e.get("abbr") or "", e.get("class") or "", e.get("race_type") or "")):
                writer.writerow(format_entry(entry))


def main() -> None:
    root = os.path.dirname(__file__)
    infile = os.path.join(root, INFILE_RELATIVE)
    outfile_path = os.path.join(root, OUTFILE)
    docs_outfile_path = os.path.join(root, DOCS_OUTFILE)

    if not os.path.exists(infile):
        raise FileNotFoundError(f"Input file not found: {infile}")

    with open(infile, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)

    entries = build_base_entries(rows)
    national_stats = compute_national_stats(entries)
    enrich_entries(entries, national_stats)
    national_rows = build_national_entries(national_stats)

    write_output(entries, national_rows, outfile_path)
    print(f"Wrote {len(entries) + len(national_rows)} rows to {outfile_path}")

    try:
        os.makedirs(os.path.dirname(docs_outfile_path), exist_ok=True)
        shutil.copy2(outfile_path, docs_outfile_path)
        print(f"Copied output to {docs_outfile_path}")
    except Exception as exc:
        print(f"Warning: unable to copy to docs output: {exc}")


if __name__ == "__main__":
    main()

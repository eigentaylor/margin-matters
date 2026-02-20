import json
import shutil
import re
from pathlib import Path

import params
from .config import CSV_PATH, SENATE_CSV_PATH, OUT_DIR, PLOTS_DST, PLOTS_SRC, LAST_UPDATED
from .io_utils import ensure_dirs, write_text, read_csv
from .pages import build_pages, make_data_page
from .templates import FAVICON_SVG
from .changelog import compile_changelog

def build_site():
    ensure_dirs()
    #write_text(OUT_DIR / "styles.css", BASE_CSS) # we now edit styles.css directly
    write_text(OUT_DIR / "favicon.svg", FAVICON_SVG)
    
    # Generate last-updated.json file with current timestamp
    last_updated_data = {"lastUpdated": LAST_UPDATED}
    write_text(OUT_DIR / "last-updated.json", json.dumps(last_updated_data, indent=2))

    if PLOTS_SRC.exists() and PLOTS_SRC.is_dir():
        PLOTS_DST.mkdir(parents=True, exist_ok=True)
        for item in PLOTS_SRC.iterdir():
            if item.is_file():
                shutil.copy2(item, PLOTS_DST / item.name)

    rows = read_csv(CSV_PATH)
    if params.INCLUDE_SENATE:
        try:
            senate_rows = read_csv(SENATE_CSV_PATH)
        except FileNotFoundError:
            senate_rows = []
    else:
        senate_rows = []

    senate_abbr_remap = {
        "ME": "ME-AL",
        "NE": "NE-AL",
    }
    for row in senate_rows:
        abbr = str(row.get("abbr", "")).upper()
        if abbr in senate_abbr_remap:
            row["abbr"] = senate_abbr_remap[abbr]
    
    # Add computed margin_breakdown column to each row
    for row in rows:
        d_share = row.get("D_share", None)
        r_share = row.get("R_share", None)
        third_share = row.get("top_third_party_share", None)
        
        if d_share is not None and r_share is not None:
            try:
                d_pct = float(d_share) * 100
                r_pct = float(r_share) * 100
                if third_share is not None:
                    third_pct = float(third_share) * 100
                else:
                    third_pct = 0.0
                row["margin_breakdown"] = f"({d_pct:.1f}%, {r_pct:.1f}%, {third_pct:.1f}%)"
            except (ValueError, TypeError):
                row["margin_breakdown"] = ""
        else:
            row["margin_breakdown"] = ""

    for row in senate_rows:
        d_share = row.get("D_share", None)
        r_share = row.get("R_share", None)
        third_share = row.get("top_third_party_share", None)
        try:
            d_pct = float(d_share) * 100 if d_share is not None else None
            r_pct = float(r_share) * 100 if r_share is not None else None
            third_pct = float(third_share) * 100 if third_share is not None else 0.0
            if d_pct is not None and r_pct is not None:
                row["margin_breakdown"] = f"({d_pct:.1f}%, {r_pct:.1f}%, {third_pct:.1f}%)"
            else:
                row["margin_breakdown"] = ""
        except (ValueError, TypeError):
            row["margin_breakdown"] = ""
    
    states = build_pages(rows, senate_rows)
    # # Build State Pages index
    # try:
    #     make_state_pages(states)
    # except Exception as e:
    #     print(f"Warning: couldn't build state-pages.html: {e}")

    try:
        shutil.copy2(CSV_PATH, OUT_DIR / "presidential_margins.csv")
    except Exception:
        pass

    if params.INCLUDE_SENATE and senate_rows:
        try:
            shutil.copy2(SENATE_CSV_PATH, OUT_DIR / "senate_margins.csv")
        except Exception:
            pass

    try:
        make_data_page(rows)
    except Exception:
        pass
    
    # Build changelog page
    try:
        compile_changelog()
    except Exception as e:
        print(f"Warning: couldn't build changelog page: {e}")

    # Build methods page
    # try:
    #     make_methods_page()
    # except Exception as e:
    #     print(f"Warning: couldn't build methods page: {e}")

    # Build or update index.html
    # try:
    #     make_index(states, rows, start_year=1912)
    # except Exception as e:
    #     print(f"Warning: couldn't build index.html: {e}")

    # Post-process static pages that aren't generated to keep header/footer in sync
    # NOTE: This section is now deprecated since we're using dynamic JS loading for header/footer/back-to-map
    # The _update_static function and its calls have been disabled to eliminate the arduous update process
    # Static HTML files now use placeholders that are filled in by header.js, footer.js, and back-to-map.js
    print("Skipping _update_static calls - using dynamic JS loading instead")

    # Ranker page is no longer built by the pipeline; maintain it separately.

    # Removed building tester.js from pipeline; edit docs/tester.js directly when needed.

    print(f"Done. Updated site. Output in {OUT_DIR}")

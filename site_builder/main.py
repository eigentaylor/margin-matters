import json
import shutil
from pathlib import Path

import params
from .config import CSV_PATH, OUT_DIR, STATE_DIR, UNIT_DIR, PLOTS_DST, PLOTS_SRC, LAST_UPDATED
from .io_utils import ensure_dirs, write_text, read_csv
from .pages import build_pages, make_index, make_data_page
from .templates import BASE_CSS, FAVICON_SVG, TESTER_JS
from .ranker import build_ranker_page


def build_site():
    ensure_dirs()
    write_text(OUT_DIR / "styles.css", BASE_CSS)
    write_text(OUT_DIR / "favicon.svg", FAVICON_SVG)

    if PLOTS_SRC.exists() and PLOTS_SRC.is_dir():
        PLOTS_DST.mkdir(parents=True, exist_ok=True)
        for item in PLOTS_SRC.iterdir():
            if item.is_file():
                shutil.copy2(item, PLOTS_DST / item.name)

    rows = read_csv(CSV_PATH)
    states = build_pages(rows)
    make_index(states, rows)

    try:
        shutil.copy2(CSV_PATH, OUT_DIR / "presidential_margins.csv")
    except Exception:
        pass

    try:
        make_data_page(rows)
    except Exception:
        pass

    # Build the ranker page with consistent header/styling
    try:
        build_ranker_page(rows)
    except Exception as e:
        print(f"Warning: couldn't build ranker page: {e}")

    # Removed building tester.js from pipeline; edit docs/tester.js directly when needed.

    print(f"Done. Open {OUT_DIR/'index.html'} in a browser or deploy /docs to GitHub Pages.")

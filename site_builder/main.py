import json
import shutil
import re
from pathlib import Path

from .config import CSV_PATH, OUT_DIR, STATE_DIR, UNIT_DIR, PLOTS_DST, PLOTS_SRC, LAST_UPDATED
from .io_utils import ensure_dirs, write_text, read_csv
from .pages import build_pages, make_data_page, make_methods_page, make_state_pages, make_index
from .templates import BASE_CSS, FAVICON_SVG, TESTER_JS
from .ranker import build_ranker_page
from .header import make_header


def build_site():
    ensure_dirs()
    #write_text(OUT_DIR / "styles.css", BASE_CSS) # we now edit styles.css directly
    write_text(OUT_DIR / "favicon.svg", FAVICON_SVG)

    if PLOTS_SRC.exists() and PLOTS_SRC.is_dir():
        PLOTS_DST.mkdir(parents=True, exist_ok=True)
        for item in PLOTS_SRC.iterdir():
            if item.is_file():
                shutil.copy2(item, PLOTS_DST / item.name)

    rows = read_csv(CSV_PATH)
    states = build_pages(rows)
    # Build State Pages index
    try:
        make_state_pages(states)
    except Exception as e:
        print(f"Warning: couldn't build state-pages.html: {e}")

    try:
        shutil.copy2(CSV_PATH, OUT_DIR / "presidential_margins.csv")
    except Exception:
        pass

    try:
        make_data_page(rows)
    except Exception:
        pass

    # Build methods page
    try:
        make_methods_page()
    except Exception as e:
        print(f"Warning: couldn't build methods page: {e}")

    # Update existing docs/index.html header/footer instead of rebuilding full file
    try:
        idx_path = OUT_DIR / 'index.html'
        if idx_path.exists():
            try:
                txt = idx_path.read_text(encoding='utf-8')
            except Exception:
                txt = ''
            # Build fresh header HTML to extract the small-links nav and legend title
            # Determine year range for legend from CSV rows
            min_year = None
            max_year = None
            for r in rows:
                try:
                    y = int(r.get('year', 0))
                except Exception:
                    continue
                if min_year is None or y < min_year:
                    min_year = y
                if max_year is None or y > max_year:
                    max_year = y
            if min_year is None:
                min_year = 1916
            if max_year is None:
                max_year = 2024
            year_range = f"{min_year}-{max_year}"
            print(f"Debug: index.html year range {year_range} from data")

            hdr_full = make_header(f"U.S. Presidential Election State Results {year_range}", is_inner=False)
            # Extract small-links inner HTML
            nav_inner = ''
            m = re.search(r'<div class="small-links">([\s\S]*?)</div>', hdr_full)
            if m:
                nav_inner = m.group(1)
            if nav_inner:
                txt = re.sub(r'(<div class="small-links">)([\s\S]*?)(</div>)', r'\1' + nav_inner + r'\3', txt, count=1)
            # Replace the header legend text content (keep surrounding markup)
            txt = re.sub(r'(<div class="legend">)U\.S\. Presidential Election State Results[\s\S]*?(</div>)', rf'\1U.S. Presidential Election State Results {year_range}\2', txt, count=1)
            # Replace the main H1 to match year range
            txt = re.sub(r'(<h1>)U\.S\. Presidential Election State Results[\s\S]*?(</h1>)', rf'\1U.S. Presidential Election State Results {year_range}\2', txt, count=1)
            # Ensure footer includes updated Last updated timestamp
            txt = re.sub(r'(Last updated:\s*)([0-9\-:\sA-Z]+)', rf'\g<1>{LAST_UPDATED}', txt, count=1)
            # set the correct min year on the year slider
            # <input id="yearSlider" type="range" min="1912" max="2024" step="4" value="2024" style="flex:1;min-width:120px;" />
            txt = re.sub(r'(<input id="yearSlider" type="range" min=")([0-9]+)(" max="2024")', rf'\g<1>{min_year}\3', txt, count=1)
            try:
                idx_path.write_text(txt, encoding='utf-8')
            except Exception:
                pass
        else:
            # If index.html is missing, fall back to building it from template
            try:
                make_index(states, rows, start_year=1912)
            except Exception as e:
                print(f"Warning: couldn't build index.html (fallback): {e}")
    except Exception as e:
        print(f"Warning: couldn't update index.html header/footer: {e}")

    # Post-process static pages that aren't generated to keep header/footer in sync
    try:
        def _update_static(path: Path, title: str):
            if not path.exists():
                return
            try:
                txt = path.read_text(encoding='utf-8')
            except Exception:
                return
            # Build canonical header pieces
            hdr = make_header(title, is_inner=False)
            # Extract small-links inner HTML
            nav_inner = ''
            m = re.search(r'<div class="small-links">([\s\S]*?)</div>', hdr)
            if m:
                nav_inner = m.group(1)
            # Replace existing small-links block
            if nav_inner:
                txt = re.sub(r'(<div class="small-links">)([\s\S]*?)(</div>)', r'\1' + nav_inner + r'\3', txt, count=1)
            # Replace legend text
            txt = re.sub(r'<div class="legend">([\s\S]*?)</div>', f'<div class="legend">{title}</div>', txt, count=1)
            # Ensure footer includes Last updated timestamp
            if 'Last updated:' not in txt:
                txt = re.sub(r'(</footer>)', f' <span class="legend">Last updated: {LAST_UPDATED}</span>\\1', txt, count=1)
            try:
                path.write_text(txt, encoding='utf-8')
            except Exception:
                pass

        root = OUT_DIR
        _update_static(root / 'trend-viewer.html', 'Trend Viewer')
        _update_static(root / 'trends.html', 'Trends')
        _update_static(root / 'ranker.html', 'U.S. Presidential Election State Results Ranker')
        _update_static(root / 'future.html', '"Future" Elections (2028–2048)')
        _update_static(root / 'paths2028.html', '2028 Paths to Victory')
    except Exception as e:
        print(f"Warning: couldn't sync static page headers: {e}")

    # Ranker page is no longer built by the pipeline; maintain it separately.

    # Removed building tester.js from pipeline; edit docs/tester.js directly when needed.

    print(f"Done. Built index, state/unit pages, data, methods, and state-pages. Ranker is managed separately.")

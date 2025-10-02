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
    
    # Generate last-updated.json file with current timestamp
    last_updated_data = {"lastUpdated": LAST_UPDATED}
    write_text(OUT_DIR / "last-updated.json", json.dumps(last_updated_data, indent=2))

    if PLOTS_SRC.exists() and PLOTS_SRC.is_dir():
        PLOTS_DST.mkdir(parents=True, exist_ok=True)
        for item in PLOTS_SRC.iterdir():
            if item.is_file():
                shutil.copy2(item, PLOTS_DST / item.name)

    rows = read_csv(CSV_PATH)
    
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
    # try:
    #     make_methods_page()
    # except Exception as e:
    #     print(f"Warning: couldn't build methods page: {e}")

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

            # hdr_full = make_header(f"U.S. Presidential Election State Results {year_range}", is_inner=False)
            # # Extract small-links inner HTML
            # nav_inner = ''
            # m = re.search(r'<div class="small-links">([\s\S]*?)</div>', hdr_full)
            # if m:
            #     nav_inner = m.group(1)
            # if nav_inner:
            #     txt = re.sub(r'(<div class="small-links">)([\s\S]*?)(</div>)', r'\1' + nav_inner + r'\3', txt, count=1)
            # Replace the header legend text content (keep surrounding markup)
            txt = re.sub(r'(<div class="legend">)U\.S\. Presidential Election State Results[\s\S]*?(</div>)', rf'\1U.S. Presidential Election State Results {year_range}\2', txt, count=1)
            # Replace the main H1 to match year range
            txt = re.sub(r'(<h1>)U\.S\. Presidential Election State Results[\s\S]*?(</h1>)', rf'\1U.S. Presidential Election State Results {year_range}\2', txt, count=1)
            # Ensure footer includes updated Last updated timestamp
            #txt = re.sub(r'(Last updated:\s*)([0-9\-:\sA-Z]+)', rf'\g<1>{LAST_UPDATED}', txt, count=1)
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
            # Compute relative prefix for header-toggle.js depending on file depth.
            try:
                rel = path.relative_to(OUT_DIR)
                parts = rel.parts
                if len(parts) <= 1:
                    script_prefix = './'
                else:
                    script_prefix = '../' * (len(parts) - 1)
            except Exception:
                script_prefix = './'
            # Build canonical header HTML (includes hamburger toggle and now expects external toggle script)
            hdr = make_header(title, is_inner=False)
            # Always replace site-header blocks with the canonical header to ensure nav links are up-to-date
            # The site-header structure includes nested divs, so we need to match the full closing tag
            # Match: <div class="card site-header"...>...(everything including nested divs and script tag)...</div>
            # We need to account for the structure: site-header -> button+small-links+legend+script -> close
            pattern = r'<div class="card site-header"[^>]*>(?:<button[^>]*>.*?</button>)?<div class="small-links"[^>]*>.*?</div><div class="legend">.*?</div><script[^>]*></script></div>'
            txt, n = re.subn(pattern, hdr, txt, count=1, flags=re.DOTALL)
            if n == 0:
                # Fallback: try a simpler pattern
                txt, n = re.subn(r'<div class="card site-header"[\s\S]*?<script[^>]*header-toggle\.js[^>]*></script>\s*</div>', hdr, txt, count=1)
            if n == 0:
                # Fallback: extract small-links inner HTML from canonical header and replace the small-links block
                nav_inner = ''
                m = re.search(r'<div class="small-links">([\s\S]*?)</div>', hdr)
                if m:
                    nav_inner = m.group(1)
                if nav_inner:
                    txt = re.sub(r'(<div class="small-links">)([\s\S]*?)(</div>)', r'\1' + nav_inner + r'\3', txt, count=1)
                # Replace legend text if present
                txt = re.sub(r'<div class="legend">([\s\S]*?)</div>', f'<div class="legend">{title}</div>', txt, count=1)
            
            # Strip existing Back to Map blocks and any hardcoded last updated text so we can insert canonical snippets
            txt = re.sub(r'\s*<div[^>]*>\s*<a[^>]*>[^<]*Back to Map[^<]*</a>[\s\S]*?\s*</div\s*>(?:\s*</div\s*>)?', '', txt, flags=re.IGNORECASE)
            txt = re.sub(r'\s*<(?:div|span)[^>]*data-last-updated[^>]*>[\s\S]*?</(?:div|span)>', '', txt, flags=re.IGNORECASE)
            txt = re.sub(r'Last updated:\s*(?:\.{3}|[0-9:\-\sA-Z]+)', '', txt)

            # Insert canonical Back to Map + timestamp placeholder block directly after the site header
            meta_block = (
                "\n    <div style=\"margin-top:12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center\">\n"
                f"      <a class=\"back\" href=\"{script_prefix}index.html\">← Back to Map</a>\n"
                "      <div class=\"legend\" style=\"font-size:0.85rem\" data-last-updated>Last updated: ...</div>\n"
                "    </div>"
            )
            header_pattern = r'(<div class="card site-header"[^>]*>[\s\S]*?header-toggle\.js[^>]*></script>\s*</div>)'
            txt, inserted_meta = re.subn(header_pattern, r'\1' + meta_block, txt, count=1, flags=re.IGNORECASE)
            if inserted_meta == 0:
                txt = meta_block + txt
            else:
                # Remove any stray container closing immediately following the injected meta block
                txt = re.sub(r'(</div>)\s*</div>(\s*<div)', r'\1\2', txt, count=1, flags=re.IGNORECASE)

            # Preserve any existing footer note about CSV builds
            extra_footer_note = ""
            if "Built as static HTML from CSV" in txt:
                extra_footer_note = "Built as static HTML from CSV."
            elif "Built from CSV" in txt:
                extra_footer_note = "Built from CSV."

            footer_body = (
                "Site by eigentaylor. Please report any inaccuracies to me through discord: eigentaylor.<br />\n"
                "Data (possibly incorrectly scraped) from <a href='https://en.wikipedia.org/' target='_blank' rel='noopener noreferrer'>Wikipedia</a>. Available under the Creative Commons Attribution-ShareAlike License (CC BY-SA 4.0).<br />\n"
            )
            if extra_footer_note:
                footer_body += extra_footer_note + "<br />\n"
            footer_body += '<span data-last-updated>Last updated: ...</span>'
            footer_html = f"<footer>{footer_body}</footer>"
            txt, n_footer = re.subn(r'<footer>[\s\S]*?</footer>', footer_html, txt, count=1, flags=re.IGNORECASE)
            if n_footer == 0:
                txt = re.sub(r'(</body>)', footer_html + '\n\\1', txt, count=1, flags=re.IGNORECASE)

            # Ensure the shared last-updated loader script is present exactly once using the computed prefix
            txt = re.sub(r'\s*<script[^>]*last-updated\.js[^>]*></script>\s*', '\n', txt, flags=re.IGNORECASE)
            txt, script_added = re.subn(r'(</body>)', f'<script src="{script_prefix}last-updated.js"></script>\n\\1', txt, count=1, flags=re.IGNORECASE)
            if script_added == 0:
                txt += f'\n<script src="{script_prefix}last-updated.js"></script>'
            
            # Replace any inline toggle script blocks with an external include using the computed prefix
            try:
                txt = re.sub(r'<script>\s*\(function\(\)\{[\s\S]*?document.getElementById\("headerToggle"\);[\s\S]*?\}\)\(\)\s*<\/script>', f'<script src="{script_prefix}header-toggle.js"></script>', txt, flags=re.M)
            except Exception:
                pass
            try:
                path.write_text(txt, encoding='utf-8')
                print(f"Updated header/footer in {path.name}")
            except Exception:
                pass

            # If the page still doesn't include the hamburger toggle, try a targeted injection
            if 'headerToggle' not in txt:
                try:
                    # Inject id on first small-links and prepend the header toggle button
                    if '<div class="small-links"' in txt:
                        txt = txt.replace('<div class="small-links"', '<button class="header-toggle" id="headerToggle" aria-label="Toggle navigation menu" aria-expanded="false"><span></span><span></span><span></span></button>\n<div class="small-links" id="headerNav"', 1)
                    # Append external shared script after the first legend div (likely the header title)
                    script_tag = f'<script src="{script_prefix}header-toggle.js"></script>'
                    txt = re.sub(r'(<div class="legend">[\s\S]*?</div>)', r"\1" + script_tag, txt, count=1)
                    path.write_text(txt, encoding='utf-8')
                    print(f"Injected header toggle into {path.name}")
                except Exception:
                    pass

        root = OUT_DIR
        _update_static(root / 'index.html', 'U.S. Presidential Election State Results 1864-2024')
        _update_static(root / 'trend-viewer.html', 'Trend Viewer')
        _update_static(root / 'trends.html', 'Trends')
        _update_static(root / 'ranker.html', 'U.S. Presidential Election State Results Ranker')
        _update_static(root / 'future.html', '"Future" Elections (2028–2048)')
        _update_static(root / 'paths2028.html', '2028 Paths to Victory')
        _update_static(root / 'methods.html', 'Methods and Data Sources')
        _update_static(root / 'attributions.html', 'Data Sources & Attribution')
        _update_static(root / 'state-pages.html', 'State Pages Directory')
        _update_static(root / 'presidential_margins.html', 'Presidential margins CSV')
        # Also update other static docs that are managed outside the main generator
        _update_static(root / 'explorer.html', 'Explorer')
        _update_static(root / 'possibilities.html', 'Enumerated Possibilities')
        _update_static(root / 'presidential_margins.html', 'Presidential margins CSV')
        _update_static(root / 'probabilities.html', '2028 Interactive Probabilities')
    except Exception as e:
        print(f"Warning: couldn't sync static page headers: {e}")

    # Ranker page is no longer built by the pipeline; maintain it separately.

    # Removed building tester.js from pipeline; edit docs/tester.js directly when needed.

    print(f"Done. Built index, state/unit pages, data, methods, and state-pages. Ranker is managed separately.")

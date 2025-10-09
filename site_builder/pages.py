from collections import defaultdict
from typing import List, Dict, Optional

import params
from .config import OUT_DIR, STATE_DIR, UNIT_DIR, SMALL_STATES, ME_NE_STATES, LAST_UPDATED, FOOTER_TEXT, EXPLANATION_TEXT
from .io_utils import write_text
from .tables import split_columns_into_three, group_by_abbr, render_table, render_info_box
from .templates import PAGE_HTML, ENHANCED_TOGGLE_JS

def make_state_pages(states_sorted: List[str]):
    """Generate a dedicated State Pages index with links to every state and unit page.

    This replaces the state links grid that used to live on index.html.
    """
    # Build a clean A–Z list: Full State Name  ·  [ABBR]
    state_items = sorted(
        [(abbr[:2], str(params.ABBR_TO_STATE.get(abbr) or abbr)) for abbr in states_sorted],
        key=lambda x: x[1]
    )
    items_html = "\n".join(
        f"<li class='state-item' style='display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border:1px solid var(--border);border-radius:10px;background:#111'>"
        f"<span class='state-name' style='text-align:left'>{name}</span>"
        f"<a class='btn' href='state/{abbr}.html' aria-label='Open {name} page'>{abbr}</a>"
        f"</li>"
        for abbr, name in state_items
    )
    state_links_html = (
        "<ul class='state-list' style='list-style:none;margin:8px 0 0 0;padding:0;display:grid;gap:8px;grid-template-columns:repeat(2,1fr)'>" +
        items_html +
        "</ul>"
    )

    html = f"""<!doctype html>
        <html lang='en'>
        <head>
            <meta charset='utf-8'/>
            <meta name='viewport' content='width=device-width,initial-scale=1'/>
            <title>State Pages • Margin Matters</title>
            <link rel='stylesheet' href='styles.css'/>
            <link rel="icon" href="favicon.svg" />
        </head>
        <body>
            <div class='container'>
                <div id="header-placeholder"></div>
                <div class="legend" style="margin-top:12px">State Pages</div>
                <div id="back-to-map-placeholder"></div>
                <div class='card'>
                    <h1 style='margin-top:0'>State Pages</h1>
                    <p class='legend'>All statewide pages. District pages are linked from Maine and Nebraska.</p>
                    <div class="small-links" id="top-links" style="padding: 4px; align-items: center; justify-content: center; display: flex;">
                        <a class="btn" href="state/NAT.html">NATIONAL</a>
                    </div>
                    {state_links_html}
                </div>
                <div id="footer-placeholder" data-extra-note="Built as static HTML from CSV."></div>
            </div>
            <script src="./header.js"></script>
            <script src="./back-to-map.js"></script>
            <script src="./footer.js"></script>
            <script src="./last-updated.js"></script>
        </body>
        </html>"""
    write_text(OUT_DIR / "state-pages.html", html)


def build_pages(rows: List[Dict], senate_rows: Optional[List[Dict]] = None):
    headers = list(rows[0].keys()) if rows else []
    basic_cols, third_cols, tp_cols = split_columns_into_three(headers)
    by_abbr = group_by_abbr(rows)

    senate_rows = senate_rows or []
    senate_headers = list(senate_rows[0].keys()) if senate_rows else []
    if senate_headers:
        senate_basic_cols, senate_third_cols, senate_tp_cols = split_columns_into_three(senate_headers)
    else:
        senate_basic_cols, senate_third_cols, senate_tp_cols = [], [], []
    senate_by_abbr = group_by_abbr(senate_rows) if senate_rows else {}

    states = sorted({abbr for abbr in by_abbr.keys() if (len(abbr) == 2 or '-AL' in abbr)})
    district_units = sorted({abbr for abbr in by_abbr.keys() if '-' in abbr})

    # State pages
    for st in states:
        table_rows = by_abbr.get(st, [])
        extra_links = ""
        if st in ME_NE_STATES:
            dlist = sorted([u for u in district_units if u.startswith(st[:2] + '-')])
            if dlist:
                items = "".join(
                    f'<a class="btn" href="../unit/{u}.html">{u}</a>' if u != st else
                    f'<a class="btn" href="../state/{st[:2]}.html">{u}</a>'
                    for u in dlist
                )
                extra_links = (
                    f'<div class="card"><h2 style="margin-top:0">{params.ABBR_TO_STATE.get(st, st)}\' Districts</h2>'
                    f'<div class="small-links">{items}</div></div>'
                )

        plot_section = (
            f'<div class="card center">\n'
            f'  <img class="plot" alt="Plot1 for {st}" src="../plots/{st}_plot1.png">\n'
            f'  <div class="legend" style="margin-top:8px">Margins · 3rd-Party share · Pres. deltas</div>\n'
            f'</div>\n'
            f'<div class="card center">\n'
            f'  <img class="plot" alt="Plot2 for {st}" src="../plots/{st}_plot2.png">\n'
            f'  <div class="legend" style="margin-top:8px">Relative margins · Relative 3rd-Party · Rel. deltas</div>\n'
            f'</div>'
        )
        table1_section = (
            f'<div class="card" data-table-type="total">\n'
            f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(st, st)} ({st}) — Total Data</h2>\n'
            f'  <div class="table-wrap">{render_table(table_rows, basic_cols)}</div>\n'
            f'  {render_info_box(basic_cols)}\n'
            f'</div>'
        )
        table3_section = ''
        if third_cols:
            table3_section = (
                f'<div class="card" data-table-type="third-party">\n'
                f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(st, st)} ({st}) — Third-Party Data</h2>\n'
                f'  <div class="table-wrap">{render_table(table_rows, third_cols)}</div>\n'
                f'  {render_info_box(third_cols)}\n'
                f'</div>'
            )
        plot3_section = (
            f'<div class="card center">\n'
            f'  <img class="plot" alt="Plot3 for {st}" src="../plots/{st}_plot3_two_party.png">\n'
            f'  <div class="legend" style="margin-top:8px">Two-party margins · relative · deltas</div>\n'
            f'</div>'
        )
        table2_section = (
            f'<div class="card" data-table-type="two-party">\n'
            f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(st, st)} ({st}) — Two-Party Data</h2>\n'
            f'  <div class="table-wrap">{render_table(table_rows, tp_cols, two_party=True)}</div>\n'
            f'  {render_info_box(tp_cols)}\n'
            f'</div>'
        )

        pres_sections = [table1_section]
        if table3_section:
            pres_sections.append(table3_section)
        pres_sections.append(table2_section)
        pres_tables_html = "\n".join(pres_sections)

        senate_table_rows = senate_by_abbr.get(st, []) if senate_by_abbr else []
        if senate_table_rows:
            senate_table1 = (
                f'<div class="card" data-table-type="total">\n'
                f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(st, st)} ({st}) — Senate Total Data</h2>\n'
                f'  <div class="table-wrap">{render_table(senate_table_rows, senate_basic_cols)}</div>\n'
                f'  {render_info_box(senate_basic_cols)}\n'
                f'</div>'
            )
            senate_table3 = ''
            if senate_third_cols:
                senate_table3 = (
                    f'<div class="card" data-table-type="third-party">\n'
                    f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(st, st)} ({st}) — Senate Third-Party Data</h2>\n'
                    f'  <div class="table-wrap">{render_table(senate_table_rows, senate_third_cols)}</div>\n'
                    f'  {render_info_box(senate_third_cols)}\n'
                    f'</div>'
                )
            senate_table2 = (
                f'<div class="card" data-table-type="two-party">\n'
                f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(st, st)} ({st}) — Senate Two-Party Data</h2>\n'
                f'  <div class="table-wrap">{render_table(senate_table_rows, senate_tp_cols, two_party=True)}</div>\n'
                f'  {render_info_box(senate_tp_cols)}\n'
                f'</div>'
            )
            senate_sections = [senate_table1]
            if senate_table3:
                senate_sections.append(senate_table3)
            senate_sections.append(senate_table2)
            senate_tables_html = "\n".join(senate_sections)
            senate_section_attr = ''
        else:
            senate_tables_html = (
                f'<div class="card">\n'
                f'  <h2 style="margin-top:0">Senate data unavailable</h2>\n'
                f'  <p class="legend">We do not have Senate general election results for {params.ABBR_TO_STATE.get(st, st)} in the dataset.</p>\n'
                f'</div>'
            )
            senate_section_attr = ' data-empty="true"'

        dataset_sections_html = (
            '<div class="dataset-sections">\n'
            '  <div class="dataset-section is-active" data-dataset="presidential">\n{pres_tables}\n  </div>\n'
            '  <div class="dataset-section" data-dataset="senate"{senate_attr}>\n{senate_tables}\n  </div>\n'
            '</div>'
        ).format(pres_tables=pres_tables_html, senate_tables=senate_tables_html, senate_attr=senate_section_attr)

        available_datasets_value = "presidential,senate"

        legend_text = f"{params.ABBR_TO_STATE.get(st, st)} ({st}) — Statewide"
        page = (
            PAGE_HTML
            .replace("%LEGEND%", legend_text)
            .replace("%TITLE%", f"{st} · State")
            .replace("%HEADING%", f"{params.ABBR_TO_STATE.get(st, st)} ({st}) — Statewide")
            .replace("%STATE_ABBR%", st)
            .replace("%EXTRA_LINKS%", extra_links)
            .replace("%DATASET_SECTIONS%", dataset_sections_html)
            .replace("%FOOTER_TEXT%", FOOTER_TEXT)
            .replace("%DELTA_TOGGLE_JS%", ENHANCED_TOGGLE_JS)
            .replace("%AVAILABLE_DATASETS%", available_datasets_value)
        )
        page = page.replace("%LAST_UPDATED%", LAST_UPDATED)
        write_text(STATE_DIR / f"{st[:2]}.html", page)

    # District/unit pages
    for unit in district_units:
        if unit.endswith('-AL'):
            continue
        table_rows = by_abbr.get(unit, [])
        dlist = sorted([u for u in district_units if u.startswith(unit[:2] + '-')])
        extra_links = ""
        if dlist:
            items = "".join(
                f'<a class="btn" href="../unit/{u}.html">{u}</a>' if u != unit[:2] + "-AL" else
                f'<a class="btn" href="../state/{unit[:2]}.html">{u}</a>'
                for u in dlist
            )
            abbr_state = params.ABBR_TO_STATE.get(unit[:2], unit) or ""
            extra_links = (
                f'<div class="card"><h2 style="margin-top:0">{abbr_state}\'s Districts</h2>'
                f'<div class="small-links">{items}</div></div>'
            )

        plot_section = (
            f'<div class="card center">\n'
            f'  <img class="plot" alt="Plot1 for {unit}" src="../plots/{unit}_plot1.png">\n'
            f'  <div class="legend" style="margin-top:8px">Margins · 3rd-Party share · Pres. deltas</div>\n'
            f'</div>\n'
            f'<div class="card center">\n'
            f'  <img class="plot" alt="Plot2 for {unit}" src="../plots/{unit}_plot2.png">\n'
            f'  <div class="legend" style="margin-top:8px">Relative margins · Relative 3rd-Party · Rel. deltas</div>\n'
            f'</div>'
        )
        plot3_section = (
            f'<div class="card center">\n'
            f'  <img class="plot" alt="Plot3 for {unit}" src="../plots/{unit}_plot3_two_party.png">\n'
            f'  <div class="legend" style="margin-top:8px">Two-party margins · relative · deltas</div>\n'
            f'</div>'
        )
        table1_section = (
            f'<div class="card" data-table-type="total">\n'
            f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(unit, unit)} ({unit}) — Total Data</h2>\n'
            f'  <div class="table-wrap">{render_table(table_rows, basic_cols)}</div>\n'
            f'  {render_info_box(basic_cols)}\n'
            f'</div>'
        )
        table3_section = ''
        if third_cols:
            table3_section = (
                f'<div class="card" data-table-type="third-party">\n'
                f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(unit, unit)} ({unit}) — Third-Party Data</h2>\n'
                f'  <div class="table-wrap">{render_table(table_rows, third_cols)}</div>\n'
                f'  {render_info_box(third_cols)}\n'
                f'</div>'
            )
        table2_section = (
            f'<div class="card" data-table-type="two-party">\n'
            f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(unit, unit)} ({unit}) — Two-Party Data</h2>\n'
            f'  <div class="table-wrap">{render_table(table_rows, tp_cols, two_party=True)}</div>\n'
            f'  {render_info_box(tp_cols)}\n'
            f'</div>'
        )
        pres_sections = [table1_section]
        if table3_section:
            pres_sections.append(table3_section)
        pres_sections.append(table2_section)
        pres_tables_html = "\n".join(pres_sections)

        dataset_sections_html = (
            '<div class="dataset-sections">\n'
            '  <div class="dataset-section is-active" data-dataset="presidential">\n{pres_tables}\n  </div>\n'
            '</div>'
        ).format(pres_tables=pres_tables_html)

        legend_text = f"{params.ABBR_TO_STATE.get(unit, unit)} ({unit})"
        page = (
            PAGE_HTML
            .replace("%LEGEND%", legend_text)
            .replace("%TITLE%", f"{unit} · District")
            .replace("%HEADING%", f"{params.ABBR_TO_STATE.get(unit, unit)} ({unit})")
            .replace("%STATE_ABBR%", unit)
            .replace("%EXTRA_LINKS%", extra_links)
            .replace("%DATASET_SECTIONS%", dataset_sections_html)
            .replace("%FOOTER_TEXT%", FOOTER_TEXT)
            .replace("%DELTA_TOGGLE_JS%", ENHANCED_TOGGLE_JS)
            .replace("%AVAILABLE_DATASETS%", "presidential")
        )
        page = page.replace("%LAST_UPDATED%", LAST_UPDATED)
        write_text(UNIT_DIR / f"{unit}.html", page)

    # NATIONAL page
    year_groups = defaultdict(list)
    for r in rows:
        try:
            yi = int(str(r.get('year')))
        except Exception:
            continue
        year_groups[yi].append(r)

    national_rows = []
    nat_cols = []
    prev_totals = {}
    for y in sorted(year_groups.keys()):
        grp = year_groups[y]
        nat_row = None
        for rr in grp:
            if str(rr.get('abbr', '')).upper() in ('NATIONAL', 'NAT'):
                nat_row = rr
                break
        if nat_row is not None:
            out = {k: v for k, v in nat_row.items() if ((k not in ['abbr', 'electoral_votes'] and 'relative' not in k.lower() and 'pres' not in k.lower() and 'third_party_share' not in k.lower() and 'two_party_margin' not in k.lower()) or 'national' in k.lower())}
            out['year'] = y
        else:
            out = {'year': y}
            sum_cols = ('D_votes', 'R_votes', 'T_votes', 'total_votes')
            for h in sum_cols:
                s = 0
                any_v = False
                for rr in grp:
                    if str(rr.get('abbr', '')).upper() in ('NATIONAL', 'NAT'):
                        continue
                    v = rr.get(h, '')
                    try:
                        s += int(str(v).replace(',', ''))
                        any_v = True
                    except Exception:
                        pass
                out[h] = s if any_v else ''
            if prev_totals:
                for h in sum_cols:
                    prev = prev_totals.get(h)
                    cur = out.get(h)
                    if isinstance(cur, int) and isinstance(prev, int):
                        out[h.replace('_votes', '_delta')] = cur - prev
        for h in out:
            if h not in nat_cols:
                nat_cols.append(h)
        national_rows.append(out)
        for k in ('D_votes', 'R_votes', 'T_votes', 'total_votes'):
            v = national_rows[-1].get(k)
            prev_totals[k] = v if isinstance(v, int) else None

    nat_basic_cols, nat_third_cols, nat_tp_cols = split_columns_into_three(nat_cols)
    plot_section = (
        f'<div class="card center">\n'
        f'  <img class="plot" alt="Plot1 for NAT" src="../plots/NAT_plot1.png">\n'
        f'  <div class="legend" style="margin-top:8px">National overview</div>\n'
        f'</div>'
    )
    plot3_section = (
        f'<div class="card center">\n'
        f'  <img class="plot" alt="Plot3 for NAT" src="../plots/NAT_plot3_two_party.png">\n'
        f'  <div class="legend" style="margin-top:8px">Two-party national overview</div>\n'
        f'</div>'
    )
    table1_section = (
        f'<div class="card" data-table-type="total">\n'
        f'  <h2 style="margin-top:0">National — Total Data</h2>\n'
        f'  <div class="table-wrap">{render_table(national_rows, nat_basic_cols)}{render_info_box(nat_basic_cols)}</div>\n'
        f'</div>'
    )
    table3_section = ''
    if nat_third_cols:
        table3_section = (
            f'<div class="card" data-table-type="third-party">\n'
            f'  <h2 style="margin-top:0">National — Third-Party Data</h2>\n'
            f'  <div class="table-wrap">{render_table(national_rows, nat_third_cols)}{render_info_box(nat_third_cols)}</div>\n'
            f'</div>'
        )
    table2_section = (
        f'<div class="card" data-table-type="two-party">\n'
        f'  <h2 style="margin-top:0">National — Two-Party Data</h2>\n'
        f'  <div class="table-wrap">{render_table(national_rows, nat_tp_cols, two_party=True)}{render_info_box(nat_tp_cols)}</div>\n'
        f'</div>'
    )
    pres_sections = [table1_section]
    if table3_section:
        pres_sections.append(table3_section)
    pres_sections.append(table2_section)
    pres_tables_html = "\n".join(pres_sections)

    national_senate_rows = senate_by_abbr.get('NAT', []) if senate_by_abbr else []
    if national_senate_rows:
        senate_table1 = (
            f'<div class="card" data-table-type="total">\n'
            f'  <h2 style="margin-top:0">National — Senate Total Data</h2>\n'
            f'  <div class="table-wrap">{render_table(national_senate_rows, senate_basic_cols)}</div>\n'
            f'  {render_info_box(senate_basic_cols)}\n'
            f'</div>'
        )
        senate_table3 = ''
        if senate_third_cols:
            senate_table3 = (
                f'<div class="card" data-table-type="third-party">\n'
                f'  <h2 style="margin-top:0">National — Senate Third-Party Data</h2>\n'
                f'  <div class="table-wrap">{render_table(national_senate_rows, senate_third_cols)}</div>\n'
                f'  {render_info_box(senate_third_cols)}\n'
                f'</div>'
            )
        senate_table2 = (
            f'<div class="card" data-table-type="two-party">\n'
            f'  <h2 style="margin-top:0">National — Senate Two-Party Data</h2>\n'
            f'  <div class="table-wrap">{render_table(national_senate_rows, senate_tp_cols, two_party=True)}</div>\n'
            f'  {render_info_box(senate_tp_cols)}\n'
            f'</div>'
        )
        senate_sections = [senate_table1]
        if senate_table3:
            senate_sections.append(senate_table3)
        senate_sections.append(senate_table2)
        senate_tables_html = "\n".join(senate_sections)
        senate_section_attr = ''
    else:
        senate_tables_html = (
            '<div class="card">\n'
            '  <h2 style="margin-top:0">Senate data unavailable</h2>\n'
            '  <p class="legend">National Senate results are not available in the dataset.</p>\n'
            '</div>'
        )
        senate_section_attr = ' data-empty="true"'

    dataset_sections_html = (
        '<div class="dataset-sections">\n'
        '  <div class="dataset-section is-active" data-dataset="presidential">\n{pres_tables}\n  </div>\n'
        '  <div class="dataset-section" data-dataset="senate"{senate_attr}>\n{senate_tables}\n  </div>\n'
        '</div>'
    ).format(pres_tables=pres_tables_html, senate_tables=senate_tables_html, senate_attr=senate_section_attr)

    available_datasets_value = "presidential,senate" if national_senate_rows else "presidential"

    page = (
        PAGE_HTML
        .replace("%LEGEND%", "National (NAT)")
        .replace("%TITLE%", f"NAT · National")
        .replace("%HEADING%", f"National (NAT)")
        .replace("%STATE_ABBR%", "NAT")
        .replace("%EXTRA_LINKS%", "")
        .replace("%DATASET_SECTIONS%", dataset_sections_html)
        .replace("%FOOTER_TEXT%", FOOTER_TEXT)
        .replace("%DELTA_TOGGLE_JS%", ENHANCED_TOGGLE_JS)
        .replace("%AVAILABLE_DATASETS%", available_datasets_value)
    )
    page = page.replace("%LAST_UPDATED%", LAST_UPDATED)
    write_text(STATE_DIR / f"NAT.html", page)

    return states


def make_data_page(rows: List[Dict]):
    headers = list(rows[0].keys()) if rows else []

    def esc(s):
        if s is None:
            return ""
        return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

    thead = "".join(f"<th>{esc(h)}</th>" for h in headers)
    body_rows = []
    for r in rows:
        cells = "".join(f"<td>{esc(r.get(h,''))}</td>" for h in headers)
        body_rows.append(f"<tr>{cells}</tr>")

    # Build the page HTML matching the manual edits: container + header, table, canonical footer, and the delta toggle JS
    html = f"""<!doctype html>
        <html lang='en'>
        <head>
            <meta charset='utf-8'/>
            <meta name='viewport' content='width=device-width,initial-scale=1'/>
            <title>Presidential margins CSV</title>
            <link rel='stylesheet' href='styles.css'/>
            <link rel="icon" href="favicon.svg" />
        </head>
    <body>
      <div class='container'>
        <div id="header-placeholder"></div>
        <div class="legend" style="margin-top:12px">Presidential margins CSV</div>
        <div id="back-to-map-placeholder"></div>
                <h1 style='margin-top:0'>presidential_margins.csv</h1>
                <p class='legend'>This page renders the primary CSV used to build the site. Download the raw data via the Data (CSV) navbar or <a href='presidential_margins.csv'>direct link</a>.</p>
                <div class='card table-wrap'>
                    <table class="presidential-margins-table"><thead><tr>{thead}</tr></thead><tbody>{''.join(body_rows)}</tbody></table>
                </div>
            <div id="footer-placeholder" data-extra-note="Built as static HTML from CSV."></div>
        </div>
        <script src="./header.js"></script>
        <script src="./back-to-map.js"></script>
        <script src="./footer.js"></script>
        <script src="./last-updated.js"></script>
    </body>
    </html>"""
    write_text(OUT_DIR / "presidential_margins.html", html)


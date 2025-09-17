from collections import defaultdict
from typing import List, Dict

import params
from .config import OUT_DIR, STATE_DIR, UNIT_DIR, SMALL_STATES, ME_NE_STATES, LAST_UPDATED, FOOTER_TEXT, EXPLANATION_TEXT
from .io_utils import write_text
from .tables import split_columns_into_three, group_by_abbr, render_table, render_info_box
from .templates import INDEX_HTML, PAGE_HTML
from .header import make_header


def make_index(states_sorted: List[str], rows: List[Dict] | None = None):
    # Build state link grid
    state_items = sorted([(abbr, str(params.ABBR_TO_STATE.get(abbr) or abbr)) for abbr in states_sorted], key=lambda x: x[0])
    cols = [[], [], [], []]
    for i, item in enumerate(state_items):
        cols[i % 4].append(item)
    col_html = []
    for col in cols:
        items = "".join(f'<a class="btn" href="state/{abbr[:2]}.html">{abbr[:2]}</a>' for abbr, _ in col)
        col_html.append(f'<div class="card" style="padding:8px"><div class="small-links" style="justify-content:center">{items}</div></div>')
    state_links_html = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:8px 0">' + "".join(col_html) + '</div>'

    # Compute year range for header
    min_year = None
    max_year = None
    if rows:
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
        min_year = 1968
    if max_year is None:
        max_year = 2024
    year_range = f"{min_year}-{max_year}"

    # Compose page
    header_html = make_header(f"U.S. Presidential Election State Results {year_range}")
    html = INDEX_HTML.replace("%HEADER%", header_html)
    html = html.replace("%SMALL_STATES_JSON%", str(SMALL_STATES))
    html = html.replace("%STATE_LINKS%", state_links_html)
    html = html.replace("%LAST_UPDATED%", LAST_UPDATED)
    html = html.replace("%FOOTER_TEXT%", FOOTER_TEXT)
    html = html.replace("%YEAR_RANGE%", year_range)

    # Optional interactive tester
    if getattr(params, "INTERACTIVE_TESTER", False):
        cap_pct = int(round(float(getattr(params, 'TESTER_PV_CAP', 0.25)) * 100))
        tester_ui = (
            "\n".join([
                '<hr style="margin:12px 0" />',
                '<div id="tester" class="center" style="margin-top:8px">',
                '  <div style="display:grid;gap:10px">',
                '    <div>',
                '      <label for="yearSlider">Year:</label>',
                '      <input id="yearSlider" type="range" min="%MIN_YEAR%" max="%MAX_YEAR%" step="4" value="%MAX_YEAR%" />',
                '      <span id="yearVal" style="margin-left:8px">%MAX_YEAR%</span>',
                '    </div>',
                '    <div>',
                '      <div style="display:flex;gap:10px;align-items:center">',
                '        <label for="pvSlider" style="min-width:150px">PV (Nat. Margin):</label>',
                '        <input id="pvSlider" type="range" min="0" max="1" step="1" value="0" list="pvStopsList" style="flex:1" />',
                '        <span id="pvVal">EVEN</span>',
                '      </div>',
                '      <datalist id="pvStopsList"></datalist>',
                '    </div>',
                '    <div id="evBar" style="height:18px;border:1px solid var(--border);border-radius:9px;position:relative;background:#111">',
                '      <div id="evFillD" style="position:absolute;left:0;top:0;bottom:0;background:#4169E1;border-radius:9px 0 0 9px;width:0%"></div>',
                '      <div id="evFillO" style="position:absolute;top:0;bottom:0;background:#C9A400;width:0%"></div>',
                '      <div id="evFillR" style="position:absolute;right:0;top:0;bottom:0;background:#B22222;border-radius:0 9px 9px 0;width:0%"></div>',
                '      <div id="evMid" style="position:absolute;left:50%;top:-6px;bottom:-6px;width:2px;background:var(--border)"></div>',
                '      <div id="evText" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)">D 0 | O 0 | R 0</div>',
                '    </div>',
                '    <div id="pvTotals" class="pv-totals">',
                '      <div class="pv-badge pv-d"><span class="label">Dem</span><span id="pvDem" class="num">0</span></div>',
                '      <div class="pv-badge pv-o"><span class="label">Other</span><span id="pvOth" class="num">0</span></div>',
                '      <div class="pv-badge pv-r"><span class="label">Rep</span><span id="pvRep" class="num">0</span></div>',
                '      <div class="pv-badge pv-total"><span class="label">Total</span><span id="pvTot" class="num">0</span></div>',
                '    </div>',
                '    <div class="legend" style="font-size:0.95rem;margin-bottom:6px">Flip scenarios (min votes)</div>',
                '    <div class="flip-controls">',
                '      <button id="flipClassic" class="btn">Flip winner</button>',
                '      <button id="flipNoMaj" class="btn">Break majority</button>',
                '      <button id="flipReset" class="btn">Reset flips</button>',
                '    </div>',
                '    <div class="flip-summary">',
                '      <div class="flip-badge"><span class="label">Votes changed</span><span id="flipVotes" class="num">0</span></div>',
                '      <div class="flip-badge"><span class="label">% of total</span><span id="flipVotesPct" class="num">0%</span></div>',
                '      <div class="flip-badge"><span class="label">States flipped</span><span id="flipCount" class="num">0</span></div>',
                '      <div class="flip-badge"><span class="label">EC</span><span id="flipEC" class="num">0 - 0</span></div>',
                '    </div>',
                '    <div id="flipDetailsWrap" class="card" style="margin-top:8px;display:none">',
                '      <div class="legend" style="text-align:left">Applied flips (winner by minimal votes to switch):</div>',
                '      <div class="table-wrap">',
                '        <table class="flip-table">',
                '          <thead><tr><th>State</th><th>EV</th><th>D old</th><th>R old</th><th>D new</th><th>R new</th><th>Δ votes</th></tr></thead>',
                '          <tbody id="flipDetails"></tbody>',
                '        </table>',
                '      </div>',
                '    </div>',
                '    <div id="pvStops" class="legend" style="font-size:0.95rem"></div>',
                f'    <div id="testerExplain" class="legend" style="font-size:0.95rem;text-align:left;color:var(--muted)">%EXPLANATION%</div>',
                '  </div>',
                '</div>',
            ])
        )
        tester_ui = tester_ui.replace('%MIN_YEAR%', str(min_year)).replace('%MAX_YEAR%', str(max_year)).replace('%EXPLANATION%', EXPLANATION_TEXT.replace('{cap_pct}', str(cap_pct)))
        tester_scripts = '<script src="tester.js"></script>'
    else:
        tester_ui = ''
        tester_scripts = ''

    html = html.replace('%TESTER_UI%', tester_ui)
    html = html.replace('%TESTER_SCRIPTS%', tester_scripts)
    write_text(OUT_DIR / "index.html", html)


def build_pages(rows: List[Dict]):
    headers = list(rows[0].keys()) if rows else []
    basic_cols, third_cols, tp_cols = split_columns_into_three(headers)
    by_abbr = group_by_abbr(rows)

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
            f'<div class="card">\n'
            f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(st, st)} ({st}) — Total Data</h2>\n'
            f'  <div class="table-wrap">{render_table(table_rows, basic_cols)}{render_info_box(basic_cols)}</div>\n'
            f'</div>'
        )
        table3_section = ''
        if third_cols:
            table3_section = (
                f'<div class="card">\n'
                f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(st, st)} ({st}) — Third-Party Data</h2>\n'
                f'  <div class="table-wrap">{render_table(table_rows, third_cols)}{render_info_box(third_cols)}</div>\n'
                f'</div>'
            )
        plot3_section = (
            f'<div class="card center">\n'
            f'  <img class="plot" alt="Plot3 for {st}" src="../plots/{st}_plot3_two_party.png">\n'
            f'  <div class="legend" style="margin-top:8px">Two-party margins · relative · deltas</div>\n'
            f'</div>'
        )
        table2_section = (
            f'<div class="card">\n'
            f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(st, st)} ({st}) — Two-Party Data</h2>\n'
            f'  <div class="table-wrap">{render_table(table_rows, tp_cols, two_party=True)}{render_info_box(tp_cols)}</div>\n'
            f'</div>'
        )
        header_html = make_header(f"{params.ABBR_TO_STATE.get(st, st)} ({st}) — Statewide", is_inner=True)
        page = (
            PAGE_HTML
            .replace("%HEADER%", header_html)
            .replace("%TITLE%", f"{st} · State")
            .replace("%HEADING%", f"{params.ABBR_TO_STATE.get(st, st)} ({st}) — Statewide")
            .replace("%PLOT_SECTION%", plot_section)
            .replace("%EXTRA_LINKS%", extra_links)
            .replace("%TABLE1_SECTION%", table1_section)
            .replace("%TABLE3_SECTION%", table3_section)
            .replace("%PLOT3_SECTION%", plot3_section)
            .replace("%TABLE2_SECTION%", table2_section)
            .replace("%FOOTER_TEXT%", FOOTER_TEXT)
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
            f'<div class="card">\n'
            f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(unit, unit)} ({unit}) — Total Data</h2>\n'
            f'  <div class="table-wrap">{render_table(table_rows, basic_cols)}{render_info_box(basic_cols)}</div>\n'
            f'</div>'
        )
        table3_section = ''
        if third_cols:
            table3_section = (
                f'<div class="card">\n'
                f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(unit, unit)} ({unit}) — Third-Party Data</h2>\n'
                f'  <div class="table-wrap">{render_table(table_rows, third_cols)}{render_info_box(third_cols)}</div>\n'
                f'</div>'
            )
        table2_section = (
            f'<div class="card">\n'
            f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(unit, unit)} ({unit}) — Two-Party Data</h2>\n'
            f'  <div class="table-wrap">{render_table(table_rows, tp_cols, two_party=True)}{render_info_box(tp_cols)}</div>\n'
            f'</div>'
        )
        header_html = make_header(f"{params.ABBR_TO_STATE.get(unit, unit)} ({unit})", is_inner=True)
        page = (
            PAGE_HTML
            .replace("%HEADER%", header_html)
            .replace("%TITLE%", f"{unit} · District")
            .replace("%HEADING%", f"{params.ABBR_TO_STATE.get(unit, unit)} ({unit})")
            .replace("%PLOT_SECTION%", plot_section)
            .replace("%EXTRA_LINKS%", extra_links)
            .replace("%TABLE1_SECTION%", table1_section)
            .replace("%TABLE3_SECTION%", table3_section)
            .replace("%PLOT3_SECTION%", plot3_section)
            .replace("%TABLE2_SECTION%", table2_section)
            .replace("%FOOTER_TEXT%", FOOTER_TEXT)
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
        f'<div class="card">\n'
        f'  <h2 style="margin-top:0">National — Total Data</h2>\n'
        f'  <div class="table-wrap">{render_table(national_rows, nat_basic_cols)}{render_info_box(nat_basic_cols)}</div>\n'
        f'</div>'
    )
    table3_section = ''
    if nat_third_cols:
        table3_section = (
            f'<div class="card">\n'
            f'  <h2 style="margin-top:0">National — Third-Party Data</h2>\n'
            f'  <div class="table-wrap">{render_table(national_rows, nat_third_cols)}{render_info_box(nat_third_cols)}</div>\n'
            f'</div>'
        )
    table2_section = (
        f'<div class="card">\n'
        f'  <h2 style="margin-top:0">National — Two-Party Data</h2>\n'
        f'  <div class="table-wrap">{render_table(national_rows, nat_tp_cols, two_party=True)}{render_info_box(nat_tp_cols)}</div>\n'
        f'</div>'
    )
    page = (
        PAGE_HTML
        .replace("%HEADER%", make_header("National (NAT)", is_inner=True))
        .replace("%TITLE%", f"NAT · National")
        .replace("%HEADING%", f"National (NAT)")
        .replace("%PLOT_SECTION%", plot_section)
        .replace("%EXTRA_LINKS%", "")
        .replace("%TABLE1_SECTION%", table1_section)
        .replace("%TABLE3_SECTION%", table3_section)
        .replace("%PLOT3_SECTION%", plot3_section)
        .replace("%TABLE2_SECTION%", table2_section)
        .replace("%FOOTER_TEXT%", FOOTER_TEXT)
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
                <div class='card site-header' style='display:flex;justify-content:space-between;align-items:center;padding:8px'>
                    <div class='small-links'>
                    <a class='btn' href='index.html'>Home</a>
                    <a class='btn' href='ranker.html'>Ranker</a>
                    <a class='btn' href='presidential_margins.csv'>Raw CSV</a>
                    </div>
                    <div class='legend'>Presidential margins CSV</div>
                </div>
                <h1>presidential_margins.csv</h1>
                <p class='legend'>This page renders the primary CSV used to build the site. The raw CSV is available from the "Raw CSV" link.</p>
                <div class='card table-wrap'>
                    <table><thead><tr>{thead}</tr></thead><tbody>{''.join(body_rows)}</tbody></table>
                </div>
                <footer>{FOOTER_TEXT} Built from CSV. Last updated: {LAST_UPDATED}</footer>
                </div>
                </body>
                </html>"""
    write_text(OUT_DIR / "presidential_margins.html", html)



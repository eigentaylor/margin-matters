from collections import defaultdict
from typing import List, Dict

import params
from .config import OUT_DIR, STATE_DIR, UNIT_DIR, SMALL_STATES, ME_NE_STATES, LAST_UPDATED, FOOTER_TEXT, EXPLANATION_TEXT
from .io_utils import write_text
from .tables import split_columns_into_three, group_by_abbr, render_table, render_info_box
from .templates import INDEX_HTML, PAGE_HTML, DELTA_TOGGLE_JS
from .header import make_header


def make_index(states_sorted: List[str], rows: List[Dict] | None = None):
    # Index no longer shows state link grid; that lives on state-pages.html

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
    html = html.replace("%LAST_UPDATED%", LAST_UPDATED)
    html = html.replace("%FOOTER_TEXT%", FOOTER_TEXT)
    html = html.replace("%YEAR_RANGE%", year_range)

    # Optional interactive tester
    if getattr(params, "INTERACTIVE_TESTER", False):
        tester_ui = (
            "\n".join([
                '<hr style="margin:12px 0" />',
                '<div id="tester" class="center" style="margin-top:8px">',
                '  <div style="display:grid;gap:10px">',
                '    <div style="display:flex;align-items:center;gap:8px">',
                '      <label for="yearSlider" style="flex:0 0 auto;min-width:48px">Year:</label>',
                '      <input id="yearSlider" type="range" min="%MIN_YEAR%" max="%MAX_YEAR%" step="4" value="%MAX_YEAR%" style="flex:1;min-width:120px;" />',
                '      <span id="yearVal" style="margin-left:8px;flex:0 0 auto">%MAX_YEAR%</span>',
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
                '          <thead><tr><th>State</th><th>EV</th><th>D</th><th>R</th><th>Δ votes</th></tr></thead>',
                '          <tbody id="flipDetails"></tbody>',
                '        </table>',
                '      </div>',
                '    </div>',
                '    <div id="pvStops" class="legend" style="font-size:0.95rem"></div>',
                '    <div id="testerExplain" class="legend" style="font-size:0.95rem;text-align:left;color:var(--muted)"><a href="methods.html">See Methods</a> for metric definitions, PV stops, uniform swing, and 1968 notes.</div>',
                '  </div>',
                '</div>',
            ])
        )
        tester_ui = tester_ui.replace('%MIN_YEAR%', str(min_year)).replace('%MAX_YEAR%', str(max_year))
        tester_scripts = '<script src="tester.js"></script>'
    else:
        tester_ui = ''
        tester_scripts = ''

    html = html.replace('%TESTER_UI%', tester_ui)
    html = html.replace('%TESTER_SCRIPTS%', tester_scripts)
    write_text(OUT_DIR / "index.html", html)


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

    header_html = make_header("State Pages")
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
                {header_html}
                <div class='card'>
                    <h1 style='margin-top:0'>State Pages</h1>
                    <p class='legend'>All statewide pages. District pages are linked from Maine and Nebraska.</p>
                    <div class="small-links" id="top-links" style="padding: 4px; align-items: center; justify-content: center; display: flex;">
                        <a class="btn" href="state/NAT.html">NATIONAL</a>
                    </div>
                    {state_links_html}
                </div>
                <footer>{FOOTER_TEXT} Built as static HTML from CSV. Last updated: {LAST_UPDATED}</footer>
            </div>
        </body>
        </html>"""
    write_text(OUT_DIR / "state-pages.html", html)


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
            f'  <div class="table-wrap">{render_table(table_rows, basic_cols)}</div>\n'
            f'</div>'
        )
        table3_section = ''
        if third_cols:
            table3_section = (
                f'<div class="card">\n'
                f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(st, st)} ({st}) — Third-Party Data</h2>\n'
                f'  <div class="table-wrap">{render_table(table_rows, third_cols)}</div>\n'
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
            f'  <div class="table-wrap">{render_table(table_rows, tp_cols, two_party=True)}</div>\n'
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
            .replace("%DELTA_TOGGLE_JS%", DELTA_TOGGLE_JS)
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
            f'  <div class="table-wrap">{render_table(table_rows, basic_cols)}</div>\n'
            f'</div>'
        )
        table3_section = ''
        if third_cols:
            table3_section = (
                f'<div class="card">\n'
                f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(unit, unit)} ({unit}) — Third-Party Data</h2>\n'
                f'  <div class="table-wrap">{render_table(table_rows, third_cols)}</div>\n'
                f'</div>'
            )
        table2_section = (
            f'<div class="card">\n'
            f'  <h2 style="margin-top:0">{params.ABBR_TO_STATE.get(unit, unit)} ({unit}) — Two-Party Data</h2>\n'
            f'  <div class="table-wrap">{render_table(table_rows, tp_cols, two_party=True)}</div>\n'
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
            .replace("%DELTA_TOGGLE_JS%", DELTA_TOGGLE_JS)
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
        .replace("%DELTA_TOGGLE_JS%", DELTA_TOGGLE_JS)
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

        header_html = make_header("Presidential margins CSV")
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
                {header_html}
                <h1 style='margin-top:0'>presidential_margins.csv</h1>
                <p class='legend'>This page renders the primary CSV used to build the site. Download the raw data via the Data (CSV) navbar or <a href='presidential_margins.csv'>direct link</a>.</p>
                <div class='card table-wrap'>
                    <table class="presidential-margins-table"><thead><tr>{thead}</tr></thead><tbody>{''.join(body_rows)}</tbody></table>
                </div>
                <footer>{FOOTER_TEXT} Built from CSV. Last updated: {LAST_UPDATED}</footer>
            </div>
            <script>
                {DELTA_TOGGLE_JS}
            </script>
        </body>
        </html>"""
    write_text(OUT_DIR / "presidential_margins.html", html)


def make_methods_page():
        """Generate a simple Methods page with definitions and links.

        This is a starter content block that we can expand later.
        """
        header_html = make_header("Methods and Definitions")
        cap_pct = int(round(float(getattr(params, 'TESTER_PV_CAP', 0.25)) * 100))
        # Use the long-form explainer content configured in config.py
        try:
            explainer_html = EXPLANATION_TEXT.replace('{cap_pct}', str(cap_pct))
        except Exception:
            explainer_html = ""
        html = f"""<!doctype html>
        <html lang='en'>
        <head>
        <meta charset='utf-8'/>
        <meta name='viewport' content='width=device-width,initial-scale=1'/>
        <title>Methods • Margin Matters</title>
        <link rel='stylesheet' href='styles.css'/>
        <link rel="icon" href="favicon.svg" />
        </head>
        <body>
            <div class='container'>
                {header_html}
                <div class='card'>
                    <h1 style='margin-top:0'>Methods</h1>
                    <p class='legend'>Definitions, formulas, and caveats for all metrics used on this site.</p>
                    <hr/>
                    <h2>Metrics</h2>
                    <dl class='info-dl'>
                        <dt>Margin</dt>
                        <dd>D% − R% in a given unit (state or district). Specifically, (D-R)/total votes in unit.</dd>
                        <dt>National margin</dt>
                        <dd>Same formula but computed for the national vote.</dd>
                        <dt>Relative margin</dt>
                        <dd>State margin − National margin. Positive means the state is more Democratic than the country that year.</dd>
                        <dt>Delta</dt>
                        <dd>Difference vs previous cycle for the selected metric (e.g., margin(year) − margin(prev)).</dd>
                        <dt>Two-party</dt>
                        <dd>Calculations restricted to Democratic and Republican vote shares (excludes third-party share). So (D-R)/(D+R).</dd>
                        <dt>Third-party share</dt>
                        <dd>Share of votes for non-major-party candidates. In 1968 and some other years, some states have third-party pluralities.</dd>
                    </dl>
                      <h2>PV Stops and Uniform Swing</h2>
                      <p>On the Home page, we shift the national popular vote (PV) uniformly across states to estimate the Electoral College outcome. 
                      Stops represent notable points such as EVEN, Actual national margin, and state-specific tipping thresholds. 
                      For 1968, special third-party windows are highlighted.</p>
                      <div class='legend' style='margin-top:8px'>%EXPLAINER_HTML%</div>
                    <h2>ME/NE Districts</h2>
                    <p>Maine and Nebraska allocate some electoral votes by congressional district. Their statewide pages link to district views.</p>
                    <h2>Data</h2>
                    <p>See the Data page for the canonical CSV, or download directly as <a href='presidential_margins.csv'>Raw CSV</a>.</p>
                </div>
                <footer>{FOOTER_TEXT} Built from CSV. Last updated: {LAST_UPDATED}</footer>
            </div>
        </body>
        </html>"""
        html = html.replace('%EXPLAINER_HTML%', explainer_html)
        write_text(OUT_DIR / "methods.html", html)



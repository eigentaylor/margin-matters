# build_site.py
# Builds a static site from presidential_margins.csv and optional plots/ images.
# Output goes to ./site/
# No external Python deps; the index page uses D3/topojson/us-atlas from CDNs.
import csv
import os
import shutil
from pathlib import Path
from collections import defaultdict
import datetime
import params
import utils

CSV_PATH = Path("presidential_margins.csv")  # your provided file
OUT_DIR = Path("docs")          # output folder (for GitHub Pages)
STATE_DIR = OUT_DIR / "state"
UNIT_DIR = OUT_DIR / "unit"
PLOTS_SRC = Path("plots")         # optional local folder with images
PLOTS_DST = OUT_DIR / "plots"     # copied here if present

SMALL_STATES = ["DC", "DE", "RI", "CT", "NJ", "MD", "MA", "VT", "NH"]
ME_NE_STATES = {"ME-AL", "NE-AL"}

# timestamp used in footers (UTC at build time)
LAST_UPDATED = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M UTC")

FOOTER_TEXT = f"Site by eigentaylor.<br />Special thanks to Kiernan Park-Egan for providing Kenneth Black's congressional district presidential data.<br />Please report any innaccuracies to tayloreigenfisher@gmail.com ·"

# HTML templates (dark theme for comfy eyes)
BASE_CSS = r"""
:root{--bg:#0b0b0b;--fg:#f5f5f5;--muted:#a5a5a5;--accent:#66b3ff;--card:#141414;--border:#2a2a2a}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial}
a{color:var(--accent);text-decoration:none} a:hover{text-decoration:underline}
.container{max-width:1100px;margin:0 auto;padding:16px}
.header{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:16px}
.header h1{font-size:1.25rem;margin:0}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}
.grid{display:grid;grid-template-columns:1fr;gap:16px}
@media (min-width: 900px){.grid{grid-template-columns:2fr 1fr}}
.small-links{display:flex;flex-wrap:wrap;gap:8px}
.btn{display:inline-block;padding:10px 14px;background:#1e1e1e;border:1px solid var(--border);border-radius:10px}
.btn:focus{outline:2px solid var(--accent);outline-offset:2px}
footer{margin-top:24px;color:var(--muted);font-size:.9rem}
img.plot{width:100%;max-width:900px;display:block;margin:0 auto;border:1px solid var(--border);border-radius:10px;background:#000}
.table-wrap{overflow:auto;border-radius:10px;border:1px solid var(--border)}
table{width:100%;border-collapse:collapse;background:#111;border-left:1px solid var(--border);border-right:1px solid var(--border)}
th,td{padding:10px 12px;border-bottom:1px solid #1f1f1f;white-space:nowrap;text-align:center;border-right:1px solid var(--border)}
th{position:sticky;top:0;background:#161616}
tbody tr:hover{background:#151515}
/* Remove the right border from the last column for a cleaner edge */
thead th:last-child, tbody td:last-child {border-right: none}
.back{margin-bottom:12px;display:inline-block}
hr{border:none;border-top:1px solid var(--border);margin:16px 0}
.legend{color:var(--muted);font-size:.95rem}
.center{text-align:center}
/* Align raw values and inline delta consistently inside table cells */
.cell-inner{display:inline-grid;grid-auto-flow:column;align-items:center;gap:8px}
.cell-inner .raw{font-variant-numeric:tabular-nums;text-align:right;display:block}
.cell-inner .delta{color:var(--muted);white-space:nowrap;font-size:0.95rem}
/* Column explanations (definition list) styling */
.info-dl{display:grid;grid-template-columns:220px 1fr;gap:6px 16px;align-items:start;margin:0}
.info-dl dt{font-weight:700;color:var(--fg);margin:0;padding:6px 0}
.info-dl dd{margin:0;padding:6px 0;color:var(--muted);font-size:0.95rem}
@media (max-width:800px){.info-dl{grid-template-columns:1fr}}
"""

INDEX_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>U.S. Presidential Election State Results</title>
<link rel="stylesheet" href="styles.css" />
<link rel="icon" href="favicon.svg" />
</head>
<body>
<div class="container">
  <div class="header">
    <h1>U.S. Presidential Election State Results</h1>
    <span class="legend">Click a state to open its page</span>
  </div>
  <div class="grid">
    <div class="card">
      <div id="map-wrap" class="center">
        <svg id="map" width="100%" viewBox="0 0 975 610" aria-label="U.S. map"></svg>
      </div>
    </div>
    <div class="card">
        <h2 style="margin-top:0">State Links</h2>
        <!-- Top line: National quick link -->
        <div class="small-links" id="top-links">
          <a class="btn" href="state/NAT.html">NATIONAL</a>
        </div>
        <!-- Second line: small states populated by the map script -->
        <div class="small-links" id="small-links">
          <!-- small-state buttons inserted here by the map script -->
        </div>
        <!-- Third: Expanded state links (categorized into 4 columns) -->
        <div id="state-links">%STATE_LINKS%</div>
      <hr/>
      <p class="legend">Tip: Maine and Nebraska’s statewide pages include links to their district pages.</p>
    </div>
  </div>
  <footer>%FOOTER_TEXT%
  Built as static HTML from CSV. D3 + us-atlas map is loaded from CDNs.<br />
  Last updated: %LAST_UPDATED%</footer>
</div>

<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
<script src="https://cdn.jsdelivr.net/npm/topojson-client@3"></script>
<script>
const FIPS_TO_ABBR = {
  "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC",
  "12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA",
  "23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV",
  "33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA",
  "44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV",
  "55":"WI","56":"WY"
};
const SMALL_STATES = %SMALL_STATES_JSON%;

const svg = d3.select("#map");
const g = svg.append("g");
// Use an Albers USA projection so geographic coordinates from us-atlas
// are projected into the SVG viewBox correctly.
const projection = d3.geoAlbersUsa().scale(1300).translate([975/2, 610/2]);
const path = d3.geoPath().projection(projection);

fetch("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json")
  .then(r => r.json())
  .then(us => {
    const states = topojson.feature(us, us.objects.states).features;

    g.selectAll("path.state")
      .data(states)
      .join("path")
      .attr("class", "state")
      .attr("d", path)
      /* Slightly brighter default fill for better contrast */
      .attr("fill", "#2f2f2f")
      /* Slightly lighter stroke so state boundaries remain visible */
      .attr("stroke", "#5a5a5a")
      .attr("stroke-width", 0.8)
      .attr("tabindex", 0)
      /* Use the page accent color on hover for a more vibrant highlight */
      .on("mouseover", function() { d3.select(this).attr("fill", "#66b3ff"); })
      .on("mouseout",  function() { d3.select(this).attr("fill", "#2f2f2f"); })
      .on("click", (event, d) => {
        const abbr = FIPS_TO_ABBR[String(d.id).padStart(2,"0")];
        // For ME and NE we want the statewide page which is named ME-AL/NE-AL
        if (abbr === "ME" || abbr === "NE") {
          window.location.href = "state/" + abbr + ".html";
        } else if (abbr) {
          window.location.href = "state/" + abbr + ".html";
        }
      })
      .append("title")
      .text(d => {
        const abbr = FIPS_TO_ABBR[String(d.id).padStart(2,"0")];
        return abbr ? abbr : "Unknown";
      });

    // Small state buttons
    const links = d3.select("#small-links");
    SMALL_STATES.forEach(abbr => {
      links.append("a")
        .attr("class","btn")
        .attr("href","state/" + abbr + ".html")
        .text(abbr);
    });
  });
</script>
</body>
</html>
"""

PAGE_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>%TITLE%</title>
<link rel="stylesheet" href="../styles.css" />
<link rel="icon" href="../favicon.svg" />
</head>
<body>
<div class="container">
  <a class="back" href="../index.html">← Back to Map</a>
  <div class="header"><h1 style="margin:0">%HEADING%</h1></div>
  %PLOT_SECTION%
  %EXTRA_LINKS%
  %TABLE1_SECTION%
  %TABLE3_SECTION%
  %PLOT3_SECTION%
  %TABLE2_SECTION%
  <footer>%FOOTER_TEXT%</footer>
</div>
</body>
</html>
"""

def read_csv(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"CSV not found: {path}")
    with path.open("r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = [dict(r) for r in reader]
    # normalize header names (strip spaces)
    for r in rows:
        for k in list(r.keys()):
            v = r.pop(k)
            r[k.strip()] = v.strip() if isinstance(v, str) else v
    return rows

def columns_for_table(headers):
  # If params.TABLE_COLUMNS provided, accept either list of names or list of (name,label)
  if params.TABLE_COLUMNS is not None:
    user_cols = params.TABLE_COLUMNS
    out = []
    seen = set()
    for item in user_cols:
      if isinstance(item, (list, tuple)) and item:
        name = item[0]
      else:
        name = item
      if name in headers and name not in seen:
        out.append(name); seen.add(name)
    return out

  cols = ["year", "D_votes", "R_votes"]
  for h in headers:
    if "str" in h.lower() and h not in cols:
      cols.append(h)
  # keep only existing & unique
  seen = set()
  out = []
  for c in cols:
    if c in headers and c not in seen:
      out.append(c); seen.add(c)
  return out

def split_columns_into_three(headers):
  """Split available headers into (basic, third_party, two_party) lists.
  - basic: columns NOT containing 'two_party' or 'third'/'3p' indicators
  - third_party: columns indicating third-party share/pct
  - two_party: columns containing 'two_party'
  Keep 'year' first when present. Respect params.TABLE_COLUMNS order if provided.
  """
  if params.TABLE_COLUMNS is not None:
    ordered = []
    seen = set()
    for item in params.TABLE_COLUMNS:
      name = item[0] if isinstance(item, (list, tuple)) else item
      if name in headers and name not in seen:
        ordered.append(name); seen.add(name)
  else:
    ordered = columns_for_table(headers)

  basic, third, tp = [], [], []
  if 'year' in ordered:
    basic.append('year'); third.append('year'); tp.append('year')
  if 'electoral_votes' in ordered:
    basic.append('electoral_votes'); tp.append('electoral_votes')
  if 'D_votes' in ordered:
    basic.append('D_votes'); third.append('D_votes'); tp.append('D_votes')
  if 'R_votes' in ordered:
    basic.append('R_votes'); third.append('R_votes'); tp.append('R_votes')
  for c in ordered:
    if c == 'year' or c == 'D_votes' or c == 'R_votes' or c == 'electoral_votes':
      continue
    lname = c.lower()
    # skip explicit delta columns (we'll render them inline with their base columns)
    if lname.endswith('_delta_str') or lname.endswith('_delta'):
      continue
    if 'two_party' in lname:
      if c not in tp:
        tp.append(c)
    elif 'third' in lname or '3p' in lname or c in ('T_votes', 'T_pct', 'third_party_share', 'third_party_relative_share', 'third_party_national_share'):
      if c not in third:
        third.append(c)
    else:
      if c not in basic:
        basic.append(c)
  return basic, third, tp

def group_by_abbr(rows):
    g = defaultdict(list)
    for r in rows:
        abbr = r.get("abbr","").strip()
        if abbr:
            g[abbr].append(r)
    # sort each group by year (if convertible)
    for k in g:
        g[k].sort(key=lambda r: int(r.get("year", 0)))
    return g

def render_table(rows, cols, two_party=False):
  # basic escape
  def esc(x):
    s = "" if x is None else str(x)
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

  # format certain numeric columns (commas for thousands)
  def format_value(col, val):
    if val is None or val == '0' or val == '0.0':
      return ""
    s = str(val)
    # render vote counts with thousands separators
    if col in ("D_votes", "R_votes", "T_votes", "total_votes"):
      try:
        # allow existing commas by removing them first
        n = int(s.replace(",", ""))
        return f"{n:,}"
      except Exception:
        return s
    return s

  # Build header label map from params.TABLE_COLUMNS when provided
  # header map uses the same logic as get_header_map so the table labels
  # and the info box stay consistent.
  header_map = get_header_map(cols)

  thead = "<thead><tr>" + "".join(f"<th>{esc(header_map.get(c, c))}</th>" for c in cols) + "</tr></thead>"
  body = "<tbody>"
  # helper to parse integers from possibly-formatted strings
  def parse_int(v):
    if v is None:
      return None
    try:
      return int(str(v).replace(",", ""))
    except Exception:
      return None

  for r in rows:
    cells = []
    # parse D and R counts once per row to compute percentages
    d_raw = r.get("D_votes", "")
    r_raw = r.get("R_votes", "")
    t_raw = r.get("T_votes", "")
    d_val = parse_int(d_raw)
    r_val = parse_int(r_raw)
    t_val = parse_int(t_raw)
    denom = None
    if d_val is not None and r_val is not None:
      if two_party:
        denom = d_val + r_val
      else:
        denom = d_val + r_val + (t_val if t_val is not None else 0)

    for c in cols:
      if c in ("D_votes", "R_votes", "T_votes"):
        # format votes with thousands separators when possible
        if c == "D_votes":
          vote_val = d_val
        elif c == "R_votes":
          vote_val = r_val
        else:
          vote_val = t_val

        if vote_val is None:
          # fallback to original formatting function for non-numeric
          cell = esc(format_value(c, r.get(c, "")))
        else:
          votes_str = f"{vote_val:,}"
          # compute pct only when denominator > 0
          if denom and denom > 0:
            pct = (vote_val / denom) * 100
            pct_str = f"{pct:.1f}%"
            cell = esc(f"{votes_str}({pct_str})")
          else:
            cell = esc(votes_str)
      else:
        # Combine inline delta for *_str columns when available
        raw_val = format_value(c, r.get(c, ""))
        if c.endswith('_str') and not c.endswith('_delta_str'):
          # Render the raw value and delta in separate spans so CSS can align them
          delta_col = c[:-4] + '_delta_str'
          delta_val = r.get(delta_col, "")
          raw_esc = esc(raw_val)
          if isinstance(delta_val, str) and delta_val != "0" and delta_val != "0.0" and delta_val.strip() != "":
            delta_esc = esc(delta_val)
            # two spans: raw value and muted delta
            cell = f'<span class="cell-inner"><span class="raw">{raw_esc}</span><span class="delta">(Δ {delta_esc})</span></span>'
          else:
            cell = f'<span class="cell-inner"><span class="raw">{raw_esc}</span><span class="delta"></span></span>'
        else:
          cell = esc(raw_val)
      cells.append(f"<td>{cell}</td>")
    body += "<tr>" + "".join(cells) + "</tr>"
  body += "</tbody>"
  return f"<table>{thead}{body}</table>"


def get_header_map(cols):
  """Return a mapping of column_name -> display_label using params.TABLE_COLUMNS
  when present, otherwise identity map for the provided cols list."""
  if params.TABLE_COLUMNS is not None:
    header_labels = []
    for item in params.TABLE_COLUMNS:
      if isinstance(item, (list, tuple)) and len(item) >= 2:
        header_labels.append((item[0], item[1]))
      else:
        header_labels.append((item, item))
    # preserve order but map to first matching label
    return {k: v for k, v in header_labels}
  return {c: c for c in cols}


def describe_column(col):
  """Return a short human-readable description for common column names."""
  k = col.lower()
  if k == 'year':
    return 'Election year.'
  if k in ('d_votes', 'd_votes'.lower()):
    return 'Number of votes for the Democratic candidate (raw count(pct%)).'
  if k in ('r_votes',):
    return 'Number of votes for the Republican candidate (raw count(pct%)).'
  if k in ('t_votes',):
    return 'Number of votes for third-party (other) candidates (raw count(pct%)).'
  if 'pct' in k:
    return 'Percentage share of the vote.'
  if 'delta' in k:
    return 'Change (delta) in the value from the previous election year. Blank if no data for previous year.'
  if 'pres_margin' in k:
    return 'Margin between the two major-party candidates ((D - R)/(D + R)).' if params.USE_TWO_PARTY_MARGIN else 'Margin between the two major-party candidates, including third-party votes ((D - R)/total).'
  if 'national_margin' in k:
    return 'The national presidential margin for that year ((D_total - R_total)/(D_total + R_total)).' if params.USE_TWO_PARTY_MARGIN else 'The national presidential margin for that year, including third-party votes ((D_total - R_total)/total_votes).'
  if 'relative_margin' in k:
    return 'The presidential margin relative to the national presidential margin (Margin - Nat. Margin).'
  if 'abbr' in k:
    return 'State or unit abbreviation.'
  if 'total_votes' in k:
    return 'Total voter turnout or ballots cast (when provided).'
  if 'electoral_votes' in k:
    return 'Number of electoral votes allocated to this state or unit.'
  if 'two_party_margin' in k:
    return 'Margin between the two major-party candidates, ignoring third-party votes ((D - R)/(D + R)).'
  if 'third_party_share' in k:
    return 'Share of the vote received by third-party (other) candidates.'
  if 'third_party_relative_share' in k:
    return 'Third-party share relative to the national third-party share (3rd-Party share - Nat. 3rd-Party share).'
  if 'third_party_national_share' in k:
    return 'The national third-party share for that year (3rd-Party votes / total votes).'
  # fallback
  return 'Value from the CSV for this column.'


def render_info_box(cols):
  """Return HTML for an explanatory info box describing each column in cols.
  Uses header display labels when available.
  """
  header_map = get_header_map(cols)
  # Build a definition list for readability
  items = []
  done_delta = False
  for c in cols:
    label = header_map.get(c, c)
    if 'margin' in c.lower():
      done_delta = True
    desc = describe_column(c)
    items.append(f"<dt>{label}</dt><dd>{desc}</dd>")
  # always include delta explanation if any delta columns present
  if done_delta and "Δ" not in [item[4:-5] for item in items if item.startswith("<dt>")]:
    items.insert(0, f"<dt>Δ</dt><dd>Change (delta) in the value from the previous election year.</dd>")
  dl_inner = "".join(items)
  dl = f"<div class=\"card\"><h3 style=\"margin-top:0\">Column explanations</h3><dl class=\"info-dl\">{dl_inner}</dl></div>"
  return dl


# a simple ballot-themed SVG favicon (keeps repo dependency-free)
FAVICON_SVG = r'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0b0b0b"/>
  <rect x="9" y="22" width="46" height="26" rx="3" fill="#ffffff"/>
  <rect x="16" y="8" width="32" height="18" rx="2" fill="#ffd166"/>
  <path d="M20 28 L28 36 L44 20" stroke="#0b0b0b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>'''

def ensure_dirs():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    UNIT_DIR.mkdir(parents=True, exist_ok=True)

def write_text(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")

def make_index(states_sorted):
  # Build categorized state links in 4 columns for easier navigation
  # Use params.ABBR_TO_STATE to get full names and sort alphabetically by state name
  state_items = sorted([(abbr, str(params.ABBR_TO_STATE.get(abbr) or abbr)) for abbr in states_sorted], key=lambda x: x[0])
  # split into 4 roughly-even columns
  cols = [[], [], [], []]
  for i, item in enumerate(state_items):
    cols[i % 4].append(item)

  col_html = []
  for col in cols:
    items = "".join(f'<a class="btn" href="state/{abbr}.html">{abbr[:2]}</a>' for abbr, _ in col)
    col_html.append(f'<div class="card" style="padding:8px">{items}</div>')

  state_links_html = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">' + "".join(col_html) + '</div>'

  html = INDEX_HTML.replace("%SMALL_STATES_JSON%", str(SMALL_STATES))
  html = html.replace("%STATE_LINKS%", state_links_html)
  html = html.replace("%LAST_UPDATED%", LAST_UPDATED)
  html = html.replace("%FOOTER_TEXT%", FOOTER_TEXT)
  write_text(OUT_DIR / "index.html", html)

def titleize_unit(unit):
    return unit

def build_pages(rows):
  headers = list(rows[0].keys())
  cols = columns_for_table(headers)
  basic_cols, third_cols, tp_cols = split_columns_into_three(headers)
  by_abbr = group_by_abbr(rows)

  # derive states (two-letter codes) present
  states = sorted({abbr for abbr in by_abbr.keys() if (len(abbr) == 2 or '-AL' in abbr)})
  # derive district units (ME-01 etc.)
  district_units = sorted({abbr for abbr in by_abbr.keys() if "-" in abbr})

  # state pages
  for st in states:
    # data source rows for the page
    table_rows = by_abbr.get(st, [])
    # extra links to districts (ME/NE statewide)
    extra_links = ""
    if st in ME_NE_STATES:
      dlist = sorted([u for u in district_units if u.startswith(st[:2] + "-")])
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

    # three plots: plot1, plot2, plot3; two tables: basic under plot1+plot2, two-party under plot3
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

    page = (
      PAGE_HTML
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

  # district/unit pages
  for unit in district_units:
    if unit.endswith("-AL"):
      continue  # AL already covered on the state page
    table_rows = by_abbr.get(unit, [])
    # list district pages that actually exist in CSV
    dlist = sorted([u for u in district_units if u.startswith(unit[:2] + "-")])
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

    page = (
      PAGE_HTML
      .replace("%TITLE%", f"{unit} · District")
      .replace("%HEADING%", f"{params.ABBR_TO_STATE.get(unit, unit)} ({unit})")
      .replace("%PLOT_SECTION%", plot_section)
      .replace("%EXTRA_LINKS%", extra_links)
  .replace("%TABLE1_SECTION%", table1_section)
  .replace("%TABLE3_SECTION%", table3_section)
      .replace("%PLOT3_SECTION%", plot3_section)
      .replace("%TABLE2_SECTION%", table2_section)
    )
    page = page.replace("%LAST_UPDATED%", LAST_UPDATED)
    write_text(UNIT_DIR / f"{unit}.html", page)

  # --- NATIONAL page -------------------------------------------------------
  # Build a simple national table by aggregating CSV rows by year. We prefer
  # sums for vote counts and means for margins/national_margin-like columns.
  from collections import defaultdict
  year_groups = defaultdict(list)
  for r in rows:
    y = r.get("year")
    try:
      yi = int(y)
    except Exception:
      continue
    year_groups[yi].append(r)

  national_rows = []
  nat_cols = []
  for y in sorted(year_groups.keys()):
    grp = year_groups[y]
    out = {}
    for h in headers:
      if h == 'year':
        out[h] = y
        continue
      val = ''
      # Sum obvious vote columns
      if h in ("D_votes", "R_votes", "T_votes", "total_votes"):
        s = 0
        any_v = False
        for rr in grp:
          if rr.get("abbr","") == "NATIONAL":
            continue
          v = rr.get(h, '')
          try:
            s += int(str(v).replace(',', ''))
            any_v = True
          except Exception:
            pass
        val = s if any_v else ''
      # For margin-like and national-like columns take the mean
      elif 'str' in h and ('national' in h.lower() or 'national' in h):
        nums = []
        for rr in grp:
          v = rr.get(h, '')
          if h not in out:
              out[h] = v
              break
        continue
      else:
        # remove columns not handled above
        # (e.g. abbr, pres_margin, relative_margin, etc.)
        continue
      out[h] = val
    # add two party margin if not params.USE_TWO_PARTY_MARGIN
    if not params.USE_TWO_PARTY_MARGIN:
      d = out.get('D_votes')
      r = out.get('R_votes')
      if isinstance(d, int) and isinstance(r, int) and (d + r) > 0:
        out['two_party_margin'] = utils.lean_str((d - r) / (d + r))
    for h in out:
      if h not in nat_cols:
        nat_cols.append(h)
    national_rows.append(out)
    

  # Split NAT columns and build two tables
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

def main():
    ensure_dirs()
    # write CSS
    write_text(OUT_DIR / "styles.css", BASE_CSS)
    # write favicon
    write_text(OUT_DIR / "favicon.svg", FAVICON_SVG)

    # copy plots folder if present (don't include subfolders)
    if PLOTS_SRC.exists() and PLOTS_SRC.is_dir():
        PLOTS_DST.mkdir(parents=True, exist_ok=True)
        for item in PLOTS_SRC.iterdir():
            if item.is_file():
                shutil.copy2(item, PLOTS_DST / item.name)

    rows = read_csv(CSV_PATH)
    states = build_pages(rows)
    make_index(states)
    print(f"Done. Open {OUT_DIR/'index.html'} in a browser or deploy /docs to GitHub Pages.")

if __name__ == "__main__":
    main()

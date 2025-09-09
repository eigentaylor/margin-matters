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

CSV_PATH = Path("presidential_margins.csv")  # your provided file
OUT_DIR = Path("docs")          # output folder (for GitHub Pages)
STATE_DIR = OUT_DIR / "state"
UNIT_DIR = OUT_DIR / "unit"
PLOTS_SRC = Path("plots")         # optional local folder with images
PLOTS_DST = OUT_DIR / "plots"     # copied here if present

SMALL_STATES = ["DC", "DE", "RI", "CT", "NJ", "MD", "MA", "VT", "NH"]
ME_NE_STATES = {"ME-AL", "NE-AL"}

# timestamp used in footers (UTC at build time)
LAST_UPDATED = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

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
img.plot{width:100%;max-width:900px;display:block;border:1px solid var(--border);border-radius:10px;background:#000}
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
"""

INDEX_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>US Presidential Map</title>
<link rel="stylesheet" href="styles.css" />
<link rel="icon" href="favicon.svg" />
</head>
<body>
<div class="container">
  <div class="header">
    <h1>U.S. Presidential Election Explorer</h1>
    <span class="legend">Click a state to open its page</span>
  </div>
  <div class="grid">
    <div class="card">
      <div id="map-wrap" class="center">
        <svg id="map" width="100%" viewBox="0 0 975 610" aria-label="U.S. map"></svg>
      </div>
    </div>
    <div class="card">
        <h2 style="margin-top:0">Small States · Quick Links</h2>
        <div class="small-links" id="small-links">
          <!-- Add a National quick link (NAT) -->
          <a class="btn" href="state/NAT.html">NAT</a>
        </div>
      <hr/>
      <p class="legend">Tip: Maine and Nebraska’s statewide pages include links to their district pages.</p>
    </div>
  </div>
  <footer>Site by eigentaylor. Built as static HTML from CSV. D3 + us-atlas map is loaded from CDNs. Please report any innaccuracies to tayloreigenfisher@gmail.com · Last updated: %LAST_UPDATED%</footer>
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
      .attr("fill", "#222")
      .attr("stroke", "#4a4a4a")
      .attr("stroke-width", 0.8)
      .attr("tabindex", 0)
      .on("mouseover", function() { d3.select(this).attr("fill", "#2b2b2b"); })
      .on("mouseout",  function() { d3.select(this).attr("fill", "#222"); })
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
  <div class="card center">
    <img class="plot" alt="Trend plot for %LABEL%" src="%IMG_SRC%">
    <div class="legend" style="margin-top:8px">%IMG_NOTE%</div>
  </div>
  %EXTRA_LINKS%
  <div class="card">
    <h2 style="margin-top:0">%TABLE_HEADING%</h2>
    <div class="table-wrap">
      %TABLE_HTML%
    </div>
  </div>
  <footer>Site by eigentaylor. Please report any innaccuracies to tayloreigenfisher@gmail.com · Last updated: %LAST_UPDATED%</footer>
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

def render_table(rows, cols):
  # basic escape
  def esc(x):
    s = "" if x is None else str(x)
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

  # format certain numeric columns (commas for thousands)
  def format_value(col, val):
    if val is None:
      return ""
    s = str(val)
    # render vote counts with thousands separators
    if col in ("D_votes", "R_votes"):
      try:
        # allow existing commas by removing them first
        n = int(s.replace(",", ""))
        return f"{n:,}"
      except Exception:
        return s
    return s

  # Build header label map from params.TABLE_COLUMNS when provided
  if params.TABLE_COLUMNS is not None:
    header_labels = []
    for item in params.TABLE_COLUMNS:
      if isinstance(item, (list, tuple)) and len(item) >= 2:
        header_labels.append((item[0], item[1]))
      else:
        header_labels.append((item, item))
    header_map = {k: v for k, v in header_labels}
  else:
    header_map = {c: c for c in cols}

  thead = "<thead><tr>" + "".join(f"<th>{esc(header_map.get(c, c))}</th>" for c in cols) + "</tr></thead>"
  body = "<tbody>"
  for r in rows:
    body += "<tr>" + "".join(f"<td>{esc(format_value(c, r.get(c, '')))}</td>" for c in cols) + "</tr>"
  body += "</tbody>"
  return f"<table>{thead}{body}</table>"


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
  html = INDEX_HTML.replace("%SMALL_STATES_JSON%", str(SMALL_STATES))
  html = html.replace("%LAST_UPDATED%", LAST_UPDATED)
  write_text(OUT_DIR / "index.html", html)

def titleize_unit(unit):
    return unit

def build_pages(rows):
  headers = list(rows[0].keys())
  cols = columns_for_table(headers)
  by_abbr = group_by_abbr(rows)

  # derive states (two-letter codes) present
  states = sorted({abbr for abbr in by_abbr.keys() if (len(abbr) == 2 or '-AL' in abbr)})
  # derive district units (ME-01 etc.)
  district_units = sorted({abbr for abbr in by_abbr.keys() if "-" in abbr})

  # state pages
  for st in states:
    label = st
    # data source rows for the page
    table_rows = by_abbr.get(st, [])
    img_src = f"../plots/{st}_trend.png"
    if st in ME_NE_STATES:
      img_note = f"{params.ABBR_TO_STATE.get(st, st)} ({st}) statewide"
    else:
      img_note = f"{params.ABBR_TO_STATE.get(st, st)} ({st}) statewide"
    if not table_rows:
      # if no rows, still generate a minimal page
      img_note += " · (no rows found in CSV)"
    extra_links = ""
    if st in ME_NE_STATES:
      # list district pages that actually exist in CSV
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

    page = (
      PAGE_HTML
      .replace("%TITLE%", f"{st} · State")
      .replace("%HEADING%", f"{params.ABBR_TO_STATE.get(st, st)} ({st}) — Statewide")
      .replace("%LABEL%", label)
      .replace("%IMG_SRC%", img_src)
      .replace("%IMG_NOTE%", img_note)
      .replace("%EXTRA_LINKS%", extra_links)
      .replace("%TABLE_HEADING%", f"{params.ABBR_TO_STATE.get(st, st)} ({st}) — Data")
      .replace("%TABLE_HTML%", render_table(table_rows, cols))
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

    page = (
      PAGE_HTML
      .replace("%TITLE%", f"{unit} · District")
      .replace("%HEADING%", f"{params.ABBR_TO_STATE.get(unit, unit)} ({unit})")
      .replace("%LABEL%", unit)
      .replace("%IMG_SRC%", f"../plots/{unit}_trend.png")
      .replace("%IMG_NOTE%", f"{unit} district")
      .replace("%EXTRA_LINKS%", extra_links)
      .replace("%TABLE_HEADING%", f"{params.ABBR_TO_STATE.get(unit, unit)} ({unit}) — Data")
      .replace("%TABLE_HTML%", render_table(table_rows, cols))
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
      if h in ("D_votes", "R_votes"):
        s = 0
        any_v = False
        for rr in grp:
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
    for h in out:
      if h not in nat_cols:
        nat_cols.append(h)
    national_rows.append(out)
    

  # Write national page under state/ to match other quick links
  img_src = f"../plots/NATIONAL_trend.png"
  img_note = "National summary"
  page = (
    PAGE_HTML
    .replace("%TITLE%", f"NAT · National")
    .replace("%HEADING%", f"National (NAT)")
    .replace("%LABEL%", "NAT")
    .replace("%IMG_SRC%", img_src)
    .replace("%IMG_NOTE%", img_note)
    .replace("%EXTRA_LINKS%", "")
    .replace("%TABLE_HEADING%", "National — Data")
    .replace("%TABLE_HTML%", render_table(national_rows, nat_cols))
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

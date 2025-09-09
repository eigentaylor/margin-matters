# build_site.py
# Builds a static site from presidential_margins.csv and optional plots/ images.
# Output goes to ./site/
# No external Python deps; the index page uses D3/topojson/us-atlas from CDNs.
import csv
import os
import shutil
from pathlib import Path
from collections import defaultdict

CSV_PATH = Path("presidential_margins.csv")  # your provided file
OUT_DIR = Path("docs")          # output folder (for GitHub Pages)
STATE_DIR = OUT_DIR / "state"
UNIT_DIR = OUT_DIR / "unit"
PLOTS_SRC = Path("plots")         # optional local folder with images
PLOTS_DST = OUT_DIR / "plots"     # copied here if present

SMALL_STATES = ["DC", "DE", "RI", "CT", "NJ", "MD", "MA", "VT", "NH"]
ME_NE_STATES = {"ME", "NE"}

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
table{width:100%;border-collapse:collapse;background:#111}
th,td{padding:10px 12px;border-bottom:1px solid #1f1f1f;white-space:nowrap}
th{position:sticky;top:0;background:#161616}
tbody tr:hover{background:#151515}
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
</head>
<body>
<div class="container">
  <div class="header">
    <h1>U.S. Presidential Election Explorer</h1>
    <span class="legend">Static alpha · click a state to open its page</span>
  </div>
  <div class="grid">
    <div class="card">
      <div id="map-wrap" class="center">
        <svg id="map" width="100%" viewBox="0 0 975 610" aria-label="U.S. map"></svg>
      </div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Small States · Quick Links</h2>
      <div class="small-links" id="small-links"></div>
      <hr/>
      <p class="legend">Tip: Maine and Nebraska’s statewide pages include big links to their district pages.</p>
    </div>
  </div>
  <footer>Built as static HTML from CSV. D3 + us-atlas map is loaded from CDNs.</footer>
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
        if (abbr) window.location.href = "state/" + abbr + ".html";
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
  <footer>Data from presidential_margins.csv</footer>
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
        return (s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;"))
    thead = "<thead><tr>" + "".join(f"<th>{esc(c)}</th>" for c in cols) + "</tr></thead>"
    body = "<tbody>"
    for r in rows:
        body += "<tr>" + "".join(f"<td>{esc(r.get(c,''))}</td>" for c in cols) + "</tr>"
    body += "</tbody>"
    return f"<table>{thead}{body}</table>"

def ensure_dirs():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    UNIT_DIR.mkdir(parents=True, exist_ok=True)

def write_text(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")

def make_index(states_sorted):
    html = INDEX_HTML.replace("%SMALL_STATES_JSON%", str(SMALL_STATES))
    write_text(OUT_DIR / "index.html", html)

def titleize_unit(unit):
    return unit

def build_pages(rows):
    headers = list(rows[0].keys())
    cols = columns_for_table(headers)
    by_abbr = group_by_abbr(rows)

    # derive states (two-letter codes) present
    states = sorted({abbr for abbr in by_abbr.keys() if len(abbr) == 2 and abbr.isalpha()})
    # derive district units (ME-01 etc.)
    district_units = sorted({abbr for abbr in by_abbr.keys() if "-" in abbr})

    # state pages
    for st in states:
        label = st
        # data source rows for the page
        if st in ME_NE_STATES and f"{st}-AL" in by_abbr:
            table_rows = by_abbr[f"{st}-AL"]
            img_src = f"../plots/{st}-AL_trend.png"
            img_note = f"{st} statewide (AL)"
        else:
            table_rows = by_abbr.get(st, [])
            img_src = f"../plots/{st}_trend.png"
            img_note = f"{st} statewide"
        if not table_rows:
            # if no rows, still generate a minimal page
            img_note += " · (no rows found in CSV)"
        extra_links = ""
        if st in ME_NE_STATES:
            # list district pages that actually exist in CSV
            dlist = sorted([u for u in district_units if u.startswith(st+"-") and not u.endswith("-AL")])
            if dlist:
                items = "".join(
                    f'<a class="btn" href="../unit/{u}.html">{u}</a>' for u in dlist
                )
                extra_links = f'<div class="card"><h2 style="margin-top:0">{st} Districts</h2><div class="small-links">{items}</div></div>'
        page = (PAGE_HTML
                .replace("%TITLE%", f"{st} · State")
                .replace("%HEADING%", f"{st} — Statewide")
                .replace("%LABEL%", label)
                .replace("%IMG_SRC%", img_src)
                .replace("%IMG_NOTE%", img_note)
                .replace("%EXTRA_LINKS%", extra_links)
                .replace("%TABLE_HEADING%", f"{st} — Data")
                .replace("%TABLE_HTML%", render_table(table_rows, cols)))
        write_text(STATE_DIR / f"{st}.html", page)

    # district/unit pages
    for unit in district_units:
        if unit.endswith("-AL"):
            continue  # AL already covered on the state page
        table_rows = by_abbr.get(unit, [])
        page = (PAGE_HTML
                .replace("%TITLE%", f"{unit} · District")
                .replace("%HEADING%", f"{unit}")
                .replace("%LABEL%", unit)
                .replace("%IMG_SRC%", f"../plots/{unit}_trend.png")
                .replace("%IMG_NOTE%", f"{unit} district")
                .replace("%EXTRA_LINKS%", "")
                .replace("%TABLE_HEADING%", f"{unit} — Data")
                .replace("%TABLE_HTML%", render_table(table_rows, cols)))
        write_text(UNIT_DIR / f"{unit}.html", page)

    return states

def main():
    ensure_dirs()
    # write CSS
    write_text(OUT_DIR / "styles.css", BASE_CSS)

    # copy plots folder if present
    if PLOTS_SRC.exists() and PLOTS_SRC.is_dir():
        shutil.copytree(PLOTS_SRC, PLOTS_DST, dirs_exist_ok=True)

    rows = read_csv(CSV_PATH)
    states = build_pages(rows)
    make_index(states)
    print(f"Done. Open {OUT_DIR/'index.html'} in a browser or deploy /docs to GitHub Pages.")

if __name__ == "__main__":
    main()

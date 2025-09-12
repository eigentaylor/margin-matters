"""
Generate a self-contained ranking tool page (docs/ranker.html) that lets users:
- pick a year (slider)
- pick a metric (e.g., relative_margin, relative_margin_delta, two_party_relative_margin, etc.)
- sort ascending/descending or by absolute value

The page embeds a compact JSON payload produced from presidential_margins.csv, so no extra data
files need to be published under docs/.

Run:
  python tools/build_ranker_page.py
"""
from __future__ import annotations

import csv
import html
import json
from pathlib import Path
from typing import Any, Dict
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "presidential_margins.csv"
DOCS = ROOT / "docs"
OUT = DOCS / "ranker.html"

# Only export a curated set of metrics to keep the embedded JSON small
METRICS = [
    "pres_margin",
    "pres_margin_delta",
    "relative_margin",
    "relative_margin_delta",
    "two_party_margin",
    "two_party_margin_delta",
    "two_party_relative_margin",
    "two_party_relative_margin_delta",
    "third_party_share",
    "third_party_relative_share",
]

# For each metric, also export a *_str column when present for nicer labels
def str_col(name: str) -> str:
    if name.endswith("_str"):
        return name
    return f"{name}_str"

# Treat these as the 51 statewide units + ME/NE congressional districts
STATE_FILTER = set([
    # 2-letter states and DC
    "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
    "IA","KS","KY","LA","ME-AL","MD","MA","MI","MN","MS","MO","MT","NE-AL","NV","NH",
    "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
    "VT","VA","WA","WV","WI","WY",
    #"ME-AL","NE-AL",  # statewide aggregations for ME and NE
    "ME-01","ME-02","NE-01","NE-02","NE-03",  # congressional districts
])

def normalize_abbr(abbr: str) -> tuple[str, bool]:
    """Return (state_abbr, is_statewide_district_agg) mapping ME-AL/NE-AL to 2-letter codes.
    Anything like ME-01/NE-02 is excluded elsewhere.
    """
    # if abbr == "ME-AL":
    #     return "ME", True
    # if abbr == "NE-AL":
    #     return "NE", True
    return abbr, False


def load_rows(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        rdr = csv.DictReader(f)
        rows = [dict(r) for r in rdr]
    # best-effort numeric coercion for relevant columns
    for r in rows:
        for k, v in list(r.items()):
            if v is None:
                continue
            vv = v.strip()
            if vv == "":
                continue
            # Only coerce the metric columns and a few known numeric fields
            if k in METRICS or k in {"year", "electoral_votes"}:
                try:
                    r[k] = float(vv)
                except ValueError:
                    # leave as-is (string column like *_str)
                    pass
    return rows


def build_payload(rows: list[dict]):
  per_year: Dict[int, Dict[str, Dict[str, Any]]] = {}

  for r in rows:
    abbr_raw = r.get("abbr", "")
    if not abbr_raw or abbr_raw == "NATIONAL":
      continue
    # Skip CD rows like ME-01; keep statewide ME-AL/NE-AL and 2-letter states
    # if "-" in abbr_raw and not abbr_raw.endswith("-AL"):
    #   continue
    abbr, _ = normalize_abbr(abbr_raw)
    if abbr not in STATE_FILTER:
      continue
    y = int(r["year"]) if r.get("year") else None
    if not y:
      continue

    dest = per_year.setdefault(y, {})

    # build the metric object for this state/year
    entry: Dict[str, Any] = {"abbr": abbr}
    ev = r.get("electoral_votes")
    if isinstance(ev, (int, float)):
      entry["electoral_votes"] = ev

    for m in METRICS:
      if m in r:
        entry[m] = r[m]
      sc = str_col(m)
      if sc in r:
        entry[sc] = r[sc]

    dest[abbr] = entry

  years_sorted = sorted(per_year.keys())
  payload = {
    "years": years_sorted,
    "states": sorted(list(STATE_FILTER)),
    "metrics": METRICS,
    "data": per_year,
    "lastUpdated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
  }
  return payload


def make_page(payload: dict) -> str:
  # human-friendly names for a few keys
  meta_options = {
    "pres_margin": "State margin (D minus R)",
    "pres_margin_delta": "State margin delta from previous election",
    "relative_margin": "Relative margin (State minus national)",
    "relative_margin_delta": "Change in relative margin vs last election",
    "two_party_margin": "Two-party margin (excludes 3rd party)",
    "two_party_margin_delta": "Two-party margin delta",
    "two_party_relative_margin": "Two-party lean vs national",
    "two_party_relative_margin_delta": "Two-party lean delta",
    "third_party_share": "Third-party share",
    "third_party_relative_share": "Third-party share minus national",
  }

  payload_json = json.dumps(payload, separators=(',', ':'))
  meta_json = json.dumps(meta_options, separators=(',', ':'))

  # JS template (not an f-string) with placeholders replaced below
  script_template = r"""
  window.RANKER_DATA = __PAYLOAD__;
  (function(){
    const $ = (sel, el=document) => el.querySelector(sel);
    const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
    const data = window.RANKER_DATA; const meta = __META__;

    // state
    let selectedYear = data.years[data.years.length-1];
    let base = 'margin';
    let twoParty = false; let relative = false; let delta = false;
    let useAbs = false; let reverse = false;

    const yearMin = data.years[0]; const yearMax = data.years[data.years.length-1];

    function buildMetricKey(){
      if(base==='third_party_share') return relative ? 'third_party_relative_share' : 'third_party_share';
      if(twoParty){ if(relative && delta) return 'two_party_relative_margin_delta';
        if(relative) return 'two_party_relative_margin'; if(delta) return 'two_party_margin_delta'; return 'two_party_margin'; }
      if(relative && delta) return 'relative_margin_delta'; if(relative) return 'relative_margin'; if(delta) return 'pres_margin_delta'; return 'pres_margin'; }

    function niceStr(abbr,m,rec){
      const sc = m + '_str'; if(rec && rec[sc]!=null && rec[sc] !== '') return rec[sc];
      const v = rec ? rec[m] : null; if(v==null || isNaN(v)) return '—';
      if(String(m).includes('margin')){
        const sign = v>0 ? 'D' : (v<0 ? 'R' : 'EVEN');
        const pct = Math.abs(v*100).toFixed(1) + '%';
        return sign==='EVEN' ? 'EVEN' : (sign+'+'+pct);
      }
      if(String(m).includes('share')) return (v*100).toFixed(2) + '%';
      return v.toFixed(4);
    }

    function metricDisplayName(){
      if(base==='third_party_share') return 'Third-party share' + (relative ? ' (relative)' : '');
      let s = twoParty ? 'Two-party margin' : 'State margin'; if(delta) s += ' (delta)'; if(relative) s += ' (relative)'; return s; }

    function renderControls(){
      $('#year-val').textContent = selectedYear; const slider = $('#year'); slider.min=yearMin; slider.max=yearMax; slider.step=4; slider.value=selectedYear;
      $('#metric').innerHTML = '<option value="margin">Margin</option><option value="third_party_share">Third-party share</option>'; $('#metric').value = base;
      $('#two').checked = twoParty; $('#rel').checked = relative; $('#delt').checked = delta; $('#abs').checked = useAbs; $('#reverse').checked = reverse;
      const disableChecks = base==='third_party_share'; $('#two').disabled = disableChecks; $('#delt').disabled = disableChecks;
      const nameEl = $('#metric-name'); if(nameEl) nameEl.textContent = metricDisplayName(); }

    function compute(){
      const metricKey = buildMetricKey();
      const byState = data.data[selectedYear];
      if(!byState) return [];
      const rows = [];
      Object.keys(byState).forEach(abbr => {
        const rec = byState[abbr];
        const val = rec[metricKey];
        if (val == null) return;
        const key = useAbs ? Math.abs(val) : val;

        // Build label depending on metric and flags. When 'Relative' is checked we show the
        // relative value as the primary label and include the raw margin in parentheses.
        let label = '';
        if (base === 'margin'){
          let rawKey = '';
          let relKey = '';
          if (twoParty){
            rawKey = delta ? 'two_party_margin_delta' : 'two_party_margin';
            relKey = delta ? 'two_party_relative_margin_delta' : 'two_party_relative_margin';
          } else {
            rawKey = delta ? 'pres_margin_delta' : 'pres_margin';
            relKey = delta ? 'relative_margin_delta' : 'relative_margin';
          }

          if (relative){
            if (delta){
                if (rec[relKey] != null && !isNaN(rec[relKey])) label = 'Δ ' + niceStr(abbr, relKey, rec);
                if (rec[rawKey] != null && !isNaN(rec[rawKey])) label += ' (Raw Δ: ' + niceStr(abbr, rawKey, rec) + ')';
            } else {
                if (rec[relKey] != null && !isNaN(rec[relKey])) label = niceStr(abbr, relKey, rec);
                if (rec[rawKey] != null && !isNaN(rec[rawKey])) label += ' (Raw: ' + niceStr(abbr, rawKey, rec) + ')';
            }
          } else {
            if (delta){
                if (rec[relKey] != null && !isNaN(rec[relKey])) label = 'Δ ' + niceStr(abbr, relKey, rec);
                if (rec[rawKey] != null && !isNaN(rec[rawKey])) label += ' (Relative Δ: ' + niceStr(abbr, rawKey, rec) + ')';
            } else {
                if (rec[rawKey] != null && !isNaN(rec[rawKey])) label = niceStr(abbr, rawKey, rec);
                if (rec[relKey] != null && !isNaN(rec[relKey])) label += ' (Relative: ' + niceStr(abbr, relKey, rec) + ')';
            }
        }
        } else if (base === 'third_party_share'){
          label = niceStr(abbr, metricKey, rec);
          if (relative){ const rel = rec['third_party_relative_share']; if (rel != null && !isNaN(rel)) label += ' (Relative: ' + niceStr(abbr, 'third_party_relative_share', rec) + ')'; }
        } else {
          label = niceStr(abbr, metricKey, rec);
        }

        rows.push({abbr, val, rec, label, sortKey: key});
      });

      const ord = reverse ? 'asc' : 'desc';
      rows.sort((a,b)=> (ord==='desc' ? b.sortKey - a.sortKey : a.sortKey - b.sortKey) || a.abbr.localeCompare(b.abbr));
      rows.forEach((r,i)=> r.rank = i+1);
      return rows;
    }

    function rowColorClass(val){ if(!String(buildMetricKey()).includes('margin')) return 'bg-purple-600 border-purple-300'; if(val>0) return 'bg-blue-600 border-blue-300'; if(val<0) return 'bg-rose-600 border-rose-300'; return 'bg-slate-600 border-slate-300'; }

    function renderList(){ const rows = compute(); const list = $('#results'); if(!rows.length){ list.innerHTML = '<div class="text-sm text-slate-400">No data for this selection.</div>'; return; }
      list.innerHTML = rows.map((r,i)=> (
        `<div class="flex items-center justify-between rounded-lg shadow-lg border-2 text-white p-3 sm:p-4 m-1 sm:m-2 transform transition-all hover:scale-[1.02] ${rowColorClass(r.val)}" style="animation-delay:${i*30}ms">` +
        `<div class="flex-shrink-0 text-center"><div class="text-sm sm:text-base lg:text-lg font-bold">#${r.rank}</div><div class="text-[10px] sm:text-xs opacity-90">EVs: ${r.rec.electoral_votes ?? '—'}</div></div>` +
        `<div class="flex-1 min-w-0 px-3 flex flex-col">
            <div class="text-sm sm:text-lg lg:text-xl font-semibold truncate"><a href="state/${r.abbr}.html" target="_blank" rel="noopener noreferrer" class="hover:underline text-current">${r.abbr}</a></div>
            <div class="text-xs sm:text-sm text-slate-200 mt-1 truncate">${r.label}</div>
         </div>` +
        `</div>`
      )).join('');
      $$('#results > div').forEach((el)=>{ el.classList.add('animate-bounce'); setTimeout(()=> el.classList.remove('animate-bounce'), 900); }); }

    function attachEvents(){ $('#year').addEventListener('input', e=>{ selectedYear = parseInt(e.target.value,10); $('#year-val').textContent = selectedYear; renderList(); });
      $('#metric').addEventListener('change', e=>{ base = e.target.value; renderControls(); renderList(); });
      $('#two').addEventListener('change', e=>{ twoParty = e.target.checked; renderControls(); renderList(); });
      $('#rel').addEventListener('change', e=>{ relative = e.target.checked; renderControls(); renderList(); });
      $('#delt').addEventListener('change', e=>{ delta = e.target.checked; renderControls(); renderList(); });
      $('#abs').addEventListener('change', e=>{ useAbs = e.target.checked; renderList(); });
      $('#reverse').addEventListener('change', e=>{ reverse = e.target.checked; renderList(); }); }

    function init(){ renderControls(); attachEvents(); renderList(); $('#updated').textContent = data.lastUpdated; }
    document.addEventListener('DOMContentLoaded', init);
  })();
  """

  script = script_template.replace("__PAYLOAD__", payload_json).replace("__META__", meta_json)

  html_template = """<!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>State Ranker · U.S. Presidential Results</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="styles.css" />
    <link rel="icon" href="favicon.svg" />
    <style>
      body.dark input[type=range]{-webkit-appearance:none;appearance:none;height:10px;background:linear-gradient(90deg,rgba(37,99,235,.14),rgba(124,58,237,.12));border-radius:9999px;outline:none;margin:6px 0}
      body.dark input[type=range]::-webkit-slider-runnable-track{height:10px;background:linear-gradient(90deg,#0f1724,#071226);border-radius:9999px}
      body.dark input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;margin-top:-5px;width:18px;height:18px;background:#e6eef8;border:3px solid #2563eb;border-radius:50%;box-shadow:0 4px 10px rgba(2,6,23,.6)}
      body.dark input[type='range']::-moz-range-track{height:10px;background:linear-gradient(90deg,#0f1724,#071226);border-radius:9999px}
      body.dark input[type='range']::-moz-range-thumb{width:18px;height:18px;background:#e6eef8;border:3px solid #2563eb;border-radius:50%;box-shadow:0 4px 10px rgba(2,6,23,.6)}
    </style>
  </head>
  <body class="dark bg-slate-950 text-slate-100">
    <div class="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      <!-- persistent header / site nav -->
      <div class="card site-header" style="display:flex;justify-content:space-between;align-items:center;padding:8px">
        <div class="small-links">
          <a class="btn" href="index.html">Home</a>
          <a class="btn" href="ranker.html">Ranker</a>
        </div>
        <div class="legend">U.S. Presidential Election State Results</div>
      </div>
      <div class="flex items-center justify-between mb-4">
        <a class="text-sm text-slate-300 hover:text-white" href="index.html">← Back to Map</a>
        <div class="text-xs text-slate-400">Last updated: <span id="updated"></span></div>
      </div>

      <div class="text-center mb-4 sm:mb-6">
        <h1 class="text-2xl sm:text-3xl font-bold">State Metric Ranker</h1>
        <p class="text-sm text-slate-400">Rank states by a metric for a given year</p>
        <p class="text-xs text-slate-400 mt-1">Metric: <span id="metric-name" class="font-semibold text-slate-200"></span></p>
      </div>

      <div class="bg-slate-900/50 rounded-lg shadow-lg p-4 sm:p-5 mb-4 sm:mb-6">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <label class="block">
            <div class="text-xs uppercase tracking-wide text-slate-400">Year: <strong id="year-val"></strong></div>
            <input id="year" type="range" min="1900" max="2024" step="4" class="w-full" />
          </label>
          <label class="block">
            <div class="text-xs uppercase tracking-wide text-slate-400">Metric</div>
            <select id="metric" class="w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-2"></select>
          </label>
          <label class="block">
            <div class="text-xs uppercase tracking-wide text-slate-400">Flags</div>
            <div class="mt-1 flex flex-col gap-2">
              <label class="flex items-center gap-2"><input id="two" type="checkbox" class="accent-blue-500" /> <span class="text-sm text-slate-300">Two-party</span></label>
              <label class="flex items-center gap-2"><input id="rel" type="checkbox" class="accent-blue-500" /> <span class="text-sm text-slate-300">Relative</span></label>
              <label class="flex items-center gap-2"><input id="delt" type="checkbox" class="accent-blue-500" /> <span class="text-sm text-slate-300">Delta</span></label>
            </div>
          </label>
          <label class="flex items-center gap-2 mt-2 md:mt-6">
            <input id="abs" type="checkbox" class="accent-blue-500" /> <span class="text-sm text-slate-300">Sort by absolute value</span><br/>
            <input id="reverse" type="checkbox" class="ml-3 accent-blue-400" /> <span class="text-sm text-slate-300 ml-2">Reverse order</span>
          </label>
        </div>
      </div>

      <div class="bg-slate-900/40 rounded-lg p-3 text-sm text-slate-300 mb-4">
        <strong>Notes</strong>
        <ul class="list-disc list-inside mt-2 space-y-1">
          <li><strong>Margin</strong>: difference between Democratic and Republican vote share (D − R). Displayed as e.g. <code>D+5.2</code> to mean the Democratic candidate is ahead by 5.2 percentage points.</li>
          <li><strong>Two-party</strong>: excludes third-party votes and recalculates margins on a D vs R two-party basis.</li>
          <li><strong>Relative</strong>: the state's margin minus the national margin (how much more D or R the state is compared to the nation).</li>
          <li><strong>Delta</strong>: change in the chosen metric since the previous presidential election.</li>
        </ul>
      </div>

      <div id="results" class="grid grid-cols-1"></div>

      <div class="mt-6 text-center text-xs text-slate-500">Site by eigentaylor · Ranking tool added</div>
    </div>

    <script>__SCRIPT__</script>
  </body>
  </html>
  """

  return html_template.replace("__SCRIPT__", script)

def main():
  rows = load_rows(CSV_PATH)
  payload = build_payload(rows)
  page = make_page(payload)
  OUT.write_text(page, encoding="utf-8")
  print(f"Wrote {OUT} ({len(page)} bytes)")
  
if __name__ == "__main__":
  main()
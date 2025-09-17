from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from .config import CSV_PATH, OUT_DIR, LAST_UPDATED
from .io_utils import read_csv, write_text
from .header import make_header

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

STATE_FILTER = set([
    "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
    "IA","KS","KY","LA","ME-AL","MD","MA","MI","MN","MS","MO","MT","NE-AL","NV","NH",
    "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
    "VT","VA","WA","WV","WI","WY",
    "ME-01","ME-02","NE-01","NE-02","NE-03",
])


def _str_col(name: str) -> str:
    return name if name.endswith("_str") else f"{name}_str"


def _coerce_metrics(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for r in rows:
        rr = dict(r)
        for k, v in list(rr.items()):
            if v is None:
                continue
            s = str(v).strip()
            if s == "":
                continue
            if k in METRICS or k in {"year", "electoral_votes"}:
                try:
                    rr[k] = float(s)
                except Exception:
                    pass
        out.append(rr)
    return out


def build_payload(rows: List[Dict[str, Any]]):
    per_year: Dict[int, Dict[str, Dict[str, Any]]] = {}

    for r in rows:
        abbr_raw = r.get("abbr", "")
        if not abbr_raw or abbr_raw == "NATIONAL":
            continue
        if abbr_raw not in STATE_FILTER:
            continue
        y_raw = r.get("year")
        try:
            y = int(float(y_raw)) if y_raw not in (None, "") else None
        except Exception:
            y = None
        if not y:
            continue

        dest = per_year.setdefault(y, {})
        entry: Dict[str, Any] = {"abbr": abbr_raw}
        ev = r.get("electoral_votes")
        if isinstance(ev, (int, float)):
            entry["electoral_votes"] = ev
        try:
            for m in METRICS:
                if m in r:
                    entry[m] = r[m]
                sc = _str_col(m)
                if sc in r:
                    entry[sc] = r[sc]
        except Exception:
            pass
        dest[abbr_raw] = entry

    years_sorted = sorted(per_year.keys())
    payload = {
        "years": years_sorted,
        "states": sorted(list(STATE_FILTER)),
        "metrics": METRICS,
        "data": per_year,
        "lastUpdated": LAST_UPDATED,
    }
    return payload


def make_page(payload: dict) -> str:
    # Short labels shown in the UI
    meta_options = {
        "pres_margin": "State margin (D − R)",
        "pres_margin_delta": "State margin delta",
        "relative_margin": "Relative margin (state − national)",
        "relative_margin_delta": "Relative margin delta",
        "two_party_margin": "Two-party margin",
        "two_party_margin_delta": "Two-party margin delta",
        "two_party_relative_margin": "Two-party relative margin",
        "two_party_relative_margin_delta": "Two-party relative delta",
        "third_party_share": "Third-party share",
        "third_party_relative_share": "Third-party share minus national",
    }

    payload_json = json.dumps(payload, separators=(",", ":"))
    meta_json = json.dumps(meta_options, separators=(",", ":"))

    # JS uses our own minimal styles; no Tailwind to avoid header mismatch
    script_template = r"""
    window.RANKER_DATA = __PAYLOAD__;
    (function(){
      const $ = (sel, el=document) => el.querySelector(sel);
      const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
      const data = window.RANKER_DATA; const meta = __META__;

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
        const hideChecks = base==='third_party_share';
        const twoEl = $('#two'); if(twoEl && twoEl.parentElement){ twoEl.parentElement.style.display = hideChecks ? 'none' : ''; if(hideChecks){ twoEl.checked = false; twoParty = false; } }
        const deltEl = $('#delt'); if(deltEl && deltEl.parentElement){ const disableDelta = hideChecks || (selectedYear === yearMin); deltEl.parentElement.style.display = hideChecks ? 'none' : ''; deltEl.disabled = disableDelta; if(disableDelta){ deltEl.checked=false; delta=false; } }
        const nameEl = $('#metric-name'); if(nameEl) nameEl.textContent = metricDisplayName(); }

      function compute(){
        const metricKey = buildMetricKey(); const byState = data.data[selectedYear]; if(!byState) return [];
        const rows = [];
        Object.keys(byState).forEach(abbr => {
          const rec = byState[abbr]; const val = rec[metricKey]; if (val == null) return;
          const key = useAbs ? Math.abs(val) : val;
          let label = '';
          if (base === 'margin'){
            let rawKey='', relKey='';
            if (twoParty){ rawKey = delta ? 'two_party_margin_delta' : 'two_party_margin'; relKey = delta ? 'two_party_relative_margin_delta' : 'two_party_relative_margin'; }
            else { rawKey = delta ? 'pres_margin_delta' : 'pres_margin'; relKey = delta ? 'relative_margin_delta' : 'relative_margin'; }
            if (relative){ if (delta){ if (rec[relKey] != null && !isNaN(rec[relKey])) label = 'Δ ' + niceStr(abbr, relKey, rec); if (rec[rawKey] != null && !isNaN(rec[rawKey])) label += ' (Raw Δ: ' + niceStr(abbr, rawKey, rec) + ')'; }
              else { if (rec[relKey] != null && !isNaN(rec[relKey])) label = niceStr(abbr, relKey, rec); if (rec[rawKey] != null && !isNaN(rec[rawKey])) label += ' (Raw: ' + niceStr(abbr, rawKey, rec) + ')'; } }
            else { if (delta){ if (rec[rawKey] != null && !isNaN(rec[rawKey])) label = 'Δ ' + niceStr(abbr, rawKey, rec); if (rec[relKey] != null && !isNaN(rec[relKey])) label += ' (Relative Δ: ' + niceStr(abbr, relKey, rec) + ')'; }
              else { if (rec[rawKey] != null && !isNaN(rec[rawKey])) label = niceStr(abbr, rawKey, rec); if (rec[relKey] != null && !isNaN(rec[relKey])) label += ' (Relative: ' + niceStr(abbr, relKey, rec) + ')'; } }
          } else if (base === 'third_party_share'){
            label = niceStr(abbr, metricKey, rec);
            if (relative){ const rel = rec['third_party_relative_share']; if (rel != null && !isNaN(rel)) label += ' (Raw: ' + niceStr(abbr, 'third_party_share', rec) + ')'; }
            else { const raw = rec['third_party_share']; if (raw != null && !isNaN(raw)) label += ' (Relative: ' + niceStr(abbr, 'third_party_relative_share', rec) + ')'; }
          } else { label = niceStr(abbr, metricKey, rec); }
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
          (function(){ var abbr=r.abbr; var link=(abbr.indexOf('-')!==-1? ('unit/'+abbr+'.html') : ('state/'+abbr+'.html')); return (
            `<div class="flex items-center justify-between rounded-lg shadow-lg border-2 text-white p-3 sm:p-4 m-1 sm:m-2 transform transition-all hover:scale-[1.02] ${rowColorClass(r.val)}" style="animation-delay:${i*30}ms">`+
            `<div class="flex-shrink-0 text-center"><div class="text-sm sm:text-base lg:text-lg font-bold">#${r.rank}</div><div class="text-[10px] sm:text-xs opacity-90">EVs: ${r.rec.electoral_votes ?? '—'}</div></div>`+
            `<div class="flex-1 min-w-0 px-3 flex flex-col">`+
            `  <div class="text-sm sm:text-lg lg:text-xl font-semibold truncate"><a href="${link}" target="_blank" rel="noopener noreferrer" class="hover:underline text-current">${abbr}</a></div>`+
            `  <div class="text-xs sm:text-sm text-slate-200 mt-1 truncate">${r.label}</div>`+
            `</div>`+
            `</div>` ); })()
        )).join('');
        $$('#results > div').forEach((el)=>{ el.classList.add('animate-bounce'); setTimeout(()=> el.classList.remove('animate-bounce'), 900); }); }
      function readUrlState(){
        const params = new URLSearchParams(location.search);
        const py = params.get('year'); if(py) { const n = parseInt(py,10); if(!isNaN(n)) selectedYear = n; }
        const pm = params.get('metric'); if(pm) base = pm;
        const getBool = (k)=>{ const v = params.get(k); return v==='1' || v==='true' || v==='on' || v==='yes'; };
        twoParty = getBool('two'); relative = getBool('rel'); delta = getBool('delt'); useAbs = getBool('abs'); reverse = getBool('reverse');
        if(!data.years.includes(selectedYear)) selectedYear = data.years[data.years.length-1];
      }

      function updateUrl(){
        try{
          const params = new URLSearchParams();
          params.set('year', String(selectedYear)); params.set('metric', String(base));
          if(twoParty) params.set('two','1'); if(relative) params.set('rel','1'); if(delta) params.set('delt','1'); if(useAbs) params.set('abs','1'); if(reverse) params.set('reverse','1');
          const newUrl = location.pathname + (params.toString() ? ('?'+params.toString()) : ''); history.replaceState(null, '', newUrl);
        }catch(e){}
      }

      function attachEvents(){
        $('#year').addEventListener('input', e=>{ selectedYear = parseInt(e.target.value,10); $('#year-val').textContent = selectedYear; renderControls(); renderList(); updateUrl(); });
        $('#metric').addEventListener('change', e=>{ base = e.target.value; renderControls(); renderList(); updateUrl(); });
        $('#two').addEventListener('change', e=>{ twoParty = e.target.checked; renderControls(); renderList(); updateUrl(); });
        $('#rel').addEventListener('change', e=>{ relative = e.target.checked; renderControls(); renderList(); updateUrl(); });
        $('#delt').addEventListener('change', e=>{ delta = e.target.checked; renderControls(); renderList(); updateUrl(); });
        $('#abs').addEventListener('change', e=>{ useAbs = e.target.checked; renderList(); updateUrl(); });
        $('#reverse').addEventListener('change', e=>{ reverse = e.target.checked; renderList(); updateUrl(); });
      }

      function init(){ readUrlState(); renderControls(); attachEvents(); renderList(); updateUrl(); $('#updated').textContent = data.lastUpdated; }
      document.addEventListener('DOMContentLoaded', init);
    })();
    """

    script = script_template.replace("__PAYLOAD__", payload_json).replace("__META__", meta_json)

    html_template = """<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />
  <title>State Ranker · U.S. Presidential Results</title>
  <script src=\"https://cdn.tailwindcss.com\"></script>
  <link rel=\"stylesheet\" href=\"styles.css\" />
  <link rel=\"icon\" href=\"favicon.svg\" />
  <style>
    body.dark input[type=range]{-webkit-appearance:none;appearance:none;height:10px;background:linear-gradient(90deg,rgba(37,99,235,.14),rgba(124,58,237,.12));border-radius:9999px;outline:none;margin:6px 0}
    body.dark input[type=range]::-webkit-slider-runnable-track{height:10px;background:linear-gradient(90deg,#0f1724,#071226);border-radius:9999px}
    body.dark input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;margin-top:-5px;width:18px;height:18px;background:#e6eef8;border:3px solid #2563eb;border-radius:50%;box-shadow:0 4px 10px rgba(2,6,23,.6)}
    body.dark input[type='range']::-moz-range-track{height:10px;background:linear-gradient(90deg,#0f1724,#071226);border-radius:9999px}
    body.dark input[type='range']::-moz-range-thumb{width:18px;height:18px;background:#e6eef8;border:3px solid #2563eb;border-radius:50%;box-shadow:0 4px 10px rgba(2,6,23,.6)}
  </style>
</head>
<body class=\"dark bg-slate-950 text-slate-100\">
  <div class=\"max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6\">
    %HEADER%
    <div class=\"flex items-center justify-between mb-4\">
      <a class=\"text-sm text-slate-300 hover:text-white\" href=\"index.html\">\u2190 Back to Map</a>
      <div class=\"text-xs text-slate-400\">Last updated: <span id=\"updated\"></span></div>
    </div>

    <div class=\"text-center mb-4 sm:mb-6\">
      <h1 class=\"text-2xl sm:text-3xl font-bold\">State Metric Ranker</h1>
      <p class=\"text-sm text-slate-400\">Rank states by a metric for a given year</p>
      <p class=\"text-xs text-slate-400 mt-1\">Metric: <span id=\"metric-name\" class=\"font-semibold text-slate-200\"></span></p>
    </div>

    <div class=\"bg-slate-900/50 rounded-lg shadow-lg p-4 sm:p-5 mb-4 sm:mb-6\">
      <div class=\"grid grid-cols-1 md:grid-cols-4 gap-4\">
        <label class=\"block\">
          <div class=\"text-xs uppercase tracking-wide text-slate-400\">Year: <strong id=\"year-val\"></strong></div>
          <input id=\"year\" type=\"range\" min=\"1900\" max=\"2024\" step=\"4\" class=\"w-full\" />
        </label>
        <label class=\"block\">
          <div class=\"text-xs uppercase tracking-wide text-slate-400\">Metric</div>
          <select id=\"metric\" class=\"w-full mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-2\"></select>
        </label>
        <label class=\"block\">
          <div class=\"text-xs uppercase tracking-wide text-slate-400\">Flags</div>
          <div class=\"mt-1 flex flex-col gap-2\">
            <label class=\"flex items-center gap-2\"><input id=\"two\" type=\"checkbox\" class=\"accent-blue-500\" /> <span class=\"text-sm text-slate-300\">Two-party</span></label>
            <label class=\"flex items-center gap-2\"><input id=\"rel\" type=\"checkbox\" class=\"accent-blue-500\" /> <span class=\"text-sm text-slate-300\">Relative</span></label>
            <label class=\"flex items-center gap-2\"><input id=\"delt\" type=\"checkbox\" class=\"accent-blue-500\" /> <span class=\"text-sm text-slate-300\">Delta</span></label>
          </div>
        </label>
        <label class=\"flex items-center gap-2 mt-2 md:mt-6\">
          <input id=\"abs\" type=\"checkbox\" class=\"accent-blue-500\" /> <span class=\"text-sm text-slate-300\">Sort by absolute value</span><br/>
          <input id=\"reverse\" type=\"checkbox\" class=\"ml-3 accent-blue-400\" /> <span class=\"text-sm text-slate-300 ml-2\">Reverse order</span>
        </label>
      </div>
    </div>

    <div class=\"bg-slate-900/40 rounded-lg p-3 text-sm text-slate-300 mb-4\">
      <strong>Notes</strong>
      <ul class=\"list-disc list-inside mt-2 space-y-1\">
        <li><strong>Margin</strong>: difference between Democratic and Republican vote share (D − R). Displayed as e.g. <code>D+5.2</code>.</li>
        <li><strong>Two-party</strong>: excludes third-party votes and recalculates margins on a D vs R two-party basis.</li>
        <li><strong>Relative</strong>: the state's margin minus the national margin.</li>
        <li><strong>Delta</strong>: change in the chosen metric since the previous election.</li>
      </ul>
    </div>

    <div id=\"results\" class=\"grid grid-cols-1\"></div>

    <div class=\"mt-6 text-center text-xs text-slate-500\">Site by eigentaylor · Ranking tool</div>
  </div>

  <script>__SCRIPT__</script>
</body>
</html>
"""

    header_html = make_header("U.S. Presidential Election State Results Ranker", is_inner=False)
    return html_template.replace("%HEADER%", header_html).replace("__SCRIPT__", script)


def build_ranker_page(rows: List[Dict[str, Any]] | None = None):
    if rows is None:
        rows = read_csv(CSV_PATH)
    rows = _coerce_metrics(rows)
    payload = build_payload(rows)
    page = make_page(payload)
    write_text(OUT_DIR / "ranker.html", page)

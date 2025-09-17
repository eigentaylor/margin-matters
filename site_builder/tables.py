from collections import defaultdict
from typing import List, Dict, Tuple
import params


def columns_for_table(headers: List[str]) -> List[str]:
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
                out.append(name)
                seen.add(name)
        return out
    cols = ["year", "D_votes", "R_votes"]
    for h in headers:
        if "str" in h.lower() and h not in cols:
            cols.append(h)
    seen = set()
    out = []
    for c in cols:
        if c in headers and c not in seen:
            out.append(c)
            seen.add(c)
    return out


def split_columns_into_three(headers: List[str]) -> Tuple[List[str], List[str], List[str]]:
    if params.TABLE_COLUMNS is not None:
        ordered = []
        seen = set()
        for item in params.TABLE_COLUMNS:
            name = item[0] if isinstance(item, (list, tuple)) else item
            if name in headers and name not in seen:
                ordered.append(name)
                seen.add(name)
    else:
        ordered = columns_for_table(headers)

    basic, third, tp = [], [], []
    if 'year' in ordered:
        basic.append('year'); third.append('year'); tp.append('year')
    if 'D_votes' in ordered:
        basic.append('D_votes'); third.append('D_votes'); tp.append('D_votes')
    if 'R_votes' in ordered:
        basic.append('R_votes'); third.append('R_votes'); tp.append('R_votes')
    for c in ordered:
        if c in ('year', 'D_votes', 'R_votes', 'electoral_votes'):
            continue
        lname = c.lower()
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
    if 'electoral_votes' in ordered:
        basic.append('electoral_votes'); tp.append('electoral_votes')
    return basic, third, tp


def group_by_abbr(rows: List[Dict]) -> Dict[str, List[Dict]]:
    g = defaultdict(list)
    for r in rows:
        abbr = r.get("abbr", "").strip()
        if abbr:
            g[abbr].append(r)
    for k in g:
        g[k].sort(key=lambda r: int(r.get("year", 0)))
    return g


def get_header_map(cols: List[str]):
    if params.TABLE_COLUMNS is not None:
        header_labels = []
        for item in params.TABLE_COLUMNS:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                header_labels.append((item[0], item[1]))
            else:
                header_labels.append((item, item))
        return {k: v for k, v in header_labels}
    return {c: c for c in cols}


def describe_column(col: str) -> str:
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
        return 'Margin between the two major-party candidates, including third-party votes ((D - R)/total).'
    if 'national_margin' in k:
        return 'The national presidential margin for that year, including third-party votes ((D_total - R_total)/total_votes).'
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
    return 'Value from the CSV for this column.'


def render_info_box(cols: List[str]) -> str:
    header_map = get_header_map(cols)
    items = []
    done_delta = False
    for c in cols:
        label = header_map.get(c, c)
        if 'margin' in c.lower():
            done_delta = True
        desc = describe_column(c)
        items.append(f"<dt>{label}</dt><dd>{desc}</dd>")
    if done_delta and "Δ" not in [item[4:-5] for item in items if item.startswith("<dt>")]:
        items.insert(0, f"<dt>Δ</dt><dd>Change (delta) in the value from the previous election year.</dd>")
    dl_inner = "".join(items)
    return f"<div class=\"card\"><h3 style=\"margin-top:0\">Column explanations</h3><dl class=\"info-dl\">{dl_inner}</dl></div>"


def render_table(rows: List[Dict], cols: List[str], two_party: bool = False) -> str:
    def esc(x):
        s = "" if x is None else str(x)
        return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

    def format_value(col, val):
        if val is None or val == '0' or val == '0.0':
            return ""
        s = str(val)
        if col in ("D_votes", "R_votes", "T_votes", "total_votes"):
            try:
                n = int(s.replace(",", ""))
                return f"{n:,}"
            except Exception:
                return s
        return s

    header_map = get_header_map(cols)
    thead = "<thead><tr>" + "".join(f"<th>{esc(header_map.get(c, c))}</th>" for c in cols) + "</tr></thead>"
    body = "<tbody>"

    def parse_int(v):
        if v is None:
            return None
        try:
            return int(str(v).replace(",", ""))
        except Exception:
            return None

    for r in rows:
        cells = []
        d_raw = r.get("D_votes", ""); r_raw = r.get("R_votes", ""); t_raw = r.get("T_votes", "")
        d_val = parse_int(d_raw); r_val = parse_int(r_raw); t_val = parse_int(t_raw)
        denom = None
        if d_val is not None and r_val is not None:
            if two_party:
                denom = d_val + r_val
            else:
                denom = d_val + r_val + (t_val if t_val is not None else 0)

        for c in cols:
            if c in ("D_votes", "R_votes", "T_votes", "total_votes"):
                if c == "D_votes": vote_val = d_val
                elif c == "R_votes": vote_val = r_val
                elif c == "T_votes": vote_val = t_val
                else:
                    tv = parse_int(r.get('total_votes', ''))
                    vote_val = denom if tv is None else tv
                if vote_val is None:
                    cell = esc(format_value(c, r.get(c, "")))
                else:
                    votes_str = f"{vote_val:,}"
                    if c in ("D_votes", "R_votes", "T_votes") and denom and denom > 0:
                        pct = (vote_val / denom) * 100
                        pct_str = f"{pct:.1f}%"
                        raw_display = f"{votes_str}({pct_str})"
                    else:
                        raw_display = votes_str
                    delta_col = c.replace('_votes', '_delta')
                    delta_val = parse_int(r.get(delta_col, ""))
                    if isinstance(delta_val, int) and delta_val != 0:
                        delta_str = f"-{abs(delta_val):,}" if delta_val < 0 else f"{delta_val:,}"
                        cell = f'<span class="cell-inner"><span class="raw">{esc(raw_display)}</span><span class="delta">(Δ {esc(delta_str)})</span></span>'
                    else:
                        cell = f'<span class="cell-inner"><span class="raw">{esc(raw_display)}</span><span class="delta"></span></span>'
            else:
                raw_val = format_value(c, r.get(c, ""))
                if c.endswith('_str') and not c.endswith('_delta_str'):
                    delta_col = c[:-4] + '_delta_str'
                    delta_val = r.get(delta_col, "")
                    raw_esc = esc(raw_val)
                    if isinstance(delta_val, str) and delta_val not in ("0", "0.0", ""):
                        delta_esc = esc(delta_val)
                        cell = f'<span class="cell-inner"><span class="raw">{raw_esc}</span><span class="delta">(Δ {delta_esc})</span></span>'
                    else:
                        cell = f'<span class="cell-inner"><span class="raw">{raw_esc}</span><span class="delta"></span></span>'
                else:
                    cell = esc(raw_val)
            cells.append(f"<td>{cell}</td>")
        body += "<tr>" + "".join(cells) + "</tr>"
    body += "</tbody>"
    return f"<table>{thead}{body}</table>"

# senate_scraper.py
import requests
from bs4 import BeautifulSoup, Tag
import pandas as pd
import re
import time
from pathlib import Path
import json
from typing import List, Dict, Optional, Tuple


DEBUG_DIR = Path("election_data/wikipedia_senate/debug")


def serialize_table_structure(tbl: Tag) -> Dict:
    """Return a JSON-serializable structure describing the table: caption, headers with spans, and rows with spans."""
    cap = tbl.find('caption')
    caption = cap.get_text(' ', strip=True) if isinstance(cap, Tag) else ''

    # headers: try to read the first header row(s)
    headers = []
    for th in tbl.find_all('th'):
        if not isinstance(th, Tag):
            continue
        headers.append({
            'text': th.get_text(' ', strip=True),
            'colspan': int(str(th.get('colspan') or 1)),
            'rowspan': int(str(th.get('rowspan') or 1))
        })

    # rows: capture text + colspan/rowspan for first ~10 rows to keep files small
    rows_out = []
    for i, tr in enumerate(tbl.find_all('tr')):
        if not isinstance(tr, Tag):
            continue
        if i > 50:
            break
        row_cells = []
        for cell in tr.find_all(['td', 'th']):
            if not isinstance(cell, Tag):
                continue
            row_cells.append({
                'text': cell.get_text(' ', strip=True),
                'colspan': int(str(cell.get('colspan') or 1)),
                'rowspan': int(str(cell.get('rowspan') or 1))
            })
        rows_out.append(row_cells)

    return {
        'caption': caption,
        'headers': headers,
        'sample_rows': rows_out
    }

GLOBAL_MIN_YEAR = 2000   # start with 2000. we can push earlier, but formatting gets messy pre-1970s
GLOBAL_MAX_YEAR = 2024

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36"
}

US_STATES = {
    'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware',
    'Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky',
    'Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi',
    'Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico',
    'New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania',
    'Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont',
    'Virginia','Washington','West Virginia','Wisconsin','Wyoming'
}

STATE_ABBR = {
    'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO',
    'Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID',
    'Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA',
    'Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN',
    'Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV',
    'New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY',
    'North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK','Oregon':'OR',
    'Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD',
    'Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA',
    'Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY'
}

def clean_int(text: str) -> int:
    if text is None:
        return 0
    cleaned = re.sub(r"[^\d]", "", text)
    return int(cleaned) if cleaned else 0

def clean_percent(text: str) -> Optional[float]:
    if not text:
        return None
    m = re.search(r"[-+]?\d+(?:\.\d+)?", text.replace(",", ""))
    return float(m.group(0)) if m else None

def is_state_heading(tag: Tag) -> bool:
    # State sections are usually h3/h4 with a span.mw-headline id/name equal to the state
    if tag.name not in ("h2", "h3", "h4"):
        return False
    headline = tag.find(class_="mw-headline")
    text = (headline.get_text(strip=True) if headline else tag.get_text(strip=True))
    # Watch for “Class II” and “special” embedded in the same line; we still treat as a state section.
    # Some pages structure as State (Class II), others State then subheads General election, etc.
    # Accept either exact state or a prefix that starts with a state name.
    for st in US_STATES:
        if text == st or text.startswith(st + " "):
            return True
    return False

def next_section_siblings(tag: Tag) -> List[Tag]:
    # Iterate following siblings until the next same-level or higher heading
    results = []
    my_level = int(tag.name[1])
    sib = tag.next_sibling
    while sib:
        if isinstance(sib, Tag) and sib.name in ("h2","h3","h4"):
            level = int(sib.name[1])
            if level <= my_level:  # stop at same or higher level
                break
        if isinstance(sib, Tag):
            results.append(sib)
        sib = sib.next_sibling
    return results

def pick_best_result_table(block: List[Tag]) -> List[Tuple[str, Tag, str]]:
    """
    Return list of (round_label, table_tag) for decisive rounds within a state/seat block.
    We prefer the last decisive round (e.g., Runoff > General) but return all we find labeled.
    """
    found = []
    current_round = "General"
    for el in block:
        if isinstance(el, Tag):
            # Track round based on subheadings inside the state section
            if el.name in ("h4","h5"):
                t = el.get_text(" ", strip=True).lower()
                if "runoff" in t:
                    current_round = "Runoff"
                elif "general" in t:
                    current_round = "General"
                elif "special" in t and "election" in t:
                    # often still the general for the special seat; label as General (Special)
                    current_round = "General (Special)"
                else:
                    # leave round as-is
                    pass
            # look for tables at this level
            if el.name == "table" and "wikitable" in (el.get("class") or []):
                # Require a vote-like table (has Votes column and candidate names)
                ths = el.find_all("th")
                headers = [th.get_text(" ", strip=True).lower() for th in ths if isinstance(th, Tag)]
                if any("vote" in h or h == "#" for h in headers) and any(
                    "candidate" in h or "party" in h for h in headers
                ):
                    cap = el.find('caption')
                    caption_text = cap.get_text(' ', strip=True) if cap else ''
                    found.append((current_round, el, caption_text))
    return found

def extract_class_and_type(header_text: str, block: List[Tag], year: int) -> Tuple[Optional[str], str]:
    """
    Try to identify Class I/II/III and whether this is a regular or special election.
    """
    class_label = None
    race_type = "regular"
    text = header_text.lower()

    # m = re.search(r"class\s+(i{1,3}|\b[1-3]\b)", text)
    # if m:
    #     raw = m.group(1).upper()
    #     class_label = {"I":"I","II":"II","III":"III","1":"I","2":"II","3":"III"}.get(raw, None)

    # try to infer class from year if not found
    if not class_label and year:
        if year % 6 == 2:
            class_label = "I" # e.g., 2024, 2018, 2012, 2006, 2000
        elif year % 6 == 4:
            class_label = "II"   # e.g., 2020, 2014, 2008, 2002
        elif year % 6 == 0:
            class_label = "III"  # e.g., 2022, 2016, 2010, 2004
        print(f'Class not found in text; inferring from year {year} (got {class_label})')

    if "special" in text:
        race_type = "special"

    # Sometimes the class/special appears only in a small paragraph before the table
    for el in block:
        if isinstance(el, Tag):
            t = el.get_text(" ", strip=True).lower()
            if not class_label:
                m2 = re.search(r"class\s+(i{1,3}|\b[1-3]\b)", t)
                if m2:
                    raw = m2.group(1).upper()
                    class_label = {"I":"I","II":"II","III":"III","1":"I","2":"II","3":"III"}.get(raw, None)
            if "special election" in t:
                race_type = "special"

    return class_label, race_type

def parse_result_table(table: Tag) -> Tuple[List[Dict], Optional[int]]:
    """
    Parse a candidate-by-row 'wikitable' for votes/percentages.
    Handles common column name variants.
    """
    # Build column map, accounting for possible colspan in header cells
    ths = table.find_all("th")
    # Expand headers according to colspan so we have a logical column index list
    expanded_headers = []
    for th in ths:
        text = th.get_text(" ", strip=True)
        try:
            if isinstance(th, Tag):
                colspan_val = th.get('colspan')
                span = int(str(colspan_val)) if colspan_val is not None else 1
            else:
                span = 1
        except Exception:
            span = 1
        for _ in range(span):
            expanded_headers.append(text)
    lower = [h.lower() for h in expanded_headers]

    # Guess logical column indices for candidate/party/votes/pct
    col_map: Dict[str, Optional[int]] = {"candidate": None, "party": None, "votes": None, "pct": None}
    for idx, h in enumerate(lower):
        if col_map["candidate"] is None and ("candidate" in h or "nominee" in h):
            col_map["candidate"] = idx
        if col_map["party"] is None and "party" in h:
            col_map["party"] = idx
        if col_map["votes"] is None and ("votes" in h or h == "#" or "popular" in h):
            col_map["votes"] = idx
        if col_map["pct"] is None and ("%" in h or "percent" in h or "percentage" in h):
            col_map["pct"] = idx

    # Helper: given a list of td/th cells for a row, and a logical target column index
    # (based on expanded headers), return the text of the cell that covers that column
    def cell_text_by_col(cells, target_idx):
        col_cursor = 0
        for cell in cells:
            if not isinstance(cell, Tag):
                continue
            try:
                colspan_val = cell.get('colspan')
                span = int(str(colspan_val)) if colspan_val is not None else 1
            except Exception:
                span = 1
            if col_cursor <= target_idx < col_cursor + span:
                # check for text (might just be a color)
                if cell.get_text(" ", strip=True) == "":
                    continue
                return cell.get_text(" ", strip=True)
            col_cursor += span
        return ""

    # Collect raw rows (preserve order)
    raw_rows = []
    table_total: Optional[int] = None
    for tr in table.find_all("tr"):
        if not isinstance(tr, Tag):
            continue
        tds = tr.find_all(["td", "th"])
        if len(tds) < 1:
            continue

        candidate = cell_text_by_col(tds, col_map["candidate"]) if col_map["candidate"] is not None else ""
        party = cell_text_by_col(tds, col_map["party"]) if col_map["party"] is not None else ""
        votes_txt = cell_text_by_col(tds, col_map["votes"]) if col_map["votes"] is not None else ""
        pct_txt = cell_text_by_col(tds, col_map["pct"]) if col_map["pct"] is not None else ""

        votes = clean_int(votes_txt)
        pct = clean_percent(pct_txt)

        # Detect table-level total/turnout rows. These often have an empty candidate cell and
        # party like 'Total' or similar, or the candidate cell itself might say 'Total'.
        party_l = (party or "").strip().lower()
        cand_l = (candidate or "").strip().lower()
        if (not candidate and re.search(r"\btotal(s)?\b", party_l)) or re.search(r"\b(total|turnout|write-in total|votes total)\b", cand_l):
            # prefer non-zero votes if present
            table_total = int(votes or 0)
            # also try to capture percent, but we only return integer total
            continue

        # Skip rows that are clearly not data
        if not candidate and not party and votes == 0 and pct is None:
            continue

        raw_rows.append({
            "candidate": candidate or "",
            "party": party or "",
            "votes": votes,
            "percent": pct
        })

    # Normalize candidate names and aggregate per-candidate
    def normalize_candidate(name: str) -> str:
        if not name or not isinstance(name, str):
            return ""
        # remove parenthetical notes like (incumbent)
        no_paren = re.sub(r"\s*\([^)]*\)", "", name)
        # strip bracketed refs like [1]
        no_refs = re.sub(r"\s*\[[^\]]*\]", "", no_paren)
        # collapse whitespace
        return re.sub(r"\s+", " ", no_refs).strip()

    cand_map = {}
    for r in raw_rows:
        raw_cand = r.get('candidate') or ""
        key = normalize_candidate(raw_cand)
        if not key:
            # skip rows with no candidate (we already captured table_total separately)
            continue
        cand_map.setdefault(key, []).append(r)

    rows_out = []
    for cand_key, entries in cand_map.items():
        # if cand_key is empty string, skip
        if not cand_key:
            continue

        # Determine if any entry is a 'Total' party row for this candidate
        total_entry = None
        for e in entries:
            p = (e.get('party') or '').lower()
            if re.search(r"\btotal(s)?\b", p):
                total_entry = e
                break

        if total_entry:
            chosen_votes = int(total_entry.get('votes') or 0)
            chosen_pct = total_entry.get('percent')
        else:
            # fallback: sum votes across entries
            chosen_votes = sum(int((e.get('votes') or 0)) for e in entries)
            # pick first non-null percent if present
            chosen_pct = next((e.get('percent') for e in entries if e.get('percent') is not None), None)

        # choose the candidate's party as the first seen non-total party
        chosen_party = ""
        for e in entries:
            p = (e.get('party') or '').strip()
            if p and not re.search(r"\btotal(s)?\b", p.lower()):
                chosen_party = re.sub(r"\s*\[[^\]]*\]", "", p).strip()
                break

        # Final candidate name: normalize and strip refs/parentheticals
        final_name = cand_key

        # Skip obviously non-candidate rows
        if chosen_votes == 0 and chosen_pct is None:
            continue

        rows_out.append({
            "candidate": final_name,
            "party": chosen_party,
            "votes": chosen_votes,
            "percent": chosen_pct
        })

    return rows_out, table_total

def scrape_senate_year(year: int) -> Optional[pd.DataFrame]:
    """
    Scrape a single year page: https://en.wikipedia.org/wiki/YYYY_United_States_Senate_elections
    Returns a long-form candidate-level dataframe.
    """
    url = f"https://en.wikipedia.org/wiki/{year}_United_States_Senate_elections"
    print(f"Scraping {year} from {url}")
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
    except Exception as e:
        print(f"  ❌ fetch failed: {e}")
        return None

    soup = BeautifulSoup(r.content, "html.parser")

    # Find each state section
    out_records = []
    for h in soup.find_all(["h2","h3","h4"]):
        if not isinstance(h, Tag) or not is_state_heading(h):
            continue

        headline = h.find(class_="mw-headline")
        state_header = (headline.get_text(" ", strip=True) if headline else h.get_text(" ", strip=True)).strip()
        # Normalize to a state and possibly embedded seat descriptor like "(Class II)" or "(special)"
        # Extract state name
        state_name = None
        for st in US_STATES:
            if state_header == st or state_header.startswith(st + " "):
                state_name = st
                break
        if not state_name:
            continue

        abbr = STATE_ABBR[state_name]
        section_block = next_section_siblings(h)
        # Identify seat classifiers and special vs regular
        class_label, race_type_hint = extract_class_and_type(state_header, section_block, year)
        # First attempt: look for a state-specific page like
        # /wiki/{year}_United_States_Senate_election_in_{State_Name}
        def find_state_page_link(page_soup: BeautifulSoup, state: str, year_num: int) -> Optional[str]:
            st_us = state.replace(' ', '_')
            # Primary pattern: 2004_United_States_Senate_election_in_North_Carolina
            pat1 = re.compile(rf"/wiki/{year_num}_United_States_Senate_election_in_{re.escape(st_us)}$", re.IGNORECASE)
            pat2 = re.compile(rf"/wiki/{year_num}_United_States_Senate_election_in_{re.escape(st_us)}[\#\?\:]", re.IGNORECASE)
            # Some pages omit the year prefix or use singular/plural variants; search more loosely as a fallback
            pat3 = re.compile(rf"/wiki/{year_num}[_ ]United[_ ]States[_ ]Senate[_ ]election[_ ]in[_ ]{re.escape(st_us)}", re.IGNORECASE)

            for a in page_soup.find_all('a', href=True):
                # use .get to avoid PageElement __getitem__ typing issues
                href = a.get('href') if isinstance(a, Tag) else None
                if not href or not isinstance(href, str):
                    continue
                if pat1.search(href) or pat2.search(href) or pat3.search(href):
                    return 'https://en.wikipedia.org' + href
            return None

        def parse_state_page(state_url: str, year_num: int, state: str, abbr_code: str) -> List[Dict]:
            try:
                rr = requests.get(state_url, headers=HEADERS, timeout=30)
                rr.raise_for_status()
            except Exception as e:
                print(f"    ⚠️ failed to fetch state page {state_url}: {e}")
                return []
            s_soup = BeautifulSoup(rr.content, 'html.parser')
            found_rows = []

            # Find candidate-result tables across the page; prefer tables near headings like "General election" or "Results"
            tables = []
            # Look for headings that likely contain the result table
            for hh in s_soup.find_all(['h2','h3','h4','h5']):
                if not isinstance(hh, Tag):
                    continue
                text = hh.get_text(' ', strip=True).lower()
                if 'general' in text or 'results' in text or 'runoff' in text or 'primary' in text or 'special' in text:
                    block = next_section_siblings(hh)
                    # pick_best_result_table returns (round_label, table). normalize to (round_label, table, caption_text)
                    for rl, tbltag, caption_text in pick_best_result_table(block):
                        if not isinstance(tbltag, Tag):
                            continue
                        tables.append((rl, tbltag, caption_text))

            # If none found via headings, fall back to scanning all wikitables on the page
            if not tables:
                for tbl in s_soup.find_all('table'):
                    if not isinstance(tbl, Tag):
                        continue
                    if 'wikitable' in (tbl.get('class') or []):
                        # get caption
                        cap = tbl.find('caption')
                        caption_text = cap.get_text(' ', strip=True) if cap else ''
                        # use pick_best_result_table-like check
                        ths = tbl.find_all('th')
                        headers = [th.get_text(' ', strip=True).lower() for th in ths if isinstance(th, Tag)]
                        if any('vote' in h or h == '#' for h in headers) and any('candidate' in h or 'party' in h for h in headers):
                            # derive round label from nearby heading
                            prev = tbl.find_previous(['h2','h3','h4','h5'])
                            round_label = 'General'
                            if isinstance(prev, Tag):
                                t = prev.get_text(' ', strip=True).lower()
                                if 'runoff' in t:
                                    round_label = 'Runoff'
                                elif 'primary' in t:
                                    round_label = 'Primary'
                                elif 'special' in t:
                                    round_label = 'General (Special)'
                            tables.append((round_label, tbl, caption_text))

            # Parse tables
            for round_label, tbl, caption_text in tables:
                if 'primary' in caption_text.lower():
                    continue  # skip primaries for now; focus on general/special/runoff
                if caption_text == '':
                    continue # figure this out later
                rows, table_total = parse_result_table(tbl)
                if not rows:
                    continue

                # Try to refine class/type from nearby caption or heading
                local_text = ''
                cap = tbl.find('caption')
                if cap:
                    local_text = cap.get_text(' ', strip=True)
                else:
                    prev = tbl.find_previous(['p','div','h4','h5'])
                    if isinstance(prev, Tag):
                        local_text = prev.get_text(' ', strip=True)

                # prefer caption_text (if present) for class/type detection
                look_text = caption_text if caption_text else local_text
                loc_class, loc_type = extract_class_and_type(look_text, [tbl], year_num)
                eff_class = loc_class or None
                race_type = loc_type if loc_type == 'special' else 'regular'

                # Write a debug file describing the table structure and parsing results
                try:
                    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
                    safe_state = re.sub(r"[^A-Za-z0-9_\-]", "_", state)
                    safe_round = re.sub(r"[^A-Za-z0-9_\-]", "_", round_label)
                    debug_fname = f"{year_num}_{abbr_code}_{safe_state}_{safe_round}.json"
                    debug_path = DEBUG_DIR / debug_fname
                    debug_payload = {
                        'year': year_num,
                        'state': state,
                        'abbr': abbr_code,
                        'round': round_label,
                        'caption': caption_text,
                        'source_url': state_url,
                        'class': eff_class,
                        'race_type': race_type,
                        'parsed_rows': len(rows) if rows else 0,
                        'table_total_votes': table_total,
                        'table': serialize_table_structure(tbl),
                        'rows_preview': rows[:10] if rows else []
                    }
                    with debug_path.open('w', encoding='utf-8') as fh:
                        json.dump(debug_payload, fh, ensure_ascii=False, indent=2)
                    print(f"    🐞 Wrote table debug -> {debug_path}")
                except Exception as e:
                    print(f"    Warning: could not write table debug file: {e}")

                for rec in rows:
                    found_rows.append({
                        'year': year_num,
                        'state': state,
                        'abbr': abbr_code,
                        'class': eff_class,
                        'race_type': race_type,
                        'round': round_label,
                        'caption': caption_text,
                        'candidate': rec['candidate'],
                        'party': rec['party'],
                        'votes': rec['votes'],
                        'percent': rec['percent'],
                        'table_total_votes': table_total,
                        'source_url': state_url
                    })
            return found_rows

        state_page = find_state_page_link(soup, state_name, year)
        if state_page:
            print(f"  → found state page for {state_name}: {state_page}")
            rows = parse_state_page(state_page, year, state_name, abbr)
            # be polite; small pause between state page requests
            #time.sleep(0.5)
            if rows:
                out_records.extend(rows)
                continue

        # Fallback: parse the big year page's section for this state
        tables = pick_best_result_table(section_block)
        if not tables:
            continue

        # Prefer the *last* round for each distinct seat (if multiple tables are clearly the same seat).
        # Heuristic: if multiple tables exist and their header/preceding text includes "runoff", keep the runoff too but mark round.
        for round_label, tbl, caption_text in tables:
            rows, table_total = parse_result_table(tbl)
            if not rows:
                continue

            # Try to refine class and special from local caption/preceding text
            local_text = ""
            cap = tbl.find("caption")
            if cap:
                local_text = cap.get_text(' ', strip=True)
            else:
                # peek back a little in nearby text nodes
                prev = tbl.find_previous_sibling()
                if isinstance(prev, Tag):
                    local_text = prev.get_text(" ", strip=True)
            # prefer caption_text if provided by pick_best_result_table, else local_text
            detect_text = caption_text if 'caption_text' in locals() and caption_text else local_text
            loc_class, loc_type = extract_class_and_type(detect_text, [tbl], year)
            eff_class = loc_class or class_label
            race_type = loc_type if loc_type == "special" else race_type_hint

            # Write debug file for this table on the year page
            try:
                DEBUG_DIR.mkdir(parents=True, exist_ok=True)
                safe_state = re.sub(r"[^A-Za-z0-9_\-]", "_", state_name)
                safe_round = re.sub(r"[^A-Za-z0-9_\-]", "_", round_label)
                debug_fname = f"{year}_{abbr}_{safe_state}_{safe_round}.json"
                debug_path = DEBUG_DIR / debug_fname
                debug_payload = {
                    'year': year,
                    'state': state_name,
                    'abbr': abbr,
                    'round': round_label,
                    'caption': detect_text,
                    'source_url': url,
                    'class': eff_class,
                    'race_type': race_type,
                    'parsed_rows': len(rows),
                    'table_total_votes': table_total,
                    'table': serialize_table_structure(tbl),
                    'rows_preview': rows[:10]
                }
                with debug_path.open('w', encoding='utf-8') as fh:
                    json.dump(debug_payload, fh, ensure_ascii=False, indent=2)
                print(f"    🐞 Wrote table debug -> {debug_path}")
            except Exception as e:
                print(f"    Warning: could not write table debug file: {e}")

            # If we still don't know class and the page contains a "Class X" just above the table, try a quick scan
            if not eff_class:
                above = tbl.find_previous(["h4","h5"])
                if above:
                    t = above.get_text(" ", strip=True)
                    m = re.search(r"Class\s+(I{1,3}|[1-3])", t)
                    if m:
                        raw = m.group(1).upper()
                        eff_class = {"I":"I","II":"II","III":"III","1":"I","2":"II","3":"III"}.get(raw, None)

            for rec in rows:
                out_records.append({
                    "year": year,
                    "state": state_name,
                    "abbr": abbr,
                    "class": eff_class,                  # 'I'/'II'/'III' or None
                    "race_type": race_type,               # 'regular' or 'special'
                    "round": round_label,                 # 'General', 'Runoff', 'General (Special)', etc.
                    "caption": detect_text if 'detect_text' in locals() else "",
                    "candidate": rec["candidate"],
                    "party": rec["party"],
                    "votes": rec["votes"],
                    "percent": rec["percent"],
                    "table_total_votes": table_total,
                    "source_url": url
                })

    if not out_records:
        print(f"  ⚠️ no state sections parsed for {year}")
        return None

    df = pd.DataFrame(out_records)

    # De-dup pass (rare: the same table captured twice due to micro-structure); keep max votes row-wise
    df = (df.sort_values(["state","class","race_type","round","votes"]) 
            .drop_duplicates(subset=["year","state","class","race_type","round","candidate","party"], keep="last"))

    # Helper: strip bracketed footnote/reference markers like [ 262 ] or [1]
    def strip_refs(text: str) -> str:
        if not text or not isinstance(text, str):
            return text
        return re.sub(r"\s*\[[^\]]*\]", "", text).strip()

    def party_to_color(party: str) -> str:
        if not party or not isinstance(party, str):
            return "yellow"
        p = party.lower()
        if "dem" in p:
            return "deepskyblue"
        if "rep" in p or "republican" in p:
            return "red"
        return "yellow"

    # Aggregate to one row per state: choose the most-representative round per-state by total votes
    final_rows = []
    grp_keys = ["year", "state", "abbr"]
    for (y, st, ab), g in df.groupby(grp_keys):
        # pick the round with the highest total votes (robust to conventions/county-level small tables)
        rounds = {}
        for rlab, sub in g.groupby('round'):
            rounds[rlab] = sub['votes'].sum()
        if rounds:
            chosen_round = max(rounds.items(), key=lambda x: x[1])[0]
        else:
            chosen_round = g['round'].iloc[0]

        rows_round = g[g['round'] == chosen_round].copy()

        # Build results dict: candidate -> {party, votes, pct}
        results = {}
        for _, row in rows_round.iterrows():
            cand = strip_refs(row.get('candidate') or '')
            party = strip_refs(row.get('party') or '')
            votes = int(row.get('votes') or 0)
            pct = row.get('percent') if row.get('percent') is not None else None
            results[cand] = {'party': party, 'votes': votes, 'pct': pct}
        
        # sort results by votes descending
        results = dict(sorted(results.items(), key=lambda kv: kv[1].get('votes', 0), reverse=True))

        # Determine winner and runner-up by votes
        sorted_cands = sorted(results.items(), key=lambda kv: kv[1].get('votes', 0), reverse=True)
        winner = sorted_cands[0][0] if sorted_cands else ''
        runner_up = sorted_cands[1][0] if len(sorted_cands) > 1 else ''

        # Choose color based on winner's party
        winner_party = results.get(winner, {}).get('party', '') if winner else ''
        color = party_to_color(winner_party)

        # Collapse caption and choose a source_url (first available)
        caption = strip_refs(rows_round['caption'].dropna().astype(str).iloc[0]) if not rows_round['caption'].dropna().empty else ''
        source_url = rows_round['source_url'].dropna().astype(str).iloc[0] if not rows_round['source_url'].dropna().empty else ''

        final_rows.append({
            'year': y,
            'state': st,
            'abbr': ab,
            'class': rows_round['class'].dropna().astype(str).iloc[0] if not rows_round['class'].dropna().empty else None,
            'race_type': rows_round['race_type'].dropna().astype(str).iloc[0] if not rows_round['race_type'].dropna().empty else 'regular',
            'round': chosen_round,
            'caption': caption,
            'results': json.dumps(results, ensure_ascii=False),
            'total_votes': int(rows_round['votes'].sum()),
            'winner': strip_refs(winner),
            'runner_up': strip_refs(runner_up),
            'color': color,
            'source_url': source_url
        })

    agg_df = pd.DataFrame(final_rows)

    print(f"  ✅ parsed {agg_df['state'].nunique()} states, {len(agg_df)} aggregated rows")
    return agg_df

def scrape_multiple_years(years: List[int], output_dir="election_data/wikipedia_senate") -> Optional[pd.DataFrame]:
    outdir = Path(output_dir)
    outdir.mkdir(parents=True, exist_ok=True)

    all_years_ok = []
    for y in years:
        df = scrape_senate_year(y)
        if df is None or df.empty:
            print(f"  ❌ {y} failed")
        else:
            f = outdir / f"wikipedia_senate_{y}.csv"
            df.to_csv(f, index=False)
            print(f"  💾 saved {f}")
            all_years_ok.append(y)
        time.sleep(0.5)  # be nice to Wikipedia

    if not all_years_ok:
        print("❌ no successful years")
        return None

    # Combine
    files = [outdir / f"wikipedia_senate_{y}.csv" for y in all_years_ok]
    combo = pd.concat([pd.read_csv(p) for p in files], ignore_index=True)
    combo = combo.sort_values(["year","state","class","race_type","round"])
    combo_file = outdir / "wikipedia_senate_combined.csv"
    combo.to_csv(combo_file, index=False)

    print("="*60)
    print("✅ SENATE SCRAPING COMPLETE")
    print(f"Successful years: {sorted(all_years_ok)}")
    print(f"Total rows: {len(combo):,}")
    print(f"Combined file: {combo_file}")
    return combo

def default_years() -> List[int]:
    # Regular Senate elections occur every even year; start with a modern window for reliability.
    start, end = 1970, GLOBAL_MAX_YEAR
    return list(range(end if end % 2 == 0 else end-1, start-1, -2))

def main():
    RELIABLE_START = 2016
    
    print("Which years would you like to scrape?")
    print(f"1) Recent reliable window ({RELIABLE_START}–2024, even years)")
    print(f"2) All even years ({GLOBAL_MIN_YEAR}–2024)")
    print(f"3) Custom even-year range")
    choice = input("Enter choice (1/2/3): ").strip()

    if choice == "1":
        years = list(range(2024, RELIABLE_START-1, -2))
    elif choice == "2":
        years = default_years()
    elif choice == "3":
        s = int(input("Start year (even): ").strip())
        e = int(input("End year (even): ").strip())
        years = [y for y in range(e, s-1, -2) if y % 2 == 0]
    else:
        years = list(range(2024, 1998, -2))
        print("Defaulting to 2000–2024…")

    print(f"\nScraping years: {years}")
    res = scrape_multiple_years(years)
    if res is not None:
        print("\n🎉 SUCCESS! Senate CSVs are ready.")
    else:
        print("\n❌ Scraping failed.")

if __name__ == "__main__":
    t0 = time.time()
    main()
    t1 = time.time()
    print(f"🕒 Elapsed: {t1 - t0:.1f}s")


def _self_test_parse_table():
    """Construct a synthetic messy wikitable HTML and ensure parse_result_table aggregates correctly."""
    from bs4 import BeautifulSoup

    html = '''
    <table class="wikitable">
      <tr><th>Candidate</th><th>Party</th><th>Votes</th><th>%</th></tr>
      <tr><td>Kristen Gillibrand (incumbent)</td><td>Democratic</td><td>500,000</td><td>60%</td></tr>
      <tr><td>Kristen Gillibrand</td><td>Working Families</td><td>0</td><td></td></tr>
      <tr><td>Kristen Gillibrand</td><td>Independence</td><td>0</td><td></td></tr>
      <tr><td></td><td>Total</td><td>500,000</td><td>60%</td></tr>
      <tr><td>Other Candidate</td><td>Republican</td><td>300,000</td><td>36%</td></tr>
    </table>
    '''
    soup = BeautifulSoup(html, 'html.parser')
    tbl = soup.find('table')
    if not isinstance(tbl, Tag):
        print('TEST ERROR: table not found')
        return
    out = parse_result_table(tbl)
    print('SELF TEST OUTPUT:')
    print(out)


# Run self-test when invoked directly for quick validation
if False:
    _self_test_parse_table()

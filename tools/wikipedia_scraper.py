import requests
from bs4 import BeautifulSoup
import pandas as pd
import re
import time
from pathlib import Path
import sys
import json

def clean_number(text):
    """Extract integer from text containing numbers with commas, etc."""
    if not text or pd.isna(text):
        return 0
    # Remove everything except digits
    cleaned = re.sub(r'[^\d]', '', str(text))
    return int(cleaned) if cleaned else 0

def get_state_code(state_name):
    """Map full state names to 2-letter codes"""
    if '-' in state_name:
        pass  # likely a district like ME-1 or NE-2
        state_name = state_name.lower().strip().replace('maine', 'me').replace('nebraska', 'ne')
    if "'" in state_name:
        # likely "Maine's 1st district" or similar
        # replace 's {}st or {}nd or {}rd or {}th with -{}
        replacement = state_name.lower().replace("'s ", "-").replace("st", "").replace("nd", "").replace("rd", "").replace("th", "").replace("maine", "me").replace("nebraska", "ne").strip()
        print(f"    Note: converting '{state_name}' to district format {replacement}")
        state_name = replacement
    state_mapping = {
        'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
        'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
        'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
        'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME-AL', 'maryland': 'MD',
        'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
        'montana': 'MT', 'nebraska': 'NE-AL', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
        'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
        'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
        'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
        'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
        'district of columbia': 'DC', 'washington, d.c.': 'DC', 'washington d.c.': 'DC', "d.c.": "DC", "d. c.": "DC",
        "me-1": "ME-01", "me-2": "ME-02", "ne-1": "NE-01", "ne-2": "NE-02", "ne-3": "NE-03",
        "national": "NATIONAL"
    }
    stripped_name = state_name.lower().strip()
    return state_mapping.get(stripped_name, None)

def get_candidate_parties(year):
    """
    Get the likely Republican and Democratic candidates for each year.
    Returns (republican_keywords, democratic_keywords)
    """
    candidates = {
        2024: (['trump'], ['harris']),
        2020: (['trump'], ['biden']),
        2016: (['trump'], ['clinton', 'hillary']),
        2012: (['romney'], ['obama']),
        2008: (['mccain'], ['obama']),
        2004: (['bush'], ['kerry']),
        2000: (['bush'], ['gore']),
        1996: (['dole'], ['clinton']),
        1992: (['bush'], ['clinton']),
        1988: (['bush'], ['dukakis']),
        1984: (['reagan'], ['mondale']),
        1980: (['reagan'], ['carter']),
        1976: (['ford'], ['carter']),
        1972: (['nixon'], ['mcgovern']),
        1968: (['nixon'], ['humphrey']),
        1964: (['goldwater'], ['johnson']),
        1960: (['nixon'], ['kennedy']),
        1956: (['eisenhower'], ['stevenson']),
        1952: (['eisenhower'], ['stevenson']),
        1948: (['dewey'], ['truman']),
        1944: (['dewey'], ['roosevelt']),
        1940: (['willkie'], ['roosevelt']),
        1936: (['landon'], ['roosevelt']),
        1932: (['hoover'], ['roosevelt']),
        1928: (['hoover'], ['smith']),
        1924: (['coolidge'], ['davis']),
        1920: (['harding'], ['cox']),
        1916: (['hughes'], ['wilson']),
        #1912: (['taft'], ['wilson']),
        1912: (['roosevelt'], ['wilson']), # Bull Moose Roosevelt was the main opponent
        1908: (['taft'], ['bryan']),
        1904: (['roosevelt'], ['parker']),
        1900: (['mckinley'], ['bryan']),
        1896: (['mckinley'], ['bryan']),
        1892: (['harrison'], ['cleveland']),
        1888: (['harrison'], ['cleveland']),
        1884: (['blaine'], ['cleveland']),
        1880: (['garfield'], ['hancock']),
        1876: (['hayes'], ['tilden']),
    }
    
    return candidates.get(year, (['republican'], ['democratic']))

def scrape_wikipedia_election(year):
    """
    Scrape presidential election results for a given year from Wikipedia.
    Returns DataFrame with state-level results.
    """
    
    url = f"https://en.wikipedia.org/wiki/{year}_United_States_presidential_election"
    
    print(f"Scraping {year} election from: {url}")
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Find the results table
        results_table = find_results_table(soup, year)
        
        if not results_table:
            print(f"  ❌ Could not find results table for {year}")
            return None
        
        print(f"  ✅ Found results table")
        
        # Get candidate info for this year
        rep_keywords, dem_keywords = get_candidate_parties(year)
        print(f"  🗳️  Looking for Republican keywords: {rep_keywords}, Democratic keywords: {dem_keywords}")
        
        # Parse the table
        election_data = parse_results_table(results_table, year, rep_keywords, dem_keywords)
        
        if not election_data:
            print(f"  ❌ No data extracted from table")
            return None
        
        # Convert to DataFrame
        df = pd.DataFrame(election_data)
        
        print(f"  ✅ Extracted {len(df)} state records")
        
        # Validate data
        total_votes = df['total_votes'].sum()
        total_r = df['R_votes'].sum()
        total_d = df['D_votes'].sum()
        
        print(f"  📊 Totals: R={total_r:,} D={total_d:,} Total={total_votes:,}")
        
        return df
        
    except requests.RequestException as e:
        print(f"  ❌ Error fetching page: {e}")
        return None
    except Exception as e:
        print(f"  ❌ Error processing data: {e}")
        return None

def find_results_table(soup, year):
    """
    Find the main results table on the Wikipedia page.
    Different years have slightly different formats.
    """
    
    # Look for tables with specific indicators
    tables = soup.find_all('table', class_='wikitable')
    
    for table in tables:
        table_text = table.get_text().lower()
        
        # Check if this looks like a results table
        indicators = [
            'state' in table_text and ('votes' in table_text or '#' in table_text),
            'alabama' in table_text and 'alaska' in table_text,  # State list indicator
            'electoral' in table_text or "ev" in table_text and ('republican' in table_text or 'democratic' in table_text),
            len(table.find_all('tr')) > 30,  # Should have rows for all states
        ]
        
        if all(indicators):
            # Additional check: should have numeric data
            if re.search(r'\d{1,3}(,\d{3})+', table_text):  # Look for vote-like numbers
                return table
    
    # Fallback: largest table (by row count)
    if tables:
        return max(tables, key=lambda t: len(t.find_all('tr')))
    
    return None

def parse_results_table(table, year, rep_keywords, dem_keywords):
    """
    Parse the results table and extract vote data.
    This is the tricky part - table structures vary by year.
    Look for "Results by state" or similar headers.
    """
    
    rows = table.find_all('tr')
    
    if len(rows) < 10:  # Not enough rows for all states
        return None
    
    if year == 1968 or year == 1992 or year == 2012:
        pass # something weird is happening in these years
    
    if year == 1896:
        pass # something weird is happening in this year
    
    # Analyze header to understand column structure
    header_info = analyze_table_header(rows[0:4], rep_keywords, dem_keywords, year=year)
    
    if year == 1896:
        header_info['d_col'] = 14
        header_info['total_col'] = 31
        pass # something weird is happening in this year
    
    if not header_info:
        print(f"    Could not understand table structure")
        return None
    # --- Write header debug file for quick inspection ---
    try:
        debug_dir = Path("election_data/wikipedia/debug")
        debug_dir.mkdir(parents=True, exist_ok=True)
        debug_payload = {
            'year': year,
            'r_col': header_info.get('r_col'),
            'd_col': header_info.get('d_col'),
            'total_col': header_info.get('total_col'),
            'third_party_cols': header_info.get('third_party_cols', []),
            'col_desc_raw': {i: desc for i, desc in enumerate(header_info.get('col_desc_raw', []))},
            'col_desc_lower': {i: desc for i, desc in enumerate(header_info.get('col_desc_lower', []))},
            'rep_keywords': rep_keywords,
            'dem_keywords': dem_keywords,
        }
        debug_file = debug_dir / f"wikipedia_{year}_header_debug.json"
        with debug_file.open('w', encoding='utf-8') as fh:
            json.dump(debug_payload, fh, ensure_ascii=False, indent=2)
        print(f"    🐞 Wrote header debug -> {debug_file}")
    except Exception as e:
        print(f"    Warning: could not write header debug file: {e}")
    
    print(f"    Table structure: R_col={header_info['r_col']}, D_col={header_info['d_col']}, Total_col={header_info.get('total_col')}, Third-party cols={len(header_info.get('third_party_cols', []))}")
    
    election_data = []
    national_row_found = False
    
    # Skip header rows and parse data
    data_rows = rows[2:] if len(rows) > 2 else rows[1:]
    
    for row in data_rows:
        cells = row.find_all(['td', 'th'])
        
        if len(cells) < max(header_info['r_col'], header_info['d_col']) + 1:
            continue
        
        try:
            # Extract state name
            state_cell = cells[0]
            state_text = state_cell.get_text().strip()
            
            # Clean state name
            state_name = re.sub(r'\[.*?\]', '', state_text)  # Remove footnotes
            state_name = re.sub(r'\s+', ' ', state_name).strip()
            # remove Tooltip and everything after that if it exists
            state_name = state_name.split('Tooltip')[0].strip()
            # remove † or * symbol if it exists
            state_name = state_name.replace('†', '').replace('*', '').strip()
            if state_name == 'Colorado' and year == 1876:
                pass
            if 'district of columbia' in state_name.lower():
                state_name = 'District of Columbia'

            # use total row as NATIONAL
            if (state_name.lower() in ['total', 'totals', 'nationwide'] or
                'total' in state_name.lower()):
                if national_row_found:
                    pass
                old_state_name = state_name
                state_name = 'NATIONAL'
                national_row_found = True
            if (not state_name or len(state_name) > 25
                or state_name.lower() in ['notes', 'see also', 'references', 'external links', 'state', 'district']):
                continue  # Skip invalid state names
            # Map to state code
            state_code = get_state_code(state_name)
            if not state_code:
                print(f"    Warning: could not map state '{state_name}' to code")
                state_code = get_state_code(state_name) # second call for debugging
                continue
            
            # Extract vote counts
            r_votes = clean_number(cells[header_info['r_col']].get_text())
            if state_code == 'AL' and (1960 <= year <= 1964 or year == 1948):
                d_votes = clean_number(cells[8].get_text()) # unpledged electors column
            else:
                d_votes = clean_number(cells[header_info['d_col']].get_text())
            
            # Try to get total votes
            total_votes = 0
            # If we have a total_col, try it; if it yields no numeric value, try the column to the left.
            if header_info.get('total_col') and header_info['total_col'] < len(cells):
                tried_cols = []
                def try_col(idx):
                    if idx < 0 or idx >= len(cells):
                        return 0
                    tried_cols.append(idx)
                    text = cells[idx].get_text()
                    return clean_number(text)

                # First try the detected total_col
                total_votes = try_col(header_info['total_col'])
                if total_votes == 921947783:
                    total_votes = 9219477 # a footnote added extra digits

                # Special-case historical 1984 table error: sometimes the header offset causes TOTALS to appear in first cell
                cell_0_text = cells[0].get_text().strip() if len(cells) > 0 else ''
                if total_votes == 0 and year == 1984 and 'TOTALS' in cell_0_text:
                    # try the column to the left of total_col
                    total_votes = try_col(header_info['total_col'] - 1)
                    print(f"    Note: Adjusted total votes column for 1984 for state {state_name} and got {total_votes}")

                # If first attempt failed, try the column to the left generally
                if total_votes == 0:
                    alt_idx = header_info['total_col'] - 1
                    # only try if it's a different column we haven't already tried
                    if alt_idx not in tried_cols:
                        total_votes = try_col(alt_idx)

                # If still zero, raise so the exception handler for rows can catch and skip the row with a warning
                if total_votes == 0 and not (state_code == 'CO' and year == 1876):
                    raise ValueError(f"Could not determine numeric total_votes for state '{state_name}' (tried columns {tried_cols})")
            
            # If no total column, estimate from visible vote columns
            if total_votes == 0:
                estimated_total = r_votes + d_votes
                # include third-party vote columns explicitly if we detected them
                tp_cols = header_info.get('third_party_cols', [])
                if tp_cols:
                    for tp in tp_cols:
                        idx = tp['index']
                        if idx < len(cells):
                            estimated_total += clean_number(cells[idx].get_text())
                else:
                    # Fallback heuristic: sum any other significant vote-looking columns
                    for i, cell in enumerate(cells[2:], 2):
                        if i != header_info['r_col'] and i != header_info['d_col']:
                            votes = clean_number(cell.get_text())
                            if votes > estimated_total * 0.01:  # Significant (>1% of total)
                                estimated_total += votes
                total_votes = estimated_total
            
            # Build third-party breakdown and compute totals
            third_party_results = {}
            tp_cols = header_info.get('third_party_cols', [])
            for tp in tp_cols:
                idx = tp['index']
                name = tp['name'] or 'Other'
                if idx < len(cells):
                    v = clean_number(cells[idx].get_text())
                    if v > 0:
                        third_party_results[name] = third_party_results.get(name, 0) + v

            # third_party_votes is defined as total - D - R
            third_party_votes = max(0, total_votes - r_votes - d_votes)

            # If we didn't detect explicit third-party columns, record the whole block as 'Other'
            if not third_party_results and third_party_votes > 0:
                third_party_results['Other'] = third_party_votes

            # T_votes is the maximum single third-party candidate total (not including 'Other' rollup)
            t_votes = max([v for k, v in third_party_results.items() if 'other' not in k.lower()], default=0)
            
            record = {
                'year': year,
                'abbr': state_code,
                #'district': 'AL',  # At-large (state level)
                'D_votes': d_votes,
                'R_votes': r_votes,
                'T_votes': t_votes,
                'third_party_votes': third_party_votes,
                'third_party_results': json.dumps(third_party_results, ensure_ascii=False, sort_keys=True),
                'total_votes': total_votes,
            }
            
            election_data.append(record)
            
        except Exception as e:
            print(f"    Warning: error parsing row: {e}")
            continue  # Skip problematic rows
    
    # Ensure a NATIONAL summary exists and includes third-party rollups
    try:
        has_national = any(r.get('abbr') == 'NATIONAL' for r in election_data)
        if not has_national and election_data:
            # Compute national totals from parsed state rows
            total_r = sum(int(r.get('R_votes', 0)) for r in election_data)
            total_d = sum(int(r.get('D_votes', 0)) for r in election_data)
            total_votes = sum(int(r.get('total_votes', 0)) for r in election_data)
            total_tp_votes = sum(int(r.get('third_party_votes', 0)) for r in election_data)

            # Merge third-party candidate dicts across states
            merged_tp: dict[str, int] = {}
            for r in election_data:
                tp_json = r.get('third_party_results')
                if tp_json:
                    try:
                        d = json.loads(tp_json)
                        for k, v in d.items():
                            merged_tp[k] = merged_tp.get(k, 0) + int(v)
                    except Exception:
                        continue

            national_t_votes = max(merged_tp.values()) if merged_tp else 0

            national_summary = {
                'year': year,
                'abbr': 'NATIONAL',
                'D_votes': total_d,
                'R_votes': total_r,
                'T_votes': national_t_votes,
                'third_party_votes': total_tp_votes,
                'third_party_results': json.dumps(merged_tp, ensure_ascii=False, sort_keys=True),
                'total_votes': total_votes,
            }
            election_data.append(national_summary)
    except Exception:
        print(f"    Warning: error computing national totals")
        pass

    return election_data

def analyze_table_header(header_rows, rep_keywords, dem_keywords, year=None):
    """
    Analyze the table header to find which columns contain R and D vote counts.
    """
    
    # Combine header rows to get full column descriptions
    num_cols = 0
    for row in header_rows:
        cells = row.find_all(['th', 'td'])
        num_cols = max(num_cols, len(cells))

    if num_cols < 3:
        return None

    # Build column descriptions (both raw and lowercased)
    col_desc_lower = [""] * num_cols
    col_desc_raw = [""] * num_cols
    col_span_tracker = [0] * num_cols

    for row in header_rows:
        cells = row.find_all(['th', 'td'])
        col_index = 0
        for cell in cells:
            text_raw = cell.get_text().strip()
            text_lower = text_raw.lower()

            # Skip over columns spanned from previous row
            while col_index < num_cols and col_span_tracker[col_index] > 0:
                col_span_tracker[col_index] -= 1
                col_index += 1

            if col_index >= num_cols:
                break

            colspan = int(cell.get('colspan', 1))
            rowspan = int(cell.get('rowspan', 1))

            for i in range(colspan):
                if col_index + i < num_cols:
                    col_desc_lower[col_index + i] += " " + text_lower
                    col_desc_raw[col_index + i] += " " + text_raw
                    if rowspan > 1:
                        col_span_tracker[col_index + i] = rowspan - 1

            col_index += colspan

    col_desc_lower = [d.strip() for d in col_desc_lower]
    col_desc_raw = [d.strip() for d in col_desc_raw]

    # Helper to decide if a description looks like a vote-count column
    def is_votes_col(desc: str) -> bool:
        if 'overall popular vote' in desc:
            return False
        # remove 'candidates with electoral votes' and 'candidates with no electoral votes' from desc
        desc = desc.replace('candidates with electoral votes', '').strip()
        desc = desc.replace('candidates with no electoral votes', '').strip()
        if not desc:
            return False
        # Must refer to votes and not percentage/electoral/total-only
        if 'vote' not in desc and 'votes' not in desc and '#' not in desc:
            return False
        if 'al ak' in desc:
            return False # Alaska and Alabama columns are not vote counts
        blockers = ['percentage', '%', 'percent', 'electoral', 'delegates', 'elec\xadtoral']
        if any(b in desc for b in blockers):
            blocker_matches = [b for b in blockers if b in desc]
            if 'charles evans hughesrepublican #' in desc or 'roosevelt/garnerdemocratic votes' in desc:
                return True # the 'ev' in Evans is a false positive
            return False
        return True

    # Find Republican and Democratic vote columns and identify potential third-party columns
    r_col = None
    d_col = None
    total_col = None
    third_party_cols = []  # list of {index, name}
    
    if year == 1896:
        d_col = 14
        total_col = 31
        third_party_cols = [
            {'index': 17, 'name': 'John Palmer'},
            {'index': 20, 'name': 'Joshua Levering'},
            {'index': 23, 'name': 'Charles Matchett'},
            {'index': 26, 'name': 'Charles Bentley'},
        ]

    # Normalized keyword sets
    rep_keys = set([k.lower() for k in (rep_keywords + ['republican', 'rep', 'gop'])])
    dem_keys = set([k.lower() for k in (dem_keywords + ['democratic', 'democrat', 'dem'])])

    # Heuristic extraction of candidate names from header text
    def extract_candidate_name(raw_text: str, lower_text: str) -> str:
        if 'unpledged electors' in raw_text.lower() or 'Unpledged electors' in raw_text or 'unpledged electors' in lower_text:
            return "Unpledged Electors"
        # Remove common non-name words
        if 'no candidateprogressive' in lower_text:
            return "No Candidate (Bull Moose)"
        cleaned_raw = re.sub(r"\((?:[^)]*)\)", " ", raw_text)
        cleaned_raw = re.sub(r"(?i)popular\s+vote|votes?|total|percentage|percent|electoral\s+votes?|electoral|results|by\s+state|state|candidate|party|ticket|running\s+mate", " ", cleaned_raw)
        # Find proper-name like sequences (e.g., 'Jill Stein', 'Gary E. Johnson', 'Stein/Honkala')
        # We also want to capture names from formats like "Herman FarisProhibition#"
        cleaned_raw = re.sub(r"(?i)prohibition|libertarian|green|independent|constitution|reform|progressive|socialist|american independent|states' rights|unpledged|national unity", " ", cleaned_raw)
        name_matches = re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z\.]+)*(?:/[A-Z][a-z]+(?:\s+[A-Z][a-z\.]+)*)?\b", cleaned_raw)
        # Filter out party words
        def looks_like_name(n: str) -> bool:
            bl = ['Republican', 'Democratic', 'Independent', 'Green', 'Libertarian', 'Constitution', 'Reform', 'Prohibition', 'Progressive', 'Socialist', 'American', 'States', 'Unpledged', 'National']
            return not any(w in n for w in bl)
        for n in name_matches:
            if 'Robert La' in n:
                return "Robert La Follette"
            if 'Arthur Reimer' in n:
                return "Arthur Reimer"
            if 'Parley' in n:
                if 'Parley Christensen' in raw_text:
                    return 'Parley Christensen'
                else:
                    raise ValueError("Ambiguous Parley name")
            if ' Labor' in n:
                return n.split(' Labor')[0].strip()
            if 'Strom' in n:
                if 'Strom Thurmond' in raw_text:
                    return "Strom Thurmond"
                else:
                    raise ValueError("Ambiguous Strom name")
            if n == 'William':
                if 'William Lemke' in raw_text:
                    return 'William Lemke'
                elif 'William Foster' in raw_text:
                    return 'William Foster'
                elif 'William H. TaftRepublican # 9,807' in raw_text:
                    return 'William H. Taft'
                else:
                    raise ValueError("Ambiguous William name")
            if n == 'Roger':
                if 'Roger MacBride' in raw_text:
                    return 'Roger MacBride'
                else:
                    raise ValueError("Ambiguous Roger name")
            if n == 'Lenora':
                if 'Lenora Fulani' in raw_text:
                    return 'Lenora Fulani'
                else:
                    raise ValueError("Ambiguous Lenora name")
            if n == 'Overall':
                pass
            if n == 'John':
                if 'John Hagelin' in raw_text:
                    return 'John Hagelin'
                elif 'John Phelps' in raw_text:
                    return 'John Phelps'
                else:
                    raise ValueError("Ambiguous John name")
            if n == 'Finn':
                if 'McMullin/Finn' in raw_text:
                    return 'McMullin/Finn'
                else:
                    raise ValueError("Ambiguous Finn name")
            if n == 'James':
                if 'James Ferguson' in raw_text:
                    return 'James Ferguson'
                elif 'James Weaver' in raw_text:
                    return 'James Weaver'
                else: 
                    raise ValueError("Ambiguous James name")
            if looks_like_name(n):
                return n.strip()

        # Fallback: party-based label if present
        parties = ['libertarian', 'green', 'independent', 'constitution', 'reform', 'progressive', 'socialist', 'prohibition', 'american independent', 'states\' rights', 'unpledged', 'national unity']
        for p in parties:
            if p in lower_text:
                return p.title()

        # Last resort generic
        return "Other"

    for i, desc in enumerate(col_desc_lower):
        if i == 0:
            continue
        if 'Unpledged' in desc or 'unpledged' in desc:
            pass

        # Determine total column early
        if not total_col and 'total' in desc and not any(x in desc for x in ['percentage', '%']):
            if 'votes' in desc or 'vote' in desc or '#' in desc or 'state total' in desc and 'electoral' not in desc and 'ev' not in desc:
                total_col = i

        # Identify R and D vote columns
        if is_votes_col(desc):
            if not r_col and any(k in desc for k in rep_keys):
                r_col = i
                continue
            if not d_col and any(k in desc for k in dem_keys):
                d_col = i
                continue

    # Any other votes-columns are third-party candidates
    for i, desc in enumerate(col_desc_lower):
        if i == 0:
            continue
        if i == r_col or i == d_col or i == total_col:
            continue
        if is_votes_col(desc):
            cand_name = extract_candidate_name(col_desc_raw[i], desc)
            # Avoid misclassifying if the header clearly says Republican/Democratic
            if (any(k in desc for k in rep_keys) or any(k in desc for k in dem_keys) or 'margin' in desc) and cand_name != 'Unpledged Electors' and (cand_name != 'William H. Taft'):
                continue
            third_party_cols.append({'index': i, 'name': cand_name})

    # Fallback: assume standard layout (state, rep_votes, dem_votes, ...)
    if not r_col or not d_col:
        raise Exception("Could not identify R or D columns from header")
        if num_cols >= 3:
            r_col = 1
            d_col = 2
            if num_cols >= 4 and total_col is None:
                total_col = num_cols - 1

    if not r_col or not d_col:
        return None

    return {
        'r_col': r_col,
        'd_col': d_col,
        'total_col': total_col,
        'third_party_cols': third_party_cols,
        'col_desc_raw': col_desc_raw,
        'col_desc_lower': col_desc_lower,
    }

def scrape_multiple_years(years, output_dir="election_data/wikipedia"):
    """
    Scrape multiple election years and save results.
    """
    
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)
    
    all_data = []
    successful_years = []
    
    print(f"🗳️  Wikipedia Presidential Election Scraper")
    print(f"📅 Scraping {len(years)} election years")
    print("=" * 60)
    
    for year in years:
        print(f"\n📊 Processing {year}...")
        
        df = scrape_wikipedia_election(year)
        
        if df is not None and len(df) > 0:
            # Save individual year file
            year_file = output_path / f"wikipedia_{year}.csv"
            df.to_csv(year_file, index=False)
            print(f"  💾 Saved: {year_file}")
            
            all_data.append(df)
            successful_years.append(year)
            
            # Show a sample for verification
            print(f"  📋 Sample data:")
            sample = df.head(3)
            for _, row in sample.iterrows():
                # best-guess top third-party candidate
                tp_top = None
                try:
                    tp = json.loads(row.get('third_party_results', '{}'))
                    if tp:
                        tp_top = max(tp.items(), key=lambda kv: kv[1])[0]
                except Exception:
                    pass
                extra = f", TP_total={row.get('third_party_votes', 0):,}"
                if tp_top:
                    extra += f", TP_max={row['T_votes']:,} ({tp_top})"
                print(f"    {row['abbr']}: R={row['R_votes']:,} D={row['D_votes']:,} Total={row['total_votes']:,}{extra}")
        else:
            print(f"  ❌ Failed to scrape {year}")
        
        # Be nice to Wikipedia
        time.sleep(2)
    
    # Combine all successful years
    if all_data:
        combined_df = pd.concat(all_data, ignore_index=True)
        # sort by year and state
        combined_df = combined_df.sort_values(by=['year', 'abbr'])
        # set column order
        # include third-party breakdown columns
        # Keep a stable ordering while being resilient if some columns are missing
        desired_cols = ['year', 'abbr', 'D_votes', 'R_votes', 'T_votes', 'third_party_votes', 'third_party_results', 'total_votes']
        present_cols = [c for c in desired_cols if c in combined_df.columns]
        combined_df = combined_df[present_cols]
        
        # Save combined file
        combined_file = output_path / "wikipedia_presidential_elections_combined.csv"
        combined_df.to_csv(combined_file, index=False)
        
        print(f"\n{'='*60}")
        print(f"✅ SCRAPING COMPLETE")
        print(f"{'='*60}")
        print(f"Successful years: {successful_years}")
        print(f"Total records: {len(combined_df):,}")
        print(f"Combined file: {combined_file}")
        
        # Summary statistics
        print(f"\n📈 SUMMARY BY YEAR:")
        for year in sorted(successful_years):
            year_data = combined_df[combined_df['year'] == year]
            total_r = year_data['R_votes'].sum()
            total_d = year_data['D_votes'].sum()
            total_votes = year_data['total_votes'].sum()
            print(f"  {year}: R={total_r:,} D={total_d:,} Total={total_votes:,}")
        
        return combined_df
    else:
        print(f"\n❌ No data was successfully scraped")
        return None

def main():
    """Main function"""
    
    # Define years to scrape
    # Start with recent years that are most likely to work
    priority_years = [2024, 2020, 2016, 2012, 2008, 2004, 2000]
    START_YEAR = 1876
    END_YEAR = 2024
    all_years = list(range(END_YEAR, START_YEAR - 1, -4))
    #all_years = [2024, 2020, 2016, 2012, 2008, 2004, 2000, 1996, 1992, 1988, 1984, 1980, 1976, 1972, 1968, 1964]
    
    print("Which years would you like to scrape?")
    print("1. Priority years (2000-2024) - most reliable")
    print(f"2. All years ({START_YEAR}-{END_YEAR}) - comprehensive but may have some failures")
    print("3. Custom range")
    
    choice = input("Enter choice (1/2/3): ").strip()
    
    if choice == "1":
        years_to_scrape = priority_years
    elif choice == "2":
        years_to_scrape = all_years
    elif choice == "3":
        start_year = int(input("Start year: "))
        end_year = int(input("End year: "))
        years_to_scrape = [y for y in all_years if start_year <= y <= end_year]
    else:
        years_to_scrape = priority_years
        print("Defaulting to priority years...")
    
    print(f"\nScraping years: {years_to_scrape}")
    
    # Run the scraper
    result_df = scrape_multiple_years(years_to_scrape)
    
    if result_df is not None:
        print(f"\n🎉 SUCCESS!")# Wikipedia data is ready for comparison with Kenneth Black dataset.")
        print(f"💡 You can now cross-validate the datasets to find discrepancies.")
    else:
        print(f"\n❌ Scraping failed. Check your internet connection and try again.")

if __name__ == "__main__":
    import time
    time_start = time.time()
    main()
    time_end = time.time()
    print(f"🕒 Elapsed time: {time_end - time_start:.2f} seconds")
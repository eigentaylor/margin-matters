import requests
from bs4 import BeautifulSoup
import pandas as pd
import re
import time
from pathlib import Path
import sys

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
    
    if year == 1968 or year == 1992:
        pass # something weird is happening in these years
    
    if year == 2012:
        pass # something weird is happening in this year
    
    # Analyze header to understand column structure
    header_info = analyze_table_header(rows[0:4], rep_keywords, dem_keywords)
    
    if not header_info:
        print(f"    Could not understand table structure")
        return None
    
    print(f"    Table structure: R_col={header_info['r_col']}, D_col={header_info['d_col']}, Total_col={header_info.get('total_col')}")
    
    election_data = []
    national_row_found = None
    
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
            if state_code == 'AL' and 1960 <= year <= 1964:
                d_votes = clean_number(cells[8].get_text()) # unpledged electors column
            else:
                d_votes = clean_number(cells[header_info['d_col']].get_text())
            
            # Try to get total votes
            total_votes = 0
            if header_info.get('total_col') and header_info['total_col'] < len(cells):
                cell_0_text = cells[0].get_text().strip()
                if year == 1984 and 'TOTALS' in cell_0_text: # error in the table structure for 1984, there's a missing column
                    total_votes = clean_number(cells[header_info['total_col'] - 1].get_text())
                    print(f'    Note: Adjusted total votes column for 1984 for state {state_name} and got {total_votes}')
                else:
                    total_votes = clean_number(cells[header_info['total_col']].get_text())
                if total_votes == 0:
                    pass # something went wrong
                    total_votes = clean_number(cells[header_info['total_col']].get_text()) # second call for debugging
            
            # If no total column, estimate from visible vote columns
            if total_votes == 0:
                estimated_total = r_votes + d_votes
                # Look for other significant vote columns
                for i, cell in enumerate(cells[2:], 2):
                    if i != header_info['r_col'] and i != header_info['d_col']:
                        votes = clean_number(cell.get_text())
                        if votes > estimated_total * 0.01:  # Significant (>1% of total)
                            estimated_total += votes
                total_votes = estimated_total
            
            # Calculate T_votes (third party/other)
            t_votes = max(0, total_votes - r_votes - d_votes)
            
            record = {
                'year': year,
                'abbr': state_code,
                #'district': 'AL',  # At-large (state level)
                'D_votes': d_votes,
                'R_votes': r_votes,
                'T_votes': t_votes,
                'total_votes': total_votes,
            }
            
            election_data.append(record)
            
        except Exception as e:
            print(f"    Warning: error parsing row: {e}")
            continue  # Skip problematic rows
    
    # If a national row was detected in the table (contains '538'), append it
    try:
        if national_row_found:
            # Ensure we don't duplicate NATIONAL if already present
            if not any(r.get('abbr') == 'NATIONAL' for r in election_data):
                election_data.append(national_row_found)
        else:
            # Fallback: compute national totals from parsed state rows
            if election_data and not any(r.get('abbr') == 'NATIONAL' for r in election_data):
                total_r = sum(int(r.get('R_votes', 0)) for r in election_data)
                total_d = sum(int(r.get('D_votes', 0)) for r in election_data)
                total_votes = sum(int(r.get('total_votes', 0)) for r in election_data)
                total_t = max(0, total_votes - total_r - total_d)
                national_summary = {
                    'year': year,
                    'state': 'NATIONAL',
                    #'district': 'AL',
                    'R_votes': total_r,
                    'D_votes': total_d,
                    'total_votes': total_votes,
                    'T_votes': total_t
                }
                election_data.append(national_summary)
    except Exception:
        print(f"    Warning: error computing national totals")
        # If anything goes wrong, just return the parsed rows
        pass

    return election_data

def analyze_table_header(header_rows, rep_keywords, dem_keywords):
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
    
    # Build column descriptions
    col_descriptions = []
    col_descriptions = [""] * num_cols  # Initialize descriptions for each column
    col_span_tracker = [0] * num_cols  # Track how many columns each header spans

    # Iterate over each header row to build column descriptions
    for row in header_rows:
        cells = row.find_all(['th', 'td'])  # Find all header cells (th or td)
        col_index = 0  # Initialize column index

        for cell in cells:
            cell_text = cell.get_text().strip()  # Extract and clean cell text
            # Skip columns that are spanned by previous rows
            while col_index < num_cols and col_span_tracker[col_index] > 0:
                col_span_tracker[col_index] -= 1  # Decrease span tracker for the column
                col_index += 1  # Move to the next column

            if col_index >= num_cols:  # Stop if column index exceeds total columns
                break

            # Get colspan and rowspan attributes (default to 1 if not specified)
            colspan = int(cell.get('colspan', 1))
            rowspan = int(cell.get('rowspan', 1))

            # Update column descriptions for spanned columns
            for i in range(colspan):
                if col_index + i < num_cols:  # Ensure within bounds
                    # Append the current cell's text to the column description
                    col_descriptions[col_index + i] += " " + cell.get_text().strip().lower()
                    # If rowspan > 1, mark the column as spanned for subsequent rows
                    if rowspan > 1:
                        col_span_tracker[col_index + i] = rowspan - 1

            col_index += colspan  # Move to the next column after colspan

    col_descriptions = [desc.strip() for desc in col_descriptions]
    
    # Find Republican and Democratic vote columns
    r_col = None
    d_col = None
    total_col = None
    
    for i, desc in enumerate(col_descriptions):
        # Skip first column (states)
        if i == 0:
            continue
        
        # Look for Republican indicators
        if not r_col and any(keyword in desc for keyword in rep_keywords + ['republican', 'rep', 'gop']):
            # Make sure it's a vote column, not percentage
            if 'votes' in desc or 'vote' in desc or re.search(r'\d', desc):
                r_col = i
        
        # Look for Democratic indicators  
        if not d_col and any(keyword in desc for keyword in dem_keywords + ['democratic', 'democrat', 'dem']):
            if 'votes' in desc or 'vote' in desc or re.search(r'\d', desc):
                d_col = i
        
        # Look for total column
        if not total_col and ('total' in desc):
            if 'votes' in desc or 'vote' in desc or '#' in desc:
                total_col = i
    
    # Fallback: assume standard layout (state, rep_votes, dem_votes, ...)
    if not r_col or not d_col:
        if num_cols >= 3:
            r_col = 1
            d_col = 2
            if num_cols >= 4:
                total_col = num_cols - 1  # Total often last column
    
    if not r_col or not d_col:
        return None
    
    if not total_col:
        pass
    
    return {
        'r_col': r_col,
        'd_col': d_col,
        'total_col': total_col
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
                print(f"    {row['abbr']}: R={row['R_votes']:,} D={row['D_votes']:,} T={row['T_votes']:,}, Total={row['total_votes']:,}")
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
        combined_df = combined_df[['year', 'abbr', 'D_votes', 'R_votes', 'T_votes', 'total_votes']]
        
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
    priority_years = [2020, 2016, 2012, 2008, 2004, 2000]
    START_YEAR = 1964
    END_YEAR = 2024
    all_years = list(range(END_YEAR, START_YEAR - 1, -4))
    #all_years = [2024, 2020, 2016, 2012, 2008, 2004, 2000, 1996, 1992, 1988, 1984, 1980, 1976, 1972, 1968, 1964]
    
    print("Which years would you like to scrape?")
    print("1. Priority years (2000-2020) - most reliable")
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
    main()
import requests
from bs4 import BeautifulSoup
import pandas as pd
import re
import time
from pathlib import Path

def clean_number(text):
    """Extract integer from text containing numbers with commas, etc."""
    if not text or pd.isna(text):
        return 0
    # Remove everything except digits
    cleaned = re.sub(r'[^\d]', '', str(text))
    return int(cleaned) if cleaned else 0

def clean_percentage(text):
    """Extract percentage as float from text like '64.57%'"""
    if not text or pd.isna(text):
        return 0.0
    # Extract numbers and decimal points, remove %
    cleaned = re.sub(r'[^\d.]', '', str(text))
    try:
        return float(cleaned) if cleaned else 0.0
    except ValueError:
        return 0.0

def scrape_2024_wikipedia():
    """
    Scrape 2024 presidential election results from Wikipedia.
    Returns DataFrame with same structure as Kenneth Black data.
    """
    
    url = "https://en.wikipedia.org/wiki/2024_United_States_presidential_election"
    
    print("Fetching 2024 election data from Wikipedia...")
    
    # Set up headers to avoid blocking
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Find the results table - look for table with "Results by state" or similar
        # The table usually has headers like "State", "Trump", "Harris", etc.
        tables = soup.find_all('table', class_='wikitable')
        
        results_table = None
        for table in tables:
            # Look for table that contains state results
            headers = table.find('tr')
            if headers:
                header_text = headers.get_text().lower()
                if ('trump' in header_text and 'harris' in header_text and 
                    ('state' in header_text or 'alabama' in table.get_text().lower())):
                    results_table = table
                    break
        
        if not results_table:
            raise ValueError("Could not find the results table on Wikipedia page")
        
        print("Found results table, parsing data...")
        
        # Parse the table
        rows = results_table.find_all('tr')[2:]  # Skip header rows
        
        election_data = []
        
        for row in rows:
            cells = row.find_all(['td', 'th'])
            if len(cells) < 10:  # Need at least state + vote columns
                continue
            
            try:
                # Extract state name from first cell
                state_cell = cells[0]
                state_text = state_cell.get_text().strip()
                if '-' in state_text:
                    pass  # Could be ME-1, NE-2, etc.
                
                # Clean state name - remove links, footnotes, etc.
                state_name = re.sub(r'\[.*?\]', '', state_text)  # Remove footnotes
                state_name = re.sub(r'\s+', ' ', state_name).strip()  # Normalize whitespace
                if state_name.startswith("ME-") or state_name.startswith("NE-"):
                    state_name = state_name[:4]

                # Skip non-state rows (totals, headers, etc.)
                if (not state_name or len(state_name) > 20 or 
                    'total' in state_name.lower() or 
                    state_name.lower() in ['state', 'district']):
                    continue
                
                # Map state names to 2-letter codes
                state_code = get_state_code(state_name)
                if not state_code:
                    print(f"Warning: Could not map state name '{state_name}' to code")
                    continue
                
                # Extract vote counts - typically Trump, Harris, Others
                # Based on the HTML structure: Trump votes, %, EV, Harris votes, %, EV, ...
                
                trump_votes = clean_number(cells[1].get_text() if len(cells) > 1 else 0)
                trump_pct = clean_percentage(cells[2].get_text() if len(cells) > 2 else 0)
                
                harris_votes = clean_number(cells[4].get_text() if len(cells) > 4 else 0)
                harris_pct = clean_percentage(cells[5].get_text() if len(cells) > 5 else 0)
                
                # Calculate other votes from remaining candidates
                other_votes = 0
                if len(cells) > 7:
                    # Stein votes (Green)
                    stein_votes = clean_number(cells[7].get_text() if len(cells) > 7 else 0)
                    other_votes += stein_votes
                
                if len(cells) > 10:
                    # Kennedy votes (Independent)
                    kennedy_votes = clean_number(cells[10].get_text() if len(cells) > 10 else 0)
                    other_votes += kennedy_votes
                
                if len(cells) > 13:
                    # Oliver votes (Libertarian)
                    oliver_votes = clean_number(cells[13].get_text() if len(cells) > 13 else 0)
                    other_votes += oliver_votes
                
                if len(cells) > 16:
                    # Other candidates
                    others_votes = clean_number(cells[16].get_text() if len(cells) > 16 else 0)
                    other_votes += others_votes
                
                # Get total votes (usually last meaningful column)
                total_votes = trump_votes + harris_votes + other_votes
                if len(cells) > 20:
                    # Try to get total from table if available
                    potential_total = clean_number(cells[-1].get_text())
                    if potential_total > total_votes:
                        total_votes = potential_total
                
                # Create record
                record = {
                    'year': 2024,
                    'state': state_code,
                    'district': 'AL',  # At-large for now
                    'R_votes': trump_votes,
                    'D_votes': harris_votes,
                    'other_votes': other_votes,
                    'total_votes': total_votes,
                    'T_votes': other_votes  # Third party = other votes
                }
                
                election_data.append(record)
                print(f"  Processed {state_code}: R={trump_votes:,} D={harris_votes:,} Total={total_votes:,}")
                
            except Exception as e:
                print(f"Error processing row: {e}")
                continue
        
        if not election_data:
            raise ValueError("No data was successfully extracted")
        
        # Convert to DataFrame
        df = pd.DataFrame(election_data)
        
        print(f"\n✅ Successfully extracted {len(df)} state records")
        print(f"States: {sorted(df['state'].unique())}")
        
        return df
        
    except requests.RequestException as e:
        print(f"Error fetching Wikipedia page: {e}")
        return None
    except Exception as e:
        print(f"Error parsing data: {e}")
        return None

def get_state_code(state_name):
    """Map full state names to 2-letter codes"""
    if '†' in state_name:
        state_name = state_name.replace('†', '').strip()
    state_mapping = {
        'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
        'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
        'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
        'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
        'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
        'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
        'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
        'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
        'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
        'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
        'district of columbia': 'DC', 'washington, d.c.': 'DC', 'washington d.c.': 'DC',
        'me-1': 'ME-01', 'me-2': 'ME-02', 'ne-1': 'NE-01', 'ne-2': 'NE-02', 'ne-3': 'NE-03',
    }
    
    return state_mapping.get(state_name.lower().strip())

def scrape_maine_nebraska_districts():
    """
    Attempt to scrape Maine and Nebraska congressional district results.
    These might be on separate pages or sections.
    """
    
    print("\nLooking for Maine and Nebraska district-level results...")
    
    # Try to find district-level results for ME and NE
    district_urls = {
        'ME': "https://en.wikipedia.org/wiki/2024_United_States_presidential_election_in_Maine",
        'NE': "https://en.wikipedia.org/wiki/2024_United_States_presidential_election_in_Nebraska"
    }
    
    district_data = []
    
    for state, url in district_urls.items():
        try:
            print(f"  Checking {state} district results...")
            
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Look for district-level tables
            tables = soup.find_all('table', class_='wikitable')
            
            for table in tables:
                table_text = table.get_text().lower()
                if 'district' in table_text and ('trump' in table_text or 'harris' in table_text):
                    # Found a district table
                    rows = table.find_all('tr')[1:]  # Skip header
                    
                    for row in rows:
                        cells = row.find_all(['td', 'th'])
                        if len(cells) < 4:
                            continue
                        
                        district_text = cells[0].get_text().strip()
                        
                        # Extract district number
                        district_match = re.search(r'(\d+)', district_text)
                        if district_match:
                            district = district_match.group(1)
                            
                            trump_votes = clean_number(cells[1].get_text() if len(cells) > 1 else 0)
                            harris_votes = clean_number(cells[2].get_text() if len(cells) > 2 else 0)
                            other_votes = clean_number(cells[3].get_text() if len(cells) > 3 else 0)
                            
                            total_votes = trump_votes + harris_votes + other_votes
                            
                            record = {
                                'year': 2024,
                                'state': state,
                                'district': district,
                                'R_votes': trump_votes,
                                'D_votes': harris_votes,
                                'other_votes': other_votes,
                                'total_votes': total_votes,
                                'T_votes': other_votes
                            }
                            
                            district_data.append(record)
                            print(f"    Found {state}-{district}: R={trump_votes:,} D={harris_votes:,}")
            
            time.sleep(1)  # Be nice to Wikipedia
            
        except Exception as e:
            print(f"  Could not get {state} district data: {e}")
    
    return district_data

def main():
    """Main function to scrape 2024 data and save it"""
    
    print("🗳️  2024 Presidential Election Wikipedia Scraper")
    print("=" * 60)
    
    # Scrape main state-level results
    state_df = scrape_2024_wikipedia()
    
    if state_df is None:
        print("❌ Failed to scrape state-level data")
        return
    
    # Try to get Maine/Nebraska district data
    district_data = None #scrape_maine_nebraska_districts()
    
    if district_data and False:
        print(f"✅ Found {len(district_data)} district-level records")
        
        # Remove ME and NE from state data if we have district data
        district_states = set(record['state'] for record in district_data)
        state_df = state_df[~state_df['state'].isin(district_states)]
        
        # Add district data
        district_df = pd.DataFrame(district_data)
        combined_df = pd.concat([state_df, district_df], ignore_index=True)
    else:
        print("⚠️  Could not find district-level data for ME/NE")
        combined_df = state_df
    
    # Save the data
    output_dir = Path("election_data")
    output_dir.mkdir(exist_ok=True)
    
    # Save 2024 data
    output_file = output_dir / "presidential_2024.csv"
    combined_df.to_csv(output_file, index=False)
    
    print(f"\n✅ Saved 2024 data: {output_file}")
    print(f"📊 Total records: {len(combined_df)}")
    print(f"🗺️  States/districts: {len(combined_df)}")
    
    # Show sample data
    print(f"\n📋 SAMPLE DATA:")
    print(combined_df.head(10).to_string(index=False))
    
    # Show summary
    print(f"\n📈 SUMMARY:")
    print(f"Total Trump votes: {combined_df['R_votes'].sum():,}")
    print(f"Total Harris votes: {combined_df['D_votes'].sum():,}")
    print(f"Total other votes: {combined_df['T_votes'].sum():,}")
    print(f"Total votes: {combined_df['total_votes'].sum():,}")
    
    # Check for ME/NE districts
    me_ne_data = combined_df[combined_df['state'].isin(['ME', 'NE'])]
    if not me_ne_data.empty:
        print(f"\n🎯 MAINE/NEBRASKA DISTRICTS:")
        for state in ['ME', 'NE']:
            state_data = me_ne_data[me_ne_data['state'] == state]
            if not state_data.empty:
                districts = sorted(state_data['district'].unique())
                print(f"  {state}: {districts}")
    
    print(f"\n🎉 SUCCESS! Now you can combine this with your 1968-2020 data!")
    
    return combined_df

if __name__ == "__main__":
    main()
import pandas as pd
import numpy as np
from pathlib import Path

def extract_presidential_data(excel_file_path, output_dir="."):
    """
    Extract presidential election data from Kenneth Black's Excel file.
    
    Args:
        excel_file_path: Path to the Excel file
        output_dir: Directory to save CSV files
    """
    
    # Canonical presidential election years to extract
    presidential_years = [
        1968, 1972, 1976, 1980, 1984, 1988, 1992, 1996, 
        2000, 2004, 2008, 2012, 2016, 2020
    ]
    MIN_YEAR = min(presidential_years)
    MAX_YEAR = max(presidential_years)
    
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)
    
    all_elections = []
    
    print("Extracting presidential election data...")
    print("=" * 50)
    
    for year in presidential_years:
        try:
            print(f"Processing {year}...")
            
            # Read the specific sheet for this year
            df = pd.read_excel(excel_file_path, sheet_name=str(year), header=0)
            
            # The data structure appears to be:
            # Column 0: State
            # Column 1: District  
            # Column 2: R (Republican votes)
            # Column 3: D (Democratic votes)
            # Column 4: O (Other votes) - sometimes A (American Independent) in some years
            # Column 5: T (Total votes)
            
            # Skip the first row which appears to be national totals
            data_df = df.iloc[1:].copy()  # Skip row 1 (national totals)
            
            # Get the actual column names
            columns = df.columns.tolist()
            print(f"  Available columns: {columns[:8]}")  # Show first 8 columns
            
            # Extract the relevant columns by position (more reliable than names)
            state_col = data_df.iloc[:, 0]    # Column A: State
            district_col = data_df.iloc[:, 1] # Column B: District
            r_col = data_df.iloc[:, 2]        # Column C: Republican votes
            d_col = data_df.iloc[:, 3]        # Column D: Democratic votes
            
            # Handle Other votes - might be in column 4 or 5 depending on year structure
            if len(data_df.columns) >= 5:
                other_col = data_df.iloc[:, 4]    # Column E: Other votes
            else:
                other_col = pd.Series([0] * len(data_df))
                
            if len(data_df.columns) >= 6:
                total_col = data_df.iloc[:, 5]    # Column F: Total votes
            else:
                # Calculate total if not provided
                total_col = r_col.fillna(0) + d_col.fillna(0) + other_col.fillna(0)
            
            # Create clean dataframe
            clean_df = pd.DataFrame({
                'year': year,
                'state': state_col,
                'district': district_col,
                'R_votes': pd.to_numeric(r_col, errors='coerce'),
                'D_votes': pd.to_numeric(d_col, errors='coerce'),
                'other_votes': pd.to_numeric(other_col, errors='coerce').fillna(0),
                'total_votes': pd.to_numeric(total_col, errors='coerce')
            })
            
            # Calculate T_votes (third party) as total - R - D (alternative calculation)
            clean_df['T_votes'] = clean_df['total_votes'] - clean_df['R_votes'] - clean_df['D_votes']
            
            # Clean up the data
            # Remove rows where state is NaN or empty
            clean_df = clean_df.dropna(subset=['state'])
            clean_df = clean_df[clean_df['state'].str.strip() != '']
            
            # Remove any remaining summary rows or non-state entries
            # Keep only 2-letter state codes and standard entries
            valid_states = clean_df['state'].str.len() == 2
            clean_df = clean_df[valid_states]
            
            # Convert district to string and handle special cases
            clean_df['district'] = clean_df['district'].astype(str)
            
            # Handle special district codes
            clean_df['district'] = clean_df['district'].replace({
                'AL': 'AL',      # At-large district
                'nan': 'AL',     # Sometimes at-large is coded as NaN
                'AL-1': '1',     # Standardize district numbering
                'AL-2': '2'
            })
            
            print(f"  Extracted {len(clean_df)} districts")
            print(f"  States: {sorted(clean_df['state'].unique())}")
            
            # Check for Maine and Nebraska districts (the key feature!)
            me_districts = clean_df[clean_df['state'] == 'ME']['district'].unique()
            ne_districts = clean_df[clean_df['state'] == 'NE']['district'].unique()
            
            if len(me_districts) > 1:
                print(f"  ✅ Maine districts: {sorted(me_districts)}")
            if len(ne_districts) > 1:
                print(f"  ✅ Nebraska districts: {sorted(ne_districts)}")
            
            all_elections.append(clean_df)
            
        except Exception as e:
            print(f"  ❌ Error processing {year}: {e}")
            continue
    
    if not all_elections:
        print("No data extracted successfully!")
        return
    
    # Combine all years into one dataframe
    combined_df = pd.concat(all_elections, ignore_index=True)
    
    print(f"\n{'='*50}")
    print(f"EXTRACTION COMPLETE")
    print(f"{'='*50}")
    print(f"Total records: {len(combined_df):,}")
    print(f"Years covered: {sorted(combined_df['year'].unique())}")
    print(f"States/territories: {len(combined_df['state'].unique())}")
    print(f"Total state-district combinations: {len(combined_df[['state', 'district']].drop_duplicates())}")
    
    # Save combined file
    combined_file = output_path / "presidential_elections_by_district_1968-2020.csv"
    combined_df.to_csv(combined_file, index=False)
    print(f"✅ Saved combined data: {combined_file}")
    
    # Save individual year files
    individual_dir = output_path / "by_year"
    individual_dir.mkdir(exist_ok=True)
    
    for year in combined_df['year'].unique():
        year_df = combined_df[combined_df['year'] == year]
        year_file = individual_dir / f"presidential_{year}.csv"
        year_df.to_csv(year_file, index=False)
    
    print(f"✅ Saved individual year files in: {individual_dir}")
    
    # Show sample of final data
    print(f"\n📊 SAMPLE DATA:")
    print(combined_df.head(10).to_string(index=False))
    
    # Show Maine/Nebraska summary across years
    print(f"\n🗺️ MAINE & NEBRASKA DISTRICTS BY YEAR:")
    for state in ['ME', 'NE']:
        state_data = combined_df[combined_df['state'] == state]
        if not state_data.empty:
            print(f"\n{state}:")
            for year in sorted(state_data['year'].unique()):
                year_districts = state_data[state_data['year'] == year]['district'].unique()
                print(f"  {year}: {sorted(year_districts)}")
    
    return combined_df

def main():
    """Main function to run the extraction"""
    
    # File path - adjust this to your file location
    excel_file = "Presidential Vote By Congressional District Master (by Kenneth Black).xlsx"
    
    # Check if file exists
    if not Path(excel_file).exists():
        print(f"❌ File not found: {excel_file}")
        print("Please make sure the Excel file is in the same directory as this script.")
        return
    
    try:
        # Extract the data
        df = extract_presidential_data(excel_file, output_dir="election_data")
        
        print(f"\n🎉 SUCCESS! Your congressional district election data is ready!")
        print(f"📁 Check the 'election_data' folder for your CSV files.")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        print("Make sure you have pandas and openpyxl installed:")
        print("pip install pandas openpyxl")

if __name__ == "__main__":
    main()
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
            
            # Prefer explicit column names 'R', 'D', 'T' (case-insensitive).
            # Fall back to positional columns when names are not present.
            state_col = data_df.iloc[:, 0]    # Column A: State
            district_col = data_df.iloc[:, 1] # Column B: District

            def find_col_by_name(df_src, names):
                """Return the first matching column series by name (case-insensitive) or None."""
                for col in df_src.columns:
                    if str(col).strip().lower() in [n.lower() for n in names]:
                        return df_src[col]
                return None

            # R (Republican), D (Democratic), T (Total)
            r_found = find_col_by_name(data_df, ['R'])
            if r_found is not None:
                r_col = r_found
            else:
                r_col = data_df.iloc[:, 2] if data_df.shape[1] > 2 else pd.Series([0] * len(data_df))

            d_found = find_col_by_name(data_df, ['D'])
            if d_found is not None:
                d_col = d_found
            else:
                d_col = data_df.iloc[:, 3] if data_df.shape[1] > 3 else pd.Series([0] * len(data_df))

            # Try to find total column named 'T' or 'Total' (case-insensitive)
            total_col = find_col_by_name(data_df, ['T', 'Total'])

            # Try to find an 'Other' column if present (names like 'O' or 'Other')
            other_col_named = find_col_by_name(data_df, ['O', 'Other'])

            # If total not found by name, attempt positional fallback
            if total_col is None:
                if data_df.shape[1] >= 6:
                    total_col = data_df.iloc[:, 5]
                else:
                    total_col = None

            # If other isn't directly available, we'll compute it below from total - R - D
            if other_col_named is not None:
                other_col = other_col_named
            else:
                other_col = None
            
            # Create clean dataframe
            # Convert numeric columns robustly
            R_votes = pd.to_numeric(r_col, errors='coerce').fillna(0)
            D_votes = pd.to_numeric(d_col, errors='coerce').fillna(0)

            if total_col is not None:
                total_votes = pd.to_numeric(total_col, errors='coerce').fillna(R_votes + D_votes)
            else:
                # If total not present, try to use a positional other_col or compute from R+D+other
                if other_col is not None:
                    other_tmp = pd.to_numeric(other_col, errors='coerce').fillna(0)
                    total_votes = R_votes + D_votes + other_tmp
                else:
                    total_votes = R_votes + D_votes

            # other_votes computed as total - R - D (per your request)
            other_votes = (total_votes - R_votes - D_votes).fillna(0)

            clean_df = pd.DataFrame({
                'year': year,
                'state': state_col,
                'district': district_col,
                'R_votes': R_votes,
                'D_votes': D_votes,
                'other_votes': other_votes,
                'total_votes': total_votes
            })

            # Keep T_votes for compatibility (same as other_votes)
            clean_df['T_votes'] = clean_df['other_votes']
            
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
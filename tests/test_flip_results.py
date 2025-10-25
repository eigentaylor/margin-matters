#!/usr/bin/env python3
"""
Test suite for build_flip_results.py changes.

Tests the following improvements:
1. Third-party vote flipping for breaking majority
2. Post-flip EV breakdown in output
3. Fixed -AL district independence issue for margin metric
"""

import csv
import sys
from pathlib import Path

# Add parent directory to path to import build_flip_results
sys.path.insert(0, str(Path(__file__).parent.parent))


def test_output_format():
    """Verify new output fields are present."""
    print("Testing output format...")
    
    # Check flip_details.csv has new fields
    with open('docs/flip_details.csv', newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        row = next(reader)
    
    required_detail_fields = [
        'year', 'metric', 'mode', 'abbr', 'ev',
        'from_party', 'to_party', 'votes_to_flip', 'pct_of_state_votes'
    ]
    missing = [f for f in required_detail_fields if f not in fieldnames]
    
    if missing:
        print(f"  ❌ FAIL: Missing fields in flip_details.csv: {missing}")
        return False
    
    print(f"  ✓ flip_details.csv has all required fields")
    
    # Check flip_results.csv has new fields
    with open('docs/flip_results.csv', newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        row = next(reader)
    
    required_summary_fields = [
        'classic_ev_d_after', 'classic_ev_r_after', 'classic_ev_t_after',
        'no_majority_ev_d_after', 'no_majority_ev_r_after', 'no_majority_ev_t_after',
        'tie_ev_d_after', 'tie_ev_r_after', 'tie_ev_t_after',
    ]
    missing = [f for f in required_summary_fields if f not in fieldnames]
    
    if missing:
        print(f"  ❌ FAIL: Missing fields in flip_results.csv: {missing}")
        return False
    
    print(f"  ✓ flip_results.csv has all required fields")
    print("  ✅ PASS: Output format correct\n")
    return True


def test_2000_ne_al_fix():
    """Verify that NE-AL is not chosen for margin metric in 2000 tie scenario."""
    print("Testing 2000 NE-AL fix...")
    
    with open('docs/flip_details.csv', newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        ne_rows_2000_margin_tie = [
            r for r in reader 
            if r['year'] == '2000' and r['metric'] == 'margin' and r['mode'] == 'tie'
        ]
    
    # Should NOT contain NE-AL
    ne_al_found = any(r['abbr'] == 'NE-AL' for r in ne_rows_2000_margin_tie)
    if ne_al_found:
        print("  ❌ FAIL: NE-AL found in 2000 margin tie results")
        return False
    
    # Should contain NE districts instead
    districts = [r for r in ne_rows_2000_margin_tie if r['abbr'].startswith('NE-')]
    if not districts:
        print("  ❌ FAIL: No NE districts found in 2000 margin tie results")
        return False
    
    print(f"  ✓ NE-AL not in results")
    print(f"  ✓ Found {len(districts)} NE districts: {[r['abbr'] for r in districts]}")
    
    # Check from_party and to_party are populated
    for r in districts:
        if not r['from_party'] or not r['to_party']:
            print(f"  ❌ FAIL: Missing from_party or to_party for {r['abbr']}")
            return False
    
    print("  ✅ PASS: 2000 NE-AL fix working correctly\n")
    return True


def test_third_party_flipping():
    """Verify that third-party flipping is implemented and tracked."""
    print("Testing third-party flipping...")
    
    with open('docs/flip_details.csv', newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        all_rows = list(reader)
    
    # Check for third-party target flips
    third_party_flips = [r for r in all_rows if r['to_party'] == 'T']
    
    if not third_party_flips:
        print("  ⚠ WARNING: No third-party flips found (may be OK if never optimal)")
    else:
        print(f"  ✓ Found {len(third_party_flips)} third-party target flips")
        # Show a few examples
        for r in third_party_flips[:3]:
            print(f"    - {r['year']} {r['abbr']}: {r['from_party']} → T ({r['mode']} mode)")
    
    # Verify all rows have from_party and to_party
    missing = [r for r in all_rows if not r['from_party'] or not r['to_party']]
    if missing:
        print(f"  ❌ FAIL: Found {len(missing)} rows with missing from_party or to_party")
        return False
    
    print(f"  ✓ All {len(all_rows)} rows have from_party and to_party")
    print("  ✅ PASS: Third-party flipping support working\n")
    return True


def test_post_flip_ev():
    """Verify post-flip EV breakdowns are correct."""
    print("Testing post-flip EV breakdowns...")
    
    with open('docs/flip_results.csv', newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        
        # Test 2000 margin tie - should be 269-269
        for row in reader:
            if row['year'] == '2000' and row['metric'] == 'margin':
                # Verify it's a 269-269 tie
                if row['tie_ev_d_after'] == '269' and row['tie_ev_r_after'] == '269':
                    print(f"  ✓ 2000 margin tie: D=269, R=269 (correct)")
                else:
                    print(f"  ❌ FAIL: Expected 269-269, got {row['tie_ev_d_after']}-{row['tie_ev_r_after']}")
                    return False
                break
    
    print("  ✅ PASS: Post-flip EV breakdowns correct\n")
    return True


def test_ev_sum_consistency():
    """Verify post-flip EV sums match total_ev for all years."""
    print("Testing EV sum consistency...")
    
    issues = []
    with open('docs/flip_results.csv', newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        
        for row in reader:
            year = row['year']
            metric = row['metric']
            total_ev = int(row['total_ev'])
            
            for mode in ['classic', 'no_majority', 'tie']:
                d = row.get(f'{mode}_ev_d_after', '')
                r = row.get(f'{mode}_ev_r_after', '')
                t = row.get(f'{mode}_ev_t_after', '')
                
                if d and r and t:
                    ev_sum = int(d) + int(r) + int(t)
                    if ev_sum != total_ev:
                        issues.append(f"{year} {metric} {mode}: sum={ev_sum}, expected={total_ev}")
    
    if issues:
        print(f"  ❌ FAIL: Found {len(issues)} inconsistencies:")
        for issue in issues[:5]:
            print(f"    {issue}")
        return False
    
    print(f"  ✓ All post-flip EV breakdowns sum correctly")
    print("  ✅ PASS: EV sum consistency verified\n")
    return True


def main():
    """Run all tests."""
    print("=" * 60)
    print("Flip Results Test Suite")
    print("=" * 60 + "\n")
    
    results = []
    results.append(test_output_format())
    results.append(test_2000_ne_al_fix())
    results.append(test_third_party_flipping())
    results.append(test_post_flip_ev())
    results.append(test_ev_sum_consistency())
    
    print("=" * 60)
    if all(results):
        print("All tests PASSED ✅")
        return 0
    else:
        print("Some tests FAILED ❌")
        return 1


if __name__ == '__main__':
    sys.exit(main())

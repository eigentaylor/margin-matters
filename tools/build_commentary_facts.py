"""
Read docs/presidential_margins.csv and generate docs/commentary_facts.json, a
static dataset of "notable fact" candidates for future election-night
commentary (voiced by the Nathaniel Sliver character): streaks of a state
matching the national popular vote winner, streaks matching the electoral
college winner, streaks of a state voting for the same party, and massive
national/state-level margin swings between consecutive elections.

This script only generates data -- it does not wire anything into the
election-night UI or dialogue system.

Usage:
    python tools/build_commentary_facts.py
"""
import csv
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IN_PATH = os.path.join(ROOT, 'docs', 'presidential_margins.csv')
OUT_PATH = os.path.join(ROOT, 'docs', 'commentary_facts.json')

INT_COLUMNS = ['year', 'electoral_votes']
NUMERIC_COLUMNS = [
    'pres_margin', 'pres_margin_delta',
    'national_margin', 'national_margin_delta',
    'relative_margin', 'relative_margin_delta',
    'two_party_margin', 'two_party_margin_delta',
]

# A streak needs at least this many consecutive elections to be "notable" --
# the user considers e.g. 3 elections in a row too common to be interesting.
STREAK_THRESHOLD_ELECTIONS = 5
STREAK_GAP_YEARS = 4

# Years where the electoral college winner's sign differs from the national
# popular vote winner's sign. Mirrors docs/bellwether-explorer.js:44 -- keep
# these two lists in sync if either changes.
EC_MISMATCH_YEARS = {1876, 1888, 2000, 2016}

# "Massive swing" cutoffs: the larger of a percentile of the actual observed
# distribution (so the bar adapts as more elections get appended) and a fixed
# floor (a safety net for small/degenerate candidate sets). See
# CHANGELOG_GUIDE.md-adjacent plan notes for how these were chosen against
# the real historical distribution.
NATIONAL_SWING_PERCENTILE = 90
NATIONAL_SWING_FLOOR = 0.08

STATE_SWING_RELATIVE_PERCENTILE = 97
STATE_SWING_RELATIVE_FLOOR = 0.10
STATE_SWING_RAW_PERCENTILE = 97
STATE_SWING_RAW_FLOOR = 0.15
STATE_SWING_TOP_N_CAP = 40


def load_rows(path):
    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = []
        for row in reader:
            for col in INT_COLUMNS:
                row[col] = int(row[col])
            for col in NUMERIC_COLUMNS:
                row[col] = float(row[col])
            rows.append(row)
    return rows


def index_by_unit(rows):
    by_abbr = {}
    national_by_year = {}
    for row in rows:
        if row['abbr'] == 'NATIONAL':
            national_by_year[row['year']] = row
        else:
            by_abbr.setdefault(row['abbr'], []).append(row)
    for abbr_rows in by_abbr.values():
        abbr_rows.sort(key=lambda r: r['year'])
    return by_abbr, national_by_year


def sign(value, eps=1e-9):
    if value is None:
        return None
    if abs(value) < eps:
        return 0
    return 1 if value > 0 else -1


def find_streaks(entries, is_start, continues, gap_years=STREAK_GAP_YEARS,
                  threshold=STREAK_THRESHOLD_ELECTIONS):
    """Find maximal runs of consecutive (gap_years apart) entries where
    is_start(entries[i]) holds and continues(entries[k-1], entries[k]) holds
    for every step. Only "true starts" (not already part of an earlier run)
    are reported, so each real streak is returned exactly once -- unlike
    bellwether-explorer.js's buildOutcomeSequences, which enumerates every
    qualifying sub-sequence for its slider UI, this is deliberately
    deduplicated since each streak should be a single fact candidate.
    """
    results = []
    n = len(entries)
    for i in range(n):
        if not is_start(entries[i]):
            continue
        if i > 0:
            gap = entries[i]['year'] - entries[i - 1]['year']
            if gap == gap_years and continues(entries[i - 1], entries[i]):
                continue  # part of an earlier run, not a true start

        j = i + 1
        while j < n:
            gap = entries[j]['year'] - entries[j - 1]['year']
            if gap != gap_years or not continues(entries[j - 1], entries[j]):
                break
            j += 1

        length = j - i
        if length >= threshold:
            results.append({
                'start_year': entries[i]['year'],
                'end_year': entries[j - 1]['year'],
                'length': length,
                'start_entry': entries[i],
                'end_entry': entries[j - 1],
                'break_entry': entries[j] if j < n else None,
                'is_active': j >= n,
            })
    return results


def percentile(values, pct):
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * (pct / 100)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return s[int(k)]
    return s[f] * (c - k) + s[c] * (k - f)


def find_outlier_deltas(candidates, value_fn, percentile_cut, floor, top_n_cap=None):
    abs_values = [abs(value_fn(c)) for c in candidates]
    cutoff = max(floor, percentile(abs_values, percentile_cut))
    qualifying = [c for c in candidates if abs(value_fn(c)) >= cutoff]
    qualifying.sort(key=lambda c: (
        -abs(value_fn(c)), c.get('abbr') or '', c.get('year', 0)
    ))
    if top_n_cap is not None:
        qualifying = qualifying[:top_n_cap]
    return qualifying


def _streak_break_reason(streak, unmatched_reason):
    """Shared break-reason logic for the NPV/EC match streaks: a break is
    either a genuine sign mismatch, or (defensively) a gap in the data."""
    break_entry = streak['break_entry']
    if break_entry is None:
        return None
    gap = break_entry['year'] - streak['end_year']
    if gap != STREAK_GAP_YEARS:
        return 'data_gap'
    return unmatched_reason


def _match_streak_facts(type_, by_abbr, target_sign_fn):
    facts = []
    for abbr, rows in sorted(by_abbr.items()):
        entries = []
        for row in rows:
            target = target_sign_fn(row)
            unit_sign = sign(row['pres_margin'])
            entry = dict(row)
            entry['success'] = target is not None and unit_sign is not None and target == unit_sign
            entries.append(entry)

        streaks = find_streaks(
            entries,
            is_start=lambda e: e['success'],
            continues=lambda p, c: c['success'],
        )
        for s in streaks:
            break_year = s['break_entry']['year'] if s['break_entry'] else None
            facts.append({
                'id': f"{type_}:{abbr}:{s['start_year']}-{s['end_year']}",
                'type': type_,
                'category': 'streak',
                'abbr': abbr,
                'start_year': s['start_year'],
                'end_year': s['end_year'],
                'length': s['length'],
                'break_year': break_year,
                'break_reason': _streak_break_reason(s, 'sign_flip'),
                'is_active': s['is_active'],
                'notes': [],
                'magnitude': s['length'],
            })
    return facts


def build_npv_match_streaks(by_abbr, national_by_year):
    def target_sign_fn(row):
        nat = national_by_year.get(row['year'])
        return sign(nat['pres_margin']) if nat is not None else None

    return _match_streak_facts('npv_match_streak', by_abbr, target_sign_fn)


def build_ec_match_streaks(by_abbr, national_by_year):
    def target_sign_fn(row):
        nat = national_by_year.get(row['year'])
        if nat is None:
            return None
        target = sign(nat['pres_margin'])
        if target is not None and row['year'] in EC_MISMATCH_YEARS:
            target = -target
        return target

    return _match_streak_facts('ec_match_streak', by_abbr, target_sign_fn)


def build_party_streaks(by_abbr):
    facts = []
    for abbr, rows in sorted(by_abbr.items()):
        entries = []
        for row in rows:
            entry = dict(row)
            if row.get('color') == 'yellow':
                entry['party_label'] = None
            else:
                s = sign(row['two_party_margin'])
                entry['party_label'] = 'D' if s == 1 else ('R' if s == -1 else None)
            entries.append(entry)

        streaks = find_streaks(
            entries,
            is_start=lambda e: e['party_label'] is not None,
            continues=lambda p, c: c['party_label'] is not None and c['party_label'] == p['party_label'],
        )
        for s in streaks:
            break_entry = s['break_entry']
            to_party = None
            notes = []
            if break_entry is None:
                break_reason = None
            elif break_entry['year'] - s['end_year'] != STREAK_GAP_YEARS:
                break_reason = 'data_gap'
            elif break_entry.get('color') == 'yellow':
                break_reason = 'third_party_win'
                notes.append('third_party_involved')
            elif break_entry['party_label'] is None:
                break_reason = 'exact_tie'
            else:
                break_reason = 'party_flip'
                to_party = break_entry['party_label']

            facts.append({
                'id': f"party_streak:{abbr}:{s['start_year']}-{s['end_year']}",
                'type': 'party_streak',
                'category': 'streak',
                'abbr': abbr,
                'party': s['start_entry']['party_label'],
                'start_year': s['start_year'],
                'end_year': s['end_year'],
                'length': s['length'],
                'break_year': break_entry['year'] if break_entry else None,
                'break_reason': break_reason,
                'to_party': to_party,
                'is_active': s['is_active'],
                'notes': notes,
                'magnitude': s['length'],
            })
    return facts


def build_national_swings(national_by_year):
    years = sorted(national_by_year.keys())
    candidates = []
    for i in range(1, len(years)):
        year, prev_year = years[i], years[i - 1]
        candidates.append({
            'abbr': None,
            'year': year,
            'prev_year': prev_year,
            'row': national_by_year[year],
            'prev_row': national_by_year[prev_year],
        })

    qualifying = find_outlier_deltas(
        candidates,
        value_fn=lambda c: c['row']['national_margin_delta'],
        percentile_cut=NATIONAL_SWING_PERCENTILE,
        floor=NATIONAL_SWING_FLOOR,
    )

    facts = []
    for c in qualifying:
        delta = c['row']['national_margin_delta']
        facts.append({
            'id': f"national_swing:{c['year']}",
            'type': 'national_swing',
            'category': 'swing',
            'abbr': None,
            'year': c['year'],
            'prev_year': c['prev_year'],
            'delta': delta,
            'from_margin_str': c['prev_row'].get('national_margin_str'),
            'to_margin_str': c['row'].get('national_margin_str'),
            'notes': [],
            'magnitude': abs(delta),
        })
    return facts


def build_state_swings(by_abbr):
    candidates = []
    for abbr, rows in sorted(by_abbr.items()):
        for i in range(1, len(rows)):
            row, prev_row = rows[i], rows[i - 1]
            if row['year'] - prev_row['year'] != STREAK_GAP_YEARS:
                continue  # only compare genuinely consecutive elections
            candidates.append({
                'abbr': abbr,
                'year': row['year'],
                'prev_year': prev_row['year'],
                'row': row,
                'prev_row': prev_row,
            })

    def make_facts(type_, value_key, percentile_cut, floor):
        qualifying = find_outlier_deltas(
            candidates, lambda c: c['row'][value_key],
            percentile_cut, floor, STATE_SWING_TOP_N_CAP,
        )
        facts = []
        for c in qualifying:
            delta = c['row'][value_key]
            notes = []
            if c['row'].get('color') == 'yellow' or c['prev_row'].get('color') == 'yellow':
                notes.append('third_party_involved')
            facts.append({
                'id': f"{type_}:{c['abbr']}:{c['year']}",
                'type': type_,
                'category': 'swing',
                'abbr': c['abbr'],
                'year': c['year'],
                'prev_year': c['prev_year'],
                'delta': delta,
                'notes': notes,
                'magnitude': abs(delta),
            })
        return facts

    relative_facts = make_facts(
        'state_swing_relative', 'relative_margin_delta',
        STATE_SWING_RELATIVE_PERCENTILE, STATE_SWING_RELATIVE_FLOOR,
    )
    raw_facts = make_facts(
        'state_swing_raw', 'pres_margin_delta',
        STATE_SWING_RAW_PERCENTILE, STATE_SWING_RAW_FLOOR,
    )
    return relative_facts, raw_facts


def main():
    rows = load_rows(IN_PATH)
    by_abbr, national_by_year = index_by_unit(rows)

    npv_facts = build_npv_match_streaks(by_abbr, national_by_year)
    ec_facts = build_ec_match_streaks(by_abbr, national_by_year)
    party_facts = build_party_streaks(by_abbr)
    national_swing_facts = build_national_swings(national_by_year)
    state_swing_relative_facts, state_swing_raw_facts = build_state_swings(by_abbr)

    all_facts = (
        npv_facts + ec_facts + party_facts
        + national_swing_facts + state_swing_relative_facts + state_swing_raw_facts
    )

    output = {
        'generated_from': 'docs/presidential_margins.csv',
        'attribution': 'Nathaniel Sliver',
        'params': {
            'streak_threshold_elections': STREAK_THRESHOLD_ELECTIONS,
            'streak_gap_years': STREAK_GAP_YEARS,
            'ec_mismatch_years': sorted(EC_MISMATCH_YEARS),
            'national_swing_percentile': NATIONAL_SWING_PERCENTILE,
            'national_swing_floor': NATIONAL_SWING_FLOOR,
            'state_swing_relative_percentile': STATE_SWING_RELATIVE_PERCENTILE,
            'state_swing_relative_floor': STATE_SWING_RELATIVE_FLOOR,
            'state_swing_raw_percentile': STATE_SWING_RAW_PERCENTILE,
            'state_swing_raw_floor': STATE_SWING_RAW_FLOOR,
            'state_swing_top_n_cap': STATE_SWING_TOP_N_CAP,
        },
        'facts': all_facts,
    }

    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, sort_keys=True)
        f.write('\n')

    print(f"NPV-match streaks: {len(npv_facts)}")
    print(f"EC-match streaks: {len(ec_facts)}")
    print(f"Party streaks: {len(party_facts)}")
    print(f"National swings: {len(national_swing_facts)}")
    print(f"State swings (relative): {len(state_swing_relative_facts)}")
    print(f"State swings (raw): {len(state_swing_raw_facts)}")
    print(f"Wrote {len(all_facts)} facts to {OUT_PATH}")


if __name__ == '__main__':
    main()

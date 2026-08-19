"""
Build docs/img/candidates.json: a flat, searchable index of every historical
candidate portrait on file, `{ name, year, img }`, for sim2028's candidate
search box.

Full names aren't stored anywhere alongside the portraits themselves (see
docs/img/portraits.json, keyed only by "{year}{lastname}"), so this script
cross-references docs/presidential_margins.csv, which does carry full names:
- Major-party nominees: the D_candidate/R_candidate columns.
- Third-party candidates: the third_party_results JSON blob (skipping
  generic non-name labels like "Other" or "Unpledged Electors").
2028 has no CSV row yet, so those seven names are hardcoded here to match
PRESET_CANDIDATES in docs/utils/sim2028/candidatePicker.js -- keep in sync.

Candidate-year pairs that share a byte-identical portrait (e.g. the same
1992 Perot photo reused for 1996) collapse to one entry at the earlier year:
the picker only ever carries a name + image, no year, so the later duplicate
adds no pickable content.

Usage:
    python tools/build_candidate_index.py
"""
import csv
import hashlib
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, 'docs', 'img')
CSV_PATH = os.path.join(ROOT, 'docs', 'presidential_margins.csv')
PORTRAITS_PATH = os.path.join(IMG_DIR, 'portraits.json')
OUT_PATH = os.path.join(IMG_DIR, 'candidates.json')

# Mirrors SURNAME_ALIASES in docs/utils/electionNight/candidatePortraits.js --
# portrait filenames use the natural surname, but the naive last-whitespace-
# token split used here (and there) gets a few multi-word surnames wrong.
SURNAME_ALIASES = {
    'Follette': 'LaFollette',  # "Robert La Follette" -> naive last token "Follette"
    'Ocasio-Cortez': 'Cortez',  # "Alexandria Ocasio-Cortez" -> naive last token "Ocasio-Cortez"
}

# Names that show up in third_party_results but aren't a real candidate.
GENERIC_THIRD_PARTY_LABELS = {
    'other', 'others', 'none', 'n/a', 'unpledged electors', 'write-in',
    'write-ins', 'scattered', 'blank', 'miscellaneous',
    'no candidate (bull moose)', 'no candidate (southern democrat)',
}

# 2028 has no election results yet, so these can't come from the CSV --
# keep in sync with PRESET_CANDIDATES in docs/utils/sim2028/candidatePicker.js.
CANDIDATES_2028 = [
    'Jon Ossoff', 'Andy Beshear', 'Pete Buttigieg',
    'Alexandria Ocasio-Cortez', 'Gavin Newsom', 'JD Vance', 'Marco Rubio',
]

# Straggler keys the CSV can't resolve automatically -- e.g. Harry F. Byrd
# only appears in the CSV as the generic "Unpledged Electors" label, never
# by name, for the Mississippi/Alabama/Louisiana electors who in fact backed
# him in 1960.
MANUAL_OVERRIDES = {
    '1960Byrd': 'Harry F. Byrd',
}


def naive_last_name(full_name):
    s = full_name.strip()
    if ',' in s:
        return s.split(',')[0].strip()
    parts = s.split()
    return parts[-1] if parts else s


def portrait_key(year, full_name):
    surname = naive_last_name(full_name)
    surname = SURNAME_ALIASES.get(surname, surname)
    return f"{year}{surname}"


def load_portraits():
    with open(PORTRAITS_PATH, encoding='utf-8') as f:
        return json.load(f)


def collect_names_by_year():
    """year -> set of full names seen as a D/R nominee or a real third-party
    candidate that year."""
    names_by_year = {}
    with open(CSV_PATH, encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            year = row.get('year')
            if not year:
                continue
            bucket = names_by_year.setdefault(year, set())
            for col in ('D_candidate', 'R_candidate'):
                name = (row.get(col) or '').strip()
                if name:
                    bucket.add(name)
            raw_tp = (row.get('third_party_results') or '').strip()
            if raw_tp and raw_tp != '{}':
                try:
                    tp = json.loads(raw_tp)
                except ValueError:
                    tp = {}
                for name in tp.keys():
                    name = name.strip()
                    if name and name.lower() not in GENERIC_THIRD_PARTY_LABELS:
                        bucket.add(name)
    return names_by_year


def resolve_names(portraits, names_by_year):
    """Returns {key: full_name} for every portraits.json key we can attribute
    to a real candidate, plus the list of keys that stayed unresolved."""
    resolved = {}

    for year, names in names_by_year.items():
        for name in names:
            key = portrait_key(year, name)
            if key in portraits and key not in resolved:
                resolved[key] = name

    for name in CANDIDATES_2028:
        key = portrait_key('2028', name)
        if key in portraits and key not in resolved:
            resolved[key] = name

    for key, name in MANUAL_OVERRIDES.items():
        if key in portraits:
            resolved[key] = name

    unresolved = sorted(k for k in portraits if k not in resolved)
    return resolved, unresolved


def file_hash(fname):
    path = os.path.join(IMG_DIR, fname)
    with open(path, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()


def build_entries(portraits, resolved):
    """One entry per resolved key, then collapse byte-identical portraits
    (same photo reused across years) down to the earliest year."""
    entries = []
    for key, name in resolved.items():
        year = int(key[:4])
        fname = portraits[key][0]  # primary/first variant, same convention as the JS lookups
        entries.append({
            'name': name,
            'year': year,
            'img': f'img/{fname}',
            '_hash': file_hash(fname),
        })

    by_hash = {}
    for e in entries:
        by_hash.setdefault(e['_hash'], []).append(e)

    deduped = []
    for group in by_hash.values():
        group.sort(key=lambda e: e['year'])
        deduped.append(group[0])

    for e in deduped:
        del e['_hash']
    deduped.sort(key=lambda e: (e['year'], e['name']))
    return deduped


def main():
    portraits = load_portraits()
    names_by_year = collect_names_by_year()
    resolved, unresolved = resolve_names(portraits, names_by_year)
    entries = build_entries(portraits, resolved)

    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(entries, f, indent=2)
        f.write('\n')

    print(f"Wrote {len(entries)} candidate entries to {OUT_PATH}")
    print(f"({len(resolved)} portrait keys resolved to a name, "
          f"{len(entries)} after collapsing duplicate portraits)")
    if unresolved:
        print(f"Skipped {len(unresolved)} portrait key(s) with no resolvable name:")
        for k in unresolved:
            print(f"  - {k}")


if __name__ == '__main__':
    main()

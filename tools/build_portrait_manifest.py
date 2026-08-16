"""
Scan docs/img for candidate portraits named [YEAR][Lastname](-n)?.ext (see
rename_candidate_images.py) and write docs/img/portraits.json, a static
manifest the client can fetch -- this is a GitHub Pages site, so there's no
server-side directory listing available at runtime.

Usage:
    python tools/build_portrait_manifest.py
"""
import json
import os
import re

IMG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs', 'img')
OUT_PATH = os.path.join(IMG_DIR, 'portraits.json')

# Variant suffix after a hyphen can be numeric (-1, -2, for undecided
# duplicates) or a word (-alt, for a deliberate second choice once the
# undecided ones get sorted out) -- either way the bare, no-suffix filename
# (if one exists) is always treated as the primary/preferred pick.
NAME_RE = re.compile(r'^(\d{4})([A-Za-z]+)(?:-([A-Za-z0-9]+))?\.(jpg|jpeg|png)$', re.IGNORECASE)


def variant_sort_key(variant):
    if variant is None:
        return (0, '')
    if variant.isdigit():
        return (1, int(variant))
    return (2, variant.lower())


def main():
    manifest = {}
    skipped = []
    for fname in sorted(os.listdir(IMG_DIR)):
        m = NAME_RE.match(fname)
        if not m:
            skipped.append(fname)
            continue
        year, lastname, variant, _ext = m.groups()
        key = f"{year}{lastname}"
        manifest.setdefault(key, []).append((variant_sort_key(variant), fname))

    out = {key: [fname for _, fname in sorted(variants)] for key, variants in manifest.items()}

    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2, sort_keys=True)
        f.write('\n')

    print(f"Wrote {len(out)} candidate-year keys to {OUT_PATH}")
    if skipped:
        print(f"Skipped {len(skipped)} file(s) not matching [YEAR][Lastname](-n)?.ext:")
        for fname in skipped:
            print(f"  - {fname}")


if __name__ == '__main__':
    main()

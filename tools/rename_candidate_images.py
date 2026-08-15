"""
Rename docs/img candidate portraits to a uniform [YEAR][Lastname].ext scheme.

Filenames arrived in whatever form they had on Wikimedia Commons -- some had
a year baked in (sometimes the election year, sometimes just the year the
photo was taken), some had none at all. This script maps each known file to
its target name explicitly (no fuzzy matching) so every decision is visible
and auditable in one place.

Two kinds of entries in CANDIDATE_MAP:
  - A plain "YEARLastname" target: confident assignment.
  - A target starting with "XXXX": the photo is for one of two possible
    election years and could not be determined from the filename alone.
    These are left with an "XXXX" year placeholder so they sort together
    and are easy to grep for; rename them by hand once you've picked a year.

GUESS_NOTES documents assignments made by elimination or arbitrary pairing
(e.g. two unlabeled Theodore Roosevelt photos split across his 1904 R run and
1912 Progressive run) so you know which ones to double check.

Files not related to the 1864-2024 presidential picture set (JD Vance, Jon
Ossoff -- Senate/future-cycle portraits) are left untouched.

Usage:
    python tools/rename_candidate_images.py            # dry run, prints the plan
    python tools/rename_candidate_images.py --apply     # actually renames (git mv)
"""
import argparse
import os
import subprocess
import sys

IMG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs', 'img')

# source filename -> target basename (without extension)
CANDIDATE_MAP = {
    '37_Lyndon_Johnson_3x4.jpg': '1964Johnson',
    'Abraham_Lincoln_O-77_matte_collodion_print.jpg': '1864Lincoln',
    'Adlai_E._Stevenson_II_(IL_2)_(cropped) 1952.jpg': '1952Stevenson',
    'Adlai_Stevenson_color_portrait 1956.jpg': '1956Stevenson',
    'Al_Gore,_Vice_President_of_the_United_States,_official_portrait_1994_(3x4_crop,_zoomed_in).png': '2000Gore',
    'Alf_Landon_closeupcrop.jpg': '1936Landon',
    'Alfred_Smith_(3x4_cropped).jpg': '1928Smith',
    'AltonBParker.png': '1904Parker',
    'Barack_Obama_2012_(4x5).png': '2012Obama',
    'Bill_Clinton_(cropped_2).jpg': 'XXXXClinton',  # 1992 or 1996 -- no year hint in filename
    'Bob_Dole,_PCCWW_photo_portrait_(cropped).jpg': '1996Dole',
    'Calvin_Coolidge_cph.3g10777_(cropped).jpg': '1924Coolidge',
    'Charles_Evans_Hughes_(Cropped).jpg': '1916Hughes',
    'DAVIS,_JOHN_W._HONORABLE_LCCN2016862563_(cropped).jpg': '1924Davis',
    'Donald_Trump_official_portrait_(cropped).jpg': 'XXXXTrump',  # 2016 or 2020 (2024 covered by the 2025 portrait below)
    'Dwight_D._Eisenhower,_official_photo_portrait,_May_29,_1959_(cropped) 1956.jpg': '1956Eisenhower-1',
    'Dwight_David_Eisenhower_1952_crop.jpg': '1952Eisenhower',
    'FDR_1944_Leon_Perskie_(3x4_cropped).jpg': '1944Roosevelt',
    'Face_detail,_James_G._Blaine_-_Brady-Handy_(cropped).jpg': '1884Blaine',
    'Franklin_D._Roosevelt 1932.jpg': '1932Roosevelt',
    'Franklin_D._Roosevelt_-_NARA_-_196715 1936.jpg': '1936Roosevelt',
    'George-W-Bush_(crop)2004.jpg': '2004Bush',
    'GeorgeMcClellan2_(3x4_cropped).jpg': '1864McClellan',
    'GeorgeWBush_2000.jpg': '2000Bush',
    'George_HW_Bush_crop.jpg': 'XXXXBush',  # George H.W. Bush, 1988 or 1992
    'George_McGovern_(D-SD)_(cropped).jpg': '1972McGovern',
    'George_Wallace_(D-AL)_(3x4).jpg': '1968Wallace',
    'Gerald_Ford_(1974)_(cropped).jpg': '1976Ford',
    'Grover_Cleveland_-_NARA_-_518139_(cropped).jpg': 'XXXXCleveland',  # 1884 or 1888 (1892 covered separately)
    'HARDING,_WARREN_G._HONORABLE_LCCN2016859366.jpg': '1920Harding',
    'Harry_F._Byrd_(3x4a).jpg': '1960Byrd',
    'Harry_S_Truman,_bw_half-length_photo_portrait,_facing_front,_1945_(cropped).jpg': '1948Truman',
    'Herbert_Hoover_(cropped)1928.jpg': '1928Hoover',
    'Hillary_Clinton_official_Secretary_of_State_portrait_crop.jpg': '2016Clinton',
    'Hon._Horatio_Seymour,_N.Y_-_NARA_-_528568_(cropped).jpg': '1868Seymour',
    'Horace_Greeley_restored_(cropped2).jpg': '1872Greeley',
    'Humphrey_1968_headshot.jpg': '1968Humphrey',
    'James_Abram_Garfield,_photo_portrait_seated_(cropped).jpg': '1880Garfield',
    'James_M._Cox_1920(Cropped).png': '1920Cox',
    'Jimmy_Carter_(cropped).jpg': '1976Carter',
    'Jimmy_Carter_presidential_portrait_(cropped_2).jpg': '1980Carter',
    'Joe_Biden_presidential_portrait_(cropped).jpg': '2020Biden',
    'John_F._Kennedy_cropped_2.jpg': '1960Kennedy',
    'John_F._Kerry_(cropped)(b).jpg': '2004Kerry',
    'John_S._McCain_(4x5).png': '2008McCain',
    'Kamala_Harris_Vice_Presidential_Portrait_(cropped).jpg': '2024Harris',
    'Michael_Dukakis_(cropped_new).jpg': '1988Dukakis',
    'Mitt_Romney_official_US_Senate_portrait_(cropped_and_rotated).jpg': '2012Romney',
    'Official_Presidential_Portrait_of_President_Donald_J._Trump_(2025)_(cropped)(2).jpg': '2024Trump',
    'Pach_Brothers_-_Benjamin_Harrison_(3x4_close_cropped).jpg': 'XXXXHarrison',  # 1888 or 1892
    'Portrait_of_President_Dwight_D._Eisenhower_1956_(3x4_cropped).jpg': '1956Eisenhower-2',
    'President_Rutherford_Hayes_1870_-_1880_(3x4_cropped).jpg': '1876Hayes',
    'Richard_Nixon_official_portrait_as_Vice_President_(cropped)1960.png': '1960Nixon',
    'Richard_Nixon_presidential_portrait_(cropped).jpg': 'XXXXNixon',  # 1968 or 1972 (1960 covered separately)
    'Robert_M._La_Follette,_Sr.jpg': '1924LaFollette',
    'Ronald_Reagan_1981_presidential_portrait_(cropped) 1980.jpg': '1980Reagan',
    'Ronald_Reagan_1985_presidential_portrait_(4x5_cropped)1984.jpg': '1984Reagan',
    'SamuelJonesTilden_(3x4_crop).jpg': '1876Tilden',
    'Senator_Goldwater_1960.jpg': '1964Goldwater',  # photo dated 1960 as senator; his only run was 1964
    'Stephen_Grover_Cleveland_Portrait_(3x4_close_cropped) 1892.jpg': '1892Cleveland',
    'Strom_Thurmond_1948.jpg': '1948Thurmond',
    'Theodore_Roosevelt-Pach_(cropped).jpg': '1904Roosevelt',  # GUESS, see GUESS_NOTES
    'Theodore_Roosevelt_by_the_Pach_Bros_(4x5_cropped).jpg': '1912Roosevelt',  # GUESS, see GUESS_NOTES
    'Thomas_Dewey_(3x4_crop).jpg': 'XXXXDewey',  # 1944 or 1948
    'Ulysses_S._Grant_1870-1880_(cropped2) 1872.jpg': '1872Grant',
    'Ulysses_S_Grant_by_Brady_c1870-restored_(3x4_crop) 1868.jpg': '1868Grant',
    'Walter_Mondale_VP_Portrait_(4x5_crop).jpg': '1984Mondale',
    'Weaver-James-B-1892.jpg': '1892Weaver',
    'WendellWillkie.jpg': '1940Willkie',
    'WilliamJBryan1900_3x4.jpg': '1900Bryan',
    'William_Howard_Taft,_head-and-shoulders_portrait,_facing_front 1912.jpg': '1912Taft',
    'William_Jennings_Bryan,_1860-1925_(closein_cropped_3x4) 1908.jpg': '1908Bryan',
    'William_Jennings_Bryan_2_B&W_(cropped) 1896.jpg': '1896Bryan',
    'William_McKinley_by_Courtney_Art_Studio,_1896_(cropped).jpg': '1896McKinley',
    'William_mckinley.jpg': '1900McKinley',  # by elimination: the 1896 photo is claimed above
    'Winfield_Scott_Hancock,_1824-86-cropped.jpg': '1880Hancock',
    'Woodrow_Wilson_(1912).jpg': '1912Wilson',
    'hoover_1932.jpg': '1932Hoover',
}

# Files intentionally left untouched (not part of the 1864-2024 presidential set)
SKIPPED = {
    'JD_Vance_official_portrait_(cropped_headshot).jpg': 'not a 1864-2024 presidential nominee/state-winner; likely for a future-cycle feature',
    'Jon_Ossoff_Senate_Portrait_2021_(cropped).jpg': 'Senate portrait, not a presidential candidate',
}

# Assignments that involved a judgment call -- double check these once renamed.
GUESS_NOTES = [
    "1904Roosevelt / 1912Roosevelt: both source photos are unlabeled Pach Bros portraits of "
    "Theodore Roosevelt with no year hint. They were split one-per-needed-year (1904 R nominee, "
    "1912 Progressive/T state winner) arbitrarily -- swap them if you can tell which is which.",
    "1976Carter / 1980Carter: two unlabeled Carter photos, arbitrarily split across his two runs "
    "per your note that you weren't sure which to use -- fine to point both filenames at the same "
    "image if you'd rather.",
    "XXXX-prefixed files: genuinely ambiguous between two election years with no filename hint. "
    "Rename the XXXX to the year you want once you've decided.",
]


def build_plan():
    plan = []  # (src_path, dst_path)
    seen_targets = {}
    for fname, target in CANDIDATE_MAP.items():
        src = os.path.join(IMG_DIR, fname)
        if not os.path.isfile(src):
            print(f"WARNING: expected file not found, skipping: {fname}", file=sys.stderr)
            continue
        ext = os.path.splitext(fname)[1]
        dst_name = f"{target}{ext}"
        dst = os.path.join(IMG_DIR, dst_name)
        if dst_name in seen_targets:
            raise SystemExit(f"Target collision: {dst_name} claimed by both "
                              f"{seen_targets[dst_name]!r} and {fname!r}")
        seen_targets[dst_name] = fname
        plan.append((src, dst, fname, dst_name))
    return plan


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='Actually rename files with git mv (default: dry run)')
    args = ap.parse_args()

    plan = build_plan()

    print(f"{len(plan)} files to rename, {len(SKIPPED)} left as-is, "
          f"{len(CANDIDATE_MAP) - len(plan)} missing from disk.\n")

    xxxx = [d for _, _, _, d in plan if d.startswith('XXXX')]
    if xxxx:
        print("Needs a manual year decision (rename the XXXX yourself once you pick):")
        for d in sorted(xxxx):
            print(f"  - {d}")
        print()

    if SKIPPED:
        print("Left untouched (not part of the presidential picture set):")
        for fname, why in SKIPPED.items():
            print(f"  - {fname}  ({why})")
        print()

    if GUESS_NOTES:
        print("Judgment calls made -- please verify:")
        for note in GUESS_NOTES:
            print(f"  - {note}")
        print()

    for src, dst, fname, dst_name in sorted(plan, key=lambda x: x[3]):
        marker = " <-- NEEDS YEAR" if dst_name.startswith('XXXX') else ""
        print(f"  {fname}\n      -> {dst_name}{marker}")

    if args.apply:
        print("\nApplying renames via git mv...")
        for src, dst, fname, dst_name in plan:
            if os.path.abspath(src) == os.path.abspath(dst):
                continue
            subprocess.run(['git', 'mv', src, dst], check=True)
        print("Done.")
    else:
        print("\nDry run only -- pass --apply to actually rename the files.")


if __name__ == '__main__':
    main()

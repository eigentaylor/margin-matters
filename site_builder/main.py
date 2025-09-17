import json
import shutil
from pathlib import Path

import params
from .config import CSV_PATH, OUT_DIR, STATE_DIR, UNIT_DIR, PLOTS_DST, PLOTS_SRC, LAST_UPDATED
from .io_utils import ensure_dirs, write_text, read_csv
from .pages import build_pages, make_index, make_data_page
from .templates import BASE_CSS, FAVICON_SVG, TESTER_JS
from .ranker import build_ranker_page


def build_site():
    ensure_dirs()
    write_text(OUT_DIR / "styles.css", BASE_CSS)
    write_text(OUT_DIR / "favicon.svg", FAVICON_SVG)

    if PLOTS_SRC.exists() and PLOTS_SRC.is_dir():
        PLOTS_DST.mkdir(parents=True, exist_ok=True)
        for item in PLOTS_SRC.iterdir():
            if item.is_file():
                shutil.copy2(item, PLOTS_DST / item.name)

    rows = read_csv(CSV_PATH)
    states = build_pages(rows)
    make_index(states, rows)

    try:
        shutil.copy2(CSV_PATH, OUT_DIR / "presidential_margins.csv")
    except Exception:
        pass

    try:
        make_data_page(rows)
    except Exception:
        pass

    # Build the ranker page with consistent header/styling
    try:
        build_ranker_page(rows)
    except Exception as e:
        print(f"Warning: couldn't build ranker page: {e}")

    if getattr(params, "INTERACTIVE_TESTER", False):
        cap_val = str(float(getattr(params, 'TESTER_PV_CAP', 0.25)))
        special_js = json.dumps(list(getattr(params, 'SPECIAL_1968_STATES', []) or []))
        write_text(OUT_DIR / "tester.js", TESTER_JS.replace('%PV_CAP%', cap_val).replace('%SPECIAL_1968%', special_js))
        try:
            shutil.copy2(CSV_PATH, OUT_DIR / "presidential_margins.csv")
        except Exception as e:
            print(f"Warning: couldn't copy {CSV_PATH} -> {OUT_DIR}: {e}")
        ec_src = Path("election_data") / "electoral_college.csv"
        if ec_src.exists():
            try:
                shutil.copy2(ec_src, OUT_DIR / "electoral_college.csv")
            except Exception as e:
                print(f"Warning: couldn't copy {ec_src} -> {OUT_DIR}: {e}")
        else:
            print("Note: election_data/electoral_college.csv not found; EV bar will use EVs from margins CSV if present.")
        geo_src = Path('me_ne_districts.geojson')
        if geo_src.exists():
            try:
                shutil.copy2(geo_src, OUT_DIR / 'me_ne_districts.geojson')
            except Exception as e:
                print(f"Warning: couldn't copy {geo_src} -> {OUT_DIR}: {e}")
        else:
            shp = Path('maps') / 'cb_2022_us_cd118_20m.shp'
            if shp.exists():
                try:
                    try:
                        import geopandas as gpd
                    except Exception:
                        gpd = None
                    if gpd is None:
                        raise RuntimeError('geopandas not available')
                    gdf = gpd.read_file(str(shp))
                    if 'STATEFP' in gdf.columns:
                        gdf = gdf[gdf.STATEFP.isin(['23','31'])]
                    else:
                        gdf = gdf[gdf['STATE_NAME'].isin(['Maine','Nebraska'])] if 'STATE_NAME' in gdf.columns else gdf
                    def make_unit(row):
                        try:
                            st = row.get('STATEFP') or row.get('STATE') or row.get('STATE_NAME')
                            cd = row.get('CD118FP') or row.get('CD116FP') or row.get('CDSESSFP') or row.get('CD118') or row.get('GEOID')
                            if isinstance(st, str) and st.isdigit():
                                stabbr = 'ME' if st == '23' else ('NE' if st == '31' else '')
                            else:
                                stabbr = 'ME' if 'Maine' in str(st) else ('NE' if 'Nebraska' in str(st) else '')
                            if stabbr and cd:
                                try:
                                    cdn = int(cd)
                                except Exception:
                                    cdn = int(str(cd).split()[-1]) if str(cd).isdigit() else None
                                if cdn:
                                    return f"{stabbr}-{cdn:02d}"
                        except Exception:
                            return None
                    gdf['unit'] = gdf.apply(make_unit, axis=1)
                    gdf = gdf[gdf['unit'].notnull()]
                    geojson = gdf.to_crs(epsg=4326).to_json()
                    (OUT_DIR / 'me_ne_districts.geojson').write_text(geojson, encoding='utf-8')
                except Exception as e:
                    print('Note: geopandas conversion unavailable or failed; ME/NE district overlay will not be generated.', e)
            else:
                print('Note: me_ne_districts.geojson not found and shapefile not present; ME/NE district overlay will be skipped.')
        try:
            shutil.copy2(CSV_PATH, OUT_DIR / "presidential_margins.csv")
        except Exception:
            pass

    print(f"Done. Open {OUT_DIR/'index.html'} in a browser or deploy /docs to GitHub Pages.")

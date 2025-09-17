from pathlib import Path
import datetime

# Paths
CSV_PATH = Path("presidential_margins.csv")
OUT_DIR = Path("docs")
STATE_DIR = OUT_DIR / "state"
UNIT_DIR = OUT_DIR / "unit"
PLOTS_SRC = Path("plots")
PLOTS_DST = OUT_DIR / "plots"

# Constants
SMALL_STATES = ["DC", "DE", "RI", "CT", "NJ", "MD", "MA", "VT", "NH"]
ME_NE_STATES = {"ME-AL", "NE-AL"}

# timestamp used in footers (UTC at build time)
LAST_UPDATED = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M UTC")

FOOTER_TEXT = (
    "Site by eigentaylor.<br />\n"
    "Data (possibly incorrectly scraped) from Wikipedia.<br /> \n"
    "Please report any innaccuracies to me through discord: eigentaylor ·"
)

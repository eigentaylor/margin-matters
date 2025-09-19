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

EXPLANATION_TEXT = (
    "<b>How this works:</b> We measure a state's relative margin as the difference between its presidential margin and the national presidential margin. A state with a relative margin of +5% is 5 points more Democratic than the nation as a whole, while a state with -3% is 3 points more Republican than the nation. By shifting the national presidential margin (PV) we can estimate how many electoral votes each party would win if the national popular vote were different. The EV bar above shows the estimated electoral vote split for the selected PV."
    "<br /><br />"
    "We only capped the maximum PV shift to ±{cap_pct}% to allow for particularly unrealistic scenarios (despite the days of a 20-point landslide being long gone). Since 1968, the largest PV margin was 23.1% in 1972, even Reagan never cracked 20% in his historic 1984 landslide. Since 1984, no candidate has surpassed a 10% margin. But if you want to see what a D+44.3 margin might look like, be my guest!"
    "<br /><br />"
    "<b>Note:</b> This is a simplified model that assumes uniform swing across all states and does not account for factors like turnout changes, demographic shifts, or unique state-level dynamics. It is intended for illustrative purposes only. The assumption of a uniform swing is a significant simplification, but is slightly more reasonable for modern elections where we have a relatively common national zeitgeist."
    "<br /><br />"
    "<i>Note on 1968:</i> A few states had a strong showing by third-party candidate George Wallace, which complicates the uniform swing assumption. We assume the national swing applies purely to the D and R votes, and that Wallace's vote share remains constant. Thus, some of these states actually have two tipping points: usually pushing a Wallace win into a D/R win, but in the case of TN, pushing an R win into a Wallace win and then into a D win."
    "<br />"
    "While a few states like Alabama and Mississippi are solidly Wallace territory (no national swing could change his plurality there), and other states like GA and LA require massive 30-50+ swings, other states like AR and TN have more reasonable tipping points."
    "<br /><br />"
    "<i>Note on Alabama:</i> Alabama is a complete mess. It's impossible to count it as a simple D/R contest in 1960 because of unpledged electors. We have opted to use the way Wikipedia counts them <a href='https://en.wikipedia.org/wiki/1960_United_States_presidential_election#Results_by_state' target='_blank' rel='noopener noreferrer'>here</a>. For testing different scenarios, we choose to allot electoral votes as 5D/6O unless Nixon wins, in which case all 11 go to R. In 1948, Truman was not even on the ballot, so we count Strom Thurmond as the de facto Democrat (but still color the state yellow unless it flips)."
    "<br /><br />"
    "<b>Flip scenarios</b> are computed by solving a knapsack problem to find the minimum number of popular votes needed to flip enough states to change the electoral college outcome (either to produce a new winner or to simply break the majority the original winner had). We choose the solution based on the minimum number of votes needed to flip (rather than the minimum number of states flipped). For example: in 2004, if Kerry had won Ohio, he would have won the presidency. But that would have actually required slightly more votes than flipping NM, IA, NV, and NE-02 combined, so the latter is the solution shown here."
)

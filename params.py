from typing import List, Dict, Optional


SWING_MARGIN = 0.05
SUPER_SWING_MARGIN = 0.02

COLORS = {
    'D': 'deepskyblue',
    'R': 'red',
    'T': 'yellow'
}

EC_LOCKED = 0.2
EC_SAFE = 0.1
EC_LEAN = 0.08
EC_TILT = 0.05

# Category thresholds (relative_margin)
# Order matters (from strong R to strong D)
CATEGORY_ORDER: List[str] = [
    "lockedR", "safeR", "leanR", "tiltR",
    "swing",
    "tiltD", "leanD", "safeD", "lockedD",
]

# Colors (dark mode friendly): R darkest -> lightest, swing purple, D lightest -> darkest
CATEGORY_COLORS = {
    "lockedR": "#8B0000",      # darkred
    "safeR":   "#B22222",      # firebrick
    "leanR":   "#CD5C5C",      # indianred
    "tiltR":   "#F08080",      # lightcoral
    "swing":   "#C3B1E1",      # light purple
    "tiltD":   "#87CEFA",      # lightskyblue
    "leanD":   "#6495ED",      # cornflowerblue
    "safeD":   "#4169E1",      # royalblue
    "lockedD": "#00008B",      # darkblue
}

# Ranges for each category
CATEGORY_THRESHOLDS = {
    "lockedR": -EC_LOCKED,
    "safeR":   -EC_SAFE,
    "leanR":   -EC_LEAN,
    "tiltR":   -EC_TILT,
    "swing":    EC_TILT,
    "tiltD":    EC_LEAN,
    "leanD":    EC_SAFE,
    "safeD":    EC_LOCKED,
    "lockedD":  float("inf"),
}

# Final margin thresholds (absolute final margin on [-1,1], negative = Republican advantage)
# These are cutoffs: for Republicans use the negative thresholds (margin <= value),
# for Democrats use the positive thresholds (margin >= value).
# Order runs from strongest R to strongest D.
FINAL_MARGIN_THRESHOLDS: Dict[str, float] = {
    # Republicans (most to least strong)
    "RED":   -0.12,   # darkest red: R wins by 20% or more
    "Red":   -0.06,   # darker red: R wins by 12%+
    "red":   -0.01,   # light red: R wins by 6%+
    "lred":  0.0,   # extremely narrow red: R wins by up to 1%
    # Democrats (narrow to strong)
    "lblue":  0.01,   # extremely narrow blue: D wins by up to 1%
    "blue":   0.06,   # light blue: D wins by 6%+
    "Blue":   0.12,   # darker blue: D wins by 12%+
    "BLUE":   0.20,   # darkest blue: D wins by 20%+
}

SPECIAL_1968_STATES = {"MS", "AR", "LA", "GA", "AL"}

# Interactive election tester (index page)
# If True, the home page will show an optional interactive tester UI with
# year + popular-vote sliders, dynamic map coloring, and an EV bar.
# Leave False while iterating; flip to True to enable on build.
INTERACTIVE_TESTER: bool = True

# Clamp for PV slider in tester (in fraction units, e.g. 0.25 = +/-25pp)
TESTER_PV_CAP: float = 0.9

# Optional: define a custom table column ordering and labels for the HTML tables.
# If set to None the code will fall back to the built-in heuristic order.
# Example formats accepted:
# - list of tuples (col_name, label): [("year","Year"),("D_votes","Dem Votes"),("R_votes","Rep Votes")]
# - list of strings (col names only): ["year","D_votes","R_votes"]
# Place this in your local copy of params.py to customize the table output.
TABLE_COLUMNS: Optional[List] = [
    ("year", "Year"),
    ("D_votes", "D"),
    ("D_pct", "D %"),
    ("R_votes", "R"),
    ("R_pct", "R %"),
    ("pres_margin_str", "State Margin"),
    ("national_margin_str", "Nat. Margin"),
    ("relative_margin_str", "Rel. Margin"),
    ("pres_margin_delta_str", "Margin Δ"),
    ("relative_margin_delta_str", "Rel. Margin Δ"),
    ("national_margin_delta_str", "Nat. Margin Δ"),
    ("two_party_margin_str", "2-Party Margin"),
    ("two_party_national_margin_str", "2-Party Nat. Margin"),
    ("two_party_relative_margin_str", "2-Party Rel. Margin"),
    ("two_party_margin_delta_str", "2-Party Margin Δ"),
    ("two_party_national_margin_delta_str", "2-Party Nat. Margin Δ"),
    ("two_party_relative_margin_delta_str", "2-Party Rel. Margin Δ"),
    ("T_votes", "Other votes"),
    ("T_pct", "Other %"),
    ("third_party_share_str", "State 3rd-Party Share"),
    ("third_party_national_share_str", "3rd-Party Nat. Share"),
    ("third_party_relative_share_str", "3rd-Party Rel. Share"),
    ("total_votes", "Total votes"),
    ("electoral_votes", "EVs"),
]

ABBR_TO_STATE = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
    'CO': 'Colorado', 'CT': 'Connecticut', 'DC': 'District of Columbia', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
    'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
    'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'ME-AL': 'Maine', 'ME-01': "Maine's 1st Congressional District", 'ME-02': "Maine's 2nd Congressional District",
    'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan',
    'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NE-AL': 'Nebraska', 'NE-01': "Nebraska's 1st Congressional District",
    'NE-02': "Nebraska's 2nd Congressional District", 'NE-03': "Nebraska's 3rd-Congressional District",
    'NV': 'Nevada',
    'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota',
    'OH': 'Ohio', 'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
    'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia',
    'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming'
}
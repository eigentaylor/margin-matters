from typing import List, Dict


SWING_MARGIN = 0.05
SUPER_SWING_MARGIN = 0.02

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
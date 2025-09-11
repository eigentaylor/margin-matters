import params

def lean_str(lean, third_party=False) -> str:
    """
    Convert a state lean value to a string representation (ex. D+1.2, R+11.2)
    """
    if lean is None:
        return '0'
    if third_party:
        prefix = 'T+' if lean > 0 else 'T-'
    else:
        prefix = 'D+' if lean > 0 else 'R+'
    if lean > 0.0001 or lean < -0.0001:
        return f"{prefix}{abs(lean * 100):.1f}"
    else:
        return "0" if third_party else "EVEN"

def emoji_from_lean(
    lean,
    use_swing=False,
    SWING_LEAN=params.SWING_MARGIN,
    use_super_swing=False,
    SUPER_SWING_LEAN=params.SUPER_SWING_MARGIN
):
    """
    Get an emoji representation of the state lean.
    If use_super_swing is True, use a smaller threshold and a different emoji for super swing states.
    """
    # Convert to float if it's a string
    if isinstance(lean, str):
        try:
            lean = float(lean)
        except (ValueError, TypeError):
            return "❓"  # Unknown for invalid values
    
    if use_super_swing and abs(lean) <= SUPER_SWING_LEAN:
        return "⚪"  # White for super swing
    threshold = SWING_LEAN if use_swing else 0.0
    if lean > threshold:
        return "🔵"  # Blue for Democratic lean
    elif lean < -threshold:
        return "🔴"  # Red for Republican lean
    else:
        return "🟣"  # Purple for swing
    
def categorize_relative_margin(x: float) -> str:
    """Map relative_margin to category per provided thresholds."""
    # Using strict < thresholds, otherwise falls into the next band toward center.
    for cat in params.CATEGORY_ORDER:
        if x < params.CATEGORY_THRESHOLDS[cat]:
            return cat
    return params.CATEGORY_ORDER[-1]


def final_margin_color_key(margin) -> str:
    """Return a final-margin color key based on params.FINAL_MARGIN_THRESHOLDS.

    margin: final margin as a float in [-1, 1] (negative = Republican advantage).
    Returns one of the keys from params.FINAL_MARGIN_THRESHOLDS (e.g. 'RED', 'red', 'lblue', 'BLUE')
    or 'swing' when the margin is within the narrow center band that isn't captured by the
    explicit thresholds.
    """
    # Normalize input
    if margin is None:
        return "swing"
    try:
        m = float(margin)
    except (ValueError, TypeError):
        return "swing"

    # Iterate in insertion order defined in params.FINAL_MARGIN_THRESHOLDS.
    # For negative cutoffs we check margin <= cutoff (Republican advantages).
    # For positive cutoffs we check margin >= cutoff (Democratic advantages).
    for key, cutoff in params.FINAL_MARGIN_THRESHOLDS.items():
        if m <= cutoff:
            return key

    # If no explicit threshold matched (e.g., margin between small negative and small positive)
    return "BLUE"
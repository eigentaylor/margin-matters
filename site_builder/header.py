from typing import Optional
from .config import LAST_UPDATED, FOOTER_TEXT


def make_header(title: str, is_inner: bool = False) -> str:
    """Return a consistent header HTML snippet used across pages.

    - title: short heading text displayed in the header legend
    - is_inner: True when the header is used on inner pages (adjusts link paths)
    """
    prefix = ".." if is_inner else "."
    return (
        f'<div class="card site-header" style="display:flex;justify-content:space-between;align-items:center;padding:8px">'
        f'<div class="small-links">'
        f'<a class="btn" href="{prefix}/index.html">Home</a>'
        f'<a class="btn" href="{prefix}/state-pages.html">State Pages</a>'
        #f'<a class="btn" href="{prefix}/trends.html">Trends</a>'
        f'<a class="btn" href="{prefix}/ranker.html">Ranker</a>'
        f'<a class="btn" href="{prefix}/trend-viewer.html">Trend Viewer</a>'
        f'<a class="btn" href="{prefix}/methods.html">Methods</a>'
        f'<a class="btn" href="{prefix}/presidential_margins.html">Data (CSV)</a>'
        f'</div>'
        f'<div class="legend">{title}</div>'
        f'</div>'
    )


def make_footer_note(extra: Optional[str] = None) -> str:
    """Return a footer text line with standard site note and timestamp.

    extra: optional extra note to append before the timestamp, e.g.,
           "Built as static HTML from CSV." or "Built from CSV."
    """
    extra_note = (extra + " ") if extra else ""
    return f"{FOOTER_TEXT} {extra_note}Last updated: {LAST_UPDATED}"

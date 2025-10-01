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
        f'<button class="header-toggle-btn" aria-label="Toggle navigation menu" aria-expanded="false">☰</button>'
        f'<div class="small-links">'
        f'<a class="btn" href="{prefix}/index.html">Home</a>'
        f'<a class="btn" href="{prefix}/state-pages.html">State Pages</a>'
        #f'<a class="btn" href="{prefix}/trends.html">Trends</a>'
        f'<a class="btn" href="{prefix}/paths2028.html">2028 Paths</a>'
        f'<a class="btn" href="{prefix}/ranker.html">Ranker</a>'
        f'<a class="btn" href="{prefix}/trend-viewer.html">Trend Viewer</a>'
        f'<a class="btn" href="{prefix}/future.html">"""Future"""</a>'
        f'<a class="btn" href="{prefix}/methods.html">Methods</a>'
        f'<a class="btn" href="{prefix}/presidential_margins.html">Data (CSV)</a>'
        f'</div>'
        f'<div class="legend">{title}</div>'
        f'</div>'
        f'<script>'
        f'(function(){{'
        f'const btn=document.querySelector(".header-toggle-btn");'
        f'const links=document.querySelector(".site-header .small-links");'
        f'if(btn&&links){{'
        f'btn.addEventListener("click",()=>{{'
        f'const exp=btn.getAttribute("aria-expanded")==="true";'
        f'btn.setAttribute("aria-expanded",exp?"false":"true");'
        f'links.classList.toggle("expanded");'
        f'}});'
        f'}}'
        f'}})()'
        f'</script>'
    )


def make_footer_note(extra: Optional[str] = None) -> str:
    """Return a footer text line with standard site note and timestamp.

    extra: optional extra note to append before the timestamp, e.g.,
           "Built as static HTML from CSV." or "Built from CSV."
    """
    extra_note = (extra + " ") if extra else ""
    return f"{FOOTER_TEXT} {extra_note}Last updated: {LAST_UPDATED}"

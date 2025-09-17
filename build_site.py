"""Thin wrapper to build the static site using the modular site_builder package."""

from site_builder.main import build_site


if __name__ == "__main__":
    # Preserve existing behavior of building the Ranker page before the site
    try:
        import tools.build_ranker_page
        tools.build_ranker_page.main()
    except Exception:
        pass
    build_site()
"""Thin wrapper to build the static site using the modular site_builder package."""

from site_builder.main import build_site


if __name__ == "__main__":
    # Preserve existing behavior of building the Ranker page before the site
    try:
        import tools.build_ranker_page
        tools.build_ranker_page.main()
    except Exception:
        pass
    # Build stop colors CSV before generating site
    try:
        import build_stop_colors
        build_stop_colors.main()
    except Exception as e:
        print(f"Warning: stop colors CSV not generated: {e}")
    build_site()
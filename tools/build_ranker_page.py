"""
CLI wrapper to generate docs/ranker.html using the centralized site_builder.ranker module.
Run:
  python tools/build_ranker_page.py
"""
from __future__ import annotations

from site_builder.ranker import build_ranker_page


def main():
    build_ranker_page()


if __name__ == "__main__":
    main()
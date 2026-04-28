#!/usr/bin/env python3
"""Fetch a web page using Camoufox and extract article content via trafilatura."""

import json
import sys
import argparse
import io

from trafilatura import extract
from camoufox.sync_api import Camoufox

FETCH_TIMEOUT = 15000  # ms — 单次 goto 超时；domcontentloaded + load fallback 最多 30s


def fetch(url: str):
    original_stdout = sys.stdout
    captured = io.StringIO()
    sys.stdout = captured

    try:
        with Camoufox(headless=True, block_images=True, i_know_what_im_doing=True) as browser:
            page = browser.new_page()
            try:
                # Try domcontentloaded first (fast), fallback to load on timeout.
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=FETCH_TIMEOUT)
                except Exception:
                    page.goto(url, wait_until="load", timeout=FETCH_TIMEOUT)

                title = page.title()
                html = page.content()

                # Extract article content with trafilatura
                extracted = extract(
                    html,
                    url=url,
                    include_comments=False,
                    include_tables=False,
                    include_images=False,
                )

                result = {
                    "title": title,
                    "content": extracted or "",
                }
            finally:
                page.close()
    finally:
        sys.stdout = original_stdout

    print(json.dumps(result, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description="Fetch web page via Camoufox")
    parser.add_argument("url", help="URL to fetch")
    args = parser.parse_args()

    try:
        fetch(args.url)
    except Exception as e:
        error_result = {"error": str(e)}
        print(json.dumps(error_result, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

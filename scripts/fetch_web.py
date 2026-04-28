#!/usr/bin/env python3
"""Fetch a web page using Camoufox and output JSON with title and HTML."""

import json
import sys
import argparse

FETCH_TIMEOUT = 20000  # ms


def fetch(url: str):
    from camoufox.sync_api import Camoufox

    with Camoufox(headless=True) as browser:
        page = browser.new_page()
        try:
            # Try domcontentloaded first (fast), fallback to load on timeout.
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=FETCH_TIMEOUT)
            except Exception:
                page.goto(url, wait_until="load", timeout=FETCH_TIMEOUT)

            title = page.title()
            html = page.content()
            body_text = page.evaluate("() => document.body?.innerText?.trim() || ''")

            result = {
                "title": title,
                "html": html,
                "bodyText": body_text,
            }
            print(json.dumps(result, ensure_ascii=False))
        finally:
            page.close()


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

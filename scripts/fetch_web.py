#!/usr/bin/env python3
"""Fetch a web page using Camoufox and extract article content via trafilatura."""

import json
import sys
import argparse
import io

from trafilatura import extract
from camoufox.sync_api import Camoufox

FETCH_TIMEOUT = 60000  # ms — 单次 goto 超时


def fetch(url: str):
    original_stdout = sys.stdout
    captured = io.StringIO()
    sys.stdout = captured

    try:
        with Camoufox(headless=True, block_images=True, i_know_what_im_doing=True) as browser:
            page = browser.new_page()
            try:
                # Try domcontentloaded first (fast, sufficient for most sites)
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=FETCH_TIMEOUT)
                except Exception:
                    # domcontentloaded 超时：尝试 load 作为 fallback，给更短时间
                    try:
                        page.goto(url, wait_until="load", timeout=5000)
                    except Exception:
                        # 连 load 也超时——页面可能已有部分内容，继续提取
                        pass

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

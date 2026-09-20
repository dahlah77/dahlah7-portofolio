#!/usr/bin/env python3
from __future__ import annotations

import html
import re
import sys
from pathlib import Path

import requests

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; source-acquisition/1.0)"}
DETAIL_URLS = [
    "https://openstax.org/details/books/principles-finance",
    "https://openstax.org/books/principles-finance/pages/1-introduction-to-finance",
    "https://openstax.org/apps/cms/api/books/principles-finance",
    "https://openstax.org/apps/cms/api/v2/books/principles-finance",
]
DIRECT_URLS = [
    "https://assets.openstax.org/oscms-prodcms/media/documents/PrinciplesofFinance-WEB.pdf",
    "https://assets.openstax.org/oscms-prodcms/media/documents/PrinciplesOfFinance-WEB.pdf",
    "https://assets.openstax.org/oscms-prodcms/media/documents/PrinciplesofFinance-OP.pdf",
    "https://assets.openstax.org/oscms-prodcms/media/documents/PrinciplesofFinance.pdf",
    "https://assets.openstax.org/oscms-prodcms/media/documents/principles-finance.pdf",
]

def get(url: str):
    return requests.get(url, headers=HEADERS, timeout=60, allow_redirects=True)

def candidates_from_page(body: str) -> list[str]:
    decoded = html.unescape(body).replace("\\/", "/").replace("\\u002F", "/")
    found = re.findall(r"https?://[^\"'<>\\\s]+?\.pdf(?:\?[^\"'<>\\\s]*)?", decoded, flags=re.I)
    # Relative asset links occasionally occur in serialized React data.
    for path in re.findall(r"/[^\"'<>\\\s]+?\.pdf(?:\?[^\"'<>\\\s]*)?", decoded, flags=re.I):
        if "openstax" in path or "media" in path or "assets" in path:
            found.append("https://openstax.org" + path)
    ordered = []
    seen = set()
    for value in found:
        value = value.rstrip(".,;)")
        if value not in seen:
            seen.add(value)
            ordered.append(value)
    return ordered

def valid_pdf(response: requests.Response) -> bool:
    content = response.content
    return response.status_code == 200 and len(content) > 1_000_000 and content[:5] == b"%PDF-"

def main() -> None:
    log = []
    discovered = []
    for url in DETAIL_URLS:
        try:
            r = get(url)
            log.append(f"DETAIL {r.status_code} {len(r.content)} {r.url}")
            if r.ok:
                discovered.extend(candidates_from_page(r.text))
        except Exception as exc:
            log.append(f"DETAIL ERROR {url}: {type(exc).__name__}: {exc}")
    candidates = DIRECT_URLS + discovered
    # Deduplicate while preserving order.
    seen = set()
    candidates = [u for u in candidates if not (u in seen or seen.add(u))]
    log.append("CANDIDATES:\n" + "\n".join(candidates))
    for url in candidates:
        try:
            r = get(url)
            log.append(f"PDF {r.status_code} {len(r.content)} {r.url}")
            if valid_pdf(r):
                Path("principles-finance.pdf").write_bytes(r.content)
                Path("source-discovery.txt").write_text("\n".join(log), encoding="utf-8")
                print("Downloaded source PDF:", r.url, flush=True)
                return
        except Exception as exc:
            log.append(f"PDF ERROR {url}: {type(exc).__name__}: {exc}")
    Path("source-discovery.txt").write_text("\n".join(log), encoding="utf-8")
    print("\n".join(log), flush=True)
    raise SystemExit("Could not retrieve a valid source PDF")

if __name__ == "__main__":
    main()

from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
ARCHIVE_DIR = DATA_DIR / "archive"

CATEGORIES = ["cs.AR", "cs.DC", "cs.NI", "cs.PL", "cs.OS"]
FEED_URL = f"https://rss.arxiv.org/atom/{'+'.join(CATEGORIES)}"
ATOM = "{http://www.w3.org/2005/Atom}"
ARXIV = "{http://arxiv.org/schemas/atom}"
DC = "{http://purl.org/dc/elements/1.1/}"

TEX_ACCENTS = {
    "\\'A": "Á",
    "\\'E": "É",
    "\\'I": "Í",
    "\\'O": "Ó",
    "\\'U": "Ú",
    "\\'a": "á",
    "\\'e": "é",
    "\\'i": "í",
    "\\'o": "ó",
    "\\'u": "ú",
    '\\"A': "Ä",
    '\\"E': "Ë",
    '\\"I': "Ï",
    '\\"O': "Ö",
    '\\"U': "Ü",
    '\\"a': "ä",
    '\\"e': "ë",
    '\\"i': "ï",
    '\\"o': "ö",
    '\\"u': "ü",
    "\\`A": "À",
    "\\`E": "È",
    "\\`I": "Ì",
    "\\`O": "Ò",
    "\\`U": "Ù",
    "\\`a": "à",
    "\\`e": "è",
    "\\`i": "ì",
    "\\`o": "ò",
    "\\`u": "ù",
    "\\~A": "Ã",
    "\\~N": "Ñ",
    "\\~O": "Õ",
    "\\~a": "ã",
    "\\~n": "ñ",
    "\\~o": "õ",
}


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def clean_author(value: str) -> str:
    for source, replacement in TEX_ACCENTS.items():
        value = value.replace(source, replacement)
    value = re.sub(r"\\([{}])", r"\1", value)
    value = value.replace("\\", "")
    return clean(value)


def https_url(value: str | None) -> str:
    if not value:
        return ""
    return value.replace("http://", "https://", 1)


def text(parent: ET.Element, tag: str) -> str:
    child = parent.find(f"{ATOM}{tag}")
    return clean(child.text if child is not None else "")


def ns_text(parent: ET.Element, namespace: str, tag: str) -> str:
    child = parent.find(f"{namespace}{tag}")
    return clean(child.text if child is not None else "")


def abstract_text(entry: ET.Element) -> str:
    summary = text(entry, "summary")
    return re.sub(r"^arXiv:\S+\s+Announce Type:\s+\S+\s+Abstract:\s*", "", summary)


def extract_authors(entry: ET.Element) -> list[str]:
    authors = [text(author, "name") for author in entry.findall(f"{ATOM}author") if text(author, "name")]
    if authors:
        return authors

    creator = ns_text(entry, DC, "creator")
    if not creator:
        return []
    return [clean_author(author) for author in creator.split(",") if clean_author(author)]


def arxiv_id_from_url(value: str) -> str:
    match = re.search(r"arxiv\.org/(?:abs|pdf)/([^?#/]+)", value)
    if not match:
        return clean(value).rstrip("/").split("/")[-1]
    arxiv_id = match.group(1).removesuffix(".pdf")
    return re.sub(r"v\d+$", "", arxiv_id)


def parse_links(entry: ET.Element) -> list[dict[str, str]]:
    links = []
    for link in entry.findall(f"{ATOM}link"):
        href = https_url(link.attrib.get("href"))
        if not href:
            continue
        links.append(
            {
                "href": href,
                "rel": link.attrib.get("rel", ""),
                "type": link.attrib.get("type", ""),
                "title": link.attrib.get("title", ""),
            }
        )
    return links


def extract_categories(entry: ET.Element) -> tuple[list[str], str]:
    categories: list[str] = []
    for category in entry.findall(f"{ATOM}category"):
        term = category.attrib.get("term", "")
        if term.startswith("cs.") and term not in categories:
            categories.append(term)

    primary = ""
    primary_node = entry.find(f"{ARXIV}primary_category")
    if primary_node is not None:
        primary = primary_node.attrib.get("term", "")

    if primary and primary not in categories:
        categories.insert(0, primary)

    matched = [category for category in categories if category in CATEGORIES]
    display_categories = matched or categories
    display_primary = primary if primary in display_categories else display_categories[0] if display_categories else ""
    return display_categories, display_primary


def parse_entry(entry: ET.Element) -> dict[str, Any]:
    entry_id = https_url(text(entry, "id"))
    links = parse_links(entry)
    versioned_id = clean(entry_id).removeprefix("oai:arXiv.org:")

    abs_url = next(
        (link["href"] for link in links if link["rel"] in {"alternate", ""} and "/abs/" in link["href"]),
        entry_id,
    )
    pdf_url = next(
        (
            link["href"]
            for link in links
            if link["type"] == "application/pdf" or link["title"].lower() == "pdf" or "/pdf/" in link["href"]
        ),
        "",
    )
    if not pdf_url and "/abs/" in abs_url:
        pdf_url = abs_url.replace("/abs/", "/pdf/")

    categories, primary_category = extract_categories(entry)
    arxiv_id = arxiv_id_from_url(abs_url or entry_id)

    return {
        "id": arxiv_id,
        "versionedId": versioned_id,
        "title": text(entry, "title"),
        "authors": extract_authors(entry),
        "summary": abstract_text(entry),
        "categories": categories,
        "primaryCategory": primary_category,
        "announceType": ns_text(entry, ARXIV, "announce_type"),
        "published": text(entry, "published") or text(entry, "updated"),
        "updated": text(entry, "updated"),
        "absUrl": abs_url,
        "pdfUrl": pdf_url,
    }


def fetch_feed() -> bytes:
    request = urllib.request.Request(
        FEED_URL,
        headers={
            "User-Agent": "paper-review/1.0 (https://ray-ruipan.github.io/paper-review/)",
            "Accept": "application/atom+xml, application/xml;q=0.9, */*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=40) as response:
        return response.read()


def parse_feed(xml_bytes: bytes) -> dict[str, Any]:
    root = ET.fromstring(xml_bytes)
    papers_by_id: dict[str, dict[str, Any]] = {}

    for entry in root.findall(f"{ATOM}entry"):
        paper = parse_entry(entry)
        if not paper["id"]:
            continue
        papers_by_id[paper["id"]] = paper

    papers = sorted(
        papers_by_id.values(),
        key=lambda paper: paper.get("published") or paper.get("updated") or "",
        reverse=True,
    )

    return {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "displayTimeZone": "Asia/Shanghai",
            "feedUpdated": text(root, "updated"),
            "sourceUrl": FEED_URL,
            "categories": CATEGORIES,
            "count": len(papers),
        },
        "papers": papers,
    }


def snapshot_date() -> str:
    if ZoneInfo is not None:
        try:
            return datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat()
        except Exception:
            pass
    return datetime.now(timezone.utc).date().isoformat()


def paper_signature(payload: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {
            "id": clean(paper.get("id")),
            "announceType": clean(paper.get("announceType")),
            "published": clean(paper.get("published")),
        }
        for paper in payload.get("papers", [])
    ]


def should_write_update(payload: dict[str, Any]) -> bool:
    if not payload.get("papers"):
        print("No papers in the arXiv feed; keeping the previous site data.")
        return False

    latest_path = DATA_DIR / "papers.json"
    if not latest_path.exists():
        return True

    current = json.loads(latest_path.read_text(encoding="utf-8"))
    if paper_signature(current) == paper_signature(payload):
        current_date = current.get("meta", {}).get("displayDate") or "previous snapshot"
        print(f"No new arXiv announcement since {current_date}; keeping the previous site data.")
        return False

    return True


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def update_archive_index(date_key: str, count: int, generated_at: str) -> None:
    index_path = DATA_DIR / "archive-index.json"
    if index_path.exists():
        index = json.loads(index_path.read_text(encoding="utf-8"))
    else:
        index = {"snapshots": []}

    snapshots = [item for item in index.get("snapshots", []) if item.get("date") != date_key]
    snapshots.insert(
        0,
        {
            "date": date_key,
            "path": f"data/archive/{date_key}.json",
            "count": count,
            "generatedAt": generated_at,
        },
    )
    index["snapshots"] = snapshots[:60]
    write_json(index_path, index)


def main() -> int:
    try:
        payload = parse_feed(fetch_feed())
    except Exception as exc:
        print(f"Failed to fetch arXiv feed: {exc}", file=sys.stderr)
        return 1

    date_key = snapshot_date()
    payload["meta"]["displayDate"] = date_key
    if not should_write_update(payload):
        return 0

    write_json(DATA_DIR / "papers.json", payload)
    write_json(ARCHIVE_DIR / f"{date_key}.json", payload)
    update_archive_index(date_key, payload["meta"]["count"], payload["meta"]["generatedAt"])
    print(f"Wrote {payload['meta']['count']} papers for {date_key}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

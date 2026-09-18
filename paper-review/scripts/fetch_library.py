from __future__ import annotations

import argparse
import calendar
import copy
import hashlib
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
LIBRARY_DIR = ROOT / "data" / "library"
SOURCES_PATH = LIBRARY_DIR / "sources.json"
INDEX_PATH = LIBRARY_DIR / "index.json"
TRACKS_DIR = LIBRARY_DIR / "tracks"

USER_AGENT = "paper-review-library/1.0 (https://ray-ruipan.github.io/paper-review/)"
UNCATEGORIZED = "Uncategorized"
DBLP_DELAY_SECONDS = 2.2
CROSSREF_DELAY_SECONDS = 0.25
NON_PAPER_TITLES = (
    "author index",
    "back matter",
    "committee",
    "conference committee",
    "copyright",
    "cover",
    "front matter",
    "keynote",
    "message from",
    "organizing committee",
    "preface",
    "program committee",
    "table of contents",
    "title page",
)


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", html.unescape(str(value or ""))).strip()


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fetch_json(url: str, timeout: int = 45, attempts: int = 3) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json, */*;q=0.8",
        },
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read().decode("utf-8", errors="replace")
                try:
                    return json.loads(body)
                except json.JSONDecodeError as exc:
                    snippet = clean(body[:180])
                    raise ValueError(f"Non-JSON response from {url}: {snippet}") from exc
        except ValueError as exc:
            last_error = exc
            break
        except (urllib.error.HTTPError, urllib.error.URLError) as exc:
            last_error = exc
            if attempt == attempts - 1:
                break
            time.sleep(3 * (attempt + 1))
    raise last_error or RuntimeError(f"Failed to fetch {url}")


def normalize_people(value: Any) -> list[str]:
    if not value:
        return []
    people = value
    if isinstance(value, dict) and "author" in value:
        people = value["author"]
    if not isinstance(people, list):
        people = [people]

    names: list[str] = []
    for person in people:
        if isinstance(person, dict):
            name = clean(person.get("text") or person.get("#text") or person.get("name"))
        else:
            name = clean(person)
        if name:
            names.append(name)
    return names


def list_value(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def first_text(value: Any) -> str:
    for item in list_value(value):
        if isinstance(item, dict):
            text = clean(item.get("text") or item.get("#text") or item.get("url"))
        else:
            text = clean(item)
        if text:
            return text
    return ""


def doi_from_url(value: str) -> str:
    match = re.search(r"doi\.org/(10\.\S+)", value, flags=re.I)
    return clean(match.group(1)).rstrip(".") if match else ""


def normalize_doi(value: str) -> str:
    value = clean(value)
    value = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", value, flags=re.I)
    return value.lower()


def stable_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha1("::".join(clean(part) for part in parts).encode("utf-8")).hexdigest()[:16]
    return f"{prefix}:{digest}"


def date_parts_to_iso(date_parts: Any) -> str:
    parts = []
    try:
        parts = date_parts.get("date-parts", [[]])[0]
    except AttributeError:
        return ""
    if not parts:
        return ""
    year = int(parts[0])
    month = int(parts[1]) if len(parts) > 1 else 1
    day = int(parts[2]) if len(parts) > 2 else 1
    return f"{year:04d}-{month:02d}-{day:02d}"


def date_parts_year(date_parts: Any) -> int | None:
    try:
        parts = date_parts.get("date-parts", [[]])[0]
    except AttributeError:
        return None
    if not parts:
        return None
    try:
        return int(parts[0])
    except (TypeError, ValueError):
        return None


def item_year(item: dict[str, Any]) -> int | None:
    for field in ("published-print", "published-online", "published", "issued", "created"):
        year = date_parts_year(item.get(field))
        if year:
            return year
    return None


def strip_markup(value: str) -> str:
    return clean(html.unescape(re.sub(r"<[^>]+>", " ", value or "")))


def normalized_words(value: str) -> list[str]:
    return [word for word in re.split(r"[^a-z0-9]+", value.lower()) if len(word) > 1]


def crossref_author_names(authors: Any) -> list[str]:
    names: list[str] = []
    for author in list_value(authors):
        if not isinstance(author, dict):
            continue
        literal = clean(author.get("name"))
        given = clean(author.get("given"))
        family = clean(author.get("family"))
        name = literal or clean(f"{given} {family}")
        if name:
            names.append(name)
    return names


def load_track_overrides(venue_id: str, year: int) -> dict[str, str]:
    path = TRACKS_DIR / venue_id / f"{year}.json"
    data = read_json(path, {})
    return {clean(key).lower(): clean(value) for key, value in data.items() if clean(value)}


def lookup_track(overrides: dict[str, str], record: dict[str, Any]) -> str:
    keys = [
        normalize_doi(record.get("doi", "")),
        clean(record.get("dblpKey", "")).lower(),
        clean(record.get("id", "")).lower(),
        clean(record.get("title", "")).lower(),
    ]
    return next((overrides[key] for key in keys if key and key in overrides), UNCATEGORIZED)


def dblp_toc_url(source: dict[str, Any], year: int) -> str:
    bht_path = f"db/conf/{source['dblpVenue']}/{source['bhtPrefix']}{year}.bht"
    query = f"toc:{bht_path}:"
    encoded_query = urllib.parse.quote(query, safe="/")
    return f"https://dblp.org/search/publ/api?q={encoded_query}&format=json&h=1000&c=0"


def dblp_hits(payload: dict[str, Any]) -> list[dict[str, Any]]:
    hits = payload.get("result", {}).get("hits", {}).get("hit", [])
    return hits if isinstance(hits, list) else [hits]


def parse_dblp_record(info: dict[str, Any], source: dict[str, Any], year: int) -> dict[str, Any] | None:
    entry_type = clean(info.get("type"))
    if entry_type and entry_type != "Conference and Workshop Papers":
        return None

    key = clean(info.get("key"))
    title = strip_markup(info.get("title")).rstrip(".")
    if not key or not title:
        return None

    ee = first_text(info.get("ee"))
    doi = normalize_doi(info.get("doi") or doi_from_url(ee))
    record_id = f"doi:{doi}" if doi else f"dblp:{key}"
    venue_id = source["id"]
    venue_name = source.get("name") or venue_id

    return {
        "id": record_id,
        "source": "library",
        "kind": "conference",
        "title": title,
        "authors": normalize_people(info.get("authors")),
        "summary": "",
        "venue": venue_id,
        "venueName": venue_name,
        "area": source.get("area", ""),
        "year": year,
        "month": "",
        "track": UNCATEGORIZED,
        "published": f"{year}-01-01",
        "pages": clean(info.get("pages")),
        "doi": doi,
        "dblpKey": key,
        "dblpUrl": f"https://dblp.org/rec/{key}",
        "url": ee or f"https://dblp.org/rec/{key}",
    }


def fetch_dblp_conference_year(source: dict[str, Any], year: int) -> list[dict[str, Any]]:
    url = dblp_toc_url(source, year)
    payload = fetch_json(url)
    overrides = load_track_overrides(source["id"], year)
    records: list[dict[str, Any]] = []

    for hit in dblp_hits(payload):
        info = hit.get("info", {}) if isinstance(hit, dict) else {}
        record = parse_dblp_record(info, source, year)
        if not record:
            continue
        record["track"] = lookup_track(overrides, record)
        records.append(record)

    return records


def crossref_conference_url(source: dict[str, Any], year: int, query: str) -> str:
    start, end = month_range(year, 1)[0], month_range(year, 12)[1]
    filters = f"type:proceedings-article,from-pub-date:{start},until-pub-date:{end}"
    params = urllib.parse.urlencode(
        {
            "query.event-name": query,
            "filter": filters,
            "rows": "1000",
        }
    )
    return f"https://api.crossref.org/works?{params}"


def crossref_conference_queries(source: dict[str, Any]) -> list[str]:
    configured = source.get("crossrefEventNames") or source.get("crossrefEventName")
    queries = list_value(configured) or [source.get("name"), source.get("id")]
    return [clean(query) for query in queries if clean(query)]


def crossref_event_text(item: dict[str, Any]) -> str:
    event = item.get("event") if isinstance(item.get("event"), dict) else {}
    parts = [
        first_text(item.get("container-title")),
        clean(event.get("name")),
        clean(event.get("acronym")),
    ]
    return " ".join(part for part in parts if part)


def crossref_conference_matches(item: dict[str, Any], source: dict[str, Any], year: int) -> bool:
    if clean(item.get("type")) != "proceedings-article":
        return False
    if item_year(item) != year:
        return False

    text = crossref_event_text(item)
    text_words = set(normalized_words(text))
    query_words = [
        word
        for word in normalized_words(clean(source.get("crossrefEventName") or source.get("name")))
        if word not in {"acm", "ieee", "annual", "international", "conference", "symposium", "workshop", "on", "and"}
    ]
    source_key = re.sub(r"[^a-z0-9]+", "", clean(source.get("id")).lower())
    text_key = re.sub(r"[^a-z0-9]+", "", text.lower())

    if len(source_key) > 2:
        return source_key in text_key
    if not query_words:
        return False

    matched = sum(1 for word in query_words if word in text_words)
    required = max(2, min(len(query_words), int(len(query_words) * 0.6 + 0.5)))
    return matched >= required


def is_non_paper_title(title: str) -> bool:
    lowered = title.lower()
    return any(pattern in lowered for pattern in NON_PAPER_TITLES)


def parse_crossref_conference_record(item: dict[str, Any], source: dict[str, Any], year: int) -> dict[str, Any] | None:
    title = strip_markup(first_text(item.get("title"))).rstrip(".")
    authors = crossref_author_names(item.get("author"))
    if not title or not authors or is_non_paper_title(title):
        return None

    doi = normalize_doi(item.get("DOI", ""))
    record_id = f"doi:{doi}" if doi else stable_id("crossref", source["id"], str(year), title)
    published = (
        date_parts_to_iso(item.get("published-print"))
        or date_parts_to_iso(item.get("published-online"))
        or date_parts_to_iso(item.get("published"))
        or date_parts_to_iso(item.get("issued"))
        or f"{year:04d}-01-01"
    )
    resource = item.get("resource") if isinstance(item.get("resource"), dict) else {}
    primary = resource.get("primary") if isinstance(resource.get("primary"), dict) else {}
    url = clean(primary.get("URL")) or clean(item.get("URL")) or (f"https://doi.org/{doi}" if doi else "")

    return {
        "id": record_id,
        "source": "library",
        "kind": "conference",
        "title": title,
        "authors": authors,
        "summary": strip_markup(clean(item.get("abstract"))),
        "venue": source["id"],
        "venueName": source.get("name") or source["id"],
        "area": source.get("area", ""),
        "year": year,
        "month": "",
        "track": UNCATEGORIZED,
        "published": published,
        "pages": clean(item.get("page")),
        "doi": doi,
        "dblpKey": "",
        "dblpUrl": "",
        "url": url,
    }


def fetch_crossref_conference_year(source: dict[str, Any], year: int) -> list[dict[str, Any]]:
    overrides = load_track_overrides(source["id"], year)
    by_id: dict[str, dict[str, Any]] = {}

    for query in crossref_conference_queries(source):
        payload = fetch_json(crossref_conference_url(source, year, query))
        for item in crossref_items(payload):
            if not crossref_conference_matches(item, source, year):
                continue
            record = parse_crossref_conference_record(item, source, year)
            if not record:
                continue
            record["track"] = lookup_track(overrides, record)
            by_id[record["id"]] = record
        time.sleep(CROSSREF_DELAY_SECONDS)

    return list(by_id.values())


def fetch_conference_year(source: dict[str, Any], year: int, providers: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []

    if providers in {"both", "dblp"}:
        try:
            records.extend(fetch_dblp_conference_year(source, year))
        except Exception as exc:
            print(f"DBLP unavailable for {source.get('id')} {year}: {exc}", file=sys.stderr)

    if providers in {"both", "crossref"}:
        try:
            records.extend(fetch_crossref_conference_year(source, year))
        except Exception as exc:
            print(f"Crossref unavailable for {source.get('id')} {year}: {exc}", file=sys.stderr)

    return merge_by_identity(records)


def month_range(year: int, month: int) -> tuple[str, str]:
    last_day = calendar.monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last_day:02d}"


def crossref_month_url(issn: str, year: int, month: int) -> str:
    start, end = month_range(year, month)
    filters = f"type:journal-article,from-pub-date:{start},until-pub-date:{end}"
    params = urllib.parse.urlencode(
        {
            "filter": filters,
            "rows": "1000",
            "sort": "published",
            "order": "asc",
        }
    )
    return f"https://api.crossref.org/journals/{urllib.parse.quote(issn)}/works?{params}"


def crossref_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    items = payload.get("message", {}).get("items", [])
    return items if isinstance(items, list) else []


def parse_crossref_record(item: dict[str, Any], source: dict[str, Any], year: int, month: int) -> dict[str, Any] | None:
    title = strip_markup(first_text(item.get("title"))).rstrip(".")
    if not title:
        return None

    doi = normalize_doi(item.get("DOI", ""))
    record_id = f"doi:{doi}" if doi else stable_id("crossref", source["id"], str(year), str(month), title)
    published = (
        date_parts_to_iso(item.get("published-print"))
        or date_parts_to_iso(item.get("published-online"))
        or date_parts_to_iso(item.get("issued"))
        or f"{year:04d}-{month:02d}-01"
    )
    month_key = f"{year:04d}-{month:02d}"
    venue_id = source["id"]

    return {
        "id": record_id,
        "source": "library",
        "kind": "journal",
        "title": title,
        "authors": crossref_author_names(item.get("author")),
        "summary": "",
        "venue": venue_id,
        "venueName": source.get("shortName") or source.get("name") or venue_id,
        "journalName": source.get("name") or venue_id,
        "area": source.get("area", ""),
        "year": year,
        "month": month_key,
        "track": "",
        "published": published,
        "volume": clean(item.get("volume")),
        "issue": clean(item.get("issue")),
        "pages": clean(item.get("page")),
        "doi": doi,
        "dblpKey": "",
        "dblpUrl": "",
        "url": clean(item.get("URL")) or (f"https://doi.org/{doi}" if doi else ""),
    }


def fetch_journal_month(source: dict[str, Any], year: int, month: int) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for issn in source.get("issns", []):
        payload = fetch_json(crossref_month_url(issn, year, month))
        for item in crossref_items(payload):
            record = parse_crossref_record(item, source, year, month)
            if record:
                by_id[record["id"]] = record
        time.sleep(CROSSREF_DELAY_SECONDS)
    return list(by_id.values())


def current_year() -> int:
    return datetime.now(timezone.utc).year


def months_for_range(start_year: int, end_year: int) -> list[tuple[int, int]]:
    now = datetime.now(timezone.utc)
    months: list[tuple[int, int]] = []
    for year in range(start_year, end_year + 1):
        max_month = now.month if year == now.year else 12
        for month in range(1, max_month + 1):
            months.append((year, month))
    return months


def recent_months(count: int) -> list[tuple[int, int]]:
    now = datetime.now(timezone.utc)
    year = now.year
    month = now.month
    months = []
    for _ in range(max(count, 1)):
        months.append((year, month))
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    return list(reversed(months))


def sort_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        records,
        key=lambda record: (
            record.get("published") or f"{record.get('year', 0)}-01-01",
            record.get("venue", ""),
            record.get("title", ""),
        ),
        reverse=True,
    )


def build_stats(records: list[dict[str, Any]]) -> dict[str, Any]:
    by_venue: dict[str, int] = {}
    by_year: dict[str, int] = {}
    by_track: dict[str, int] = {}

    for record in records:
        venue = clean(record.get("venue"))
        year = clean(record.get("year"))
        track = clean(record.get("track")) or clean(record.get("month"))
        if venue:
            by_venue[venue] = by_venue.get(venue, 0) + 1
        if year:
            by_year[year] = by_year.get(year, 0) + 1
        if track:
            by_track[track] = by_track.get(track, 0) + 1

    return {
        "byVenue": dict(sorted(by_venue.items())),
        "byYear": dict(sorted(by_year.items(), reverse=True)),
        "byTrack": dict(sorted(by_track.items())),
    }


def write_chunks(records: list[dict[str, Any]]) -> None:
    grouped_conferences: dict[tuple[str, int], list[dict[str, Any]]] = {}
    grouped_journals: dict[tuple[str, str], list[dict[str, Any]]] = {}

    for record in records:
        if record.get("kind") == "conference":
            grouped_conferences.setdefault((record["venue"], int(record["year"])), []).append(record)
        elif record.get("kind") == "journal":
            grouped_journals.setdefault((record["venue"], record["month"]), []).append(record)

    for (venue, year), items in grouped_conferences.items():
        write_json(
            LIBRARY_DIR / "conferences" / venue / f"{year}.json",
            {"meta": {"venue": venue, "year": year, "count": len(items)}, "records": sort_records(items)},
        )

    for (journal, month), items in grouped_journals.items():
        write_json(
            LIBRARY_DIR / "journals" / journal / f"{month}.json",
            {"meta": {"journal": journal, "month": month, "count": len(items)}, "records": sort_records(items)},
        )


def build_index(records: list[dict[str, Any]], sources: dict[str, Any]) -> dict[str, Any]:
    records = sort_records(records)
    conference_count = sum(1 for record in records if record.get("kind") == "conference")
    journal_count = sum(1 for record in records if record.get("kind") == "journal")
    return {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "startYear": sources.get("startYear", 2014),
            "count": len(records),
            "conferenceCount": conference_count,
            "journalCount": journal_count,
            "stats": build_stats(records),
        },
        "sources": {
            "conferences": sources.get("conferences", []),
            "journals": sources.get("journals", []),
        },
        "records": records,
    }


def identity_key(record: dict[str, Any]) -> str:
    doi = normalize_doi(record.get("doi", ""))
    return f"doi:{doi}" if doi else clean(record.get("id"))


def merge_by_identity(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for record in records:
        key = identity_key(record)
        if key:
            merged[key] = {**merged.get(key, {}), **record}
    return list(merged.values())


def merge_records(existing: list[dict[str, Any]], updates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged = {identity_key(record): record for record in existing if identity_key(record)}
    for record in updates:
        key = identity_key(record)
        if key:
            merged[key] = record
    return list(merged.values())


def fetch_conferences(sources: dict[str, Any], years: list[int], providers: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for source in sources.get("conferences", []):
        for year in years:
            try:
                items = fetch_conference_year(source, year, providers)
                records.extend(items)
                print(f"{source['id']} {year}: {len(items)} conference papers")
                time.sleep(DBLP_DELAY_SECONDS)
            except Exception as exc:
                print(f"Skipping {source.get('id')} {year}: {exc}", file=sys.stderr)
    return records


def fetch_journals(sources: dict[str, Any], months: list[tuple[int, int]]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for source in sources.get("journals", []):
        for year, month in months:
            try:
                items = fetch_journal_month(source, year, month)
                records.extend(items)
                print(f"{source['id']} {year}-{month:02d}: {len(items)} journal papers")
            except Exception as exc:
                print(f"Skipping {source.get('id')} {year}-{month:02d}: {exc}", file=sys.stderr)
    return records


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch conference and journal metadata for Paper Review.")
    parser.add_argument("--mode", choices=["all", "recent", "conferences", "journals"], default="recent")
    parser.add_argument("--start-year", type=int, default=None)
    parser.add_argument("--end-year", type=int, default=current_year())
    parser.add_argument("--recent-years", type=int, default=2)
    parser.add_argument("--recent-months", type=int, default=4)
    parser.add_argument("--venues", default="", help="Comma-separated conference ids to fetch.")
    parser.add_argument("--journals", default="", help="Comma-separated journal ids to fetch.")
    parser.add_argument(
        "--conference-providers",
        choices=["both", "crossref", "dblp"],
        default="both",
        help="Metadata providers for conference proceedings.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    all_sources = read_json(SOURCES_PATH, {})
    if not all_sources:
        print(f"Missing source configuration: {SOURCES_PATH}", file=sys.stderr)
        return 1
    sources = copy.deepcopy(all_sources)

    if args.venues:
        wanted = {item.strip().upper() for item in args.venues.split(",") if item.strip()}
        sources["conferences"] = [
            source for source in sources.get("conferences", []) if source.get("id", "").upper() in wanted
        ]

    if args.journals:
        wanted = {item.strip().upper() for item in args.journals.split(",") if item.strip()}
        sources["journals"] = [
            source for source in sources.get("journals", []) if source.get("id", "").upper() in wanted
        ]

    start_year = args.start_year or int(sources.get("startYear", 2014))
    end_year = max(args.end_year, start_year)

    if args.mode in {"all", "conferences"}:
        conference_years = list(range(start_year, end_year + 1))
    else:
        recent_start = max(start_year, end_year - max(args.recent_years, 1) + 1)
        conference_years = list(range(recent_start, end_year + 1))

    if args.mode in {"all", "journals"}:
        journal_months = months_for_range(start_year, end_year)
    else:
        journal_months = recent_months(args.recent_months)

    updates: list[dict[str, Any]] = []
    if args.mode in {"all", "recent", "conferences"}:
        updates.extend(fetch_conferences(sources, conference_years, args.conference_providers))
    if args.mode in {"all", "recent", "journals"}:
        updates.extend(fetch_journals(sources, journal_months))

    existing_payload = read_json(INDEX_PATH, {"records": []})
    existing_records = existing_payload.get("records", [])
    records = updates if args.mode == "all" else merge_records(existing_records, updates)

    if not records and existing_records:
        print("No library records fetched; keeping the previous index.")
        return 0

    payload = build_index(records, all_sources)
    write_json(INDEX_PATH, payload)
    write_chunks(records)
    print(f"Wrote {payload['meta']['count']} library records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

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
UNCATEGORIZED = "未标注 Track"
DBLP_DELAY_SECONDS = 2.2
CROSSREF_DELAY_SECONDS = 0.25
OFFICIAL_PROGRAM_DELAY_SECONDS = 0.5
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
ADMIN_SESSION_PATTERNS = (
    "arrival coffee",
    "award",
    "banquet",
    "break",
    "business meeting",
    "coffee",
    "dinner",
    "keynote",
    "lunch",
    "opening",
    "panel",
    "poster",
    "reception",
    "registration",
    "social",
    "tutorial",
    "welcome",
    "workshop",
)
OFFICIAL_PROGRAM_URL_TEMPLATES = {
    "ISCA": [
        "https://iscaconf.org/isca{year}/program/",
        "https://www.iscaconf.org/isca{year}/program/",
    ],
    "HPCA": [
        "https://www.hpca-conf.org/{year}/program/main.php",
        "https://{year}.hpca-conf.org/program/program-hpca-{year}/",
        "https://conf.researchr.org/track/hpca-{year}/hpca-{year}-main-conference",
    ],
    "MICRO": [
        "https://microarch.org/micro{micro_edition}/program/",
        "https://www.microarch.org/micro{micro_edition}/program/",
    ],
    "ASPLOS": [
        "https://www.asplos-conference.org/asplos{year}/main-program/index.html",
        "https://www.asplos-conference.org/asplos{year}/program/",
    ],
    "DAC": [
        "https://www.dac.com/Conference/Technical-Program?year={year}",
    ],
    "ICCAD": [
        "https://iccad.com/{year}/program/",
        "https://iccad.com/technical-program/",
    ],
    "DATE": [
        "https://www.date-conference.com/programme",
        "https://www.date-conference.com/date{year}/programme",
    ],
    "ASP-DAC": [
        "https://www.aspdac.com/aspdac{year}/program/",
        "https://www.aspdac.com/aspdac{year}/technical_program/",
    ],
    "FPGA": [
        "https://www.isfpga.org/fpga{year}/program/",
    ],
    "FPL": [
        "https://fpl{year}.org/program/",
        "https://www.fpl{year}.org/program/",
    ],
    "FPT": [
        "https://fpt{year}.org/program/",
        "https://www.fpt{year}.org/program/",
    ],
    "ICCD": [
        "https://www.iccd-conf.com/Program.html",
        "https://www.iccd-conf.com/Program/{year}",
    ],
    "PACT": [
        "https://conf.researchr.org/track/pact-{year}/pact-{year}-papers",
        "https://pact{year}.github.io/program/",
    ],
    "SC": [
        "https://sc{yy}.supercomputing.org/program/papers/",
        "https://sc{yy}.supercomputing.org/program/technical-program/",
    ],
    "PPOPP": [
        "https://conf.researchr.org/track/PPoPP-{year}/PPoPP-{year}-Research-Papers",
        "https://conf.researchr.org/track/ppopp-{year}/ppopp-{year}-main-conference",
    ],
    "FAST": [
        "https://www.usenix.org/conference/fast{yy}/technical-sessions",
    ],
    "MLSys": [
        "https://mlsys.org/virtual/{year}/calendar",
        "https://mlsys.org/Conferences/{year}/Schedule",
    ],
    "OSDI": [
        "https://www.usenix.org/conference/osdi{yy}/technical-sessions",
    ],
    "SOSP": [
        "https://sigops.org/s/conferences/sosp/{year}/program.html",
        "https://sosp{year}.munich/program.html",
    ],
    "EuroSys": [
        "https://{year}.eurosys.org/program/",
        "https://{year}.eurosys.org/program.html",
    ],
    "ATC": [
        "https://www.usenix.org/conference/atc{yy}/technical-sessions",
    ],
    "HPDC": [
        "https://www.hpdc.org/{year}/program/",
    ],
    "PLDI": [
        "https://pldi{yy}.sigplan.org/track/pldi-{year}-papers",
        "https://conf.researchr.org/track/pldi-{year}/pldi-{year}-papers",
    ],
    "POPL": [
        "https://popl{yy}.sigplan.org/track/POPL-{year}-POPL-Research-Papers",
        "https://conf.researchr.org/track/POPL-{year}/POPL-{year}-POPL-Research-Papers",
    ],
    "OOPSLA": [
        "https://{year}.splashcon.org/track/splash-{year}-oopsla",
        "https://conf.researchr.org/track/splash-{year}/splash-{year}-oopsla",
    ],
    "CGO": [
        "https://{year}.cgo.org/program/program-cgo-{year}/",
        "https://conf.researchr.org/track/cgo-{year}/cgo-{year}-main-conference",
    ],
    "NSDI": [
        "https://www.usenix.org/conference/nsdi{yy}/technical-sessions",
    ],
    "SIGCOMM": [
        "https://conferences.sigcomm.org/sigcomm/{year}/program.html",
        "https://conferences.sigcomm.org/sigcomm/{year}/program.php",
    ],
    "INFOCOM": [
        "https://infocom{year}.ieee-infocom.org/program",
    ],
    "ISSCC": [
        "https://www.isscc.org/{year}/program",
    ],
}

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


def fetch_text(url: str, timeout: int = 45, attempts: int = 2) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html, text/plain;q=0.9, */*;q=0.8",
        },
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read().decode("utf-8", errors="replace")
        except (urllib.error.HTTPError, urllib.error.URLError) as exc:
            last_error = exc
            if attempt == attempts - 1:
                break
            time.sleep(2 * (attempt + 1))
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


def html_to_lines(markup: str) -> list[str]:
    text = re.sub(r"(?is)<(script|style|noscript).*?</\1>", " ", markup or "")
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(h[1-6]|p|div|li|tr|td|th|section|article|table)>", "\n", text)
    text = re.sub(r"(?i)<(h[1-6]|p|div|li|tr|td|th|section|article|table)[^>]*>", "\n", text)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    return [clean(line) for line in text.splitlines() if clean(line)]


def de_latex(value: str) -> str:
    value = re.sub(r"\\(?:textbf|emph|underline|textit|mathrm)\{([^{}]*)\}", r"\1", value or "")
    value = re.sub(r"\\[a-zA-Z]+\{?([^{}]*)\}?", r"\1", value)
    return value.replace("{", " ").replace("}", " ")


def canonical_title(value: str) -> str:
    value = de_latex(strip_markup(value))
    value = re.sub(r"\[(?:best paper|distinguished|artifact|award|nominee)[^\]]*\]", " ", value, flags=re.I)
    value = re.sub(r"\b(?:pre-print|doi|paper|abstract|slides?|video|media attached)\b", " ", value, flags=re.I)
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def normalized_words(value: str) -> list[str]:
    return [word for word in re.split(r"[^a-z0-9]+", value.lower()) if len(word) > 1]


def title_words(value: str) -> set[str]:
    return {
        word
        for word in normalized_words(de_latex(strip_markup(value)))
        if word
        not in {
            "a",
            "an",
            "and",
            "for",
            "in",
            "of",
            "on",
            "the",
            "to",
            "using",
            "via",
            "with",
        }
    }


def is_admin_session(title: str) -> bool:
    lowered = title.lower()
    return any(pattern in lowered for pattern in ADMIN_SESSION_PATTERNS)


def clean_session_title(value: str) -> str:
    value = clean(value).strip(" |:-")
    value = re.split(
        r"(?:Main Conference|Research Papers|PLDI Research Papers|HPCA Main Conference|Keynotes|Papers)\b",
        value,
        maxsplit=1,
    )[0]
    value = re.split(r"\s+Chair\(s\):", value, maxsplit=1, flags=re.I)[0]
    value = re.split(r"\s+at\s+[A-Z][A-Za-z0-9 /&().-]*$", value, maxsplit=1)[0]
    value = re.sub(r"^Session\s+([0-9A-Za-z.-]+)\s*:\s*", r"Session \1: ", value)
    return clean(value).strip(" |:-")


def extract_session_title(line: str) -> str:
    line = clean(line)
    if not line:
        return ""

    heading_match = re.match(r"^(Session\s+[0-9A-Za-z.-]+\s*:\s*.+)$", line, flags=re.I)
    if heading_match:
        title = clean_session_title(heading_match.group(1))
        return "" if is_admin_session(title) else title

    compact_heading = re.match(r"^([0-9]+[A-Z]\s*:\s*.+)$", line)
    if compact_heading:
        title = clean_session_title(compact_heading.group(1))
        return "" if is_admin_session(title) else title

    time_range = re.match(
        r"^(?:\|?\s*)?(?:[A-Z][a-z]{2}\s+\d+\s+[A-Z][a-z]{2}\s+)?"
        r"\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\s*[-–]\s*"
        r"\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\s*(?:\||:)?\s*(.+)$",
        line,
    )
    if not time_range:
        return ""

    title = clean_session_title(time_range.group(1))
    if not title or len(title) < 4 or is_admin_session(title):
        return ""
    if re.search(r"\b(?:Talk|Paper|Keynote|Meeting|Coffee break)\b", title):
        return ""
    return title


def record_match_candidates(records: list[dict[str, Any]]) -> list[tuple[dict[str, Any], str, set[str]]]:
    candidates = []
    for record in records:
        title = clean(record.get("title"))
        key = canonical_title(title)
        if len(key) < 8:
            continue
        words = title_words(title)
        candidates.append((record, key, words))
    return candidates


def match_record_from_line(
    line: str, candidates: list[tuple[dict[str, Any], str, set[str]]]
) -> dict[str, Any] | None:
    line_key = canonical_title(line)
    if len(line_key) < 12:
        return None

    for record, key, _words in candidates:
        if len(key) >= 12 and key in line_key:
            return record

    line_word_set = title_words(line)
    best_record: dict[str, Any] | None = None
    best_score = 0.0
    for record, _key, words in candidates:
        if len(words) < 4:
            continue
        overlap = len(words & line_word_set)
        score = overlap / max(len(words), 1)
        if overlap >= 4 and score > best_score:
            best_score = score
            best_record = record

    return best_record if best_score >= 0.72 else None


def mapping_entries_for_record(record: dict[str, Any], track: str) -> dict[str, str]:
    entries: dict[str, str] = {}
    for key in (
        normalize_doi(record.get("doi", "")),
        clean(record.get("dblpKey", "")),
        clean(record.get("id", "")),
        clean(record.get("title", "")),
    ):
        if key:
            entries[key] = track
    return entries


def format_program_template(template: str, source: dict[str, Any], year: int) -> str:
    context = {
        "id": clean(source.get("id")),
        "id_lower": clean(source.get("id")).lower(),
        "name": clean(source.get("name")),
        "name_lower": clean(source.get("name")).lower(),
        "year": year,
        "yy": f"{year % 100:02d}",
        "micro_edition": year - 1967,
    }
    return template.format(**context)


def official_program_urls(source: dict[str, Any], year: int) -> list[str]:
    templates = []
    templates.extend(list_value(source.get("officialProgramUrls")))
    templates.extend(list_value(source.get("officialProgramUrlTemplates")))
    templates.extend(OFFICIAL_PROGRAM_URL_TEMPLATES.get(clean(source.get("id")), []))

    urls: list[str] = []
    for template in templates:
        try:
            url = format_program_template(clean(template), source, year)
        except KeyError:
            continue
        if url and url not in urls:
            urls.append(url)
    return urls


def extract_program_track_overrides(markup: str, records: list[dict[str, Any]]) -> dict[str, str]:
    candidates = record_match_candidates(records)
    if not candidates:
        return {}

    mappings: dict[str, str] = {}
    current_session = ""

    for line in html_to_lines(markup):
        session = extract_session_title(line)
        if session:
            current_session = session
            continue

        if not current_session or is_admin_session(current_session) or is_non_paper_title(line):
            continue

        record = match_record_from_line(line, candidates)
        if record:
            mappings.update(mapping_entries_for_record(record, current_session))

    return mappings


def fetch_official_track_overrides(source: dict[str, Any], year: int, records: list[dict[str, Any]]) -> dict[str, str]:
    mappings: dict[str, str] = {}
    for url in official_program_urls(source, year):
        try:
            markup = fetch_text(url, timeout=20, attempts=1)
            found = extract_program_track_overrides(markup, records)
            if found:
                print(f"{source['id']} {year}: {len(found)} official track keys from {url}")
                mappings.update(found)
                return mappings
        except Exception as exc:
            print(f"Official program unavailable for {source.get('id')} {year} at {url}: {exc}", file=sys.stderr)
        time.sleep(OFFICIAL_PROGRAM_DELAY_SECONDS)
    return mappings


def write_track_overrides(venue_id: str, year: int, mappings: dict[str, str]) -> None:
    normalized = {clean(key): clean(value) for key, value in mappings.items() if clean(key) and clean(value)}
    if normalized:
        write_json(TRACKS_DIR / venue_id / f"{year}.json", dict(sorted(normalized.items())))


def apply_track_overrides(records: list[dict[str, Any]], source: dict[str, Any], overrides: dict[str, str]) -> None:
    for record in records:
        record["track"] = assign_track(record, source, overrides)


def ensure_official_tracks(
    source: dict[str, Any], year: int, records: list[dict[str, Any]], mode: str = "auto"
) -> None:
    if mode == "off" or not records:
        return

    path = TRACKS_DIR / source["id"] / f"{year}.json"
    existing = load_track_overrides(source["id"], year)
    if existing and mode != "refresh":
        apply_track_overrides(records, source, existing)
        return

    fetched = fetch_official_track_overrides(source, year, records)
    if fetched:
        write_track_overrides(source["id"], year, fetched)
        apply_track_overrides(records, source, load_track_overrides(source["id"], year))
        return

    if existing:
        apply_track_overrides(records, source, existing)
    elif path.exists():
        apply_track_overrides(records, source, load_track_overrides(source["id"], year))


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
    return next((overrides[key] for key in keys if key and key in overrides), "")


def assign_track(record: dict[str, Any], source: dict[str, Any], overrides: dict[str, str] | None = None) -> str:
    override = lookup_track(overrides or {}, record)
    return override or UNCATEGORIZED


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
        record["track"] = assign_track(record, source, overrides)
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
            record["track"] = assign_track(record, source, overrides)
            by_id[record["id"]] = record
        time.sleep(CROSSREF_DELAY_SECONDS)

    return list(by_id.values())


def fetch_conference_year(
    source: dict[str, Any], year: int, providers: str, official_tracks: str = "auto"
) -> list[dict[str, Any]]:
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

    merged = merge_by_identity(records)
    ensure_official_tracks(source, year, merged, official_tracks)
    return merged


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


def crossref_year_url(issn: str, year: int) -> str:
    filters = f"type:journal-article,from-pub-date:{year:04d}-01-01,until-pub-date:{year:04d}-12-31"
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


def published_year_month(published: str, fallback_year: int, fallback_month: int | None = None) -> tuple[int, int]:
    match = re.match(r"^(\d{4})-(\d{2})", published or "")
    if match:
        return int(match.group(1)), int(match.group(2))
    return fallback_year, fallback_month or 1


def parse_crossref_record(
    item: dict[str, Any], source: dict[str, Any], year: int, month: int | None = None
) -> dict[str, Any] | None:
    title = strip_markup(first_text(item.get("title"))).rstrip(".")
    if not title:
        return None

    doi = normalize_doi(item.get("DOI", ""))
    published = (
        date_parts_to_iso(item.get("published-print"))
        or date_parts_to_iso(item.get("published-online"))
        or date_parts_to_iso(item.get("published"))
        or date_parts_to_iso(item.get("issued"))
        or f"{year:04d}-{(month or 1):02d}-01"
    )
    record_year, record_month = published_year_month(published, year, month)
    record_id = f"doi:{doi}" if doi else stable_id("crossref", source["id"], str(record_year), str(record_month), title)
    month_key = f"{record_year:04d}-{record_month:02d}"
    venue_id = source["id"]

    record = {
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
        "year": record_year,
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
    record["track"] = assign_track(record, source)
    return record


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


def fetch_journal_year(source: dict[str, Any], year: int, allowed_months: set[int] | None = None) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for issn in source.get("issns", []):
        payload = fetch_json(crossref_year_url(issn, year))
        for item in crossref_items(payload):
            record = parse_crossref_record(item, source, year)
            if not record:
                continue
            try:
                record_month = int(str(record.get("month", ""))[-2:])
            except ValueError:
                continue
            if allowed_months and record_month not in allowed_months:
                continue
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


def fetch_conferences(
    sources: dict[str, Any], years: list[int], providers: str, official_tracks: str
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for source in sources.get("conferences", []):
        for year in years:
            try:
                items = fetch_conference_year(source, year, providers, official_tracks)
                records.extend(items)
                print(f"{source['id']} {year}: {len(items)} conference papers")
                time.sleep(DBLP_DELAY_SECONDS)
            except Exception as exc:
                print(f"Skipping {source.get('id')} {year}: {exc}", file=sys.stderr)
    return records


def refresh_official_tracks_for_existing(
    records: list[dict[str, Any]], sources: dict[str, Any], years: list[int], mode: str
) -> list[dict[str, Any]]:
    conferences = {source["id"]: source for source in sources.get("conferences", [])}
    wanted_years = {str(year) for year in years}
    grouped: dict[tuple[str, int], list[dict[str, Any]]] = {}

    for record in records:
        if record.get("kind") != "conference":
            continue
        venue = clean(record.get("venue"))
        year = clean(record.get("year"))
        if venue in conferences and year in wanted_years:
            grouped.setdefault((venue, int(year)), []).append(record)

    for (venue, year), items in sorted(grouped.items()):
        source = conferences[venue]
        ensure_official_tracks(source, year, items, mode)
        matched = sum(1 for record in items if clean(record.get("track")) and record.get("track") != UNCATEGORIZED)
        print(f"{venue} {year}: official tracks applied to {matched}/{len(items)} existing papers")

    return records


def fetch_journals(sources: dict[str, Any], months: list[tuple[int, int]]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    months_by_year: dict[int, set[int]] = {}
    for year, month in months:
        months_by_year.setdefault(year, set()).add(month)

    for source in sources.get("journals", []):
        for year, allowed_months in sorted(months_by_year.items()):
            try:
                items = fetch_journal_year(source, year, allowed_months)
                records.extend(items)
                print(f"{source['id']} {year}: {len(items)} journal papers")
            except Exception as exc:
                print(f"Skipping {source.get('id')} {year}: {exc}", file=sys.stderr)
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
        "--official-tracks",
        choices=["auto", "off", "refresh"],
        default="auto",
        help="Use official program/proceedings pages to map papers to session tracks.",
    )
    parser.add_argument(
        "--refresh-official-tracks-only",
        action="store_true",
        help="Do not fetch paper metadata; only refresh official session-track mappings for existing conference records.",
    )
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

    existing_payload = read_json(INDEX_PATH, {"records": []})
    existing_records = existing_payload.get("records", [])

    if args.refresh_official_tracks_only:
        records = refresh_official_tracks_for_existing(
            existing_records,
            sources,
            list(range(start_year, end_year + 1)),
            args.official_tracks if args.official_tracks != "off" else "off",
        )
        if not records:
            print("No existing library records found; nothing to refresh.")
            return 0
        payload = build_index(records, all_sources)
        write_json(INDEX_PATH, payload)
        write_chunks(records)
        print(f"Wrote {payload['meta']['count']} library records")
        return 0

    updates: list[dict[str, Any]] = []
    if args.mode in {"all", "recent", "conferences"}:
        updates.extend(fetch_conferences(sources, conference_years, args.conference_providers, args.official_tracks))
    if args.mode in {"all", "recent", "journals"}:
        updates.extend(fetch_journals(sources, journal_months))

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

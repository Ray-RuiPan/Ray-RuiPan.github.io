# Paper Review

Static GitHub Pages dashboard for daily arXiv papers in:

- `cs.AR`
- `cs.DC`
- `cs.NI`
- `cs.PL`
- `cs.OS`

Production URL:

```text
https://ray-ruipan.github.io/paper-review/
```

Saved papers page:

```text
https://ray-ruipan.github.io/paper-review/saved/
```

Conference and journal library:

```text
https://ray-ruipan.github.io/paper-review/library/
```

## How It Works

- `scripts/fetch_arxiv.py` downloads the combined arXiv Atom feed.
- `data/papers.json` stores the latest snapshot.
- `data/archive/YYYY-MM-DD.json` stores daily snapshots.
- `data/archive-index.json` powers the date selector.
- `scripts/fetch_library.py` downloads conference and journal metadata from DBLP and Crossref.
- `data/library/index.json` powers the proceedings and journal library page.
- `library/` organizes records by venue, year, and track, with collection support.
- `data/library/tracks/VENUE/YEAR.json` can override automatically inferred track names.
- `saved/` shows papers and collections saved in the current browser via localStorage.
- `../.github/workflows/update-paper-review.yml` checks for updates daily at 10:00 Beijing time.
- `../.github/workflows/update-paper-library.yml` refreshes the library monthly and supports manual backfill from 2014.
- If the feed contains the same arXiv announcement as the current site data, the script leaves the site unchanged.

## Local Preview

```powershell
python scripts/fetch_arxiv.py
python scripts/fetch_library.py --mode recent --conference-providers crossref
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

## Deploy

This directory is served by the existing `Ray-RuiPan.github.io` site at:

```text
https://ray-ruipan.github.io/paper-review/
```

The workflow supports manual runs from the Actions tab.

## Attribution

Thank you to arXiv for use of its open access interoperability.

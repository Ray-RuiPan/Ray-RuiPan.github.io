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

## How It Works

- `scripts/fetch_arxiv.py` downloads the combined arXiv Atom feed.
- `data/papers.json` stores the latest snapshot.
- `data/archive/YYYY-MM-DD.json` stores daily snapshots.
- `data/archive-index.json` powers the date selector.
- `../.github/workflows/update-paper-review.yml` checks for updates daily at 10:00 Beijing time.
- If the feed contains the same arXiv announcement as the current site data, the script leaves the site unchanged.

## Local Preview

```powershell
python scripts/fetch_arxiv.py
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

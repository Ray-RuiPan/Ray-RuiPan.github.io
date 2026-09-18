# Track Overrides

Place optional per-conference track mappings here:

```text
paper-review/data/library/tracks/ISCA/2024.json
```

The JSON file can map a DOI, dblp key, generated record id, or exact title to a track:

```json
{
  "10.1145/example": "Memory Systems",
  "conf/isca/Example24": "Memory Systems",
  "Paper Title": "Security"
}
```

Papers without an override are assigned to a broad research track by keyword rules
in `scripts/fetch_library.py`. If no rule matches, the script falls back to the
venue or journal area, then to `Uncategorized`.

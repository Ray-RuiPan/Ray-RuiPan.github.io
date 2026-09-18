# Official Track Mappings

Place curated per-venue track mappings here after checking the official
proceedings, program, or journal issue page:

```text
paper-review/data/library/tracks/ISCA/2024.json
```

The JSON file can map a DOI, DBLP key, generated record id, or exact title to
the official track/session name:

```json
{
  "10.1145/example": "Memory Systems",
  "conf/isca/Example24": "Memory Systems",
  "Paper Title": "Security"
}
```

Papers without an official mapping are not classified by keywords. They remain
under `未标注 Track` until a mapping from the official proceedings, program, or
journal issue is added.

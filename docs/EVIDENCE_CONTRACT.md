# Evidence contract — Cue

Family envelope v1. Locators: `timestamp_ms`, stream indices, subtitle cue ranges, source hash.
Gaps: missing ffprobe, absent subtitles, optional ASR unavailable.
No `evidence_first` tool.

## Implemented family wire fields (v1)

Every tool result includes:

- `envelope_version: "1"`
- `status`, `tool`, `product`, `product_version`
- `route` as `{ engine, path? }`
- `warnings` and `gaps` arrays (may be empty)
- domain payload (often also as top-level twin/results/answer for compatibility)

Schema: `SylphxAI/skills` `schemas/instrument-evidence-envelope.schema.json`.

`video_evidence` render, crop, and OCR frame results carry the immutable source
SHA-256 at `frame.provenance.source_hash`, matching `read_video`'s timeline
provenance hash for the same source.

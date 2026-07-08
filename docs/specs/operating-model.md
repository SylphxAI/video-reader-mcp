# Operating Model — video-reader-mcp

**Status:** Bootstrap target  
**Owner:** video-reader-mcp

## Goal

Evidence-first video reading for AI agents — ffprobe, subtitles, scenes, transcripts, and timelines without frame-by-frame LLM vision.

## Non-Goals

- Hosted platform services inside this package.
- Frame-by-frame or whole-image generative LLM understanding as default.

## Acceptance (v0.1.0)

- `read_video` ships with schema, handler, tests, and docs.
- Default path works without remote providers or ML model downloads.
- Release gate JSON artifact passes in CI.

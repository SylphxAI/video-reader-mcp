# ADR-0001: Video Reader MCP Boundary

**Status:** Accepted  
**Date:** 2026-07-08  
**Project:** video-reader-mcp

## Context

This repository is part of the Sylphx Reader portfolio. Cross-cutting architecture
is defined in [pdf-reader-mcp ADR-0004](https://github.com/SylphxAI/pdf-reader-mcp/blob/main/docs/adr/0004-reader-portfolio-architecture.md).

## Decision

`@sylphx/video-reader-mcp` owns the local/open-source MCP contract for: **Evidence-first video reading for AI agents — ffprobe, subtitles, scenes, transcripts, and timelines without frame-by-frame LLM vision.**

Reading uses deterministic extraction (metadata, OCR/ASR adapters, classical signal
processing). Generative LLMs are optional remote providers only, never the default.

## Consequences

- Implement `read_video` with provenance and release gates before v0.1.0.
- Depend on `@sylphx/reader-evidence` for shared schema when types stabilize.

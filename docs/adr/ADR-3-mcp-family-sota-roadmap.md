# ADR-3: Adopt Video Reader MCP Family SOTA Roadmap

Date: 2026-07-09
Status: Proposed in PR #3
Slug: mcp-family-sota-roadmap

## Context

Video Reader MCP is the temporal evidence specialist in the SylphxAI Reader
family. It needs a repo-local roadmap that keeps video reading focused on
timestamped evidence, reproducible frames, subtitles, transcripts, and media
warnings rather than unsupported summaries.

## Decision

Adopt `docs/roadmap/sota-family-roadmap.md` as the local roadmap for Video
Reader MCP's family role.

Video Reader MCP owns video probing, timeline evidence, subtitle and transcript
routes, scene detection, frame evidence, media warnings, and temporal locators.

## Consequences

- Smart Reader routes videos but does not own video timeline semantics.
- Rust is the target for timeline assembly, hashing, cache keys, bounded
  sampling policy, and media orchestration.
- Native media dependencies remain explicit and diagnosable.
- Every temporal claim must be reproducible through timestamp or frame evidence.

## Verification

- Roadmap added at `docs/roadmap/sota-family-roadmap.md`.
- README and PROJECT link to the roadmap.
- Docs-only validation: `git diff --check`.

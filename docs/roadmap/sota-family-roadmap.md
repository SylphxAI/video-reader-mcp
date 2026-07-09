# SOTA Family Roadmap

Status: adoption plan  
Owner: Video Reader MCP  
Scope: repo-local future plan and its role in the SylphxAI MCP family

## Family Role

Video Reader MCP is the temporal evidence engine for the Reader family. It
turns video files into timestamped evidence: container metadata, streams,
subtitles, scenes, transcripts, thumbnails, frame evidence, OCR, and warnings.

Its job is not to produce confident story summaries. Its job is to help agents
verify what happened when.

## Family Fit

| Project | Relationship |
| --- | --- |
| Smart Reader MCP | Routes detected video files to `read_video` and preserves temporal evidence in the normalized envelope. |
| Image Reader MCP | Shares frame crop, OCR, thumbnail, and visual-region evidence conventions. |
| PDF Reader MCP | Shares provenance, trust warning, provider route, and evidence follow-up conventions. |
| Architecture Reader MCP | Can link demo videos, release recordings, or screen captures to repo evidence when relevant. |
| Consultant MCP | Uses timeline evidence for research, incident review, and answer challenge. |

## SOTA End State

Video Reader MCP should become the default local temporal inspection tool for
agents: fast probing, bounded sampling, reproducible frame evidence, subtitle
and transcript search, and explicit warnings for unsupported or degraded media.

## Runtime Direction

Rust should own timeline assembly, hashing, cache keys, stream metadata, bounded
sampling policy, and orchestration. Native media tools remain controlled
adapters. The TypeScript adapter can stay thin while packaging and provider
contracts mature.

WASM is not the default runtime for media-heavy local work; it may be used for
sandboxed transforms where inputs and host capabilities are bounded.

## Roadmap

### Phase 0: Timeline Contract

- Freeze `read_video` output shape.
- Add examples for subtitle, no-subtitle, long, corrupted, multi-stream, and
  missing-media-tool cases.
- Add source hash, stream id, timestamp, frame index, scene id, route, and
  warning fields.
- Document ffprobe and ffmpeg diagnostic behavior.

### Phase 1: Rust Timeline Core

- Implement native timeline model, cache keys, stream metadata, and deterministic
  scene/subtitle fixtures.
- Add large-file streaming tests.
- Add benchmark gates for probe and timeline assembly.

### Phase 2: Evidence Operations

- Add frame render, thumbnail, crop, and OCR follow-up operations.
- Add transcript provider contract with local and remote policy controls.
- Add reproducible evidence calls for every timestamped claim.

### Phase 3: Agent Temporal Twin

- Add compact timeline summaries for agent token budgets.
- Add search over subtitle, transcript, OCR, and scene labels.
- Add cross-media delegation through Smart Reader.

### Phase 4: Native Distribution

- Package native engine and dependency diagnostics.
- Publish benchmark fixtures across common formats.
- Add `doctor` output for missing media tools, codec issues, permissions, and
  unsupported platform packages.

## Star And Adoption Strategy

The public promise is "make video citeable." The README should show a tiny
video fixture returning timestamped evidence, not a generic summary. Growth
comes from reproducible frame evidence, clear local defaults, and support for
the common files agents actually receive.

## Validation Gates

- Timestamp locators are stable across repeated runs.
- Unsupported codecs return structured warnings.
- Large files stream without full memory load.
- Extracted frames can be reproduced by follow-up calls.
- Native install succeeds across supported platforms without network
  postinstall binary downloads.

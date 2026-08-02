# Cue — positioning

## One-liner

**Cue**: Video timeline evidence for agents — local-first, fast, light, powerful.

## Why agents use this

Local timeline proof: ffprobe, subtitles, scenes, frames/crops with time locators — without frame-by-frame LLM vision.

## Surfaces

| Surface | Role |
| --- | --- |
| MCP | Agent tools over stdio |
| CLI | Human/scriptable brand bin |
| SDK | Programmatic library for apps and internal dogfood |

## Primary tools

- `read_video`
- `video_evidence`
- `render_frame`
- `crop_frame`

## Evidence

See [EVIDENCE_CONTRACT.md](./EVIDENCE_CONTRACT.md).

## Independence

See [PRODUCT_INDEPENDENCE.md](./PRODUCT_INDEPENDENCE.md).

## Competitive

See [COMPETITIVE.md](./COMPETITIVE.md).

## Completion bar

See [IPPB.md](./IPPB.md).


## 2026-08 — timeline + per-scene semantics

Cue stays the **local timeline evidence** tool (ffprobe/scenes/subtitles/structural
keyframes). Via the Cue→Iris compose path (`bun run compose:iris`), structural
keyframes become **timestamped open-vocab objects** from Iris L2
(`include_semantics`) — no per-frame VLM. Structure in Cue, semantics in Iris.

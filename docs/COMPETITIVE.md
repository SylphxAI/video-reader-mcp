# Cue — competitive positioning

## Job

Video timeline evidence for agents

## Wedge

Local timeline proof: ffprobe, subtitles, scenes, frames/crops with time locators — without frame-by-frame LLM vision.

## Local-first

Operates on local media with ffmpeg/ffprobe; no required paid video API.

## Peer anchors (learn; do not clone)

| Peer | Gap we exploit |
| --- | --- |
| mcp-video-analyzer / YouTube transcript MCPs | Remote platforms + transcripts; often not local-file timeline engines |
| anthropics/popcorn | Local long-form video understanding with frames/transcripts — heavier agent skill path |
| whisper.cpp transcriber MCPs | ASR-focused; not full probe/subtitle/scene/crop evidence kit |

## Non-goals

- Becoming a cloud SaaS wrapper as the default path
- Multi-product monorepo for star aggregation
- Generative summaries as the sole evidence authority

## 2026-07-31 research note

See docs/specs/agent-*-read-contract.md for competitive synthesis and product decisions.


## Zero-config CTA

```bash
npx -y @sylphx/cue
```

Live **@sylphx/cue@0.2.1**. Bare MCP stdio for agents.

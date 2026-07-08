# Video Reader MCP

> Evidence-first video reading for AI agents — ffprobe, subtitles, scenes, transcripts, and timelines without frame-by-frame LLM vision.

**Status:** v0.1.0 shipped — `read_video` MCP tool available.

Orchestrated by [smart-reader-mcp](https://github.com/SylphxAI/smart-reader-mcp) — portfolio ADR lives there, not in pdf-reader-mcp.

| Repository | Role |
| --- | --- |
| [pdf-reader-mcp](https://github.com/SylphxAI/pdf-reader-mcp) | PDF (production) |
| [image-reader-mcp](https://github.com/SylphxAI/image-reader-mcp) | Image |
| **video-reader-mcp** (this repo) | Video |
| [smart-reader-mcp](https://github.com/SylphxAI/smart-reader-mcp) | Unified read + delegate |

## Read vs interpret

**Read** (this repo): extract facts, metadata, transcripts, regions, and timelines with provenance — **no generative LLM required**.

**Interpret** (out of scope): summarize, classify, or answer open questions — belongs in the agent or an optional remote provider adapter.

## MCP surface

Primary tool: `read_video`

Returns a **timeline document** per source:

- ffprobe format + stream metadata
- chapter markers
- embedded subtitle cues (`time_ms`, text, provenance)
- optional scene boundaries (ffmpeg `scene` filter)
- warnings (missing ffmpeg/ffprobe, VFR, missing audio, skipped ASR)
- optional local ASR hook (skipped in v0.1 unless adapter is wired)

No per-frame vision LLM calls. No cloud APIs by default.

## Prerequisites

- Node.js ≥ 22.13
- **ffprobe** (required) and **ffmpeg** (recommended for subtitles + scenes) on `PATH`

## Quick start

```bash
npx @sylphx/video-reader-mcp
```

From source:

```bash
bun install
bun run build
bun run start
```

### Example `read_video` input

```json
{
  "sources": [{ "path": "./sample.mp4" }],
  "include_subtitles": true,
  "include_scenes": true,
  "scene_threshold": 0.4
}
```

### HTTP transport (optional)

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=8080 node dist/index.js
```

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

Unit tests mock parsers and do not require ffmpeg in CI. Integration with real media is optional locally.

## License

MIT © [SylphxAI](https://github.com/SylphxAI)
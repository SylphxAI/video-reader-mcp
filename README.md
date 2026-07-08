# Video Reader MCP

> Evidence-first video reading for AI agents — ffprobe, subtitles, scenes, transcripts, and timelines without frame-by-frame LLM vision.

**Status:** bootstrap — repository scaffold; MCP tools not shipped yet.

Part of the [Sylphx Reader portfolio](https://github.com/SylphxAI/pdf-reader-mcp/blob/main/docs/adr/0004-reader-portfolio-architecture.md).

| Repository | Role |
| --- | --- |
| [pdf-reader-mcp](https://github.com/SylphxAI/pdf-reader-mcp) | PDF (production) |
| [image-reader-mcp](https://github.com/SylphxAI/image-reader-mcp) | Image |
| **video-reader-mcp** (this repo) | Video |
| [smart-reader-mcp](https://github.com/SylphxAI/smart-reader-mcp) | Unified read + delegate |

## Read vs interpret

**Read** (this repo): extract facts, metadata, transcripts, regions, and timelines with provenance — **no generative LLM required**.

**Interpret** (out of scope): summarize, classify, or answer open questions — belongs in the agent or an optional remote provider adapter.

## Planned MCP surface

Primary tool: `read_video`

## Quick start (after v0.1.0)

```bash
npx @sylphx/video-reader-mcp
```

## License

MIT © [SylphxAI](https://github.com/SylphxAI)

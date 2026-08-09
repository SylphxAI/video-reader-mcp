<!-- Marketing: promise → CTA → comparison → why → tools → docs -->
<div align="center">

# Cue

### Timeline proof for agents — not frame-by-frame vision guesses.

**Local-first video evidence**: streams, chapters, subtitles, scenes, and follow-up crops your agent can cite.

**Canonical** [`@sylphx/cue`](https://www.npmjs.com/package/@sylphx/cue) · **bin** `cue` · **live** `0.2.1`

[![npm version](https://img.shields.io/npm/v/@sylphx/cue?style=flat-square)](https://www.npmjs.com/package/@sylphx/cue)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](https://opensource.org/licenses/MIT)
[![stars](https://img.shields.io/github/stars/SylphxAI/video-reader-mcp?style=flat-square)](https://github.com/SylphxAI/video-reader-mcp/stargazers)

</div>

## Zero-config in one line

```bash
npx -y @sylphx/cue
```

No API key. No global install. Starts a **stdio MCP server** immediately.

| Client | Setup |
| --- | --- |
| **Any agent / CLI** | `npx -y @sylphx/cue` |
| **Claude Code** | `claude mcp add cue -- npx -y @sylphx/cue` |
| **Desktop / Cursor / VS Code / Codex** | `"command": "npx", "args": ["-y", "@sylphx/cue"]` |

## Why Cue feels unfairly good

Your agent watched the video. **Did it read the timeline?**

| Frame-by-frame VLM | **Cue** |
| --- | --- |
| Expensive / slow captions | **Timeline structure** (streams, chapters, scenes) |
| Every follow-up is a new model call | `video_evidence` crops / frames with provenance |
| Cloud by default | **Local-first** |
| Setup: GPU + keys | **`npx -y` — done** |
| Brand mix | `@sylphx/cue` · bin `cue` · brand-sole `serverInfo.name=cue` |

### Five reasons teams pick Cue

1. **Zero-config MCP** for video evidence.
2. **Timeline twin**, not random frame captions.
3. **Local-first** — no required upload of whole videos to a cloud API.
4. **Fail closed** without the matching native.
5. **Family ready** — Iris for stills, Citra for PDFs, Locus for code.

## What agents get

Public tools: **`read_video`**, **`video_evidence`**.

### Flagship use cases

1. **Meeting / lecture recordings** — chapters, subtitles, scene boundaries  
2. **Product demos** — extract citeable frames with geometry context  
3. **Long-form media triage** — structure first, then crop evidence  

## Product docs

| Doc | Purpose |
| --- | --- |
| [docs/POSITIONING.md](docs/POSITIONING.md) | Strategic positioning |
| [docs/COMPETITIVE.md](docs/COMPETITIVE.md) | Peer anchors and wedge |
| [docs/EVIDENCE_CONTRACT.md](docs/EVIDENCE_CONTRACT.md) | Evidence = result contract |
| [docs/TOOL_SURFACE.md](docs/TOOL_SURFACE.md) | Few clear tools policy |
| [docs/PRODUCT_INDEPENDENCE.md](docs/PRODUCT_INDEPENDENCE.md) | This repo is SSOT |
| [docs/IPPB.md](docs/IPPB.md) | Independent public product bar |
| [docs/PUBLISH.md](docs/PUBLISH.md) | npm / git publish status |

## See it work

### Install (30 seconds)

```bash
npm install -g @sylphx/cue
cue doctor
claude mcp add cue -- npx -y @sylphx/cue
```

**Install once. Call once.**

```bash
```

```json
{
  "sources": [{ "path": "/absolute/path/to/demo.mp4" }],
  "include_subtitles": true,
  "include_scenes": true
}
```

`read_video` builds a timeline document per source — no per-frame vision LLM
calls:

```json
{
  "source": "/absolute/path/to/demo.mp4",
  "success": true,
  "data": {
    "provenance": {
      "source": "/absolute/path/to/demo.mp4",
      "tool": "read_video",
      "version": "0.1.0",
      "extracted_at": "2026-07-09T12:00:00.000Z"
    },
    "format": {
      "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
      "duration_ms": 125500
    },
    "streams": [
      { "index": 0, "codec_type": "video", "width": 1920, "height": 1080 },
      { "index": 1, "codec_type": "audio", "channels": 2, "sample_rate": 48000 }
    ],
    "chapters": [
      { "id": 0, "start_ms": 0, "end_ms": 60250, "title": "Intro" }
    ],
    "subtitles": [
      {
        "index": 0,
        "start_ms": 1200,
        "end_ms": 3400,
        "text": "Welcome to the demo.",
        "provenance": { "method": "ffmpeg_extract", "format": "srt" }
      }
    ],
    "scenes": [
      {
        "index": 0,
        "time_ms": 45200,
        "provenance": { "method": "ffmpeg_scene_filter", "threshold": 0.4 }
      }
    ],
    "warnings": []
  }
}
```

Abbreviated shape — optional local ASR transcript hooks skip gracefully when no
adapter is wired.

## Prerequisites

- Node.js `>=22.13`
- **ffprobe** (required) and **ffmpeg** (recommended for subtitles + scenes) on `PATH`

## MCP Tool Surface

| Tool | Use it when the agent needs to... |
| --- | --- |
| `read_video` | Read one or more local videos and return ffprobe metadata, chapters, subtitles, scenes, and timeline warnings. |

Supported formats: MP4, M4V, MKV, MOV, WebM, and other formats ffprobe can inspect.

## Quick Start

### Claude Code

```bash
```

### Claude Desktop

Add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cue": {
      "command": "npx",
      "args": ["-y", "@sylphx/cue"]
    }
  }
}
```

### Any MCP Client

```bash
npx -y @sylphx/cue
```

### HTTP transport (optional)

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=8080 npx -y @sylphx/cue
```

## Security model

- **Local-first** — `read_video` inspects local files; remote URLs are not fetched by default.
- **ffprobe/ffmpeg boundary** — probe and frame tools shell out to configured binaries on PATH; missing tools return explicit errors.
- **Fixture corpus** — CI validates parser and safety fixtures; corrupted inputs fail closed with structured diagnostics.
- **Evidence envelope** — timestamps, frame indices, and extraction routes are preserved so agents can verify claims.

## Release proof

Claims are backed by CI `benchmark:release-gate`, fixture corpus checks, and the shipped-path matrix (Rust-default primary tools).

```bash
bun run benchmark:release-gate
```

Artifact: `benchmark-artifacts/video_reader_release_gate.json` — must report `status: passed` before release.

## Development

```bash
git clone https://github.com/SylphxAI/video-reader-mcp.git
cd video-reader-mcp
bun install
bun run build
bun test
bun run doctor
bun run benchmark:release-gate
```

Useful checks:

```bash
bun run check
bun run typecheck
bun run benchmark:release-gate
```

Example `read_video` requests live in [`examples/`](examples/). CI runs parser,
fixture corpus, doctor, and release-gate checks; integration tests exercise ffmpeg
when available on the runner.

## Support

- [Issues](https://github.com/SylphxAI/video-reader-mcp/issues)
- [npm package](https://www.npmjs.com/package/@sylphx/cue)
- Portfolio orchestration: [smart-reader-mcp](https://github.com/SylphxAI/smart-reader-mcp)

## Help this reach more builders

If frame-by-frame vision guesses have wasted your context, your citations, or
your trust in agent output, you are exactly who this project is for.

**[⭐ Star the repo](https://github.com/SylphxAI/video-reader-mcp)** — it is the
fastest way to help more agent builders find evidence-first video reading. Share
it in your MCP client setup, team wiki, or agent stack README.

### Discovery (in progress)

| Channel | Status |
| --- | --- |
| [Glama MCP directory](https://glama.ai/mcp/servers/SylphxAI/video-reader-mcp) | Listed — [claim server](https://glama.ai/mcp/servers/SylphxAI/video-reader-mcp/admin) for full discoverability |
| [Official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.SylphxAI/video-reader-mcp) | Listed — `io.github.SylphxAI/video-reader-mcp` @ v0.1.0 |
| [TensorBlock MCP Index PR #1113](https://github.com/TensorBlock/awesome-mcp-servers/pull/1113) | Open — multimedia/document processing listing |
| [MCP servers community issue #4500](https://github.com/modelcontextprotocol/servers/issues/4500) | Open — community server highlight |
| [mcp.so listing issue #3068](https://github.com/chatmcp/mcpso/issues/3068) | Open — directory submission request |
| [mcpservers.org submit](https://mcpservers.org/submit) | Not listed yet — free web-form submission |

Know another MCP directory? [Open an issue](https://github.com/SylphxAI/video-reader-mcp/issues/new) with the link.

## License

MIT © [SylphxAI](https://github.com/SylphxAI)

# Tool surface — Cue

Policy: **few, powerful, obvious** tools. Prefer the primary read tool first.

## Primary (matches Rust rmcp surface)

| Tool | Role |
| --- | --- |
| `read_video` | Timeline document: ffprobe, subtitles, structural scenes/keyframes, agent_index |
| `video_evidence` | Follow-up: `render_frame` / `crop_frame` / `ocr_frame` with timestamp locators |

## Not separate top-level tools

Operations like render/crop/ocr frame are **ops inside `video_evidence`**, not extra MCP tool names. That keeps agent schemas small.

## Rules

1. Always `read_video` first; then `video_evidence` for citeable frames.
2. Structural keyframes only — not N-second grid spam.
3. ASR via local whisper-cli is optional (`include_transcript`).
4. No cloud vision/ASR required for success.
5. Composition with Iris/Prism via public contracts only.

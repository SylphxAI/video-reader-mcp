# Cue — video timeline evidence for agents

Use Cue when agents need **timeline proof** (streams, duration, chapters) without frame-by-frame VLMs.

## Install

```bash
npx @sylphx/video-reader-mcp
cue doctor
```

## SDK

```ts
import { Cue } from '@sylphx/video-reader-mcp/sdk'
const timeline = await Cue.create().read({
  path: './sample.mp4',
  include_subtitles: true,
  include_scenes: true,
})
```

## Tools

| Tool | Job |
| --- | --- |
| `read_video` | Timeline document via local ffprobe path |
| `video_evidence` *(advanced)* | `render_frame` / `crop_frame` / **`ocr_frame`** (render+tesseract honesty) |

### Timeline flags

| Flag | Meaning |
| --- | --- |
| `include_subtitles` | Extract embedded subtitle cues (`start_ms`/`end_ms`) when ffmpeg available |
| `include_scenes` | Optional ffmpeg scene boundaries with timestamps |
| `include_transcript` | Local ASR when whisper-cli/etc present; honest skip otherwise |
| *(chapters)* | Returned from ffprobe when present on the container |

## Evidence contract

Results include stream/chapter anchors and warnings. There is **no** `evidence_first` tool.
Full timeline path requires **ffprobe** on PATH; doctor and public-proof report availability honestly.
Missing ffmpeg → subtitle/scene paths skip with warnings (no invented cues).


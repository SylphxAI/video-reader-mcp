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
const timeline = await Cue.create().read({ path: './sample.mp4' })
```

## Tools

| Tool | Job |
| --- | --- |
| `read_video` | Timeline document via local ffprobe path |
| `video_evidence` *(optional advanced)* | Frame/OCR paths when enabled |

Evidence is on results. Family: https://github.com/SylphxAI/instruments

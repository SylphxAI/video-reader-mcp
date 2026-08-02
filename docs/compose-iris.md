# Cue → Iris composition (local semantic video timeline)

One-command local pipeline that gives an agent **timestamped object evidence**
from a video — without per-frame VLM.

```text
Cue (structure)          Iris (semantics)
  detect scenes   ──►  structural keyframes  ──►  read_image include_semantics  ──►  objects + time
```

## Principles

- **Structure in Cue, semantics in Iris, merge by time.**
- Keyframes are **scene-change architecture** (not an N-second grid).
- No frame-by-frame vision LLM: only structural samples.
- Iris L2 is **scored_non_locator** — never overrides OCR/layout in a single image.

## Usage

Requirements: `ffmpeg`/`ffprobe` on PATH, plus an Iris semantics backend
(`IRIS_SEMANTICS_URL` pointing at the sidecar at
`image-reader-mcp/examples/florence-sidecar/` or a compatible adapter; or any
Iris `read_image { include_semantics: true }` backend).

```bash
cd /abs/video-reader-mcp
bun install
IRIS_SEMANTICS_URL=http://127.0.0.1:8765 \
bun run compose:iris -- /abs/clip.mp4 [--limit 8] [--prompt "animals"] [--out composed_objects.json]
```

## Output example

```json
{
  "policy": "cue_compose_iris_v1",
  "video": "clip.mp4",
  "keyframe_policy": "structural_v1",
  "keyframe_count": 4,
  "total_objects": 11,
  "keyframes": [
    { "time_ms": 1000, "frame": "frame_000.png",
      "semantics_available": true,
      "objects": [
        { "id": "obj_1", "label": "person", "bbox": { "x": 10, "y": 20, "width": 30, "height": 40 }, "score": 0.91 }
      ],
      "caption": "a person walking a dog", "model": "florence2" }
  ],
  "warnings": []
}
```

## Honest failure

- If ffmpeg or the semantics backend is missing, each frame fails closed with
  `semantics_available:false` + `skipped_reason`, and the process exits non-zero
  when any keyframe failed. No empty-guess objects are fabricated.
- This composition is a **CLI/agent path**, not a new Cue MCP tool.

## Tests

`bun test test/composeIris.boundary.test.ts` proves the merge + fail-closed with
a mocked semantics backend (no video/model needed).

# Cue — Agent Video Read Contract

## Job

Let agents **read** a video as a **timeline architecture** (streams, cuts, dialogue, structural keyframes), not watch every Nth frame with a vision model.

## Competitive synthesis

| Peer class | Strength | Gap we exploit |
| --- | --- | --- |
| YouTube transcript MCPs | Dialogue from platform | Not local files; weak structure |
| Popcorn / long-form local | Transcripts + scenes + frames | Heavier; we stay timeline-first |
| whisper.cpp MCPs | ASR | Not full structural index |
| Fixed-interval frame OCR | Simple | **Not** architecture; we reject this as default |

## Default path (local-first)

1. **ffprobe** format + streams + chapters  
2. **Subtitles** embedded (dialogue authority when present)  
3. **Scenes** ffmpeg scene filter (cut architecture)  
4. **Structural keyframes** (policy `structural`): scene cuts + mid-gaps, capped — **not** fixed interval  
5. **agent_index** text outline for non-vision agents  
6. Follow-up **video_evidence** `render_frame` / `crop_frame` at a locator `time_ms`  

## Optional

- ASR transcript (`include_transcript`) when whisper adapter present  
- Optional future LLM vision at a locator time — never default authority  

## Tool surface

| Tool | Role |
| --- | --- |
| `read_video` | Primary timeline + agent_index |
| `video_evidence` | Frame/crop/OCR at time |
| `render_frame` / `crop_frame` | Pixel evidence |

## Agent usage

```json
{
  "sources": [{ "path": "/abs/clip.mp4" }],
  "include_scenes": true,
  "include_keyframes": true,
  "keyframe_policy": "structural",
  "include_agent_index": true
}
```

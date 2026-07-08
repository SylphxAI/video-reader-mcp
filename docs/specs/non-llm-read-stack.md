# Non-LLM Video Read Stack (v0.1 target)

## Default path (no generative LLM)

| Layer | Tool | Output |
| --- | --- | --- |
| Container | ffprobe | duration, codecs, bitrate, streams, chapters |
| Subtitles | ffmpeg extract | embedded SRT/VTT/WebVTT text + timecodes |
| Scenes | PySceneDetect ContentDetector / ffmpeg `scene` | shot boundaries, scene list |
| Keyframes | ffmpeg `select=eq(pict_type\,I)` | timestamp index (not sent to vision LLM) |
| Audio read | optional local ASR adapter (whisper.cpp, vosk) | word-level transcript + timecodes |
| Silence | ffmpeg silencedetect | speech/music segments |

## What "read video" means here

Agents receive a **timeline document**:

- N scenes, M shots, chapter markers
- Full subtitle/transcript text with `time_ms`
- Stream metadata and warnings (variable frame rate, missing audio)
- Optional keyframe thumbnails as **evidence crops** with provenance IDs

We do **not** default to sending every frame to a vision model.

## Explicitly not default

- Per-frame vision LLM ("describe this frame")
- Video LLM summarization of plot
- Cloud-only APIs without explicit provider selection
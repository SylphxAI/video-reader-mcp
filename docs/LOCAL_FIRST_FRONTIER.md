# Local-first frontier (Cue)

## Principles (hard)

1. **Less dependency** — ffmpeg/ffprobe/whisper on PATH; no npm ML bundles  
2. **Zero config** — probe/scenes/subtitles work with ffmpeg alone  
3. **Local first, cloud optional** — no cloud ASR/VLM by default  
4. **Speed / size / performance** — timeline first; pixel frames only on follow-up  
5. **Rust first** — timeline/ASR/frames via Rust engines when built  

## Extraction stack (priority)

| Layer | Default | Optional |
| --- | --- | --- |
| Container/streams | **ffprobe** (+ Rust assemble) | — |
| Scenes | **ffmpeg** scene filter | — |
| Structural keyframes | scene architecture (not N-sec grid) | images via render |
| Subtitles | embedded extract | — |
| ASR | off | local **whisper-cli/cpp** on PATH |
| agent_index | on by default | — |

## Zero-config usage

```bash
npm i -g @sylphx/cue
# system: ffmpeg/ffprobe
read_video { "sources":[{"path":"/abs/a.mp4"}], "include_keyframes": true, "keyframe_policy": "structural" }
```

Optional local ASR:

```bash
# whisper.cpp providing whisper-cli on PATH
# optional: CUE_WHISPER_MODEL=/path/to/ggml-model.bin
read_video { ..., "include_transcript": true }
```

## Non-negotiable

1. Zero API key for default path  
2. Prefer Rust native MCP when present  
3. Few tools; primary path documented in TOOL_SURFACE.md  
4. Cloud / LLM only optional and non-authority  
5. Product SSOT is this repository only (no instruments monorepo)

## Composition: Iris L2 on structural keyframes

Cue owns **timeline structure** (probe, scenes, structural keyframes, subtitles).
Open-vocab objects / masks / captions belong to **Iris L2 semantics**:

1. `read_video` with structural keyframes  
2. For each keyframe path, agent calls Iris `read_image` with `include_semantics: true`  
3. Merge by timestamp locator — do not run per-frame VLM inside Cue  

See Iris `docs/adr/ADR-20260802-iris-l2-local-semantics.md`.

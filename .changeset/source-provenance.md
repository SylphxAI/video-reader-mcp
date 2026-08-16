---
'@sylphx/cue': patch
---

Preserve the source SHA-256 on `video_evidence` frame, crop, and OCR results so
pixel evidence remains attributable to the same local video as `read_video`.

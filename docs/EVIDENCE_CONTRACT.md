# Evidence contract — product-specific

**Evidence First** means results carry citeable structure. There is **no** MCP tool named `evidence_first`.

## Locators and honesty for this product

- time_ms / frame indices
- stream ids from ffprobe
- subtitle cue times
- warnings when ffmpeg/ffprobe/asr missing

Internal helpers (`hash_source`, `build_cache_key`) support caching; agents should prefer `read_video` first.

## Always include when applicable

- **route**: which local engine path produced the payload
- **warnings**: missing binaries, partial parse, network/adapter limits
- raw facts over generative rewrite as authority

## Non-goals

- Requiring a cloud model to “confirm” local facts
- Over-marketing Evidence First without locators on the wire

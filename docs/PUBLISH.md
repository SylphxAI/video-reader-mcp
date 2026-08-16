# Publish status — Cue

| Field | Value |
| --- | --- |
| Canonical npm | `@sylphx/cue` |
| Source/package tip | `0.2.1` |
| Deprecated CTA | `@sylphx/video-reader-mcp` |
| Public tools | `read_video`, `video_evidence` only |

`server.json` is the MCP Registry manifest and must stay version-aligned with
`package.json`; run `bun run sync:server-json` before a release or registry
publication.

```bash
npm i -g @sylphx/cue
```

## Zero-config CTA

```bash
npx -y @sylphx/cue
```

Live **@sylphx/cue@0.2.1**. Bare MCP stdio for agents.

# Cue — brand npm publish (expand–contract)

**Publish authority:** this repository only.

| Field | Value |
| --- | --- |
| Brand | **Cue** |
| Canonical brand npm id | `@sylphx/cue` |
| Transitional npm id | `@sylphx/video-reader-mcp` |
| Marketplace title | Cue (`server.json`) |

## Policy (expand → contract)

1. **One codebase / one version** — never two products.
2. **Expand:** dual-publish `@sylphx/video-reader-mcp@X.Y.Z` and `@sylphx/cue@X.Y.Z` (same artifacts).
3. **Contract (later):** `npm deprecate` transitional toward brand; keep bins as long as cheap.
4. Workflow: `.github/workflows/publish-brand-alias.yml` (org `NPM_TOKEN`).

## User install

```bash
# preferred
npm i -g @sylphx/cue
# transitional still valid during expand
npm i -g @sylphx/video-reader-mcp
```

## Authority

No central Instruments monorepo. Brand alias ships only from this product repo.

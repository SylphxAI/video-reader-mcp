import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dir, '../..');

describe('http transport integration (matrix)', () => {
  it('Rust HTTP module and bin routing are present', () => {
    const http = path.join(repoRoot, 'crates/video-reader-mcp-server/src/http_transport.rs');
    const bin = path.join(repoRoot, 'bin/video-reader-mcp');
    expect(existsSync(http)).toBe(true);
    expect(existsSync(bin)).toBe(true);
    const binText = readFileSync(bin, 'utf8');
    expect(binText).toContain('MCP_TRANSPORT');
    expect(binText).toContain('resolve_rust_bin');
  });
});

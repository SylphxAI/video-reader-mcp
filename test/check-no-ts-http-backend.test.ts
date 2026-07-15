import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

const readText = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('Web MCP HTTP Rust authority gate', () => {
  it('check-no-ts-http-backend gate script exists and enforces Rust HTTP authority', () => {
    const script = readText('scripts/check-no-ts-http-backend.sh');

    expect(script).toContain('check-no-ts-http-backend');
    expect(script).toContain('resolve_rust_bin');
    expect(script).toContain('MCP_TRANSPORT=http');
    expect(script).toContain('StreamableHttpService');
    expect(script).toContain('check-ts-adapter-deletion-ready.sh');
    expect(script).toContain('must not retain TS transport opt-in');
    expect(existsSync(path.join(repoRoot, 'test/integration/http-transport.test.ts'))).toBe(true);
  });

  it('npm bin routes HTTP to Rust rmcp without TS stdio opt-in', () => {
    const bin = readText('bin/video-reader-mcp');
    const httpTransport = readText('crates/video-reader-mcp-server/src/http_transport.rs');

    expect(bin).toContain('resolve_rust_bin');
    expect(bin).toContain('MCP_TRANSPORT=http');
    expect(bin).toContain('transport="$(resolve_transport)"');
    expect(bin).not.toContain('use_ts_transport');
    expect(bin).not.toContain('exec node');
    expect(httpTransport).toContain('StreamableHttpService');
    expect(httpTransport).toContain('health_check');
  });

  it('migration ledger marks transport/web-mcp-http as ts_deleted after adversarial admission', () => {
    const ledger = JSON.parse(readText('docs/specs/video-reader-mcp-migration-ledger.json')) as {
      capabilities: Array<{ id: string; state: string }>;
    };

    const http = ledger.capabilities.find(
      (capability) => capability.id === 'transport/web-mcp-http'
    );
    expect(http?.state).toBe('ts_deleted');
  });
});

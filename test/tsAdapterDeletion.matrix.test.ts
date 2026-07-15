import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'bun:test';

const repoRoot = path.resolve(import.meta.dirname, '..');

describe('TS stdio adapter deletion matrix (adversarial admission)', () => {
  it('npm bin routes exclusively to Rust rmcp', () => {
    const bin = readFileSync(path.join(repoRoot, 'bin/video-reader-mcp'), 'utf8');
    expect(bin).toContain('resolve_rust_bin');
    expect(bin).toContain('resolve_transport');
    expect(bin).not.toContain('use_ts_transport');
    expect(bin).not.toContain('VIDEO_READER_MCP_TRANSPORT:-}" == "ts"');
    expect(bin).not.toContain('exec node');
    expect(bin).not.toContain('dist/index.js');
  });

  it('TS stdio adapter sources are deleted', () => {
    expect(existsSync(path.join(repoRoot, 'src/index.ts'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'dist/index.js'))).toBe(false);
  });

  it('doctor CLI is preserved without MCP stdio adapter entry', () => {
    expect(existsSync(path.join(repoRoot, 'src/doctor-cli.ts'))).toBe(true);
    expect(existsSync(path.join(repoRoot, 'src/doctor.ts'))).toBe(true);
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      exports: Record<string, string>;
    };
    expect(pkg.scripts.doctor).toContain('doctor-cli');
    expect(pkg.exports['.']).toContain('doctor-cli');
  });

  it('HTTP integration harness exists for web-mcp-http authority proof', () => {
    const integration = readFileSync(
      path.join(repoRoot, 'test/integration/http-transport.test.ts'),
      'utf8'
    );
    expect(integration).toContain('http transport');
    expect(integration).toContain('resolve_rust_bin');
    expect(integration).toContain('MCP_TRANSPORT');
  });

  it('deletion gate script enforces ts_deleted ledger state for video capabilities', () => {
    const script = readFileSync(
      path.join(repoRoot, 'scripts/check-ts-adapter-deletion-ready.sh'),
      'utf8'
    );
    expect(script).toContain('require_ledger_state "transport/stdio-ts-adapter" "ts_deleted"');
    expect(script).toContain('require_ledger_state "tool/read_video" "ts_deleted"');
    expect(script).toContain('require_ledger_state "tool/video_evidence" "ts_deleted"');
    expect(script).toContain('src/index.ts must be deleted');
    expect(script).toContain('use_ts_transport');
    expect(script).not.toContain('tool/read_pdf');
    expect(script).not.toContain('tool/search_pdf');
    expect(script).not.toContain('tool/pdf_evidence');
  });

  it('ledger records all five capabilities as ts_deleted', () => {
    for (const ledgerPath of [
      'docs/specs/migration-ledger.json',
      'docs/specs/video-reader-mcp-migration-ledger.json',
    ]) {
      const ledger = JSON.parse(readFileSync(path.join(repoRoot, ledgerPath), 'utf8')) as {
        capabilities: Array<{ id: string; state: string }>;
        summary: { ts_deleted: number; ts_only: number; completion_progress: number };
      };
      const expected = [
        'transport/web-mcp-http',
        'transport/stdio-rust-rmcp',
        'transport/stdio-ts-adapter',
        'tool/read_video',
        'tool/video_evidence',
      ];
      for (const id of expected) {
        const cap = ledger.capabilities.find((c) => c.id === id);
        expect(cap?.state).toBe('ts_deleted');
      }
      expect(ledger.summary.ts_deleted).toBe(5);
      expect(ledger.summary.ts_only).toBe(0);
      expect(ledger.summary.completion_progress).toBe(1.0);
    }
  });

  it('ledger records transport/stdio-rust-rmcp as ts_deleted with admitted proof', () => {
    const ledger = JSON.parse(
      readFileSync(path.join(repoRoot, 'docs/specs/video-reader-mcp-migration-ledger.json'), 'utf8')
    ) as {
      capabilities: Array<{ id: string; state: string; proof?: { status: string } }>;
      summary: { ts_deleted: number; completion_progress: number; authority_progress: number };
    };
    const admittedProof = new Set(['missing', 'differential_green', 'canary_green', 'caught_up']);
    const stdioRust = ledger.capabilities.find((cap) => cap.id === 'transport/stdio-rust-rmcp');
    expect(stdioRust?.state).toBe('ts_deleted');
    expect(admittedProof.has(stdioRust?.proof?.status ?? '')).toBe(true);
    expect(ledger.summary.ts_deleted).toBe(5);
    expect(ledger.summary.completion_progress).toBe(1.0);
    expect(ledger.summary.authority_progress).toBe(1.0);
  });
});

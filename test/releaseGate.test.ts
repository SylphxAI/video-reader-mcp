import { beforeAll, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { buildReleaseGateReport } from '../scripts/release-gate.js';

const repoRoot = path.resolve(import.meta.dirname, '..');

describe('video reader release gate', () => {
  beforeAll(() => {
    execSync('cargo build -q', { cwd: repoRoot, stdio: 'pipe', timeout: 120_000 });
  }, 120_000);

  it('passes Phase 0 contract checks', async () => {
    const report = await buildReleaseGateReport(
      path.join(import.meta.dirname, '..', 'benchmark-artifacts')
    );

    expect(report.profile).toBe('video_reader_release_gate');
    expect(report.status).toBe('passed');
    expect(report.summary.failed).toBe(0);
    expect(report.checks.some((check) => check.id === 'fixtures:corpus_manifest')).toBe(true);
  });
});

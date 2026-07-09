import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assembleProbeTimelineViaRustEngine,
  hashSourceViaRustEngine,
} from '../src/engine/rust-timeline.js';
import { execBinary, isBinaryAvailable } from '../src/utils/exec.js';
import { parseFfprobeJson } from '../src/utils/ffprobe.js';
import { buildTimelineDocument } from '../src/video/readCoordinator.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const multiStreamFixture = path.join(
  import.meta.dirname,
  'fixtures',
  'probes',
  'multi-stream.json'
);
const noSubtitleFixture = path.join(import.meta.dirname, 'fixtures', 'no-subtitle.mp4');

describe('rust timeline engine boundary', () => {
  beforeAll(async () => {
    execSync('cargo build -q', { cwd: repoRoot, stdio: 'pipe', timeout: 120_000 });
    process.env.VIDEO_READER_USE_RUST_TIMELINE = '1';

    if (await isBinaryAvailable('ffmpeg')) {
      await execBinary(
        'ffmpeg',
        [
          '-hide_banner',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'color=c=blue:s=160x120:d=2',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          noSubtitleFixture,
        ],
        { timeoutMs: 60_000 }
      );
    }
  }, 120_000);

  afterAll(() => {
    delete process.env.VIDEO_READER_USE_RUST_TIMELINE;
  });

  it('assembles probe timelines from deterministic ffprobe fixtures', () => {
    const probe = parseFfprobeJson(readFileSync(multiStreamFixture, 'utf8'));
    const timeline = assembleProbeTimelineViaRustEngine(probe, {
      includeStreams: true,
      includeChapters: true,
    });

    expect(timeline.streams).toHaveLength(3);
    expect(timeline.format.duration_ms).toBe(125_500);
    expect(timeline.chapters[0]?.title).toBe('Intro');
    expect(timeline.route).toBe('rust-timeline');
  });

  it('hashes local fixture bytes deterministically', async () => {
    if (!(await isBinaryAvailable('ffmpeg'))) {
      return;
    }

    const first = hashSourceViaRustEngine(noSubtitleFixture);
    const second = hashSourceViaRustEngine(noSubtitleFixture);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('records rust provenance fields in timeline documents', async () => {
    if (!(await isBinaryAvailable('ffprobe')) || !(await isBinaryAvailable('ffmpeg'))) {
      return;
    }

    const document = await buildTimelineDocument(
      noSubtitleFixture,
      {
        sources: [{ path: noSubtitleFixture }],
      },
      '0.1.0'
    );

    expect(document.provenance.assembly_route).toBe('rust-timeline');
    expect(document.provenance.source_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(document.provenance.cache_key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps timeline assembly logic out of the TypeScript coordinator sources', () => {
    const coordinatorSrc = readFileSync(
      path.join(repoRoot, 'src/video/readCoordinator.ts'),
      'utf8'
    );
    const engineSrc = readFileSync(path.join(repoRoot, 'src/engine/rust-timeline.ts'), 'utf8');

    expect(engineSrc).toContain('spawnSync');
    expect(coordinatorSrc).toContain('assembleProbeTimelineViaRustEngine');
    expect(coordinatorSrc).toContain('hashSourceViaRustEngine');
  });
});

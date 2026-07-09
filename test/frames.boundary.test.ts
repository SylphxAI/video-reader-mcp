import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  extractKeyframesViaRustEngine,
  isRustCliAvailable,
  shouldUseRustFramesEngine,
} from '../src/engine/rust-frames.js';
import { execBinary, isBinaryAvailable } from '../src/utils/exec.js';
import { buildTimelineDocument } from '../src/video/readCoordinator.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const fixturePath = path.join(import.meta.dirname, 'fixtures', 'no-subtitle.mp4');

describe('rust frames engine boundary', () => {
  beforeAll(async () => {
    execSync('cargo build -q', { cwd: repoRoot, stdio: 'pipe', timeout: 120_000 });

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
          fixturePath,
        ],
        { timeoutMs: 60_000 }
      );
    }
  }, 120_000);

  afterAll(() => {
    delete process.env.VIDEO_READER_USE_RUST_FRAMES;
  });

  it('defaults to the Rust CLI when it is built', () => {
    expect(isRustCliAvailable()).toBe(true);
    expect(shouldUseRustFramesEngine()).toBe(true);
  });

  it('indexes keyframes and renders PNG evidence when ffmpeg is available', async () => {
    if (!(await isBinaryAvailable('ffmpeg'))) {
      return;
    }

    const response = extractKeyframesViaRustEngine({
      videoPath: fixturePath,
      limit: 2,
      includeImages: true,
      maxDimension: 120,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.keyframes.length).toBeGreaterThan(0);
    const first = response.keyframes[0];
    expect(first?.route).toBe('rust-keyframe-png');
    expect(first?.frame_hash?.length).toBeGreaterThan(0);
    expect(first?.mime).toBe('image/png');
    expect(first?.image_base64?.length).toBeGreaterThan(0);
  });

  it('attaches keyframe PNG evidence through read_video', async () => {
    if (!(await isBinaryAvailable('ffmpeg')) || !(await isBinaryAvailable('ffprobe'))) {
      return;
    }

    const document = await buildTimelineDocument(fixturePath, {
      sources: [{ path: fixturePath }],
      include_scenes: false,
      include_subtitles: false,
      include_transcript: false,
      include_keyframes: true,
      include_keyframe_images: true,
      keyframe_limit: 2,
      keyframe_max_dimension: 120,
    }, '0.1.0');

    expect(document.keyframes.length).toBeGreaterThan(0);
    expect(document.keyframes[0]?.route).toBe('rust-keyframe-png');
    expect(document.keyframes[0]?.frame_hash?.length).toBeGreaterThan(0);
  });

  it('keeps frame extraction logic out of the TypeScript adapter sources', () => {
    const framesSrc = readFileSync(path.join(repoRoot, 'src/utils/frames.ts'), 'utf8');
    const engineSrc = readFileSync(path.join(repoRoot, 'src/engine/rust-frames.ts'), 'utf8');

    expect(engineSrc).toContain('extract_keyframes');
    expect(framesSrc).toContain('extractKeyframesViaRustEngine');
    expect(framesSrc).not.toMatch(/Sha256|image2pipe/i);
  });
});
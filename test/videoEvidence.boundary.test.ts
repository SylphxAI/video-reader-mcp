import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  cropFrameViaRustEngine,
  isRustCliAvailable,
  renderFrameViaRustEngine,
  shouldUseRustVideoEvidenceEngine,
} from '../src/engine/rust-video-evidence.js';
import { createVideoEvidenceHandler } from '../src/handlers/videoEvidence.js';
import { execBinary, isBinaryAvailable } from '../src/utils/exec.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const fixturePath = path.join(import.meta.dirname, 'fixtures', 'no-subtitle.mp4');
const videoEvidence = createVideoEvidenceHandler();

const parseEvidenceResults = (result: Awaited<ReturnType<typeof videoEvidence.handler>>) => {
  const block =
    'type' in result && result.type === 'text'
      ? result
      : 'content' in result && Array.isArray(result.content)
        ? result.content[0]
        : undefined;

  if (block?.type === 'text' && typeof block.text === 'string') {
    return JSON.parse(block.text) as {
      profile: string;
      operation: string;
      route: string;
      results: Array<{
        success: boolean;
        route?: string;
        frame?: { frame_hash: string; mime: string; image_base64: string; crop?: unknown };
        error?: string;
        code?: string;
      }>;
    };
  }

  const errorBlock =
    'type' in result && result.type === 'error'
      ? result
      : 'content' in result && Array.isArray(result.content)
        ? result.content[0]
        : undefined;

  if (errorBlock?.type === 'text' && typeof errorBlock.text === 'string') {
    return { error: errorBlock.text };
  }

  throw new Error('Expected text or error content from video_evidence handler');
};

describe('rust video evidence engine boundary', () => {
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
    expect(shouldUseRustVideoEvidenceEngine()).toBe(true);
  });

  it('renders citeable PNG evidence at a timestamp when ffmpeg is available', async () => {
    if (!(await isBinaryAvailable('ffmpeg'))) {
      return;
    }

    const response = renderFrameViaRustEngine({
      videoPath: fixturePath,
      timeMs: 0,
      maxDimension: 120,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.frame.route).toBe('rust-frame-render');
    expect(response.frame.frame_hash.length).toBeGreaterThan(0);
    expect(response.frame.mime).toBe('image/png');
    expect(response.frame.image_base64.length).toBeGreaterThan(0);
  });

  it('crops citeable PNG evidence at a timestamp when ffmpeg is available', async () => {
    if (!(await isBinaryAvailable('ffmpeg'))) {
      return;
    }

    const response = cropFrameViaRustEngine({
      videoPath: fixturePath,
      timeMs: 0,
      crop: { x: 10, y: 10, width: 80, height: 60 },
      maxDimension: 120,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.frame.route).toBe('rust-frame-crop');
    expect(response.frame.frame_hash.length).toBeGreaterThan(0);
    expect(response.frame.crop).toEqual({ x: 10, y: 10, width: 80, height: 60 });
  });

  it('exposes render_frame and crop_frame through the video_evidence MCP handler', async () => {
    if (!(await isBinaryAvailable('ffmpeg'))) {
      return;
    }

    const renderResult = await videoEvidence.handler({
      input: {
        operation: 'render_frame',
        sources: [{ path: fixturePath, time_ms: 0 }],
        max_dimension: 120,
      },
      ctx: {},
    });
    const renderPayload = parseEvidenceResults(renderResult);
    expect('error' in renderPayload).toBe(false);
    if ('error' in renderPayload) {
      return;
    }

    expect(renderPayload.profile).toBe('video_evidence_results');
    expect(renderPayload.operation).toBe('render_frame');
    expect(renderPayload.route).toBe('rust-frame-render');
    expect(renderPayload.results[0]?.success).toBe(true);
    expect(renderPayload.results[0]?.frame?.frame_hash?.length).toBeGreaterThan(0);

    const cropResult = await videoEvidence.handler({
      input: {
        operation: 'crop_frame',
        sources: [
          {
            path: fixturePath,
            time_ms: 0,
            crop: { x: 5, y: 5, width: 100, height: 90 },
          },
        ],
        max_dimension: 120,
      },
      ctx: {},
    });
    const cropPayload = parseEvidenceResults(cropResult);
    expect('error' in cropPayload).toBe(false);
    if ('error' in cropPayload) {
      return;
    }

    expect(cropPayload.operation).toBe('crop_frame');
    expect(cropPayload.route).toBe('rust-frame-crop');
    expect(cropPayload.results[0]?.success).toBe(true);
  });

  it('returns an explicit unavailable error for ocr_frame', async () => {
    const result = await videoEvidence.handler({
      input: {
        operation: 'ocr_frame',
        sources: [{ path: fixturePath, time_ms: 0 }],
      },
      ctx: {},
    });

    expect(result).toMatchObject({ isError: true });
    const block =
      'content' in result && Array.isArray(result.content) ? result.content[0] : undefined;
    expect(block?.type).toBe('text');
    if (block?.type !== 'text') {
      return;
    }
    expect(block.text).toContain('ocr_frame is not available');
  });

  it('keeps frame render logic out of the TypeScript adapter sources', () => {
    const handlerSrc = readFileSync(path.join(repoRoot, 'src/handlers/videoEvidence.ts'), 'utf8');
    const engineSrc = readFileSync(
      path.join(repoRoot, 'src/engine/rust-video-evidence.ts'),
      'utf8'
    );

    expect(engineSrc).toContain('render_frame');
    expect(engineSrc).toContain('crop_frame');
    expect(handlerSrc).toContain('renderFrameViaRustEngine');
    expect(handlerSrc).not.toMatch(/image2pipe|Sha256/i);
  });
});

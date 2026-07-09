import { beforeAll, describe, expect, it } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createReadVideoHandler } from '../src/handlers/readVideo.js';
import { execBinary, isBinaryAvailable } from '../src/utils/exec.js';

const fixtureDir = path.join(import.meta.dirname, 'fixtures');
const noSubtitlePath = path.join(fixtureDir, 'no-subtitle.mp4');
const corruptedPath = path.join(fixtureDir, 'corrupted-truncated.mp4');
const readVideo = createReadVideoHandler('0.1.0-test');

const parseResults = (result: Awaited<ReturnType<typeof readVideo.handler>>) => {
  const block =
    'type' in result && result.type === 'text'
      ? result
      : 'content' in result && Array.isArray(result.content)
        ? result.content[0]
        : undefined;

  if (block?.type !== 'text' || typeof block.text !== 'string') {
    throw new Error('Expected text content from read_video handler');
  }

  return JSON.parse(block.text) as {
    results: Array<{
      success: boolean;
      data?: { warnings: string[]; streams: unknown[]; subtitles: unknown[] };
      error?: string;
    }>;
  };
};

beforeAll(async () => {
  const ffmpegAvailable = await isBinaryAvailable('ffmpeg');
  if (!ffmpegAvailable) {
    return;
  }

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
      noSubtitlePath,
    ],
    { timeoutMs: 60_000 }
  );

  const bytes = await readFile(noSubtitlePath);
  await writeFile(corruptedPath, bytes.subarray(0, Math.min(bytes.length, 512)));
});

describe('read_video integration fixtures', () => {
  it('reads a generated no-subtitle clip when ffmpeg is available', async () => {
    const ffmpegAvailable = await isBinaryAvailable('ffmpeg');
    const ffprobeAvailable = await isBinaryAvailable('ffprobe');
    if (!ffmpegAvailable || !ffprobeAvailable) {
      return;
    }

    const result = await readVideo.handler({
      input: {
        sources: [{ path: noSubtitlePath }],
        include_scenes: false,
        include_transcript: false,
      },
      ctx: {},
    });

    expect(result).not.toMatchObject({ isError: true });

    const payload = parseResults(result);
    expect(payload.results[0]?.success).toBe(true);
    expect(payload.results[0]?.data?.streams.length).toBeGreaterThan(0);
    expect(
      payload.results[0]?.data?.warnings.some((warning) =>
        warning.includes('No embedded subtitle streams found')
      )
    ).toBe(true);
  });

  it('returns structured failure for truncated video fixtures', async () => {
    const ffmpegAvailable = await isBinaryAvailable('ffmpeg');
    const ffprobeAvailable = await isBinaryAvailable('ffprobe');
    if (!ffmpegAvailable || !ffprobeAvailable) {
      return;
    }

    const result = await readVideo.handler({
      input: {
        sources: [{ path: corruptedPath }],
        include_scenes: false,
        include_subtitles: false,
        include_transcript: false,
      },
      ctx: {},
    });

    expect(result).toMatchObject({ isError: true });
  });
});

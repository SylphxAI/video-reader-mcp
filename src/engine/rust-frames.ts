import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FrameEvidence } from '../types/timeline.js';

type RustKeyframeEnvelope =
  | { status: 'ok'; keyframes: FrameEvidence[] }
  | { status: 'error'; code: string; message: string };

const here = path.dirname(fileURLToPath(import.meta.url));

export function resolveRustCliBinary(): string {
  const env = process.env.VIDEO_READER_CLI;
  if (env && existsSync(env)) {
    return env;
  }

  const release = path.join(here, '../../target/release/video-reader-cli');
  if (existsSync(release)) {
    return release;
  }

  const debug = path.join(here, '../../target/debug/video-reader-cli');
  if (existsSync(debug)) {
    return debug;
  }

  return 'video-reader-cli';
}

export function isRustCliAvailable(): boolean {
  return resolveRustCliBinary() !== 'video-reader-cli';
}

export function shouldUseRustFramesEngine(): boolean {
  if (process.env.VIDEO_READER_USE_RUST_FRAMES === '0') {
    return false;
  }
  if (process.env.VIDEO_READER_USE_RUST_FRAMES === '1') {
    return true;
  }
  return isRustCliAvailable();
}

export function extractKeyframesViaRustEngine(input: {
  videoPath: string;
  limit: number;
  includeImages: boolean;
  maxDimension?: number | undefined;
}): { ok: true; keyframes: FrameEvidence[] } | { ok: false; code: string; message: string } {
  const binary = resolveRustCliBinary();
  const payload = JSON.stringify({
    tool: 'extract_keyframes',
    input: {
      path: input.videoPath,
      limit: input.limit,
      include_images: input.includeImages,
      ...(input.maxDimension !== undefined ? { max_dimension: input.maxDimension } : {}),
    },
  });

  const response = spawnSync(binary, [], {
    input: payload,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  if (response.error) {
    return {
      ok: false,
      code: 'ENGINE_UNAVAILABLE',
      message: response.error.message,
    };
  }

  if (response.status !== 0) {
    return {
      ok: false,
      code: 'ENGINE_FAILED',
      message: response.stderr || `Rust frames engine exited with status ${response.status}`,
    };
  }

  const envelope = JSON.parse(response.stdout) as RustKeyframeEnvelope;
  if (envelope.status !== 'ok') {
    return {
      ok: false,
      code: envelope.code,
      message: envelope.message,
    };
  }

  return { ok: true, keyframes: envelope.keyframes };
}

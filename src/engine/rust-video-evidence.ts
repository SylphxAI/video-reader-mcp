import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type CropRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FrameRenderEvidence = {
  time_ms: number;
  route: string;
  frame_hash: string;
  mime: string;
  width: number;
  height: number;
  image_base64: string;
  provenance: {
    method: string;
    time_ms: number;
  };
  crop?: CropRegion | undefined;
};

type FrameRenderEnvelope =
  | { status: 'ok'; frame: FrameRenderEvidence }
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

export function shouldUseRustVideoEvidenceEngine(): boolean {
  if (process.env.VIDEO_READER_USE_RUST_FRAMES === '0') {
    return false;
  }
  if (process.env.VIDEO_READER_USE_RUST_FRAMES === '1') {
    return true;
  }
  return isRustCliAvailable();
}

function invokeRustFrameTool(
  tool: 'render_frame' | 'crop_frame',
  input: Record<string, unknown>
): { ok: true; frame: FrameRenderEvidence } | { ok: false; code: string; message: string } {
  const binary = resolveRustCliBinary();
  const payload = JSON.stringify({ tool, input });
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
      message:
        response.stderr || `Rust video evidence engine exited with status ${response.status}`,
    };
  }

  const envelope = JSON.parse(response.stdout) as FrameRenderEnvelope;
  if (envelope.status !== 'ok') {
    return {
      ok: false,
      code: envelope.code,
      message: envelope.message,
    };
  }

  return { ok: true, frame: envelope.frame };
}

export function renderFrameViaRustEngine(input: {
  videoPath: string;
  timeMs: number;
  maxDimension?: number | undefined;
}) {
  return invokeRustFrameTool('render_frame', {
    path: input.videoPath,
    time_ms: input.timeMs,
    ...(input.maxDimension !== undefined ? { max_dimension: input.maxDimension } : {}),
  });
}

export function cropFrameViaRustEngine(input: {
  videoPath: string;
  timeMs: number;
  crop: CropRegion;
  maxDimension?: number | undefined;
}) {
  return invokeRustFrameTool('crop_frame', {
    path: input.videoPath,
    time_ms: input.timeMs,
    crop: input.crop,
    ...(input.maxDimension !== undefined ? { max_dimension: input.maxDimension } : {}),
  });
}

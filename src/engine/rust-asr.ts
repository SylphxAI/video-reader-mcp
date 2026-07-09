import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TranscriptSegment } from '../types/timeline.js';

export type RustAsrResult = {
  transcript: TranscriptSegment[];
  route: string;
  adapter?: string;
  warning?: string;
};

type RustAsrEnvelope =
  | { status: 'ok'; asr: RustAsrResult }
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

export function shouldUseRustAsrEngine(): boolean {
  if (process.env.VIDEO_READER_USE_RUST_ASR === '0') {
    return false;
  }
  if (process.env.VIDEO_READER_USE_RUST_ASR === '1') {
    return true;
  }
  return isRustCliAvailable();
}

export function transcribeViaRustEngine(
  videoPath: string,
  maxAudioSeconds = 300
): { ok: true; result: RustAsrResult } | { ok: false; code: string; message: string } {
  const binary = resolveRustCliBinary();
  const payload = JSON.stringify({
    tool: 'transcribe_asr',
    input: {
      path: videoPath,
      max_audio_seconds: maxAudioSeconds,
    },
  });

  const response = spawnSync(binary, [], {
    input: payload,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
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
      message: response.stderr || `Rust ASR engine exited with status ${response.status}`,
    };
  }

  const envelope = JSON.parse(response.stdout) as RustAsrEnvelope;
  if (envelope.status !== 'ok') {
    return {
      ok: false,
      code: envelope.code,
      message: envelope.message,
    };
  }

  return { ok: true, result: envelope.asr };
}
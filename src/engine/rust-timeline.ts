import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FfprobeResult } from '../utils/ffprobe.js';

export type RustProbeTimeline = {
  format: {
    format_name?: string;
    duration_ms: number;
    bit_rate?: number;
    size_bytes?: number;
    tags?: Record<string, string>;
  };
  streams: Array<{
    index: number;
    codec_type: string;
    codec_name?: string;
    language?: string;
    channels?: number;
    sample_rate?: number;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    bit_rate?: number;
    disposition?: Record<string, number>;
    tags?: Record<string, string>;
  }>;
  chapters: Array<{
    id: number;
    start_ms: number;
    end_ms: number;
    title?: string;
  }>;
  warnings: string[];
  route: string;
};

type RustTimelineEnvelope =
  | { status: 'ok'; timeline: RustProbeTimeline }
  | { status: 'error'; code: string; message: string };

type RustHashEnvelope =
  | { status: 'ok'; source_hash: string }
  | { status: 'error'; code: string; message: string };

type RustCacheKeyEnvelope =
  | { status: 'ok'; cache_key: string }
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

export function shouldUseRustTimelineEngine(): boolean {
  return process.env.VIDEO_READER_USE_RUST_TIMELINE === '1';
}

const invokeRustCli = (tool: string, input: Record<string, unknown>): unknown => {
  const binary = resolveRustCliBinary();
  const payload = JSON.stringify({ tool, input });

  const result = spawnSync(binary, [], {
    input: payload,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Failed to launch video timeline engine: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || `Video timeline engine exited with status ${result.status}`);
  }

  return JSON.parse(result.stdout) as unknown;
};

export function assembleProbeTimelineViaRustEngine(
  probe: FfprobeResult,
  options: { includeStreams: boolean; includeChapters: boolean }
): RustProbeTimeline {
  const envelope = invokeRustCli('assemble_probe_timeline', {
    ffprobe: probe,
    options: {
      include_streams: options.includeStreams,
      include_chapters: options.includeChapters,
    },
  }) as RustTimelineEnvelope;

  if (envelope.status !== 'ok') {
    throw new Error(envelope.message);
  }

  return envelope.timeline;
}

export function hashSourceViaRustEngine(filePath: string): string {
  const envelope = invokeRustCli('hash_source', { path: filePath }) as RustHashEnvelope;
  if (envelope.status !== 'ok') {
    throw new Error(envelope.message);
  }

  return envelope.source_hash;
}

export function buildCacheKeyViaRustEngine(
  sourceHash: string,
  options: {
    includeStreams: boolean;
    includeChapters: boolean;
    includeSubtitles: boolean;
    includeScenes: boolean;
    includeTranscript: boolean;
    includeKeyframes: boolean;
    keyframeLimit: number;
    sceneThreshold: number;
  }
): string {
  const envelope = invokeRustCli('build_cache_key', {
    source_hash: sourceHash,
    options: {
      include_streams: options.includeStreams,
      include_chapters: options.includeChapters,
      include_subtitles: options.includeSubtitles,
      include_scenes: options.includeScenes,
      include_transcript: options.includeTranscript,
      include_keyframes: options.includeKeyframes,
      keyframe_limit: options.keyframeLimit,
      scene_threshold: options.sceneThreshold,
    },
  }) as RustCacheKeyEnvelope;

  if (envelope.status !== 'ok') {
    throw new Error(envelope.message);
  }

  return envelope.cache_key;
}

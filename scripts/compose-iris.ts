/**
 * Cue → Iris composition: structural keyframes from Cue, open-vocab objects
 * from Iris L2 semantics, merged by timestamp.
 *
 * Principle: structure in Cue, semantics in Iris, merge by time. No per-frame
 * VLM loop. Each keyframe is a structural-scene sample, not an N-second grid.
 *
 * Usage:
 *   IRIS_SEMANTICS_URL=http://127.0.0.1:8765 bun run compose:iris -- /abs/video.mp4 [--limit 8] [--prompt "animals"]
 */

import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { planStructuralKeyframeTimes } from '../src/utils/structuralKeyframes.js';
import { detectScenes } from '../src/utils/scenes.js';
import { isBinaryAvailable } from '../src/utils/exec.js';
import type { ComposedIrisResult, ComposedKeyframe, ComposedKeyframeObject } from '../src/types/composeIris.js';

const DEFAULT_SEMANTICS_URL = 'http://127.0.0.1:8765';
const SCENE_THRESHOLD = 0.4;
const DEFAULT_LIMIT = 8;

function parseArgs(argv: string[]): { video: string; limit: number; prompt?: string; out?: string } {
  let video = '';
  let limit = DEFAULT_LIMIT;
  let prompt: string | undefined;
  let out: string | undefined;
  const args = [...argv];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--prompt') { prompt = args[++i]; }
    else if (a === '--limit') { limit = Number.parseInt(args[++i] ?? '8', 10) || DEFAULT_LIMIT; }
    else if (a === '--out') { out = args[++i]; }
    else if (a && !a.startsWith('--')) { video = a; }
  }
  if (!video) throw new Error('missing video path argument');
  return { video, limit, prompt, out };
}

/** Render a single frame at time_ms to a temp PNG via ffmpeg. */
export async function renderFrame(videoPath: string, timeMs: number, outPath: string, maxDimension = 512): Promise<void> {
  const ffmpeg = await isBinaryAvailable('ffmpeg');
  if (!ffmpeg) throw new Error('ffmpeg is required for compose-iris');
  const { execBinary } = await import('../src/utils/exec.js');
  const sec = (timeMs / 1000).toFixed(3);
  await execBinary('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-ss', sec, '-i', videoPath,
    '-frames:v', '1',
    '-vf', `scale='min(${maxDimension},iw)':'min(${maxDimension},ih)':force_original_aspect_ratio=decrease`,
    '-y', outPath,
  ], { timeoutMs: 120_000 });
}

export interface IrisSidecarResponse {
  caption?: string;
  model?: string;
  objects?: ComposedKeyframeObject[];
  warnings?: string[];
}

/** Query Iris semantics via the IRIS_SEMANTICS_URL contract (Florence-sidecar / adapter). */
export async function queryIrisSemantics(input: {
  path: string;
  mime: string;
  url: string;
  prompt?: string;
}): Promise<IrisSidecarResponse> {
  const res = await fetch(input.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: input.path, mime: input.mime, purpose: 'image_semantics', prompt: input.prompt }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`Iris semantics HTTP ${res.status}`);
  }
  const body = (await res.json()) as IrisSidecarResponse;
  return body;
}

/** Build a composed object timeline. Pure; unit-tested with a fake semantics fn. */
export async function composeKeyframes(input: {
  videoPath: string;
  sceneTimesMs: number[];
  iframeTimesMs?: number[];
  limit?: number;
  semanticsUrl?: string;
  prompt?: string;
  semantics?: (request: { path: string; mime: string; url: string; prompt?: string }) => Promise<IrisSidecarResponse>;
  render?: (videoPath: string, timeMs: number, outPath: string) => Promise<void>;
}): Promise<ComposedIrisResult> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const plan = planStructuralKeyframeTimes({
    durationMs: undefined,
    sceneTimesMs: input.sceneTimesMs,
    iframeTimesMs: input.iframeTimesMs ?? [],
    limit,
  });
  const url = input.semanticsUrl ?? process.env.IRIS_SEMANTICS_URL ?? DEFAULT_SEMANTICS_URL;
  const semantics =
    input.semantics ?? ((req) => queryIrisSemantics(req));
  const renders = input.render ?? ((v, t, p) => renderFrame(v, t, p));

  const warnings: string[] = [...plan.notes];
  const keyframes: ComposedKeyframe[] = [];
  let totalObjects = 0;

  const tmp = await mkdtemp(join(tmpdir(), 'cue-compose-iris-'));
  for (let i = 0; i < plan.times_ms.length; i++) {
    const timeMs = plan.times_ms[i];
    if (timeMs === undefined) continue;
    const framePath = join(tmp, `frame_${String(i).padStart(3, '0')}.png`);
    try {
      await renders(input.videoPath, timeMs, framePath);
      const remote = await semantics({ path: framePath, mime: 'image/png', url, prompt: input.prompt });
      const objects = Array.isArray(remote.objects) ? remote.objects : [];
      totalObjects += objects.length;
      keyframes.push({
        time_ms: timeMs,
        frame: basename(framePath),
        semantics_available: true,
        objects,
        ...(remote.caption ? { caption: remote.caption } : {}),
        ...(remote.model ? { model: remote.model } : {}),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`keyframe@${timeMs}ms: ${message}`);
      keyframes.push({
        time_ms: timeMs,
        frame: '',
        semantics_available: false,
        skipped_reason: message,
        objects: [],
      });
    }
  }

  const result: ComposedIrisResult = {
    policy: 'cue_compose_iris_v1',
    video: basename(input.videoPath),
    keyframe_policy: plan.policy,
    generated_at: new Date().toISOString(),
    keyframe_count: keyframes.length,
    total_objects: totalObjects,
    keyframes,
    warnings,
  };

  const out = input.out ?? process.env.COMPOSE_IRIS_OUT;
  if (out) {
    await mkdir(join(process.cwd(), dirnameOf(out)), { recursive: true });
    const target = isAbsoluteOf(out) ? out : join(process.cwd(), out);
    await writeFile(target, JSON.stringify(result, null, 2));
  }
  return result;
}

function dirnameOf(p: string): string { return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.'; }
function isAbsoluteOf(p: string): boolean { return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p); }

async function main(): Promise<void> {
  const { video, limit, prompt, out } = parseArgs(process.argv.slice(2));
  const scenes = await detectScenes(video, SCENE_THRESHOLD);
  const result = await composeKeyframes({
    videoPath: video,
    sceneTimesMs: scenes.scenes.map((s) => s.time_ms),
    limit,
    prompt,
    semanticsUrl: process.env.IRIS_SEMANTICS_URL ?? DEFAULT_SEMANTICS_URL,
    out,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.warnings.some((w) => w.startsWith('keyframe@'))) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`compose-iris failed: ${message}\n`);
    process.exit(1);
  });
}

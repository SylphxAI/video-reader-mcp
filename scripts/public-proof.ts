#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cue } from '../src/sdk.ts';
import { isBinaryAvailable } from '../src/utils/exec.ts';

function unwrapPayload(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {};
  const r = result as { type?: string; text?: string; content?: { type: string; text?: string }[] };
  let text: string | undefined;
  if (r.type === 'text' && typeof r.text === 'string') text = r.text;
  else if (Array.isArray(r.content)) text = r.content.find((c) => c.type === 'text')?.text;
  if (!text) return result as Record<string, unknown>;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return result as Record<string, unknown>;
  }
}

const root = join(import.meta.dir, '..');
const sample = join(root, 'test/fixtures/no-subtitle.mp4');
const outDir = process.env.MCP_VIDEO_BENCHMARK_OUTPUT_DIR
  ? join(root, process.env.MCP_VIDEO_BENCHMARK_OUTPUT_DIR)
  : join(root, 'benchmark-artifacts');

if (!existsSync(sample)) {
  console.error('missing fixture', sample);
  process.exit(1);
}

const ffprobe = await isBinaryAvailable('ffprobe');
const ffmpeg = await isBinaryAvailable('ffmpeg');
const started = performance.now();
let ok = false;
let error: string | undefined;
let answerPreview = '';
let hasDuration = false;
let signals: Record<string, unknown> = {};
try {
  const result = await Cue.create().read({
    path: sample,
    include_subtitles: true,
    include_scenes: true,
  } as { path: string; include_subtitles: boolean; include_scenes: boolean });
  const parsed = unwrapPayload(result);
  const raw = JSON.stringify(parsed);
  answerPreview = raw.slice(0, 800);
  hasDuration = /duration/i.test(raw);
  const docs = parsed.documents;
  const doc = Array.isArray(docs) && docs[0] && typeof docs[0] === 'object'
    ? (docs[0] as Record<string, unknown>)
    : parsed;
  const d = doc;
  signals = {
    hasStreams: Boolean(d.streams ?? parsed.streams),
    chapterCount: Array.isArray(d.chapters) ? d.chapters.length : Array.isArray(parsed.chapters) ? parsed.chapters.length : 0,
    subtitleCount: Array.isArray(d.subtitles) ? d.subtitles.length : Array.isArray(parsed.subtitles) ? parsed.subtitles.length : 0,
    sceneCount: Array.isArray(d.scenes) ? d.scenes.length : Array.isArray(parsed.scenes) ? parsed.scenes.length : 0,
    warningCount: Array.isArray(d.warnings)
      ? d.warnings.length
      : Array.isArray(parsed.warnings)
        ? parsed.warnings.length
        : 0,
    route: d.route ?? parsed.route ?? null,
  };
  ok = result != null && (ffprobe ? hasDuration || answerPreview.length > 50 : true);
  if (!ffprobe) {
    ok = result != null;
  }
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
  ok = false;
}
const ms = performance.now() - started;
const report = {
  product: 'Cue',
  sample,
  ms,
  ok,
  error,
  ffprobeAvailable: ffprobe,
  ffmpegAvailable: ffmpeg,
  hasDurationSignal: hasDuration,
  timelineSignals: signals,
  honesty: {
    ffprobe: ffprobe ? 'present' : 'absent — full timeline path unavailable',
    ffmpeg: ffmpeg ? 'present' : 'absent — subtitle/scene extraction may skip with warnings',
  },
  answerPreviewBytes: answerPreview.length,
  hasSkill: existsSync(join(root, 'skills/cue/SKILL.md')),
  brandPublishDoc: existsSync(join(root, 'docs/BRAND_PUBLISH.md')),
  generatedAt: new Date().toISOString(),
};
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'cue_public_proof.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 1);

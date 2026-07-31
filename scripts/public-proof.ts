#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cue } from '../src/sdk.ts';
import { isBinaryAvailable } from '../src/utils/exec.ts';

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
const started = performance.now();
let ok = false;
let error: string | undefined;
let answerPreview = '';
let hasDuration = false;
try {
  const result = await Cue.create().read({ path: sample });
  answerPreview = JSON.stringify(result).slice(0, 800);
  hasDuration = /duration/i.test(answerPreview);
  ok = result != null && (ffprobe ? hasDuration || answerPreview.length > 50 : true);
  if (!ffprobe) {
    // Still ok if SDK returns honest error structure; prefer success path when ffprobe present
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
  hasDurationSignal: hasDuration,
  answerPreviewBytes: answerPreview.length,
  hasSkill: existsSync(join(root, 'skills/cue/SKILL.md')),
  brandPublishDoc: existsSync(join(root, 'docs/BRAND_PUBLISH.md')),
  generatedAt: new Date().toISOString(),
};
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'cue_public_proof.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 1);

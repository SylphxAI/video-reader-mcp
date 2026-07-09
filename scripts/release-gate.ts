import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { runDoctor } from '../src/doctor.js';
import { transcribeViaRustEngine } from '../src/engine/rust-asr.js';
import { buildTimelineDocument } from '../src/video/readCoordinator.js';
import { isBinaryAvailable } from '../src/utils/exec.js';

const ARTIFACT_DIR_ENV = 'MCP_VIDEO_BENCHMARK_OUTPUT_DIR';
const DEFAULT_ARTIFACT_DIR = 'benchmark-artifacts';
const ARTIFACT_FILE = 'video_reader_release_gate.json';

type GateStatus = 'passed' | 'failed';

interface GateCheck {
  id: string;
  status: GateStatus;
  message: string;
  evidence?: Record<string, unknown>;
}

interface ReleaseGateReport {
  profile: 'video_reader_release_gate';
  generated_at: string;
  artifact_dir: string;
  status: GateStatus;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  checks: GateCheck[];
}

const repoRoot = path.resolve(import.meta.dirname, '..');

const addCheck = (
  checks: GateCheck[],
  id: string,
  passed: boolean,
  message: string,
  evidence?: Record<string, unknown>
): void => {
  checks.push({
    id,
    status: passed ? 'passed' : 'failed',
    message,
    ...(evidence ? { evidence } : {}),
  });
};

const fileExists = (relativePath: string): boolean =>
  existsSync(path.join(repoRoot, relativePath));

const readJson = (relativePath: string): unknown =>
  JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));

export async function buildReleaseGateReport(artifactDir: string): Promise<ReleaseGateReport> {
  const checks: GateCheck[] = [];
  const pkg = readJson('package.json') as { version: string; bin?: Record<string, string> };
  const manifest = readJson('test/fixtures/corpus-manifest.json') as {
    profile: string;
    cases: Array<{ id: string }>;
  };

  addCheck(
    checks,
    'package:read_video_bin',
    typeof pkg.bin?.['video-reader-mcp'] === 'string',
    'package.json exposes the video-reader-mcp bin entry',
    { bin: pkg.bin?.['video-reader-mcp'] }
  );

  addCheck(
    checks,
    'fixtures:corpus_manifest',
    manifest.profile === 'video_reader_fixture_corpus' && manifest.cases.length >= 5,
    'Fixture corpus manifest documents subtitle, no-subtitle, multi-stream, corrupted, and long-sample cases',
    { caseCount: manifest.cases.length }
  );

  for (const caseId of [
    'no-subtitle',
    'multi-stream',
    'subtitle-stream',
    'corrupted-truncated',
    'long-sample',
  ]) {
    addCheck(
      checks,
      `fixtures:case:${caseId}`,
      manifest.cases.some((entry) => entry.id === caseId),
      `Corpus manifest includes the ${caseId} case`
    );
  }

  addCheck(
    checks,
    'fixtures:probe_multi_stream',
    fileExists('test/fixtures/probes/multi-stream.json'),
    'Deterministic ffprobe fixture exists for multi-stream parsing'
  );

  addCheck(
    checks,
    'fixtures:probe_no_subtitle',
    fileExists('test/fixtures/probes/no-subtitle.json'),
    'Deterministic ffprobe fixture exists for no-subtitle parsing'
  );

  addCheck(
    checks,
    'examples:read_video_request',
    fileExists('examples/read-video-request.json'),
    'examples/read-video-request.json documents a read_video call'
  );

  addCheck(
    checks,
    'rust:timeline_core',
    fileExists('crates/video-reader-core/src/timeline.rs'),
    'Rust video-reader-core timeline assembly engine is present'
  );

  addCheck(
    checks,
    'rust:hash_policy',
    fileExists('crates/video-reader-core/src/hash.rs'),
    'Rust video-reader-core hash and cache policy engine is present'
  );

  addCheck(
    checks,
    'rust:asr_core',
    fileExists('crates/video-reader-core/src/asr.rs'),
    'Rust video-reader-core ASR orchestration engine is present'
  );

  const asrResponse = transcribeViaRustEngine(
    path.join(repoRoot, 'test/fixtures/no-subtitle.mp4')
  );
  addCheck(
    checks,
    'boundary:transcribe_asr',
    !asrResponse.ok && asrResponse.code === 'ADAPTER_UNAVAILABLE',
    'transcribe_asr returns a structured adapter-unavailable envelope when whisper is not installed',
    asrResponse.ok
      ? { route: asrResponse.result.route }
      : { code: asrResponse.code, message: asrResponse.message }
  );

  addCheck(
    checks,
    'evidence:frame_extractor',
    fileExists('src/utils/frames.ts'),
    'ffmpeg keyframe evidence extractor is present for Phase 2 frame follow-up'
  );

  const doctor = await runDoctor(pkg.version);
  addCheck(
    checks,
    'doctor:ffprobe',
    doctor.checks.find((check) => check.id === 'ffprobe')?.status === 'ok',
    'doctor reports ffprobe is available for timeline probing',
    { doctorStatus: doctor.status }
  );

  const ffmpegAvailable = await isBinaryAvailable('ffmpeg');
  const ffprobeAvailable = await isBinaryAvailable('ffprobe');
  let keyframeCount = 0;
  if (ffmpegAvailable && ffprobeAvailable) {
    try {
      execSync(
        `ffmpeg -hide_banner -y -f lavfi -i color=c=blue:s=160x120:d=2 -c:v libx264 -pix_fmt yuv420p ${path.join(repoRoot, 'test/fixtures/no-subtitle.mp4')}`,
        { stdio: 'pipe', timeout: 60_000 }
      );
      const document = await buildTimelineDocument(
        path.join(repoRoot, 'test/fixtures/no-subtitle.mp4'),
        {
          sources: [{ path: path.join(repoRoot, 'test/fixtures/no-subtitle.mp4') }],
          include_scenes: false,
          include_subtitles: false,
          include_transcript: false,
          include_keyframes: true,
          keyframe_limit: 4,
        },
        pkg.version
      );
      keyframeCount = document.keyframes.length;
    } catch {
      keyframeCount = 0;
    }
  }

  addCheck(
    checks,
    'boundary:keyframe_index',
    ffmpegAvailable && ffprobeAvailable && keyframeCount > 0,
    'read_video include_keyframes returns reproducible I-frame locators when ffmpeg is available',
    { keyframeCount, ffmpegAvailable, ffprobeAvailable }
  );

  const passed = checks.filter((check) => check.status === 'passed').length;
  const failed = checks.length - passed;

  return {
    profile: 'video_reader_release_gate',
    generated_at: new Date().toISOString(),
    artifact_dir: artifactDir,
    status: failed === 0 ? 'passed' : 'failed',
    summary: {
      total: checks.length,
      passed,
      failed,
    },
    checks,
  };
}

async function main(): Promise<void> {
  const artifactDir = path.resolve(
    process.env[ARTIFACT_DIR_ENV] ?? path.join(repoRoot, DEFAULT_ARTIFACT_DIR)
  );

  const report = await buildReleaseGateReport(artifactDir);
  mkdirSync(artifactDir, { recursive: true });
  const outputPath = path.join(artifactDir, ARTIFACT_FILE);

  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.error(`Video reader release gate report written to ${outputPath}`);

  if (report.status !== 'passed') {
    for (const check of report.checks.filter((entry) => entry.status === 'failed')) {
      console.error(`[FAILED] ${check.id}: ${check.message}`);
    }
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
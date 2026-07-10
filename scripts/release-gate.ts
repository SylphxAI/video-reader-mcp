import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { runDoctor } from '../src/doctor.js';
import { transcribeViaRustEngine } from '../src/engine/rust-asr.js';
import { extractKeyframesViaRustEngine } from '../src/engine/rust-frames.js';
import {
  cropFrameViaRustEngine,
  renderFrameViaRustEngine,
} from '../src/engine/rust-video-evidence.js';
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
  const pkg = readJson('package.json') as { version: string; bin?: Record<string, string>; dependencies?: Record<string, string> };
  // Ensure generated corpus video exists for boundary checks that run before ffmpeg-gated keyframe block.
  const earlyFixtureVideo = path.join(repoRoot, 'test/fixtures/no-subtitle.mp4');
  if (!fileExists('test/fixtures/no-subtitle.mp4')) {
    try {
      execSync(
        `ffmpeg -hide_banner -y -f lavfi -i color=c=blue:s=160x120:d=2 -c:v libx264 -pix_fmt yuv420p ${earlyFixtureVideo}`,
        { stdio: 'pipe', timeout: 60_000 }
      );
    } catch {
      // leave missing; later checks will record structured failure
    }
  }

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

  addCheck(
    checks,
    'rust:frames_core',
    fileExists('crates/video-reader-core/src/frames.rs'),
    'Rust video-reader-core keyframe PNG evidence engine is present'
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

  addCheck(
    checks,
    'evidence:video_evidence_handler',
    fileExists('src/handlers/videoEvidence.ts') && fileExists('src/schemas/videoEvidence.ts'),
    'video_evidence MCP handler and schema are present for Phase 2 frame follow-up'
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
  const fixtureVideo = path.join(repoRoot, 'test/fixtures/no-subtitle.mp4');
  let keyframeCount = 0;
  let keyframeHash: string | undefined;
  if (ffmpegAvailable && ffprobeAvailable) {
    try {
      execSync(
        `ffmpeg -hide_banner -y -f lavfi -i color=c=blue:s=160x120:d=2 -c:v libx264 -pix_fmt yuv420p ${fixtureVideo}`,
        { stdio: 'pipe', timeout: 60_000 }
      );
      const document = await buildTimelineDocument(
        fixtureVideo,
        {
          sources: [{ path: fixtureVideo }],
          include_scenes: false,
          include_subtitles: false,
          include_transcript: false,
          include_keyframes: true,
          include_keyframe_images: true,
          keyframe_limit: 4,
          keyframe_max_dimension: 120,
        },
        pkg.version
      );
      keyframeCount = document.keyframes.length;
      keyframeHash = document.keyframes[0]?.frame_hash;
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

  const keyframeResponse = extractKeyframesViaRustEngine({
    videoPath: fixtureVideo,
    limit: 2,
    includeImages: true,
    maxDimension: 120,
  });
  addCheck(
    checks,
    'boundary:keyframe_png',
    ffmpegAvailable &&
      keyframeResponse.ok &&
      (keyframeResponse.keyframes[0]?.frame_hash?.length ?? 0) > 0,
    'extract_keyframes returns citeable PNG evidence from the Rust CLI when ffmpeg is available',
    keyframeResponse.ok
      ? {
          route: keyframeResponse.keyframes[0]?.route,
          frameHash: keyframeResponse.keyframes[0]?.frame_hash,
        }
      : {
          code: keyframeResponse.ok ? undefined : keyframeResponse.code,
          message: keyframeResponse.ok ? undefined : keyframeResponse.message,
          keyframeHash,
        }
  );

  const renderFrameResponse = renderFrameViaRustEngine({
    videoPath: fixtureVideo,
    timeMs: 0,
    maxDimension: 120,
  });
  addCheck(
    checks,
    'boundary:video_evidence_render_frame',
    ffmpegAvailable &&
      renderFrameResponse.ok &&
      renderFrameResponse.frame.route === 'rust-frame-render' &&
      renderFrameResponse.frame.frame_hash.length > 0,
    'render_frame returns citeable PNG evidence from the Rust CLI when ffmpeg is available',
    renderFrameResponse.ok
      ? {
          route: renderFrameResponse.frame.route,
          frameHash: renderFrameResponse.frame.frame_hash,
        }
      : {
          code: renderFrameResponse.ok ? undefined : renderFrameResponse.code,
          message: renderFrameResponse.ok ? undefined : renderFrameResponse.message,
        }
  );

  const cropFrameResponse = cropFrameViaRustEngine({
    videoPath: fixtureVideo,
    timeMs: 0,
    crop: { x: 10, y: 10, width: 80, height: 60 },
    maxDimension: 120,
  });
  addCheck(
    checks,
    'boundary:video_evidence_crop_frame',
    ffmpegAvailable &&
      cropFrameResponse.ok &&
      cropFrameResponse.frame.route === 'rust-frame-crop' &&
      cropFrameResponse.frame.frame_hash.length > 0,
    'crop_frame returns citeable cropped PNG evidence from the Rust CLI when ffmpeg is available',
    cropFrameResponse.ok
      ? {
          route: cropFrameResponse.frame.route,
          frameHash: cropFrameResponse.frame.frame_hash,
        }
      : {
          code: cropFrameResponse.ok ? undefined : cropFrameResponse.code,
          message: cropFrameResponse.ok ? undefined : cropFrameResponse.message,
        }
  );

  const binWrapper = readFileSync(path.join(repoRoot, 'bin/video-reader-mcp'), 'utf8');
  addCheck(
    checks,
    'mcp:rust_adapter_default',
    binWrapper.includes('video-reader-mcp-server') &&
      binWrapper.includes('resolve_rust_bin') &&
      binWrapper.includes('use_ts_transport'),
    'Default npm bin launches the Rust rmcp MCP server; TypeScript adapter is opt-in only'
  );

  const matrixProbe = spawnSync('bun', ['test', 'test/shippedPath.matrix.test.ts'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      VIDEO_READER_ALLOW_LEGACY_ENGINE: '',
    },
    timeout: 300_000,
  });
  addCheck(
    checks,
    'boundary:rust_cli_engine',
    fileExists('crates/video-reader-mcp-server/src/tool_routes.rs') && matrixProbe.status === 0,
    'Shipped-path matrix test proves primary tools route through Rust core without legacy runtime',
    matrixProbe.status === 0
      ? { exitCode: 0 }
      : {
          exitCode: matrixProbe.status,
          stderr: matrixProbe.stderr?.slice(-2000),
          stdout: matrixProbe.stdout?.slice(-2000),
        }
  );

  try {
    execSync('cargo build --release -p video-reader-mcp-server', {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 300_000,
    });
    addCheck(
      checks,
      'rust:mcp_server_crate',
      fileExists('target/release/video-reader-mcp-server'),
      'video-reader-mcp-server rmcp crate builds for release'
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    addCheck(checks, 'rust:mcp_server_crate', false, `video-reader-mcp-server build failed: ${message}`);
  }

  addCheck(
    checks,
    'contract:reader_evidence_dep',
    typeof pkg.dependencies?.['@sylphx/reader-evidence'] === 'string' &&
      (fileExists('node_modules/@sylphx/reader-evidence/src/envelope.ts') ||
        fileExists('node_modules/@sylphx/reader-evidence/src/index.ts')),
    'video-reader depends on @sylphx/reader-evidence shared schema package',
    { dependency: pkg.dependencies?.['@sylphx/reader-evidence'] }
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
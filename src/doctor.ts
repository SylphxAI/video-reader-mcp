import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRustCliBinary } from './engine/rust-timeline.js';
import { isBinaryAvailable } from './utils/exec.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export type DoctorStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  message: string;
}

export interface DoctorReport {
  profile: 'video_reader_doctor';
  version: string;
  status: 'ready' | 'degraded' | 'unavailable';
  checks: DoctorCheck[];
}

const probeBinary = async (id: string, binary: string, required: boolean): Promise<DoctorCheck> => {
  const available = await isBinaryAvailable(binary);
  if (available) {
    return {
      id,
      status: 'ok',
      message: `${binary} is installed and responds to -version.`,
    };
  }

  return {
    id,
    status: required ? 'fail' : 'warn',
    message: required
      ? `${binary} is required for read_video but was not found on PATH.`
      : `${binary} is optional for some extraction paths.`,
  };
};

const probeRustTimelineCli = (): DoctorCheck => {
  const binary = resolveRustCliBinary();
  if (binary !== 'video-reader-cli' && existsSync(binary)) {
    const probe = spawnSync(binary, [], {
      input: JSON.stringify({
        tool: 'build_cache_key',
        input: {
          source_hash: 'abc123',
          options: { include_streams: true, include_chapters: true },
        },
      }),
      encoding: 'utf8',
      timeout: 5_000,
    });

    if (probe.status === 0) {
      return {
        id: 'rust_timeline_cli',
        status: 'ok',
        message: `Rust timeline CLI is available at ${binary}.`,
      };
    }
  }

  const release = path.join(here, '../target/release/video-reader-cli');
  const debug = path.join(here, '../target/debug/video-reader-cli');
  if (existsSync(release) || existsSync(debug)) {
    return {
      id: 'rust_timeline_cli',
      status: 'ok',
      message: 'Rust timeline CLI is built locally.',
    };
  }

  return {
    id: 'rust_timeline_cli',
    status: 'warn',
    message:
      'Rust timeline CLI is not built. Run `cargo build --release` to enable VIDEO_READER_USE_RUST_TIMELINE=1.',
  };
};

const probeNode = (): DoctorCheck => {
  const version = process.versions.node;
  const major = Number.parseInt(version.split('.')[0] ?? '0', 10);
  if (major >= 22) {
    return {
      id: 'node',
      status: 'ok',
      message: `Node.js ${version} meets the >=22.13 requirement.`,
    };
  }

  return {
    id: 'node',
    status: 'warn',
    message: `Node.js ${version} is below the recommended >=22.13 runtime.`,
  };
};

const aggregateStatus = (checks: DoctorCheck[]): DoctorReport['status'] => {
  if (checks.some((check) => check.status === 'fail')) {
    return 'unavailable';
  }
  if (checks.some((check) => check.status === 'warn')) {
    return 'degraded';
  }
  return 'ready';
};

export async function runDoctor(version: string): Promise<DoctorReport> {
  const checks = [
    probeNode(),
    probeRustTimelineCli(),
    await probeBinary('ffprobe', 'ffprobe', true),
    await probeBinary('ffmpeg', 'ffmpeg', false),
  ];

  return {
    profile: 'video_reader_doctor',
    version,
    status: aggregateStatus(checks),
    checks,
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  return JSON.stringify(report, null, 2);
}

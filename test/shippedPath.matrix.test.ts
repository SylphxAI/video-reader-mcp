import { beforeAll, describe, expect, it } from 'bun:test';
import { execSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isBinaryAvailable } from '../src/utils/exec.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const rustCliBin = path.join(repoRoot, 'target/release/video-reader-cli');
const sampleMp4 = path.join(repoRoot, 'test/fixtures/no-subtitle.mp4');
const multiStreamProbe = path.join(repoRoot, 'test/fixtures/probes/multi-stream.json');

type CliEnvelope = {
  status?: string;
  code?: string;
  message?: string;
  engine?: string;
  route?: string;
  source_hash?: string;
  timeline?: { route?: string; streams?: unknown[] };
  results?: Array<{
    success?: boolean;
    timeline?: { provenance?: { assembly_route?: string; source_hash?: string } };
  }>;
  envelope?: {
    delegation?: { delegated_tool?: string; reader_package?: string };
    sourceHash?: string;
  };
};

const invokeCli = (tool: string, input: Record<string, unknown>, env: NodeJS.ProcessEnv) => {
  const probe = spawnSync(rustCliBin, [], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    input: JSON.stringify({ tool, input }),
    timeout: 30_000,
  });
  expect(probe.status).toBe(0);
  return JSON.parse(probe.stdout) as CliEnvelope;
};

describe('shipped path matrix (Rust core, no legacy flags)', () => {
  let fakeNodeEnv: NodeJS.ProcessEnv;
  let nodeInvokeLog: string;

  beforeAll(() => {
    execSync('bun run build:rust', { cwd: repoRoot, stdio: 'pipe', timeout: 300_000 });

    const probeDir = mkdtempSync(path.join(os.tmpdir(), 'video-reader-matrix-probe-'));
    nodeInvokeLog = path.join(probeDir, 'node-invoke.log');
    const fakeNode = path.join(probeDir, 'node');
    writeFileSync(
      fakeNode,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >> "${nodeInvokeLog}"\nexit 99\n`
    );
    chmodSync(fakeNode, 0o755);

    fakeNodeEnv = {
      ...process.env,
      VIDEO_READER_NODE: fakeNode,
      VIDEO_READER_ALLOW_LEGACY_ENGINE: '',
      VIDEO_READER_MCP_TRANSPORT: '',
    };
  }, 300_000);

  it('hash_source routes through video-reader-core without legacy runtime', () => {
    const envelope = invokeCli('hash_source', { path: sampleMp4 }, fakeNodeEnv);
    expect(envelope.status).toBe('ok');
    expect(envelope.engine).toBe('video-reader-core');
    expect(envelope.source_hash?.length).toBe(64);
    expect(existsSync(nodeInvokeLog)).toBe(false);
  });

  it('assemble_probe_timeline returns rust-timeline without legacy runtime', () => {
    const ffprobe = JSON.parse(readFileSync(multiStreamProbe, 'utf8'));
    const envelope = invokeCli(
      'assemble_probe_timeline',
      {
        ffprobe,
        options: { include_streams: true, include_chapters: true },
      },
      fakeNodeEnv
    );
    expect(envelope.status).toBe('ok');
    expect(envelope.engine).toBe('video-reader-core');
    expect(envelope.timeline?.route).toBe('rust-timeline');
    expect(envelope.timeline?.streams?.length).toBe(3);
    expect(existsSync(nodeInvokeLog)).toBe(false);
  });

  it('read_video returns rust-read-video-v1 when ffprobe is available', async () => {
    if (!(await isBinaryAvailable('ffprobe')) || !existsSync(sampleMp4)) {
      return;
    }

    const envelope = invokeCli(
      'read_video',
      {
        sources: [{ path: sampleMp4 }],
        include_subtitles: false,
        include_scenes: false,
      },
      fakeNodeEnv
    );
    expect(envelope.status).toBe('ok');
    expect(envelope.route).toBe('rust-read-video-v1');
    expect(envelope.results?.[0]?.success).toBe(true);
    expect(envelope.results?.[0]?.timeline?.provenance?.assembly_route).toBe('rust-timeline');
    expect(envelope.results?.[0]?.timeline?.provenance?.source_hash?.length).toBe(64);
    expect(envelope.envelope?.delegation?.delegated_tool).toBe('read_video');
    expect(envelope.envelope?.delegation?.reader_package).toBe('@sylphx/video-reader-mcp');
    expect(envelope.envelope?.sourceHash?.length).toBe(64);
    expect(existsSync(nodeInvokeLog)).toBe(false);
  });

  it('video_evidence rejects ocr_frame on the default Rust route', () => {
    const probe = spawnSync(rustCliBin, [], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: fakeNodeEnv,
      input: JSON.stringify({
        tool: 'video_evidence',
        input: {
          operation: 'ocr_frame',
          sources: [{ path: sampleMp4, time_ms: 0 }],
        },
      }),
      timeout: 30_000,
    });
    expect(probe.status).toBe(0);
    const envelope = JSON.parse(probe.stdout) as CliEnvelope;
    expect(envelope.status).toBe('error');
    expect(existsSync(nodeInvokeLog)).toBe(false);
  });

  it('default bin resolves staged rmcp server', () => {
    const bin = path.join(repoRoot, 'bin/video-reader-mcp');
    expect(existsSync(bin)).toBe(true);
    const staged = path.join(repoRoot, 'bin/native/video-reader-mcp-server');
    expect(existsSync(staged)).toBe(true);
  });
});

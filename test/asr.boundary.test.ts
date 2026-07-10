import { beforeAll, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  isRustCliAvailable,
  shouldUseRustAsrEngine,
  transcribeViaRustEngine,
} from '../src/engine/rust-asr.js';
import { tryAsrTranscript } from '../src/utils/asr.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const fixturePath = path.join(import.meta.dirname, 'fixtures', 'no-subtitle.mp4');

describe('rust asr engine boundary', () => {
  beforeAll(() => {
    execSync('cargo build -q', { cwd: repoRoot, stdio: 'pipe', timeout: 120_000 });
  }, 120_000);

  it('defaults to the Rust CLI when it is built', () => {
    expect(isRustCliAvailable()).toBe(true);
    expect(shouldUseRustAsrEngine()).toBe(true);
  });

  it('returns a structured adapter warning when whisper is unavailable', async () => {
    const response = transcribeViaRustEngine(fixturePath);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.code).toBe('ADAPTER_UNAVAILABLE');
    }

    const asr = await tryAsrTranscript(fixturePath, true);
    expect(asr.transcript).toEqual([]);
    expect(asr.warning).toContain('whisper');
  });

  it('keeps ASR orchestration out of the TypeScript adapter sources', () => {
    const asrSrc = readFileSync(path.join(repoRoot, 'src/utils/asr.ts'), 'utf8');
    const engineSrc = readFileSync(path.join(repoRoot, 'src/engine/rust-asr.ts'), 'utf8');

    expect(engineSrc).toContain('spawnSync');
    expect(engineSrc).toContain('transcribe_asr');
    expect(asrSrc).toContain('transcribeViaRustEngine');
    expect(asrSrc).not.toMatch(/ffmpeg|parse_whisper|Command::new/i);
  });
});

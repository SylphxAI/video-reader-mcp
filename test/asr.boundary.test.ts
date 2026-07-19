import { beforeAll, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
    if (!existsSync(fixturePath)) {
      mkdirSync(path.dirname(fixturePath), { recursive: true });
      try {
        execSync(
          `ffmpeg -hide_banner -y -f lavfi -i color=c=blue:s=160x120:d=1 -c:v libx264 -pix_fmt yuv420p "${fixturePath}"`,
          { stdio: 'pipe', timeout: 60_000 }
        );
      } catch {
        writeFileSync(fixturePath, Buffer.from('video-reader-fixture-placeholder'));
      }
    }
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
});

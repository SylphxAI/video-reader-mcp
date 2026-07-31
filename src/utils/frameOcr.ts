import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type FrameOcrLine = {
  text: string;
  confidence?: number;
};

export type FrameOcrResult = {
  available: boolean;
  route: string;
  skipped_reason?: string;
  languages: string[];
  lines: FrameOcrLine[];
  line_count: number;
};

export const isTesseractAvailable = (): boolean => {
  const result = spawnSync('tesseract', ['--version'], {
    timeout: 2_500,
    windowsHide: true,
    stdio: 'ignore',
  });
  return result.status === 0;
};

/** OCR a PNG buffer (base64) with local Tesseract; honest skip when missing. */
export const ocrPngBase64 = (
  imageBase64: string,
  languages: string[] = ['eng'],
): FrameOcrResult => {
  const langs = languages.length ? languages : ['eng'];
  if (!isTesseractAvailable()) {
    return {
      available: false,
      route: 'tesseract_frame',
      skipped_reason: 'Tesseract is not installed or not available on PATH.',
      languages: langs,
      lines: [],
      line_count: 0,
    };
  }

  const dir = mkdtempSync(join(tmpdir(), 'cue-ocr-'));
  const pngPath = join(dir, 'frame.png');
  try {
    writeFileSync(pngPath, Buffer.from(imageBase64, 'base64'));
    const languageArg = langs.join('+');
    const result = spawnSync(
      'tesseract',
      [pngPath, 'stdout', '-l', languageArg, '--psm', '6'],
      {
        encoding: 'utf8',
        timeout: 60_000,
        windowsHide: true,
        maxBuffer: 5 * 1024 * 1024,
      },
    );
    if (result.error) {
      return {
        available: false,
        route: 'tesseract_frame',
        skipped_reason: `Tesseract failed to start: ${result.error.message}`,
        languages: langs,
        lines: [],
        line_count: 0,
      };
    }
    if (result.status !== 0) {
      const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
      return {
        available: false,
        route: 'tesseract_frame',
        skipped_reason:
          stderr.length > 0 ? stderr : `Tesseract exited with status ${String(result.status)}.`,
        languages: langs,
        lines: [],
        line_count: 0,
      };
    }
    const text = typeof result.stdout === 'string' ? result.stdout : '';
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => ({ text: line }));
    return {
      available: true,
      route: 'tesseract_frame',
      languages: langs,
      lines,
      line_count: lines.length,
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
};

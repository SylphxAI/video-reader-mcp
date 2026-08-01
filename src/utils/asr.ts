import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldUseRustAsrEngine, transcribeViaRustEngine } from '../engine/rust-asr.js';
import type { TranscriptSegment } from '../types/timeline.js';
import { execBinary, isBinaryAvailable } from './exec.js';

const ASR_CANDIDATES = ['whisper-cli', 'whisper-cpp', 'whisper', 'vosk-transcriber'] as const;

export const detectAsrAdapter = async (): Promise<string | null> => {
  for (const candidate of ASR_CANDIDATES) {
    if (await isBinaryAvailable(candidate)) {
      return candidate;
    }
  }
  return null;
};

/** Parse whisper.txt style lines: [00:00.000 --> 00:01.000] text */
export function parseWhisperTxt(raw: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const re =
    /\[(\d{1,2}:)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]\s*(.+)/g;
  const toMs = (h: string | undefined, min: string, sec: string, ms: string | undefined) => {
    const hours = h ? Number.parseInt(h.replace(':', ''), 10) : 0;
    const minutes = Number.parseInt(min, 10);
    const seconds = Number.parseInt(sec, 10);
    const millis = ms ? Number.parseInt(ms.padEnd(3, '0').slice(0, 3), 10) : 0;
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
  };
  let m = re.exec(raw);
  while (m !== null) {
    const start = toMs(m[1], m[2] ?? '0', m[3] ?? '0', m[4]);
    const end = toMs(m[5], m[6] ?? '0', m[7] ?? '0', m[8]);
    const text = (m[9] ?? '').trim();
    if (text) {
      segments.push({
        start_ms: start,
        end_ms: end,
        text,
        provenance: { method: 'asr_adapter', adapter: 'whisper-cli' },
      });
    }
    m = re.exec(raw);
  }
  if (segments.length === 0) {
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('['));
    lines.forEach((text, i) => {
      segments.push({
        start_ms: i * 1000,
        end_ms: (i + 1) * 1000,
        text,
        provenance: { method: 'asr_adapter', adapter: 'whisper-cli' },
      });
    });
  }
  return segments;
}

async function extractWavMono16k(
  videoPath: string
): Promise<{ wavPath: string; dir: string } | { error: string }> {
  const ffmpegOk = await isBinaryAvailable('ffmpeg');
  if (!ffmpegOk) {
    return { error: 'ffmpeg required to extract audio for local whisper ASR' };
  }
  const dir = mkdtempSync(join(tmpdir(), 'cue-asr-'));
  const wavPath = join(dir, 'audio.wav');
  try {
    await execBinary(
      'ffmpeg',
      ['-hide_banner', '-y', '-i', videoPath, '-ac', '1', '-ar', '16000', '-f', 'wav', wavPath],
      { timeoutMs: 300_000 }
    );
    return { wavPath, dir };
  } catch (error: unknown) {
    rmSync(dir, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}

/** Local-first frontier ASR: whisper-cli/whisper.cpp on PATH (no cloud). */
export async function runLocalWhisperTranscript(
  videoPath: string,
  adapter: string
): Promise<{ transcript: TranscriptSegment[]; warning?: string }> {
  const wav = await extractWavMono16k(videoPath);
  if ('error' in wav) {
    return { transcript: [], warning: `ASR audio extract failed: ${wav.error}` };
  }

  const outBase = join(wav.dir, 'out');
  const model = process.env.CUE_WHISPER_MODEL ?? process.env.WHISPER_MODEL ?? '';
  const args: string[] = ['-f', wav.wavPath, '-otxt', '-of', outBase];
  if (model) args.push('-m', model);

  try {
    const result = spawnSync(adapter, args, {
      encoding: 'utf8',
      timeout: 600_000,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    if (result.status !== 0) {
      const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
      return {
        transcript: [],
        warning: `Local ASR (${adapter}) failed: ${stderr || `exit ${String(result.status)}`}`,
      };
    }
    let raw = '';
    try {
      raw = readFileSync(`${outBase}.txt`, 'utf8');
    } catch {
      raw = typeof result.stdout === 'string' ? result.stdout : '';
    }
    const transcript = parseWhisperTxt(raw).map((seg) => ({
      ...seg,
      provenance: { method: 'asr_adapter' as const, adapter },
    }));
    if (transcript.length === 0) {
      return { transcript: [], warning: `Local ASR (${adapter}) produced empty transcript` };
    }
    return { transcript };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { transcript: [], warning: `Local ASR (${adapter}) error: ${message}` };
  } finally {
    rmSync(wav.dir, { recursive: true, force: true });
  }
}

export const tryAsrTranscript = async (
  videoPath: string,
  enabled: boolean
): Promise<{ transcript: TranscriptSegment[]; warning?: string }> => {
  if (!enabled) {
    return { transcript: [] };
  }

  if (shouldUseRustAsrEngine()) {
    const response = transcribeViaRustEngine(videoPath);
    if (response.ok) {
      return {
        transcript: response.result.transcript,
        ...(response.result.warning ? { warning: response.result.warning } : {}),
      };
    }
    if (response.code !== 'ADAPTER_UNAVAILABLE') {
      return {
        transcript: [],
        warning: `ASR transcription failed: ${response.message}`,
      };
    }
  }

  const adapter = await detectAsrAdapter();
  if (!adapter) {
    return {
      transcript: [],
      warning:
        'ASR requested but no local adapter found (checked whisper-cli, whisper-cpp, whisper, vosk-transcriber). Install whisper.cpp for local-first frontier ASR.',
    };
  }

  if (adapter === 'whisper-cli' || adapter === 'whisper-cpp' || adapter === 'whisper') {
    return runLocalWhisperTranscript(videoPath, adapter);
  }

  return {
    transcript: [],
    warning: `ASR adapter "${adapter}" detected but no local runner implemented for it yet.`,
  };
};

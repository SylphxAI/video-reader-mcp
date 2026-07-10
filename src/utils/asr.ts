import { shouldUseRustAsrEngine, transcribeViaRustEngine } from '../engine/rust-asr.js';
import type { TranscriptSegment } from '../types/timeline.js';
import { isBinaryAvailable } from './exec.js';

const ASR_CANDIDATES = ['whisper-cli', 'whisper-cpp', 'whisper', 'vosk-transcriber'] as const;

export const detectAsrAdapter = async (): Promise<string | null> => {
  for (const candidate of ASR_CANDIDATES) {
    if (await isBinaryAvailable(candidate)) {
      return candidate;
    }
  }
  return null;
};

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

    if (response.code === 'ADAPTER_UNAVAILABLE') {
      return {
        transcript: [],
        warning: `${response.message} Checked whisper-cli and whisper-cpp.`,
      };
    }

    return {
      transcript: [],
      warning: `ASR transcription failed: ${response.message}`,
    };
  }

  const adapter = await detectAsrAdapter();
  if (!adapter) {
    return {
      transcript: [],
      warning:
        'ASR requested but no local adapter found (checked whisper-cli, whisper-cpp, whisper, vosk-transcriber); transcript skipped.',
    };
  }

  return {
    transcript: [],
    warning: `ASR adapter "${adapter}" detected but Rust ASR engine is not enabled. Build video-reader-cli or set VIDEO_READER_USE_RUST_ASR=1.`,
  };
};

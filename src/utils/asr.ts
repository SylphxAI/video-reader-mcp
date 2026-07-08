import type { TranscriptSegment } from '../types/timeline.js';
import { isBinaryAvailable } from './exec.js';

const ASR_CANDIDATES = ['whisper', 'whisper-cpp', 'vosk-transcriber'] as const;

export const detectAsrAdapter = async (): Promise<string | null> => {
  for (const candidate of ASR_CANDIDATES) {
    if (await isBinaryAvailable(candidate)) {
      return candidate;
    }
  }
  return null;
};

export const tryAsrTranscript = async (
  _videoPath: string,
  enabled: boolean
): Promise<{ transcript: TranscriptSegment[]; warning?: string }> => {
  if (!enabled) {
    return { transcript: [] };
  }

  const adapter = await detectAsrAdapter();
  if (!adapter) {
    return {
      transcript: [],
      warning:
        'ASR requested but no local adapter found (checked whisper, whisper-cpp, vosk-transcriber); transcript skipped.',
    };
  }

  return {
    transcript: [],
    warning: `ASR adapter "${adapter}" detected but transcription is not wired in v0.1.0; transcript skipped.`,
  };
};
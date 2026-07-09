import type { FrameEvidence } from '../types/timeline.js';
import { execBinary, isBinaryAvailable } from './exec.js';

const KEYFRAME_PTS_TIME_RE = /pts_time:([0-9.]+)/g;

export const parseKeyframeFilterOutput = (stderr: string): FrameEvidence[] => {
  const keyframes: FrameEvidence[] = [];
  let match: RegExpExecArray | null;

  while ((match = KEYFRAME_PTS_TIME_RE.exec(stderr)) !== null) {
    const seconds = Number.parseFloat(match[1]);
    if (!Number.isFinite(seconds)) continue;

    keyframes.push({
      index: keyframes.length,
      time_ms: Math.round(seconds * 1000),
      provenance: {
        method: 'ffmpeg_keyframe_select',
        pict_type: 'I',
      },
    });
  }

  return keyframes;
};

export const extractKeyframes = async (
  videoPath: string,
  limit = 8
): Promise<{ keyframes: FrameEvidence[]; warning?: string }> => {
  const available = await isBinaryAvailable('ffmpeg');
  if (!available) {
    return {
      keyframes: [],
      warning: 'ffmpeg is not installed; keyframe index extraction skipped.',
    };
  }

  const boundedLimit = Math.max(1, Math.min(limit, 64));

  try {
    const { stderr } = await execBinary(
      'ffmpeg',
      [
        '-hide_banner',
        '-i',
        videoPath,
        '-vf',
        "select='eq(pict_type,I)',showinfo",
        '-vsync',
        'vfr',
        '-f',
        'null',
        '-',
      ],
      { timeoutMs: 300_000 }
    );

    const keyframes = parseKeyframeFilterOutput(stderr).slice(0, boundedLimit);
    return { keyframes };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      keyframes: [],
      warning: `Keyframe extraction failed: ${message}`,
    };
  }
};
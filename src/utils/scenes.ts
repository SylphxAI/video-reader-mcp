import type { SceneInfo } from '../types/timeline.js';
import { execBinary, isBinaryAvailable } from './exec.js';

const SCENE_PTS_TIME_RE = /pts_time:([0-9.]+)/g;

export const parseSceneFilterOutput = (stderr: string, threshold: number): SceneInfo[] => {
  const scenes: SceneInfo[] = [];
  let match: RegExpExecArray | null;

  while ((match = SCENE_PTS_TIME_RE.exec(stderr)) !== null) {
    const seconds = Number.parseFloat(match[1]);
    if (!Number.isFinite(seconds)) continue;

    scenes.push({
      index: scenes.length,
      time_ms: Math.round(seconds * 1000),
      provenance: {
        method: 'ffmpeg_scene_filter',
        threshold,
      },
    });
  }

  return scenes;
};

export const detectScenes = async (
  videoPath: string,
  threshold: number
): Promise<{ scenes: SceneInfo[]; warning?: string }> => {
  const available = await isBinaryAvailable('ffmpeg');
  if (!available) {
    return {
      scenes: [],
      warning: 'ffmpeg is not installed; scene detection skipped.',
    };
  }

  try {
    const { stderr } = await execBinary(
      'ffmpeg',
      [
        '-hide_banner',
        '-i',
        videoPath,
        '-vf',
        `select='gt(scene,${threshold})',showinfo`,
        '-f',
        'null',
        '-',
      ],
      { timeoutMs: 300_000 }
    );

    return { scenes: parseSceneFilterOutput(stderr, threshold) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      scenes: [],
      warning: `Scene detection failed: ${message}`,
    };
  }
};

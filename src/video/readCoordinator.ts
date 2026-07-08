import { access } from 'node:fs/promises';
import type { ReadVideoArgs } from '../schemas/readVideo.js';
import type { TimelineDocument, VideoSourceResult } from '../types/timeline.js';
import { tryAsrTranscript } from '../utils/asr.js';
import { extractSubtitles } from '../utils/ffmpeg.js';
import {
  collectProbeWarnings,
  findSubtitleStreams,
  mapChapters,
  mapStreams,
  runFfprobe,
  secondsToMs,
} from '../utils/ffprobe.js';
import { resolvePath } from '../utils/pathUtils.js';
import { detectScenes } from '../utils/scenes.js';

const DEFAULT_SCENE_THRESHOLD = 0.4;

export const buildTimelineDocument = async (
  sourcePath: string,
  args: ReadVideoArgs,
  version: string
): Promise<TimelineDocument> => {
  const includeStreams = args.include_streams ?? true;
  const includeChapters = args.include_chapters ?? true;
  const includeSubtitles = args.include_subtitles ?? true;
  const includeScenes = args.include_scenes ?? true;
  const includeTranscript = args.include_transcript ?? false;
  const sceneThreshold = args.scene_threshold ?? DEFAULT_SCENE_THRESHOLD;

  const warnings: string[] = [];
  const probe = await runFfprobe(sourcePath);

  warnings.push(...collectProbeWarnings(probe, includeStreams));

  const format = {
    ...(probe.format.format_name ? { format_name: probe.format.format_name } : {}),
    duration_ms: secondsToMs(probe.format.duration),
    ...(probe.format.bit_rate
      ? { bit_rate: Number.parseInt(probe.format.bit_rate, 10) }
      : {}),
    ...(probe.format.size ? { size_bytes: Number.parseInt(probe.format.size, 10) } : {}),
    ...(probe.format.tags ? { tags: probe.format.tags } : {}),
  };

  let subtitles: TimelineDocument['subtitles'] = [];
  if (includeSubtitles) {
    const subtitleStreams = findSubtitleStreams(probe.streams);
    const extracted = await extractSubtitles(sourcePath, subtitleStreams);
    subtitles = extracted.subtitles;
    warnings.push(...extracted.warnings);
  }

  let scenes: TimelineDocument['scenes'] = [];
  if (includeScenes) {
    const detected = await detectScenes(sourcePath, sceneThreshold);
    scenes = detected.scenes;
    if (detected.warning) warnings.push(detected.warning);
  }

  let transcript: TimelineDocument['transcript'] = [];
  if (includeTranscript) {
    const asr = await tryAsrTranscript(sourcePath, true);
    transcript = asr.transcript;
    if (asr.warning) warnings.push(asr.warning);
  }

  return {
    provenance: {
      source: sourcePath,
      tool: 'read_video',
      version,
      extracted_at: new Date().toISOString(),
    },
    format,
    streams: includeStreams ? mapStreams(probe.streams) : [],
    chapters: includeChapters ? mapChapters(probe.chapters) : [],
    scenes,
    subtitles,
    transcript,
    warnings,
  };
};

export const processVideoSource = async (
  userPath: string,
  args: ReadVideoArgs,
  version: string
): Promise<VideoSourceResult> => {
  try {
    const sourcePath = resolvePath(userPath);
    await access(sourcePath);

    const data = await buildTimelineDocument(sourcePath, args, version);
    return {
      source: userPath,
      success: true,
      data,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      source: userPath,
      success: false,
      error: message,
    };
  }
};
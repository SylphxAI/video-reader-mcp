import { access } from 'node:fs/promises';
import {
  assembleProbeTimelineViaRustEngine,
  buildCacheKeyViaRustEngine,
  hashSourceViaRustEngine,
  shouldUseRustTimelineEngine,
} from '../engine/rust-timeline.js';
import type { ReadVideoArgs } from '../schemas/readVideo.js';
import type { TimelineDocument, VideoSourceResult } from '../types/timeline.js';
import { tryAsrTranscript } from '../utils/asr.js';
import { extractSubtitles } from '../utils/ffmpeg.js';
import { extractKeyframes } from '../utils/frames.js';
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
const DEFAULT_KEYFRAME_LIMIT = 8;

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
  const includeKeyframes = args.include_keyframes ?? false;
  const keyframeLimit = args.keyframe_limit ?? DEFAULT_KEYFRAME_LIMIT;
  const sceneThreshold = args.scene_threshold ?? DEFAULT_SCENE_THRESHOLD;

  const warnings: string[] = [];
  const probe = await runFfprobe(sourcePath);

  let format: TimelineDocument['format'];
  let streams: TimelineDocument['streams'];
  let chapters: TimelineDocument['chapters'];
  let assemblyRoute = 'typescript-timeline-v1';
  let sourceHash: string | undefined;
  let cacheKey: string | undefined;

  if (shouldUseRustTimelineEngine()) {
    const assembled = assembleProbeTimelineViaRustEngine(probe, {
      includeStreams,
      includeChapters,
    });
    format = assembled.format;
    streams = assembled.streams;
    chapters = assembled.chapters;
    warnings.push(...assembled.warnings);
    assemblyRoute = assembled.route;
    sourceHash = hashSourceViaRustEngine(sourcePath);
    cacheKey = buildCacheKeyViaRustEngine(sourceHash, {
      includeStreams,
      includeChapters,
      includeSubtitles,
      includeScenes,
      includeTranscript,
      includeKeyframes,
      keyframeLimit,
      sceneThreshold,
    });
  } else {
    warnings.push(...collectProbeWarnings(probe, includeStreams));
    format = {
      ...(probe.format.format_name ? { format_name: probe.format.format_name } : {}),
      duration_ms: secondsToMs(probe.format.duration),
      ...(probe.format.bit_rate ? { bit_rate: Number.parseInt(probe.format.bit_rate, 10) } : {}),
      ...(probe.format.size ? { size_bytes: Number.parseInt(probe.format.size, 10) } : {}),
      ...(probe.format.tags ? { tags: probe.format.tags } : {}),
    };
    streams = includeStreams ? mapStreams(probe.streams) : [];
    chapters = includeChapters ? mapChapters(probe.chapters) : [];
  }

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

  let keyframes: TimelineDocument['keyframes'] = [];
  if (includeKeyframes) {
    const extracted = await extractKeyframes(sourcePath, keyframeLimit);
    keyframes = extracted.keyframes;
    if (extracted.warning) warnings.push(extracted.warning);
  }

  return {
    provenance: {
      source: sourcePath,
      tool: 'read_video',
      version,
      extracted_at: new Date().toISOString(),
      ...(sourceHash ? { source_hash: sourceHash } : {}),
      ...(cacheKey ? { cache_key: cacheKey } : {}),
      ...(shouldUseRustTimelineEngine() ? { assembly_route: assemblyRoute } : {}),
    },
    format,
    streams,
    chapters,
    scenes,
    subtitles,
    transcript,
    keyframes,
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

import { access } from 'node:fs/promises';
import {
  assembleProbeTimelineViaRustEngine,
  buildCacheKeyViaRustEngine,
  hashSourceViaRustEngine,
  shouldUseRustTimelineEngine,
} from '../engine/rust-timeline.js';
import type { ReadVideoArgs } from '../schemas/readVideo.js';
import type { TimelineDocument, VideoSourceResult } from '../types/timeline.js';
import { buildAgentVideoIndex } from '../utils/agentIndex.js';
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
import { extractKeyframes } from '../utils/frames.js';
import { resolvePath } from '../utils/pathUtils.js';
import { detectScenes } from '../utils/scenes.js';
import { planStructuralKeyframeTimes } from '../utils/structuralKeyframes.js';

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
  const includeKeyframeImages = args.include_keyframe_images ?? false;
  const keyframeLimit = args.keyframe_limit ?? DEFAULT_KEYFRAME_LIMIT;
  const keyframeMaxDimension = args.keyframe_max_dimension;
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
      includeKeyframeImages,
      keyframeLimit,
      keyframeMaxDimension,
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
  const keyframePolicy = args.keyframe_policy ?? 'structural';
  if (includeKeyframes) {
    const extracted = await extractKeyframes(sourcePath, Math.max(keyframeLimit, 32), {
      includeImages: false,
      ...(keyframeMaxDimension !== undefined ? { maxDimension: keyframeMaxDimension } : {}),
    });
    if (extracted.warning) warnings.push(extracted.warning);

    if (keyframePolicy === 'iframes') {
      keyframes = extracted.keyframes.slice(0, keyframeLimit);
      if (includeKeyframeImages && extracted.keyframes.length > 0) {
        const withImages = await extractKeyframes(sourcePath, keyframeLimit, {
          includeImages: true,
          ...(keyframeMaxDimension !== undefined ? { maxDimension: keyframeMaxDimension } : {}),
        });
        keyframes = withImages.keyframes;
        if (withImages.warning) warnings.push(withImages.warning);
      }
    } else {
      const plan = planStructuralKeyframeTimes({
        durationMs: format.duration_ms,
        sceneTimesMs: scenes.map((s) => s.time_ms),
        iframeTimesMs: extracted.keyframes.map((k) => k.time_ms),
        limit: keyframeLimit,
      });
      warnings.push(...plan.notes);
      keyframes = plan.times_ms.map((time_ms, index) => {
        const nearest = extracted.keyframes.reduce<(typeof extracted.keyframes)[number] | null>(
          (best, kf) => {
            if (!best) return kf;
            return Math.abs(kf.time_ms - time_ms) < Math.abs(best.time_ms - time_ms) ? kf : best;
          },
          null
        );
        return {
          index,
          time_ms,
          provenance: {
            method: 'ffmpeg_keyframe_select' as const,
            pict_type: 'I' as const,
          },
          ...(nearest?.frame_hash ? { frame_hash: nearest.frame_hash } : {}),
          ...(nearest?.route ? { route: nearest.route } : {}),
        };
      });
      // Optional images still use iframe extractor for true pixel evidence when requested.
      if (includeKeyframeImages) {
        const withImages = await extractKeyframes(sourcePath, keyframeLimit, {
          includeImages: true,
          ...(keyframeMaxDimension !== undefined ? { maxDimension: keyframeMaxDimension } : {}),
        });
        if (withImages.warning) warnings.push(withImages.warning);
        // attach images from nearest iframe evidence when hashes/times align
        keyframes = keyframes.map((kf) => {
          const hit = withImages.keyframes.find((x) => Math.abs(x.time_ms - kf.time_ms) < 50);
          if (!hit) return kf;
          return {
            ...kf,
            ...(hit.frame_hash ? { frame_hash: hit.frame_hash } : {}),
            ...(hit.image_base64 ? { image_base64: hit.image_base64 } : {}),
            ...(hit.mime ? { mime: hit.mime } : {}),
            ...(hit.width ? { width: hit.width } : {}),
            ...(hit.height ? { height: hit.height } : {}),
            ...(hit.route ? { route: hit.route } : {}),
          };
        });
      }
    }
  }

  const includeAgentIndex = args.include_agent_index ?? true;
  const documentBase = {
    provenance: {
      source: sourcePath,
      tool: 'read_video' as const,
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

  return {
    ...documentBase,
    ...(includeAgentIndex
      ? {
          agent_index: buildAgentVideoIndex(
            documentBase as Parameters<typeof buildAgentVideoIndex>[0]
          ),
        }
      : {}),
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

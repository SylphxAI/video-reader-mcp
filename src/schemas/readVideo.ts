import { z } from 'zod';

export const videoSourceSchema = z.object({
  path: z.string().min(1).describe('Path to the local video file (absolute or relative to cwd).'),
});

export const readVideoArgsSchema = z.object({
  sources: z.array(videoSourceSchema).min(1).describe('One or more local video sources to read.'),
  include_streams: z
    .boolean()
    .optional()
    .describe('Include stream metadata from ffprobe. Defaults to true.'),
  include_chapters: z
    .boolean()
    .optional()
    .describe('Include chapter markers when present. Defaults to true.'),
  include_subtitles: z
    .boolean()
    .optional()
    .describe('Extract embedded subtitles when available. Defaults to true.'),
  include_scenes: z
    .boolean()
    .optional()
    .describe('Detect scene boundaries with ffmpeg scene filter. Defaults to true.'),
  scene_threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Scene detection sensitivity for ffmpeg gt(scene,threshold). Defaults to 0.4.'),
  include_transcript: z
    .boolean()
    .optional()
    .describe(
      'Attempt optional local ASR transcript when an adapter is installed. Defaults to false.'
    ),
  include_keyframes: z
    .boolean()
    .optional()
    .describe(
      'Index I-frame timestamps with ffmpeg for reproducible frame evidence follow-up. Defaults to false.'
    ),
  keyframe_limit: z
    .number()
    .int()
    .min(1)
    .max(64)
    .optional()
    .describe('Maximum number of keyframe locators to return when include_keyframes is true. Defaults to 8.'),
  include_keyframe_images: z
    .boolean()
    .optional()
    .describe(
      'When include_keyframes is true, render citeable PNG thumbnails for each keyframe. Defaults to false.'
    ),
  keyframe_max_dimension: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum width or height when resizing keyframe PNG evidence.'),
});

export type ReadVideoArgs = z.infer<typeof readVideoArgsSchema>;
export type VideoSource = z.infer<typeof videoSourceSchema>;

import { z } from 'zod';

export const videoSourceSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('Path to the local video file (absolute or relative to cwd).'),
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
});

export type ReadVideoArgs = z.infer<typeof readVideoArgsSchema>;
export type VideoSource = z.infer<typeof videoSourceSchema>;
import { z } from 'zod';
import { videoSourceSchema } from './readVideo.js';

const cropRegionSchema = z.object({
  x: z.number().int().min(0).describe('Crop origin X in video pixel coordinates.'),
  y: z.number().int().min(0).describe('Crop origin Y in video pixel coordinates.'),
  width: z.number().int().positive().describe('Crop width in video pixel coordinates.'),
  height: z.number().int().positive().describe('Crop height in video pixel coordinates.'),
});

const evidenceSourceSchema = videoSourceSchema.extend({
  time_ms: z
    .number()
    .int()
    .min(0)
    .describe('Timestamp in milliseconds for frame evidence follow-up.'),
  crop: cropRegionSchema
    .optional()
    .describe('Required for crop_frame; pixel crop bounds on the source video frame.'),
});

export const videoEvidenceArgsSchema = z
  .object({
    operation: z
      .enum(['render_frame', 'crop_frame', 'ocr_frame'])
      .describe('Focused frame evidence operation after read_video timeline discovery.'),
    sources: z
      .array(evidenceSourceSchema)
      .min(1)
      .describe('One or more local video sources with timestamp locators.'),
    max_dimension: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum width or height when resizing rendered PNG evidence.'),
  })
  .superRefine((value, ctx) => {
    if (value.operation === 'crop_frame') {
      for (const [index, source] of value.sources.entries()) {
        if (!source.crop) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'crop_frame requires sources[].crop for each source.',
            path: ['sources', index, 'crop'],
          });
        }
      }
    }
  });

export type VideoEvidenceArgs = z.infer<typeof videoEvidenceArgsSchema>;
export type VideoEvidenceSource = z.infer<typeof evidenceSourceSchema>;

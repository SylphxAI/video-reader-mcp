import {
  cropFrameViaRustEngine,
  renderFrameViaRustEngine,
  shouldUseRustVideoEvidenceEngine,
} from '../engine/rust-video-evidence.js';
import { text, tool, toolError } from '../mcp.js';
import { type VideoEvidenceArgs, videoEvidenceArgsSchema } from '../schemas/videoEvidence.js';
import { resolvePath } from '../utils/pathUtils.js';

type EvidenceResult = {
  source: string;
  success: boolean;
  time_ms: number;
  operation: VideoEvidenceArgs['operation'];
  route?: string | undefined;
  frame?: {
    frame_hash: string;
    mime: string;
    width: number;
    height: number;
    image_base64: string;
    provenance: { method: string; time_ms: number };
    crop?: VideoEvidenceArgs['sources'][number]['crop'];
  };
  error?: string | undefined;
  code?: string | undefined;
};

const routeForOperation = (operation: VideoEvidenceArgs['operation']): string => {
  switch (operation) {
    case 'render_frame':
      return 'rust-frame-render';
    case 'crop_frame':
      return 'rust-frame-crop';
    case 'ocr_frame':
      return 'ocr-frame-unavailable';
  }
};

export const createVideoEvidenceHandler = () =>
  tool()
    .description(
      'Runs focused video evidence follow-up operations: render_frame, crop_frame, or ocr_frame with timestamp locators after read_video.'
    )
    .input(videoEvidenceArgsSchema)
    .handler(async ({ input }: { input: VideoEvidenceArgs }) => {
      if (input.operation === 'ocr_frame') {
        return toolError(
          'ocr_frame is not available yet. Use render_frame or crop_frame for citeable PNG evidence, or enable read_video include_transcript when a local ASR adapter is installed.'
        );
      }

      if (!shouldUseRustVideoEvidenceEngine()) {
        return toolError(
          'Rust video evidence engine is unavailable. Build video-reader-cli with cargo build --release or set VIDEO_READER_CLI.'
        );
      }

      const results: EvidenceResult[] = [];

      for (const source of input.sources) {
        const resolvedPath = resolvePath(source.path);
        const engineResult =
          input.operation === 'crop_frame'
            ? cropFrameViaRustEngine({
                videoPath: resolvedPath,
                timeMs: source.time_ms,
                crop: source.crop!,
                maxDimension: input.max_dimension,
              })
            : renderFrameViaRustEngine({
                videoPath: resolvedPath,
                timeMs: source.time_ms,
                maxDimension: input.max_dimension,
              });

        if (!engineResult.ok) {
          results.push({
            source: source.path,
            success: false,
            time_ms: source.time_ms,
            operation: input.operation,
            error: engineResult.message,
            code: engineResult.code,
          });
          continue;
        }

        results.push({
          source: source.path,
          success: true,
          time_ms: source.time_ms,
          operation: input.operation,
          route: engineResult.frame.route,
          frame: {
            frame_hash: engineResult.frame.frame_hash,
            mime: engineResult.frame.mime,
            width: engineResult.frame.width,
            height: engineResult.frame.height,
            image_base64: engineResult.frame.image_base64,
            provenance: engineResult.frame.provenance,
            ...(engineResult.frame.crop ? { crop: engineResult.frame.crop } : {}),
          },
        });
      }

      if (results.every((result) => !result.success)) {
        const messages = results.map((result) => result.error).join('; ');
        return toolError(`All video evidence sources failed: ${messages}`);
      }

      return text(
        JSON.stringify(
          {
            profile: 'video_evidence_results',
            operation: input.operation,
            route: routeForOperation(input.operation),
            results,
          },
          null,
          2
        )
      );
    });

export const videoEvidence = createVideoEvidenceHandler();

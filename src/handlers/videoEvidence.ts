import {
  cropFrameViaRustEngine,
  renderFrameViaRustEngine,
  shouldUseRustVideoEvidenceEngine,
} from '../engine/rust-video-evidence.js';
import { text, tool, toolError } from '../mcp.js';
import { type VideoEvidenceArgs, videoEvidenceArgsSchema } from '../schemas/videoEvidence.js';
import { ocrPngBase64 } from '../utils/frameOcr.js';
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
    image_base64?: string;
    provenance: { method: string; time_ms: number; source_hash: string };
    crop?: VideoEvidenceArgs['sources'][number]['crop'];
  };
  ocr?: {
    available: boolean;
    route: string;
    skipped_reason?: string;
    languages: string[];
    lines: { text: string; confidence?: number }[];
    line_count: number;
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
      return 'rust-frame-render+tesseract_frame';
  }
};

export const createVideoEvidenceHandler = () =>
  tool()
    .description(
      'Runs focused video evidence follow-up operations: render_frame, crop_frame, or ocr_frame with timestamp locators after read_video.'
    )
    .input(videoEvidenceArgsSchema)
    .handler(async ({ input }: { input: VideoEvidenceArgs }) => {
      if (!shouldUseRustVideoEvidenceEngine()) {
        return toolError(
          'Rust video evidence engine is unavailable. Build video-reader-cli with cargo build --release or set VIDEO_READER_CLI.'
        );
      }

      const results: EvidenceResult[] = [];
      const ocrLanguages = (input as { ocr_languages?: string[] }).ocr_languages ??
        (input as { languages?: string[] }).languages ?? ['eng'];

      for (const source of input.sources) {
        const resolvedPath = resolvePath(source.path);
        const engineResult =
          input.operation === 'crop_frame'
            ? cropFrameViaRustEngine({
                videoPath: resolvedPath,
                timeMs: source.time_ms,
                crop: source.crop as NonNullable<typeof source.crop>,
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

        if (input.operation === 'ocr_frame') {
          const ocr = ocrPngBase64(engineResult.frame.image_base64, ocrLanguages);
          results.push({
            source: source.path,
            success: true,
            time_ms: source.time_ms,
            operation: 'ocr_frame',
            route: ocr.available
              ? 'rust-frame-render+tesseract_frame'
              : 'rust-frame-render+tesseract_unavailable',
            frame: {
              frame_hash: engineResult.frame.frame_hash,
              mime: engineResult.frame.mime,
              width: engineResult.frame.width,
              height: engineResult.frame.height,
              // omit large base64 by default for OCR answers (hash is the locator)
              provenance: engineResult.frame.provenance,
            },
            ocr: {
              available: ocr.available,
              route: ocr.route,
              languages: ocr.languages,
              lines: ocr.lines,
              line_count: ocr.line_count,
              ...(ocr.skipped_reason !== undefined ? { skipped_reason: ocr.skipped_reason } : {}),
            },
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

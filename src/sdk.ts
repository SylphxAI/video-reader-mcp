/**
 * Cue SDK — programmatic video timeline API (Sylphx Instruments).
 * Isomorphic with MCP tools `read_video` / `video_evidence`.
 */
import { readVideo } from './handlers/readVideo.js';
import { videoEvidence } from './handlers/videoEvidence.js';
import { readVideoArgsSchema } from './schemas/readVideo.js';

export type CueReadInput = {
  path?: string;
  sources?: unknown;
  [key: string]: unknown;
};

export { readVideoArgsSchema };

export class Cue {
  static create(): Cue {
    return new Cue();
  }

  /** MCP: read_video */
  async read(input: CueReadInput) {
    const parsed = readVideoArgsSchema.parse(input);
    return readVideo.handler({ input: parsed, ctx: {} });
  }

  /** MCP: video_evidence */
  async evidence(input: Record<string, unknown>) {
    return videoEvidence.handler({ input: input as never, ctx: {} });
  }
}

export default Cue;

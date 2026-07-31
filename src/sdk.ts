/**
 * Cue SDK — programmatic video timeline API (Sylphx).
 * Isomorphic with MCP tools `read_video` / `video_evidence`.
 */
import { readVideo } from './handlers/readVideo.js';
import { videoEvidence } from './handlers/videoEvidence.js';
import { readVideoArgsSchema, type ReadVideoArgs } from './schemas/readVideo.js';

export type CueReadInput = ReadVideoArgs | { path: string; [key: string]: unknown };

export { readVideoArgsSchema };

function normalizeReadInput(input: CueReadInput): ReadVideoArgs {
  if ('sources' in input && Array.isArray((input as ReadVideoArgs).sources)) {
    return readVideoArgsSchema.parse(input);
  }
  const { path, ...rest } = input as { path: string; [key: string]: unknown };
  if (!path || typeof path !== 'string') {
    throw new Error('Cue.read requires sources[] or path');
  }
  return readVideoArgsSchema.parse({
    ...rest,
    sources: [{ path }],
  });
}

export class Cue {
  static create(): Cue {
    return new Cue();
  }

  /** MCP: read_video — accepts `{ sources:[{path}] }` or ergonomic `{ path }` */
  async read(input: CueReadInput) {
    const parsed = normalizeReadInput(input);
    return readVideo.handler({ input: parsed, ctx: {} });
  }

  /** MCP: video_evidence */
  async evidence(input: Record<string, unknown>) {
    return videoEvidence.handler({ input: input as never, ctx: {} });
  }
}

export default Cue;

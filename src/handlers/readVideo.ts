import { text, tool, toolError } from '../mcp.js';
import { type ReadVideoArgs, readVideoArgsSchema } from '../schemas/readVideo.js';
import { processVideoSource } from '../video/readCoordinator.js';

const MAX_CONCURRENT_SOURCES = 2;

export const createReadVideoHandler = (version: string) =>
  tool()
    .description(
      'Primary video reader. Returns a timeline document with ffprobe metadata, embedded subtitles, optional scene boundaries, and warnings — no per-frame vision LLM.'
    )
    .input(readVideoArgsSchema)
    .handler(async ({ input }: { input: ReadVideoArgs }) => {
      const results = [];

      for (let i = 0; i < input.sources.length; i += MAX_CONCURRENT_SOURCES) {
        const batch = input.sources.slice(i, i + MAX_CONCURRENT_SOURCES);
        const batchResults = await Promise.all(
          batch.map((source) => processVideoSource(source.path, input, version))
        );
        results.push(...batchResults);
      }

      const allFailed = results.every((result) => !result.success);
      if (allFailed) {
        const errorMessages = results.map((result) => result.error).join('; ');
        return toolError(`All video sources failed to process: ${errorMessages}`);
      }

      return text(
        JSON.stringify(
          {
            results,
          },
          null,
          2
        )
      );
    });

export const readVideo = createReadVideoHandler('0.1.0');
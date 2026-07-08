import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SubtitleCue } from '../types/timeline.js';
import { execBinary, isBinaryAvailable } from './exec.js';
import type { FfprobeStream } from './ffprobe.js';
import { parseSubtitleContent } from './subtitles.js';

const subtitleFormatForStream = (stream: FfprobeStream): 'srt' | 'vtt' | 'webvtt' => {
  const codec = stream.codec_name?.toLowerCase() ?? '';
  if (codec.includes('webvtt') || codec === 'vtt') return 'vtt';
  return 'srt';
};

export const extractSubtitles = async (
  videoPath: string,
  subtitleStreams: FfprobeStream[]
): Promise<{ subtitles: SubtitleCue[]; warnings: string[] }> => {
  const warnings: string[] = [];
  const subtitles: SubtitleCue[] = [];

  if (subtitleStreams.length === 0) {
    return { subtitles, warnings: ['No embedded subtitle streams found.'] };
  }

  const available = await isBinaryAvailable('ffmpeg');
  if (!available) {
    return {
      subtitles,
      warnings: ['ffmpeg is not installed; subtitle extraction skipped.'],
    };
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'video-reader-mcp-'));

  try {
    for (const stream of subtitleStreams) {
      const format = subtitleFormatForStream(stream);
      const extension = format === 'srt' ? 'srt' : 'vtt';
      const outputPath = path.join(tempDir, `sub-${stream.index}.${extension}`);

      try {
        await execBinary(
          'ffmpeg',
          [
            '-hide_banner',
            '-y',
            '-i',
            videoPath,
            '-map',
            `0:${stream.index}`,
            '-c:s',
            format === 'srt' ? 'srt' : 'webvtt',
            outputPath,
          ],
          { timeoutMs: 120_000 }
        );

        const content = await readFile(outputPath, 'utf8');
        const cues = parseSubtitleContent(content, format).map((cue) => ({
          ...cue,
          index: subtitles.length + cue.index,
          stream_index: stream.index,
          ...(stream.tags?.language ? { language: stream.tags.language } : {}),
          provenance: {
            method: 'ffmpeg_extract' as const,
            format,
          },
        }));
        subtitles.push(...cues);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Subtitle stream ${stream.index} extraction failed: ${message}`);
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return { subtitles, warnings };
};

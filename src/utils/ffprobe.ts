import { execBinary, isBinaryAvailable } from './exec.js';

export interface FfprobeChapter {
  id: number;
  start: number;
  end: number;
  tags?: Record<string, string>;
}

export interface FfprobeStream {
  index: number;
  codec_type: string;
  codec_name?: string;
  tags?: Record<string, string>;
  channels?: number;
  sample_rate?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  bit_rate?: string;
  disposition?: Record<string, number>;
}

export interface FfprobeFormat {
  format_name?: string;
  duration?: string;
  bit_rate?: string;
  size?: string;
  tags?: Record<string, string>;
}

export interface FfprobeResult {
  streams: FfprobeStream[];
  format: FfprobeFormat;
  chapters?: FfprobeChapter[];
}

export const parseFfprobeJson = (raw: string): FfprobeResult => {
  const parsed = JSON.parse(raw) as Partial<FfprobeResult>;
  return {
    streams: Array.isArray(parsed.streams) ? parsed.streams : [],
    format: parsed.format ?? {},
    chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
  };
};

export const secondsToMs = (value: string | number | undefined): number => {
  if (value === undefined) return 0;
  const seconds = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(seconds)) return 0;
  return Math.round(seconds * 1000);
};

export const mapStreams = (streams: FfprobeStream[]) =>
  streams.map((stream) => ({
    index: stream.index,
    codec_type: stream.codec_type,
    ...(stream.codec_name ? { codec_name: stream.codec_name } : {}),
    ...(stream.tags?.language ? { language: stream.tags.language } : {}),
    ...(stream.channels !== undefined ? { channels: stream.channels } : {}),
    ...(stream.sample_rate ? { sample_rate: Number.parseInt(stream.sample_rate, 10) } : {}),
    ...(stream.width !== undefined ? { width: stream.width } : {}),
    ...(stream.height !== undefined ? { height: stream.height } : {}),
    ...(stream.avg_frame_rate ? { avg_frame_rate: stream.avg_frame_rate } : {}),
    ...(stream.r_frame_rate ? { r_frame_rate: stream.r_frame_rate } : {}),
    ...(stream.bit_rate ? { bit_rate: Number.parseInt(stream.bit_rate, 10) } : {}),
    ...(stream.disposition ? { disposition: stream.disposition } : {}),
    ...(stream.tags ? { tags: stream.tags } : {}),
  }));

export const mapChapters = (chapters: FfprobeChapter[] | undefined) =>
  (chapters ?? []).map((chapter) => ({
    id: chapter.id,
    start_ms: secondsToMs(chapter.start),
    end_ms: secondsToMs(chapter.end),
    ...(chapter.tags?.title ? { title: chapter.tags.title } : {}),
  }));

export const collectProbeWarnings = (
  probe: FfprobeResult,
  includeStreams: boolean
): string[] => {
  const warnings: string[] = [];
  const videoStreams = probe.streams.filter((s) => s.codec_type === 'video');
  const audioStreams = probe.streams.filter((s) => s.codec_type === 'audio');

  if (includeStreams && videoStreams.length === 0) {
    warnings.push('No video stream detected.');
  }
  if (includeStreams && audioStreams.length === 0) {
    warnings.push('No audio stream detected.');
  }

  for (const stream of videoStreams) {
    if (stream.avg_frame_rate && stream.r_frame_rate && stream.avg_frame_rate !== stream.r_frame_rate) {
      warnings.push(
        `Stream ${stream.index}: variable frame rate suspected (avg_frame_rate=${stream.avg_frame_rate}, r_frame_rate=${stream.r_frame_rate}).`
      );
    }
  }

  const duration = probe.format.duration;
  if (!duration || Number.parseFloat(duration) <= 0) {
    warnings.push('Duration unavailable or zero; timeline bounds may be incomplete.');
  }

  return warnings;
};

export const runFfprobe = async (videoPath: string): Promise<FfprobeResult> => {
  const available = await isBinaryAvailable('ffprobe');
  if (!available) {
    throw new Error('ffprobe is not installed or not on PATH');
  }

  const { stdout } = await execBinary(
    'ffprobe',
    [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      '-show_chapters',
      videoPath,
    ],
    { timeoutMs: 60_000 }
  );

  return parseFfprobeJson(stdout);
};

export const findSubtitleStreams = (streams: FfprobeStream[]): FfprobeStream[] =>
  streams.filter((stream) => stream.codec_type === 'subtitle');
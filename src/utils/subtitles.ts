import type { SubtitleCue } from '../types/timeline.js';

const parseTimestampToMs = (timestamp: string): number => {
  const normalized = timestamp.trim().replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length !== 3) return 0;

  const [hours, minutes, secondsPart] = parts;
  const [seconds, millis = '0'] = secondsPart.split('.');
  const h = Number.parseInt(hours, 10);
  const m = Number.parseInt(minutes, 10);
  const s = Number.parseInt(seconds, 10);
  const ms = Number.parseInt(millis.padEnd(3, '0').slice(0, 3), 10);

  return ((h * 60 + m) * 60 + s) * 1000 + ms;
};

const stripTags = (text: string): string =>
  text
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]+\}/g, '')
    .trim();

export const parseSrt = (content: string): SubtitleCue[] => {
  const blocks = content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 2) continue;

    const timingLine = lines.find((line) => line.includes('-->'));
    if (!timingLine) continue;

    const [startRaw, endRaw] = timingLine.split('-->').map((part) => part.trim());
    const textLines = lines.filter((line) => line !== lines[0] && !line.includes('-->'));
    const text = stripTags(textLines.join('\n'));
    if (!text) continue;

    cues.push({
      index: cues.length,
      start_ms: parseTimestampToMs(startRaw),
      end_ms: parseTimestampToMs(endRaw),
      text,
      provenance: {
        method: 'embedded_parse',
        format: 'srt',
      },
    });
  }

  return cues;
};

export const parseVtt = (content: string): SubtitleCue[] => {
  const normalized = content.replace(/\r\n/g, '\n');
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block && !block.startsWith('WEBVTT') && !block.startsWith('NOTE'));

  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const timingLine = lines.find((line) => line.includes('-->'));
    if (!timingLine) continue;

    const timing = timingLine.split('-->')[0]?.trim() ?? '';
    const endTiming = timingLine.split('-->')[1]?.trim().split(' ')[0] ?? '';
    const textLines = lines.filter((line) => !line.includes('-->') && !/^\d+$/.test(line));
    const text = stripTags(textLines.join('\n'));
    if (!text) continue;

    cues.push({
      index: cues.length,
      start_ms: parseTimestampToMs(timing),
      end_ms: parseTimestampToMs(endTiming),
      text,
      provenance: {
        method: 'embedded_parse',
        format: 'vtt',
      },
    });
  }

  return cues;
};

export const parseSubtitleContent = (
  content: string,
  format: 'srt' | 'vtt' | 'webvtt'
): SubtitleCue[] => {
  if (format === 'srt') return parseSrt(content);
  return parseVtt(content);
};
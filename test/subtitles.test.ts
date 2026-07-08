import { describe, expect, it } from 'bun:test';
import { parseSrt, parseVtt } from '../src/utils/subtitles.js';

describe('parseSrt', () => {
  it('parses SRT cues with comma milliseconds', () => {
    const cues = parseSrt(`1
00:00:01,000 --> 00:00:03,500
Hello world

2
00:00:04,000 --> 00:00:06,000
Second cue`);

    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({
      start_ms: 1000,
      end_ms: 3500,
      text: 'Hello world',
    });
    expect(cues[1]?.text).toBe('Second cue');
  });
});

describe('parseVtt', () => {
  it('parses WebVTT cues', () => {
    const cues = parseVtt(`WEBVTT

00:00:00.500 --> 00:00:02.000
First line

00:00:02.500 --> 00:00:04.000
Second line`);

    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({
      start_ms: 500,
      end_ms: 2000,
      text: 'First line',
    });
  });
});
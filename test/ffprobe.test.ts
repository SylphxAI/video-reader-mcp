import { describe, expect, it } from 'bun:test';
import {
  collectProbeWarnings,
  mapChapters,
  mapStreams,
  parseFfprobeJson,
  secondsToMs,
} from '../src/utils/ffprobe.js';

const SAMPLE_PROBE = `{
  "streams": [
    {
      "index": 0,
      "codec_name": "h264",
      "codec_type": "video",
      "width": 1920,
      "height": 1080,
      "avg_frame_rate": "30000/1001",
      "r_frame_rate": "30/1"
    },
    {
      "index": 1,
      "codec_name": "aac",
      "codec_type": "audio",
      "channels": 2,
      "sample_rate": "48000"
    },
    {
      "index": 2,
      "codec_name": "subrip",
      "codec_type": "subtitle",
      "tags": { "language": "eng" }
    }
  ],
  "format": {
    "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
    "duration": "125.5",
    "bit_rate": "2500000",
    "size": "39234567"
  },
  "chapters": [
    {
      "id": 0,
      "start": 0,
      "end": 60.25,
      "tags": { "title": "Intro" }
    }
  ]
}`;

describe('parseFfprobeJson', () => {
  it('parses streams, format, and chapters', () => {
    const probe = parseFfprobeJson(SAMPLE_PROBE);

    expect(probe.streams).toHaveLength(3);
    expect(probe.format.duration).toBe('125.5');
    expect(probe.chapters).toHaveLength(1);
    expect(probe.chapters?.[0]?.tags?.title).toBe('Intro');
  });

  it('returns empty collections for malformed partial payloads', () => {
    const probe = parseFfprobeJson('{}');
    expect(probe.streams).toEqual([]);
    expect(probe.chapters).toEqual([]);
  });
});

describe('secondsToMs', () => {
  it('converts seconds to rounded milliseconds', () => {
    expect(secondsToMs('1.234')).toBe(1234);
    expect(secondsToMs(2)).toBe(2000);
    expect(secondsToMs(undefined)).toBe(0);
  });
});

describe('mapStreams', () => {
  it('maps ffprobe streams into timeline stream metadata', () => {
    const probe = parseFfprobeJson(SAMPLE_PROBE);
    const streams = mapStreams(probe.streams);

    expect(streams[0]).toMatchObject({
      index: 0,
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
    });
    expect(streams[1]?.channels).toBe(2);
    expect(streams[1]?.sample_rate).toBe(48000);
    expect(streams[2]?.language).toBe('eng');
  });
});

describe('mapChapters', () => {
  it('maps chapter timestamps to milliseconds', () => {
    const probe = parseFfprobeJson(SAMPLE_PROBE);
    const chapters = mapChapters(probe.chapters);

    expect(chapters[0]).toEqual({
      id: 0,
      start_ms: 0,
      end_ms: 60250,
      title: 'Intro',
    });
  });
});

describe('collectProbeWarnings', () => {
  it('flags missing audio and variable frame rate', () => {
    const probe = parseFfprobeJson(`{
      "streams": [
        {
          "index": 0,
          "codec_type": "video",
          "avg_frame_rate": "24/1",
          "r_frame_rate": "30000/1001"
        }
      ],
      "format": { "duration": "10" }
    }`);

    const warnings = collectProbeWarnings(probe, true);
    expect(warnings.some((w) => w.includes('No audio stream'))).toBe(true);
    expect(warnings.some((w) => w.includes('variable frame rate'))).toBe(true);
  });
});
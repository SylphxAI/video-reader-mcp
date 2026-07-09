import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  collectProbeWarnings,
  findSubtitleStreams,
  mapStreams,
  parseFfprobeJson,
} from '../src/utils/ffprobe.js';

const fixtureDir = path.join(import.meta.dirname, 'fixtures');

const readProbeFixture = (name: string) =>
  readFileSync(path.join(fixtureDir, 'probes', name), 'utf8');

describe('fixture corpus manifest', () => {
  it('lists the Phase 0 video cases', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(fixtureDir, 'corpus-manifest.json'), 'utf8')
    ) as { profile: string; cases: Array<{ id: string }> };

    expect(manifest.profile).toBe('video_reader_fixture_corpus');
    expect(manifest.cases.map((entry) => entry.id)).toEqual([
      'no-subtitle',
      'subtitle-stream',
      'multi-stream',
      'corrupted-truncated',
    ]);
  });

  it('parses the no-subtitle probe fixture', () => {
    const probe = parseFfprobeJson(readProbeFixture('no-subtitle.json'));
    const warnings = collectProbeWarnings(probe, true);

    expect(mapStreams(probe.streams)).toHaveLength(1);
    expect(findSubtitleStreams(probe.streams)).toHaveLength(0);
    expect(warnings.some((warning) => warning.includes('No audio stream'))).toBe(true);
  });

  it('parses the multi-stream probe fixture', () => {
    const probe = parseFfprobeJson(readProbeFixture('multi-stream.json'));
    const streams = mapStreams(probe.streams);

    expect(streams).toHaveLength(3);
    expect(streams[0]?.codec_type).toBe('video');
    expect(streams[1]?.codec_type).toBe('audio');
    expect(streams[2]?.language).toBe('eng');
  });

  it('parses the subtitle-stream probe fixture', () => {
    const probe = parseFfprobeJson(readProbeFixture('subtitle-stream.json'));
    const subtitleStreams = findSubtitleStreams(probe.streams);

    expect(subtitleStreams).toHaveLength(1);
    expect(subtitleStreams[0]?.codec_name).toBe('subrip');
  });
});

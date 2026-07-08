import { describe, expect, it } from 'bun:test';
import { parseSceneFilterOutput } from '../src/utils/scenes.js';

describe('parseSceneFilterOutput', () => {
  it('extracts scene timestamps from ffmpeg showinfo stderr', () => {
    const stderr = `[Parsed_showinfo_0 @ 0x55aa] n:   0 pts:      0 pts_time:0       ...
[Parsed_showinfo_0 @ 0x55aa] n:  42 pts:  90000 pts_time:3.000000 ...
[Parsed_showinfo_0 @ 0x55aa] n:  88 pts: 180000 pts_time:6.125000 ...`;

    const scenes = parseSceneFilterOutput(stderr, 0.4);

    expect(scenes).toHaveLength(3);
    expect(scenes[0]?.time_ms).toBe(0);
    expect(scenes[1]?.time_ms).toBe(3000);
    expect(scenes[2]?.time_ms).toBe(6125);
    expect(scenes[1]?.provenance).toEqual({
      method: 'ffmpeg_scene_filter',
      threshold: 0.4,
    });
  });
});
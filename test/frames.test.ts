import { describe, expect, it } from 'bun:test';
import { parseKeyframeFilterOutput } from '../src/utils/frames.js';

describe('parseKeyframeFilterOutput', () => {
  it('extracts I-frame timestamps from ffmpeg showinfo stderr', () => {
    const stderr = `[Parsed_showinfo_0 @ 0x55aa] n:   0 pts:      0 pts_time:0.000000 pict_type:I ...
[Parsed_showinfo_0 @ 0x55aa] n:  24 pts:  48000 pts_time:2.000000 pict_type:I ...`;

    const keyframes = parseKeyframeFilterOutput(stderr);

    expect(keyframes).toHaveLength(2);
    expect(keyframes[0]?.time_ms).toBe(0);
    expect(keyframes[1]?.time_ms).toBe(2000);
    expect(keyframes[0]?.provenance).toEqual({
      method: 'ffmpeg_keyframe_select',
      pict_type: 'I',
    });
  });
});

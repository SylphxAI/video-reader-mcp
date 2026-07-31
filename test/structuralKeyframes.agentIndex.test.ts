import { describe, expect, test } from 'bun:test';
import { buildAgentVideoIndex } from '../src/utils/agentIndex.js';
import { planStructuralKeyframeTimes } from '../src/utils/structuralKeyframes.js';

describe('Cue structural keyframes + agent index', () => {
  test('plans structural times from scene cuts not fixed interval grid', () => {
    const plan = planStructuralKeyframeTimes({
      durationMs: 10_000,
      sceneTimesMs: [1000, 4000, 7000],
      iframeTimesMs: [0, 2000, 5000, 9000],
      limit: 8,
    });
    expect(plan.policy).toBe('structural_v1');
    expect(plan.times_ms[0]).toBe(0);
    expect(plan.times_ms).toContain(1000);
    expect(plan.notes.join(' ')).toMatch(/scene/i);
  });

  test('agent index formats film architecture for text agents', () => {
    const idx = buildAgentVideoIndex({
      provenance: { source: '/tmp/a.mp4' },
      format: { duration_ms: 5000, format_name: 'mp4' },
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
      scenes: [{ time_ms: 1000 }, { time_ms: 3000 }],
      keyframes: [{ time_ms: 0 }, { time_ms: 1000 }],
      subtitles: [{ cues: [{}, {}] }],
      transcript: [],
      warnings: [],
    });
    expect(idx.outline).toContain('# Video index');
    expect(idx.scene_count).toBe(2);
    expect(idx.outline).toMatch(/Scene architecture|scene cut/i);
  });
});

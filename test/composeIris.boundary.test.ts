import { describe, expect, test } from 'bun:test';
import { composeKeyframes, type IrisSidecarResponse } from '../scripts/compose-iris.js';

describe('Cue → Iris compose (boundary, mock semantics)', () => {
  test('merges structural keyframes with Iris L2 objects by time', async () => {
    const mkSemantics =
      () =>
      async (req: {
        path: string;
        mime: string;
        url: string;
        prompt?: string;
      }): Promise<IrisSidecarResponse> => {
        const timeFromPath = Number.parseInt(req.path.match(/frame_(\d+)/)?.[1] ?? '0', 10);
        return {
          model: 'florence2-mock',
          caption: `frame ${timeFromPath}`,
          objects: [
            {
              id: 'o1',
              label: 'person',
              bbox: { x: 10, y: 20, width: 30, height: 40 },
              score: 0.91,
            },
            { id: 'o2', label: 'dog', bbox: { x: 50, y: 60, width: 25, height: 20 }, score: 0.8 },
          ],
        };
      };
    const render = async () => {};

    const result = await composeKeyframes({
      videoPath: '/abs/clip.mp4',
      sceneTimesMs: [1000, 5000, 9000],
      limit: 4,
      semanticsUrl: 'http://127.0.0.1:8765',
      semantics: mkSemantics(),
      render,
    });

    expect(result.policy).toBe('cue_compose_iris_v1');
    expect(result.keyframe_count).toBeGreaterThan(0);
    expect(result.keyframe_policy).toBe('structural_v1');
    // keyframes sorted structural times (not empty)
    expect(result.keyframes.length).toBeGreaterThanOrEqual(2);
    for (const kf of result.keyframes) {
      expect(kf.semantics_available).toBe(true);
      expect(kf.objects.length).toBe(2);
      expect(kf.objects[0]?.label).toBe('person');
      expect(typeof kf.time_ms).toBe('number');
    }
    expect(result.total_objects).toBe(result.keyframes.length * 2);
  });

  test('fail closed per keyframe when semantics unavailable', async () => {
    const sem = async () => {
      throw new Error('Iris semantics HTTP 500');
    };
    const result = await composeKeyframes({
      videoPath: '/abs/clip.mp4',
      sceneTimesMs: [0, 4000],
      limit: 3,
      semanticsUrl: 'http://127.0.0.1:8765',
      semantics: sem,
      render: async () => {},
    });
    expect(result.keyframes.length).toBeGreaterThan(0);
    for (const kf of result.keyframes) {
      expect(kf.semantics_available).toBe(false);
      expect(kf.skipped_reason).toContain('500');
      expect(kf.objects).toEqual([]);
    }
  });
});

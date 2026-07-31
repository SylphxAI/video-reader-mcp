/**
 * Structural keyframe policy: prefer scene-change timestamps over fixed-interval thumbs.
 */

export type StructuralKeyframePlan = {
  policy: 'structural_v1' | 'iframes_v1';
  times_ms: number[];
  notes: string[];
};

export function planStructuralKeyframeTimes(input: {
  durationMs?: number;
  sceneTimesMs: number[];
  iframeTimesMs: number[];
  limit: number;
}): StructuralKeyframePlan {
  const notes: string[] = [];
  const limit = Math.max(1, Math.min(64, input.limit));
  const times = new Set<number>();

  const sceneTimes = [...input.sceneTimesMs]
    .filter((t) => Number.isFinite(t) && t >= 0)
    .sort((a, b) => a - b);
  if (sceneTimes.length > 0) {
    times.add(0);
    for (let i = 0; i < sceneTimes.length; i++) {
      const st = sceneTimes[i];
      if (st !== undefined) times.add(st);
      const a = sceneTimes[i];
      const b = sceneTimes[i + 1];
      if (a !== undefined && b !== undefined) {
        times.add(Math.round((a + b) / 2));
      }
    }
    if (typeof input.durationMs === 'number' && input.durationMs > 0) {
      times.add(Math.max(0, input.durationMs - 1));
    }
    notes.push(
      'Keyframe times derived from scene-change architecture (starts + mid-gaps), not fixed N-second sampling.'
    );
    const sorted = [...times].sort((a, b) => a - b);
    if (sorted.length <= limit) {
      return { policy: 'structural_v1', times_ms: sorted, notes };
    }
    const picked: number[] = [];
    for (let i = 0; i < limit; i++) {
      const idx = Math.round((i * (sorted.length - 1)) / Math.max(1, limit - 1));
      const v = sorted[idx];
      if (v !== undefined) picked.push(v);
    }
    notes.push(`Downsampled structural candidates from ${sorted.length} to ${limit}.`);
    return {
      policy: 'structural_v1',
      times_ms: [...new Set(picked)].sort((a, b) => a - b),
      notes,
    };
  }

  notes.push('No scene cuts available; falling back to I-frame timestamps.');
  const iframes = input.iframeTimesMs.slice(0, limit);
  if (iframes.length === 0 && typeof input.durationMs === 'number' && input.durationMs > 0) {
    notes.push('No I-frames parsed; using start/mid/end anchors only.');
    return {
      policy: 'structural_v1',
      times_ms: [0, Math.round(input.durationMs / 2), Math.max(0, input.durationMs - 1)].slice(
        0,
        limit
      ),
      notes,
    };
  }
  return { policy: 'iframes_v1', times_ms: iframes, notes };
}

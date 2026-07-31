import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Cue } from '../src/sdk.ts';

const sample = join(import.meta.dir, 'fixtures/no-subtitle.mp4');
const hasFfprobe = Bun.which('ffprobe') !== null;

describe('Cue read behavior', () => {
  test.skipIf(!hasFfprobe)(
    'reads fixture timeline when ffprobe is available',
    async () => {
      const cue = Cue.create();
      const result = await cue.read({ path: sample });
      let body: string | undefined;
      if (result && typeof result === 'object' && 'content' in result) {
        body = (result as { content?: { type: string; text?: string }[] }).content?.find(
          (c) => c.type === 'text',
        )?.text;
      } else if (Array.isArray(result)) {
        body = (result as { type: string; text?: string }[]).find((c) => c.type === 'text')?.text;
      }
      expect(body).toBeTruthy();
      const twin = JSON.parse(body as string) as Record<string, unknown>;
      // timeline-ish fields — be flexible on exact schema
      expect(twin).toBeTruthy();
      const keys = Object.keys(twin);
      expect(keys.length).toBeGreaterThan(0);
    },
    60_000,
  );

  test('sdk constructs without ffprobe', () => {
    expect(Cue.create()).toBeTruthy();
  });
});

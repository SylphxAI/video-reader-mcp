import { describe, expect, test } from 'bun:test';
import { parseWhisperTxt } from '../src/utils/asr.js';

describe('local whisper transcript parse', () => {
  test('parses timestamped whisper lines', () => {
    const segs = parseWhisperTxt(`[00:00.000 --> 00:01.500]  Hello agents
[00:01.500 --> 00:03.000]  Local frontier
`);
    expect(segs.length).toBe(2);
    expect(segs[0]?.text).toContain('Hello');
    expect(segs[0]?.start_ms).toBe(0);
    expect(segs[1]?.end_ms).toBe(3000);
  });
});

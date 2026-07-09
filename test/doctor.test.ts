import { describe, expect, it } from 'bun:test';
import { runDoctor } from '../src/doctor.js';

describe('video reader doctor', () => {
  it('returns structured install diagnostics', async () => {
    const report = await runDoctor('0.1.0');

    expect(report.profile).toBe('video_reader_doctor');
    expect(['ready', 'degraded', 'unavailable']).toContain(report.status);
    expect(report.checks.some((check) => check.id === 'ffprobe')).toBe(true);
    expect(report.checks.some((check) => check.id === 'ffmpeg')).toBe(true);
  });
});

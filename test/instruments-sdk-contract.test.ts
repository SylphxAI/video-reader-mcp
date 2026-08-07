import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

describe('Cue Instruments product contract', () => {
  test('brand-sole package and bin', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name?: string;
      bin?: Record<string, string>;
      exports?: Record<string, string>;
    };
    expect(pkg.name).toBe('@sylphx/cue');
    expect(pkg.bin?.cue).toBeTruthy();
    expect(pkg.exports?.['./sdk']).toBeTruthy();
  });

  test('marketplace server.json brands as Cue', () => {
    const server = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8')) as {
      title?: string;
      name?: string;
      packages?: { identifier?: string }[];
    };
    expect(server.title).toBe('Cue');
    expect(server.name).toBe('io.github.SylphxAI/cue');
    expect(server.packages?.[0]?.identifier).toBe('@sylphx/cue');
  });
});

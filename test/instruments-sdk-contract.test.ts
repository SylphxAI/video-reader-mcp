import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name?: string;
  version?: string;
  bin?: Record<string, string>;
  exports?: Record<string, string>;
};

describe('Cue Instruments product contract', () => {
  test('brand-sole package and bin', () => {
    expect(pkg.name).toBe('@sylphx/cue');
    expect(pkg.bin?.cue).toBeTruthy();
    expect(pkg.exports?.['./sdk']).toBeTruthy();
  });

  test('marketplace server.json brands as Cue', () => {
    const server = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8')) as {
      title?: string;
      name?: string;
      version?: string;
      packages?: { identifier?: string; version?: string }[];
    };
    expect(server.title).toBe('Cue');
    expect(server.name).toBe('io.github.SylphxAI/cue');
    expect(server.packages?.[0]?.identifier).toBe('@sylphx/cue');
    expect(server.version).toBe(pkg.version);
    expect(server.packages?.[0]?.version).toBe(pkg.version);
  });
});

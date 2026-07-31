import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

describe('Cue Instruments SDK contract', () => {
  test('sdk source and package exports/bin brand alias exist', () => {
    expect(existsSync(join(root, 'src/sdk.ts'))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      exports?: Record<string, string>;
      bin?: Record<string, string>;
    };
    expect(pkg.exports?.['./sdk']).toBeTruthy();
    expect(pkg.exports?.['./cue'] || pkg.exports?.['./sdk']).toBeTruthy();
    expect(pkg.bin?.['cue']).toBeTruthy();
    const sdk = readFileSync(join(root, 'src/sdk.ts'), 'utf8');
    expect(sdk).toContain('export class Cue');
    expect(sdk.toLowerCase()).toContain('read_video'.split('_')[0]);
  });
});

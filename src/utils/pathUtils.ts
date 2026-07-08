import fs from 'node:fs';
import path from 'node:path';
import { ErrorCode, VideoError } from './errors.js';

export const PROJECT_ROOT = process.cwd();

const canonicalize = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err.code === 'ENOENT' || err.code === 'ENOTDIR')
    ) {
      const parent = path.dirname(p);
      if (parent === p) return p;
      return path.join(canonicalize(parent), path.basename(p));
    }
    throw err;
  }
};

export const resolvePath = (userPath: string): string => {
  if (typeof userPath !== 'string') {
    throw new VideoError(ErrorCode.InvalidParams, 'Path must be a string.');
  }

  const normalizedUserPath = path.normalize(userPath);
  const resolved = path.isAbsolute(normalizedUserPath)
    ? normalizedUserPath
    : path.resolve(PROJECT_ROOT, normalizedUserPath);

  return canonicalize(resolved);
};

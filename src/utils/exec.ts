import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  timeoutMs?: number;
  maxBuffer?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

export const execBinary = async (
  binary: string,
  args: readonly string[],
  options: ExecOptions = {}
): Promise<ExecResult> => {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;

  try {
    const { stdout, stderr } = await execFileAsync(binary, [...args], {
      timeout,
      maxBuffer,
      encoding: 'utf8',
    });
    return {
      stdout: typeof stdout === 'string' ? stdout : String(stdout),
      stderr: typeof stderr === 'string' ? stderr : String(stderr),
    };
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'killed' in error &&
      error.killed === true &&
      'signal' in error &&
      error.signal === 'SIGTERM'
    ) {
      throw new Error(`${binary} timed out after ${timeout}ms`);
    }
    throw error;
  }
};

const binaryCache = new Map<string, boolean>();

export const isBinaryAvailable = async (binary: string): Promise<boolean> => {
  const cached = binaryCache.get(binary);
  if (cached !== undefined) return cached;

  try {
    await execFileAsync(binary, ['-version'], { timeout: 5_000, encoding: 'utf8' });
    binaryCache.set(binary, true);
    return true;
  } catch {
    try {
      await execFileAsync(binary, ['--version'], { timeout: 5_000, encoding: 'utf8' });
      binaryCache.set(binary, true);
      return true;
    } catch {
      binaryCache.set(binary, false);
      return false;
    }
  }
};

export const clearBinaryCache = (): void => {
  binaryCache.clear();
};
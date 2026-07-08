import { describe, expect, it } from 'bun:test';
import { ErrorCode, VideoError } from '../src/utils/errors.js';

describe('VideoError', () => {
  it('carries JSON-RPC error code and message', () => {
    const err = new VideoError(ErrorCode.InvalidParams, 'bad path');

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('VideoError');
    expect(err.code).toBe(ErrorCode.InvalidParams);
    expect(err.message).toBe('bad path');
  });
});
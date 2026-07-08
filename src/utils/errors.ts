export enum ErrorCode {
  InvalidParams = -32602,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
}

export class VideoError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    options?: { cause?: Error | undefined }
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'VideoError';
  }
}

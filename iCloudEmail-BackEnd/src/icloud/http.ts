/** Maximum time a single Apple/iCloud HTTP exchange may occupy a worker. */
export const ICLOUD_REQUEST_TIMEOUT_MS = 30_000;

export class UpstreamTimeoutError extends Error {
  readonly status = 504;

  constructor(cause?: unknown) {
    super('连接 Apple/iCloud 服务超时，请检查网络后重试', { cause });
    this.name = 'UpstreamTimeoutError';
  }
}

/** Native fetch with a bounded lifetime and a stable user-facing timeout error. */
export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = ICLOUD_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(input, { ...init, signal });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (signal.aborted || name === 'AbortError' || name === 'TimeoutError') {
      throw new UpstreamTimeoutError(err);
    }
    throw err;
  }
}

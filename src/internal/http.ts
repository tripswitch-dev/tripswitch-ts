import { createHmac } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

import {
  APIError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ServerFaultError,
  TransportError,
  UnauthorizedError,
  ValidationError,
} from '../errors.js';

const gzipAsync = promisify(gzip);

/**
 * Compute HMAC-SHA256 signature for ingest requests.
 *
 * Message format: `"{timestampMs}.{compressedBody}"`
 * Returns: `"v1=<hex-digest>"`
 */
export function sign(
  secret: string,
  timestampMs: string,
  body: Uint8Array,
): string {
  const secretBytes = Buffer.from(secret, 'hex');
  const message = Buffer.concat([
    Buffer.from(timestampMs + '.'),
    body,
  ]);
  const mac = createHmac('sha256', secretBytes);
  mac.update(message);
  return 'v1=' + mac.digest('hex');
}

/** Gzip compress data. */
export async function compress(data: Uint8Array): Promise<Buffer> {
  return gzipAsync(data);
}

/** Map HTTP status codes to error classes. */
export function raiseForStatus(
  status: number,
  body: Uint8Array,
  headers: Headers,
): never {
  const requestId = headers.get('x-request-id') ?? '';

  let code = '';
  let message = '';
  try {
    const data = JSON.parse(new TextDecoder().decode(body));
    code = data.code ?? '';
    message = data.message ?? '';
  } catch {
    // ignore parse failures
  }

  if (!message) {
    message = `HTTP ${status}`;
  }

  let retryAfter: number | null = null;
  if (status === 429) {
    const raw = headers.get('retry-after') ?? '';
    if (raw) {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed)) {
        retryAfter = parsed;
      }
    }
  }

  const opts = { status, code, requestId, body, retryAfter };

  if (status === 404) throw new NotFoundError(message, opts);
  if (status === 401) throw new UnauthorizedError(message, opts);
  if (status === 403) throw new ForbiddenError(message, opts);
  if (status === 429) throw new RateLimitedError(message, opts);
  if (status === 409) throw new ConflictError(message, opts);
  if (status === 400 || status === 422) throw new ValidationError(message, opts);
  if (status >= 500 && status < 600) throw new ServerFaultError(message, opts);
  throw new APIError(message, opts);
}

/** Backoff schedule for ingest retries: 100ms, 400ms, 1000ms. */
const BACKOFF_SCHEDULE = [100, 400, 1000];

/**
 * Retry a fetch request with exponential backoff.
 * Returns the response on success (2xx), throws on exhaustion.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  for (let attempt = 0; attempt <= BACKOFF_SCHEDULE.length; attempt++) {
    if (signal?.aborted) {
      throw new TransportError('request aborted');
    }

    if (attempt > 0) {
      const delay = BACKOFF_SCHEDULE[attempt - 1];
      await sleep(delay, signal);
    }

    try {
      const response = await fetch(url, { ...init, signal });
      if (response.status >= 200 && response.status < 300) {
        return response;
      }
      // On final attempt, throw the error
      if (attempt === BACKOFF_SCHEDULE.length) {
        const body = new Uint8Array(await response.arrayBuffer());
        raiseForStatus(response.status, body, response.headers);
      }
    } catch (err) {
      if (signal?.aborted) {
        throw new TransportError('request aborted');
      }
      if (attempt === BACKOFF_SCHEDULE.length) {
        if (err instanceof APIError) throw err;
        throw new TransportError(
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  // Unreachable, but TypeScript needs it
  throw new TransportError('retries exhausted');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TransportError('request aborted'));
      return;
    }

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new TransportError('request aborted'));
      },
      { once: true },
    );
  });
}

import { createHmac } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

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

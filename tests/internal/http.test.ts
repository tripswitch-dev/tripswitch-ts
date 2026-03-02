import { describe, it, expect } from 'vitest';
import { sign, compress, raiseForStatus } from '../../src/internal/http.js';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitedError,
  ConflictError,
  ValidationError,
  ServerFaultError,
  APIError,
} from '../../src/errors.js';

describe('sign', () => {
  it('computes HMAC-SHA256 with v1= prefix', () => {
    // Known test vector: 64-char hex secret
    const secret = 'a'.repeat(64);
    const timestamp = '1700000000000';
    const body = new Uint8Array([1, 2, 3]);

    const sig = sign(secret, timestamp, body);
    expect(sig).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  it('produces consistent signatures', () => {
    const secret = 'abcd'.repeat(16);
    const timestamp = '12345';
    const body = new TextEncoder().encode('hello');

    const sig1 = sign(secret, timestamp, body);
    const sig2 = sign(secret, timestamp, body);
    expect(sig1).toBe(sig2);
  });

  it('different secrets produce different signatures', () => {
    const body = new TextEncoder().encode('test');
    const sig1 = sign('a'.repeat(64), '100', body);
    const sig2 = sign('b'.repeat(64), '100', body);
    expect(sig1).not.toBe(sig2);
  });

  it('different timestamps produce different signatures', () => {
    const secret = 'a'.repeat(64);
    const body = new TextEncoder().encode('test');
    const sig1 = sign(secret, '100', body);
    const sig2 = sign(secret, '200', body);
    expect(sig1).not.toBe(sig2);
  });
});

describe('compress', () => {
  it('produces gzip output', async () => {
    const input = new TextEncoder().encode('hello world');
    const output = await compress(input);
    // Gzip magic bytes: 0x1f 0x8b
    expect(output[0]).toBe(0x1f);
    expect(output[1]).toBe(0x8b);
  });

  it('compressed output is smaller for large inputs', async () => {
    const input = new TextEncoder().encode('a'.repeat(10000));
    const output = await compress(input);
    expect(output.length).toBeLessThan(input.length);
  });
});

describe('raiseForStatus', () => {
  function makeHeaders(extra: Record<string, string> = {}): Headers {
    return new Headers(extra);
  }

  function makeBody(data: object): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(data));
  }

  it('throws NotFoundError for 404', () => {
    expect(() =>
      raiseForStatus(404, makeBody({ message: 'not found', code: 'NOT_FOUND' }), makeHeaders()),
    ).toThrow(NotFoundError);
  });

  it('throws UnauthorizedError for 401', () => {
    expect(() =>
      raiseForStatus(401, makeBody({ message: 'bad key' }), makeHeaders()),
    ).toThrow(UnauthorizedError);
  });

  it('throws ForbiddenError for 403', () => {
    expect(() =>
      raiseForStatus(403, makeBody({ message: 'forbidden' }), makeHeaders()),
    ).toThrow(ForbiddenError);
  });

  it('throws RateLimitedError for 429 with retry-after', () => {
    try {
      raiseForStatus(
        429,
        makeBody({ message: 'too many requests' }),
        makeHeaders({ 'retry-after': '30' }),
      );
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitedError);
      expect((err as RateLimitedError).retryAfter).toBe(30);
    }
  });

  it('throws ConflictError for 409', () => {
    expect(() =>
      raiseForStatus(409, makeBody({ message: 'conflict' }), makeHeaders()),
    ).toThrow(ConflictError);
  });

  it('throws ValidationError for 400', () => {
    expect(() =>
      raiseForStatus(400, makeBody({ message: 'invalid' }), makeHeaders()),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for 422', () => {
    expect(() =>
      raiseForStatus(422, makeBody({ message: 'unprocessable' }), makeHeaders()),
    ).toThrow(ValidationError);
  });

  it('throws ServerFaultError for 500', () => {
    expect(() =>
      raiseForStatus(500, makeBody({ message: 'internal error' }), makeHeaders()),
    ).toThrow(ServerFaultError);
  });

  it('throws ServerFaultError for 503', () => {
    expect(() =>
      raiseForStatus(503, makeBody({ message: 'service unavailable' }), makeHeaders()),
    ).toThrow(ServerFaultError);
  });

  it('throws generic APIError for unknown 4xx', () => {
    expect(() =>
      raiseForStatus(418, makeBody({ message: 'teapot' }), makeHeaders()),
    ).toThrow(APIError);
  });

  it('parses request-id from headers', () => {
    try {
      raiseForStatus(
        404,
        makeBody({ message: 'gone' }),
        makeHeaders({ 'x-request-id': 'req-456' }),
      );
    } catch (err) {
      expect((err as APIError).requestId).toBe('req-456');
    }
  });

  it('falls back to HTTP status message when body is not JSON', () => {
    try {
      raiseForStatus(500, new TextEncoder().encode('not json'), makeHeaders());
    } catch (err) {
      expect((err as APIError).message).toBe('HTTP 500');
    }
  });
});

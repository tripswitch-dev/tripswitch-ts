import { describe, it, expect } from 'vitest';
import {
  TripSwitchError,
  BreakerOpenError,
  ConflictingOptionsError,
  MetadataUnavailableError,
  TransportError,
  APIError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitedError,
  ConflictError,
  ValidationError,
  ServerFaultError,
} from '../src/errors.js';

describe('error hierarchy', () => {
  it('BreakerOpenError is instanceof TripSwitchError', () => {
    const err = new BreakerOpenError('my-breaker');
    expect(err).toBeInstanceOf(TripSwitchError);
    expect(err).toBeInstanceOf(BreakerOpenError);
    expect(err).toBeInstanceOf(Error);
    expect(err.breaker).toBe('my-breaker');
    expect(err.message).toBe('breaker is open: my-breaker');
  });

  it('BreakerOpenError without breaker name', () => {
    const err = new BreakerOpenError();
    expect(err.breaker).toBeUndefined();
    expect(err.message).toBe('breaker is open');
  });

  it('ConflictingOptionsError is instanceof TripSwitchError', () => {
    const err = new ConflictingOptionsError();
    expect(err).toBeInstanceOf(TripSwitchError);
    expect(err.message).toBe('conflicting execute options');
  });

  it('MetadataUnavailableError is instanceof TripSwitchError', () => {
    const err = new MetadataUnavailableError();
    expect(err).toBeInstanceOf(TripSwitchError);
    expect(err.message).toBe('metadata cache unavailable');
  });

  it('TransportError is instanceof TripSwitchError', () => {
    const err = new TransportError('connection refused');
    expect(err).toBeInstanceOf(TripSwitchError);
    expect(err.message).toBe('connection refused');
  });
});

describe('APIError hierarchy', () => {
  it('APIError carries status, code, requestId, body, retryAfter', () => {
    const body = new Uint8Array([1, 2, 3]);
    const err = new APIError('something failed', {
      status: 500,
      code: 'INTERNAL',
      requestId: 'req-123',
      body,
      retryAfter: 5,
    });
    expect(err).toBeInstanceOf(TripSwitchError);
    expect(err).toBeInstanceOf(APIError);
    expect(err.status).toBe(500);
    expect(err.code).toBe('INTERNAL');
    expect(err.requestId).toBe('req-123');
    expect(err.body).toBe(body);
    expect(err.retryAfter).toBe(5);
  });

  it('APIError defaults', () => {
    const err = new APIError('oops');
    expect(err.status).toBe(0);
    expect(err.code).toBe('');
    expect(err.requestId).toBe('');
    expect(err.retryAfter).toBeNull();
  });

  const subclasses = [
    { Class: NotFoundError, name: 'NotFoundError' },
    { Class: UnauthorizedError, name: 'UnauthorizedError' },
    { Class: ForbiddenError, name: 'ForbiddenError' },
    { Class: RateLimitedError, name: 'RateLimitedError' },
    { Class: ConflictError, name: 'ConflictError' },
    { Class: ValidationError, name: 'ValidationError' },
    { Class: ServerFaultError, name: 'ServerFaultError' },
  ] as const;

  for (const { Class, name } of subclasses) {
    it(`${name} extends APIError`, () => {
      const err = new Class('test', { status: 404 });
      expect(err).toBeInstanceOf(APIError);
      expect(err).toBeInstanceOf(TripSwitchError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe(name);
    });
  }

  it('instanceof checks work for distinguishing error types', () => {
    const err = new NotFoundError('not found', { status: 404 });
    expect(err instanceof NotFoundError).toBe(true);
    expect(err instanceof UnauthorizedError).toBe(false);
    expect(err instanceof APIError).toBe(true);
    expect(err instanceof TripSwitchError).toBe(true);
  });
});

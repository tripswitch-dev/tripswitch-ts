/** Base class for all TripSwitch errors. */
export class TripSwitchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TripSwitchError';
  }
}

/**
 * Raised when a circuit breaker is open and the request is rejected.
 * In half-open state, this may also be raised probabilistically.
 */
export class BreakerOpenError extends TripSwitchError {
  readonly breaker: string | undefined;

  constructor(breaker?: string) {
    const msg = breaker ? `breaker is open: ${breaker}` : 'breaker is open';
    super(msg);
    this.name = 'BreakerOpenError';
    this.breaker = breaker;
  }
}

/** Raised when mutually exclusive execute options are used together. */
export class ConflictingOptionsError extends TripSwitchError {
  constructor(message = 'conflicting execute options') {
    super(message);
    this.name = 'ConflictingOptionsError';
  }
}

/** Raised when a selector needs metadata but the cache is empty. */
export class MetadataUnavailableError extends TripSwitchError {
  constructor(message = 'metadata cache unavailable') {
    super(message);
    this.name = 'MetadataUnavailableError';
  }
}

/** Network or transport-level failure. */
export class TransportError extends TripSwitchError {
  constructor(message: string) {
    super(message);
    this.name = 'TransportError';
  }
}

// ── API errors ────────────────────────────────────────────────────────

/** Error response from the TripSwitch API. */
export class APIError extends TripSwitchError {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly body: Uint8Array;
  readonly retryAfter: number | null;

  constructor(
    message: string,
    opts: {
      status?: number;
      code?: string;
      requestId?: string;
      body?: Uint8Array;
      retryAfter?: number | null;
    } = {},
  ) {
    super(message);
    this.name = 'APIError';
    this.status = opts.status ?? 0;
    this.code = opts.code ?? '';
    this.requestId = opts.requestId ?? '';
    this.body = opts.body ?? new Uint8Array();
    this.retryAfter = opts.retryAfter ?? null;
  }
}

/** 404 Not Found. */
export class NotFoundError extends APIError {
  constructor(
    message: string,
    opts: ConstructorParameters<typeof APIError>[1] = {},
  ) {
    super(message, opts);
    this.name = 'NotFoundError';
  }
}

/** 401 Unauthorized. */
export class UnauthorizedError extends APIError {
  constructor(
    message: string,
    opts: ConstructorParameters<typeof APIError>[1] = {},
  ) {
    super(message, opts);
    this.name = 'UnauthorizedError';
  }
}

/** 403 Forbidden. */
export class ForbiddenError extends APIError {
  constructor(
    message: string,
    opts: ConstructorParameters<typeof APIError>[1] = {},
  ) {
    super(message, opts);
    this.name = 'ForbiddenError';
  }
}

/** 429 Too Many Requests. */
export class RateLimitedError extends APIError {
  constructor(
    message: string,
    opts: ConstructorParameters<typeof APIError>[1] = {},
  ) {
    super(message, opts);
    this.name = 'RateLimitedError';
  }
}

/** 409 Conflict. */
export class ConflictError extends APIError {
  constructor(
    message: string,
    opts: ConstructorParameters<typeof APIError>[1] = {},
  ) {
    super(message, opts);
    this.name = 'ConflictError';
  }
}

/** 400 or 422 validation error. */
export class ValidationError extends APIError {
  constructor(
    message: string,
    opts: ConstructorParameters<typeof APIError>[1] = {},
  ) {
    super(message, opts);
    this.name = 'ValidationError';
  }
}

/** 5xx server error. */
export class ServerFaultError extends APIError {
  constructor(
    message: string,
    opts: ConstructorParameters<typeof APIError>[1] = {},
  ) {
    super(message, opts);
    this.name = 'ServerFaultError';
  }
}

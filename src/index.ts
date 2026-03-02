// ── Runtime client ────────────────────────────────────────────────────
export { Client } from './client.js';

// ── Types & constants ────────────────────────────────────────────────
export { Latency, CONTRACT_VERSION } from './types.js';
export type {
  ClientOptions,
  ExecuteOptions,
  ReportInput,
  BreakerStatus,
  BreakerMeta,
  RouterMeta,
  SDKStats,
  Status,
  Logger,
} from './types.js';

// ── Errors ───────────────────────────────────────────────────────────
export {
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
} from './errors.js';

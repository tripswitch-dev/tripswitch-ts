/**
 * Sentinel value for automatic latency measurement.
 *
 * When used as a metric value in `execute()`, the SDK automatically computes
 * task duration in milliseconds.
 *
 * @example
 * ```ts
 * client.execute(task, {
 *   router: 'my-router',
 *   metrics: { latency: Latency },
 * });
 * ```
 */
export const Latency: unique symbol = Symbol.for('tripswitch.latency');

/** SDK Contract version this implementation conforms to. */
export const CONTRACT_VERSION = '0.2';

// ── Public types ──────────────────────────────────────────────────────

/** Cached state of a circuit breaker. */
export interface BreakerStatus {
  readonly name: string;
  readonly state: 'open' | 'closed' | 'half_open';
  readonly allowRate: number;
}

/** Breaker identity and user-defined metadata for dynamic selection. */
export interface BreakerMeta {
  readonly id: string;
  readonly name: string;
  readonly metadata: Readonly<Record<string, string>>;
}

/** Router identity and user-defined metadata for dynamic selection. */
export interface RouterMeta {
  readonly id: string;
  readonly name: string;
  readonly metadata: Readonly<Record<string, string>>;
}

/** Snapshot of SDK health metrics. */
export interface SDKStats {
  readonly droppedSamples: number;
  readonly bufferSize: number;
  readonly sseConnected: boolean;
  readonly sseReconnects: number;
  readonly lastSuccessfulFlush: Date | null;
  readonly lastSSEEvent: Date | null;
  readonly flushFailures: number;
  readonly cachedBreakers: number;
}

/** Project health summary from the API. */
export interface Status {
  readonly openCount: number;
  readonly closedCount: number;
  readonly lastEvalMs: number | null;
}

/** Logger interface compatible with console and structured loggers. */
export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

/** Constructor options for the runtime Client. */
export interface ClientOptions {
  /** Project ID (e.g. "proj_abc123"). */
  projectId: string;
  /** Project API key for SSE subscriptions (eb_pk_...). */
  apiKey?: string;
  /** Ingest secret for HMAC-signed sample ingestion (64-char hex). */
  ingestSecret?: string;
  /** Allow traffic when TripSwitch is unreachable. Defaults to `true`. */
  failOpen?: boolean;
  /** Override the default base URL. */
  baseUrl?: string;
  /** Custom logger. Defaults to console. */
  logger?: Logger;
  /** Callback invoked on breaker state transitions. */
  onStateChange?: (name: string, from: string, to: string) => void;
  /** Extract a trace ID for correlation. */
  traceIdExtractor?: () => string;
  /** Tags applied to every sample. */
  globalTags?: Record<string, string>;
  /** Metadata refresh interval in milliseconds. Set to 0 to disable. */
  metadataSyncInterval?: number;
  /**
   * Maximum milliseconds to wait for initial SSE sync.
   * Defaults to 30000 (30s). Set to 0 to wait indefinitely.
   */
  timeout?: number;
}

/**
 * Per-call options for `execute()`.
 *
 * @typeParam T - The return type of the task, used for deferred metrics.
 */
export interface ExecuteOptions<T = unknown> {
  /** Breaker names to gate on. */
  breakers?: string[];
  /** Dynamic breaker selector (mutually exclusive with `breakers`). */
  selectBreakers?: (breakers: readonly BreakerMeta[]) => string[];
  /** Router ID for sample routing. */
  router?: string;
  /** Dynamic router selector (mutually exclusive with `router`). */
  selectRouter?: (routers: readonly RouterMeta[]) => string;
  /** Metrics to report. Values can be `Latency`, `() => number`, or `number`. */
  metrics?: Record<string, typeof Latency | (() => number) | number>;
  /** Extract metrics from the task result after execution. */
  deferredMetrics?: (result: T | undefined, error: Error | null) => Record<string, number>;
  /** Per-call tags (merged with global tags; per-call wins). */
  tags?: Record<string, string>;
  /** Errors that should not count as failures. */
  ignoreErrors?: Array<new (...args: any[]) => Error>;
  /** Custom error evaluator. Return `true` if the error is a failure. */
  errorEvaluator?: (error: Error) => boolean;
  /** Explicit trace ID for this call. */
  traceId?: string;
}

/** Input for the standalone `report()` method. */
export interface ReportInput {
  /** Router ID (required). */
  routerId: string;
  /** Metric name (required). */
  metric: string;
  /** Metric value. */
  value?: number;
  /** Whether this sample represents a successful outcome. */
  ok?: boolean;
  /** Optional trace ID for correlation. */
  traceId?: string;
  /** Optional per-sample tags (merged with global tags). */
  tags?: Record<string, string>;
}

// ── Internal types (not exported from barrel) ─────────────────────────

/** @internal A single sample to be reported to the ingest endpoint. */
export interface Sample {
  routerId: string;
  metric: string;
  tsMs: number;
  value: number;
  ok: boolean;
  tags?: Record<string, string>;
  traceId?: string;
}

/** @internal Wire format for the ingest endpoint. */
export interface BatchPayload {
  samples: SampleWire[];
}

/** @internal Wire format for a single sample. */
export interface SampleWire {
  router_id: string;
  metric: string;
  ts_ms: number;
  value: number;
  ok: boolean;
  tags?: Record<string, string>;
  trace_id?: string;
}

/** @internal Local breaker state from SSE events. */
export interface BreakerState {
  state: 'open' | 'closed' | 'half_open';
  allowRate: number;
}

import type {
  BreakerMeta,
  BreakerStatus,
  ClientOptions,
  ExecuteOptions,
  Logger,
  ReportInput,
  RouterMeta,
  Sample,
  SampleWire,
  SDKStats,
  Status,
} from './types.js';
import { Latency } from './types.js';
import { BreakerOpenError, ConflictingOptionsError, MetadataUnavailableError, TransportError } from './errors.js';
import { UnauthorizedError, ForbiddenError } from './errors.js';
import { SampleBuffer } from './internal/buffer.js';
import { sign, compress } from './internal/http.js';
import { BreakerStateManager } from './sse.js';

const DEFAULT_BASE_URL = 'https://api.tripswitch.dev';
const BUFFER_CAPACITY = 10_000;
const BATCH_SIZE = 500;
const FLUSH_INTERVAL_MS = 15_000;
const DEFAULT_META_SYNC_INTERVAL_MS = 30_000;
const HTTP_TIMEOUT_MS = 30_000;
const BACKOFF_SCHEDULE = [100, 400, 1000];

const defaultLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: (...args) => console.warn('[tripswitch]', ...args),
  error: (...args) => console.error('[tripswitch]', ...args),
};

/**
 * The main TripSwitch client.
 *
 * Maintains real-time circuit breaker state via SSE, buffers and batches
 * execution samples, and supports metadata-driven dynamic selection.
 *
 * @example
 * ```ts
 * const client = await Client.create({
 *   projectId: 'proj_abc123',
 *   apiKey: 'eb_pk_...',
 *   ingestSecret: '...',
 * });
 *
 * const result = await client.execute(
 *   () => fetch('https://api.example.com/data'),
 *   { breakers: ['api-latency'], router: 'api-router', metrics: { latency: Latency } },
 * );
 *
 * await client.close();
 * ```
 */
export class Client {
  private readonly projectId: string;
  private readonly apiKey: string;
  private readonly ingestSecret: string;
  private readonly failOpen: boolean;
  private readonly baseUrl: string;
  private readonly logger: Logger;
  private readonly traceIdExtractor?: () => string;
  private readonly globalTags: Record<string, string>;

  private readonly abortController = new AbortController();
  private readonly buffer: SampleBuffer;
  private readonly sseManager: BreakerStateManager | null;

  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private metaSyncTimer: ReturnType<typeof setInterval> | null = null;
  private readonly metaSyncInterval: number;

  // Metadata cache
  private breakersMeta: readonly BreakerMeta[] | undefined;
  private routersMeta: readonly RouterMeta[] | undefined;
  private breakersETag = '';
  private routersETag = '';

  // Stats tracking
  private lastSuccessfulFlush: Date | null = null;
  private flushFailures = 0;
  private inFlightSends = 0;
  private closePromise: Promise<void> | null = null;

  private constructor(opts: ClientOptions) {
    this.projectId = opts.projectId;
    this.apiKey = opts.apiKey ?? '';
    this.ingestSecret = opts.ingestSecret ?? '';
    this.failOpen = opts.failOpen ?? true;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.logger = opts.logger ?? defaultLogger;
    this.traceIdExtractor = opts.traceIdExtractor;
    this.globalTags = opts.globalTags ? { ...opts.globalTags } : {};
    this.metaSyncInterval = opts.metadataSyncInterval ?? DEFAULT_META_SYNC_INTERVAL_MS;
    this.buffer = new SampleBuffer(BUFFER_CAPACITY);

    // Set up SSE if API key provided
    if (opts.apiKey) {
      this.sseManager = new BreakerStateManager({
        baseUrl: this.baseUrl,
        projectId: this.projectId,
        apiKey: opts.apiKey,
        logger: this.logger,
        onStateChange: opts.onStateChange,
      });
    } else {
      this.sseManager = null;
    }
  }

  /**
   * Create and initialize a new Client.
   *
   * If an API key is configured, this blocks until the first SSE event
   * is received or the timeout expires.
   */
  static async create(opts: ClientOptions): Promise<Client> {
    const client = new Client(opts);

    // Start SSE connection
    if (client.sseManager) {
      client.sseManager.connect();

      // Wait for SSE readiness with optional timeout
      if (opts.timeout != null && opts.timeout > 0) {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new TransportError('initialization timed out')),
            opts.timeout!,
          ),
        );
        await Promise.race([client.sseManager.ready, timeout]);
      } else {
        await client.sseManager.ready;
      }
    }

    // Start flush interval
    client.flushTimer = setInterval(() => {
      client.flush().catch((err) => {
        client.logger.error('flush failed', 'error', err);
      });
    }, FLUSH_INTERVAL_MS);

    // Start metadata sync
    if (client.metaSyncInterval > 0) {
      // Initial fetch
      client.refreshMetadata().catch(() => {});

      client.metaSyncTimer = setInterval(() => {
        client.refreshMetadata().catch(() => {});
      }, client.metaSyncInterval);
    }

    return client;
  }

  // ── Core ────────────────────────────────────────────────────────────

  /**
   * Execute a task with circuit breaker logic.
   *
   * Checks breaker states, runs the task, resolves metrics, and enqueues
   * samples for batch ingestion.
   */
  async execute<T>(
    task: () => T | Promise<T>,
    options?: ExecuteOptions<T>,
  ): Promise<T> {
    const opts = options ?? {};

    // 1. Validate conflicting options
    if (opts.breakers && opts.selectBreakers) {
      throw new ConflictingOptionsError(
        'breakers and selectBreakers are mutually exclusive',
      );
    }
    if (opts.router && opts.selectRouter) {
      throw new ConflictingOptionsError(
        'router and selectRouter are mutually exclusive',
      );
    }

    // 2. Resolve dynamic breakers
    let breakers = opts.breakers;
    if (opts.selectBreakers) {
      const meta = this.getBreakersMetadata();
      if (!meta) throw new MetadataUnavailableError();
      try {
        breakers = opts.selectBreakers(meta);
      } catch (err) {
        this.logger.warn('breaker selector threw', 'error', err);
        breakers = [];
      }
    }

    // 3. Resolve dynamic router
    let routerId = opts.router;
    if (opts.selectRouter) {
      const meta = this.getRoutersMetadata();
      if (!meta) throw new MetadataUnavailableError();
      try {
        routerId = opts.selectRouter(meta);
      } catch (err) {
        this.logger.warn('router selector threw', 'error', err);
        routerId = '';
      }
    }

    // 4. Check breaker states
    if (breakers && breakers.length > 0) {
      this.checkBreakers(breakers);
    }

    // 5. Execute task
    const startTime = Date.now();
    let result: T;
    let taskError: Error | null = null;

    try {
      result = await task();
    } catch (err) {
      taskError = err instanceof Error ? err : new Error(String(err));
      throw taskError;
    } finally {
      const durationMs = Date.now() - startTime;

      // 6. Determine success/failure
      const ok = taskError === null || !this.isFailure(taskError, opts);

      // 7. Resolve trace ID
      let traceId = opts.traceId ?? '';
      if (!traceId && this.traceIdExtractor) {
        try {
          traceId = this.traceIdExtractor();
        } catch {
          // ignore
        }
      }

      // 8. Emit samples
      const hasMetrics =
        (opts.metrics && Object.keys(opts.metrics).length > 0) ||
        opts.deferredMetrics;
      if (hasMetrics && !routerId) {
        this.logger.warn(
          'metrics specified but no router - samples will not be emitted',
        );
      }

      if (routerId) {
        const samples = this.resolveMetrics(opts.metrics, durationMs);

        // Resolve deferred metrics
        if (opts.deferredMetrics) {
          try {
            const deferred = opts.deferredMetrics(result!, taskError);
            if (deferred) {
              for (const [key, value] of Object.entries(deferred)) {
                if (key) samples.push({ metric: key, value });
              }
            }
          } catch (err) {
            this.logger.warn('deferred metrics function threw', 'error', err);
          }
        }

        const mergedTags = this.mergeTags(opts.tags);
        const tsMs = startTime;

        for (const sample of samples) {
          this.enqueue({
            routerId: routerId,
            metric: sample.metric,
            tsMs,
            value: sample.value,
            ok,
            tags: mergedTags,
            traceId: traceId || undefined,
          });
        }
      }
    }

    return result!;
  }

  /** Send a sample outside of `execute()` for async or fire-and-forget workflows. */
  report(input: ReportInput): void {
    if (!input.routerId || !input.metric) {
      this.logger.warn(
        'report called with missing required fields',
        'routerId', input.routerId,
        'metric', input.metric,
      );
      return;
    }

    this.enqueue({
      routerId: input.routerId,
      metric: input.metric,
      tsMs: Date.now(),
      value: input.value ?? 0,
      ok: input.ok ?? true,
      tags: this.mergeTags(input.tags),
      traceId: input.traceId || undefined,
    });
  }

  // ── State inspection ────────────────────────────────────────────────

  /** Get the cached state of a single breaker. */
  getState(name: string): BreakerStatus | undefined {
    return this.sseManager?.getState(name);
  }

  /** Get all cached breaker states. */
  getAllStates(): ReadonlyMap<string, BreakerStatus> {
    return this.sseManager?.getAllStates() ?? new Map();
  }

  /** SDK health metrics snapshot. */
  get stats(): SDKStats {
    return {
      droppedSamples: this.buffer.droppedCount,
      bufferSize: this.buffer.size,
      sseConnected: this.sseManager?.isConnected ?? false,
      sseReconnects: this.sseManager?.reconnectCount ?? 0,
      lastSuccessfulFlush: this.lastSuccessfulFlush,
      lastSSEEvent: this.sseManager?.lastEvent ?? null,
      flushFailures: this.flushFailures,
      cachedBreakers: this.sseManager?.cachedBreakerCount ?? 0,
    };
  }

  // ── Metadata ────────────────────────────────────────────────────────

  /** Cached breaker metadata, or `undefined` if not yet populated. */
  getBreakersMetadata(): readonly BreakerMeta[] | undefined {
    return this.breakersMeta;
  }

  /** Cached router metadata, or `undefined` if not yet populated. */
  getRoutersMetadata(): readonly RouterMeta[] | undefined {
    return this.routersMeta;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  /** Gracefully shut down: stop SSE, flush remaining samples, clear timers. */
  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;

    this.closePromise = this.doClose();
    return this.closePromise;
  }

  /** Support `await using client = await Client.create(...)` */
  async [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  // ── Private ─────────────────────────────────────────────────────────

  private async doClose(): Promise<void> {
    // Signal abort
    this.abortController.abort();

    // Clear timers
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.metaSyncTimer) {
      clearInterval(this.metaSyncTimer);
      this.metaSyncTimer = null;
    }

    // Final flush
    await this.flush();

    // Wait for in-flight sends
    while (this.inFlightSends > 0) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Close SSE
    this.sseManager?.close();
  }

  private checkBreakers(breakers: string[]): void {
    if (!this.sseManager) return;

    let minAllowRate = 1.0;

    for (const name of breakers) {
      const state = this.sseManager.getRawState(name);
      if (!state) continue;

      if (state.state === 'open') {
        throw new BreakerOpenError(name);
      }

      if (state.state === 'half_open' && state.allowRate < minAllowRate) {
        minAllowRate = state.allowRate;
      }
    }

    if (minAllowRate < 1.0 && Math.random() >= minAllowRate) {
      throw new BreakerOpenError();
    }
  }

  private isFailure<T>(err: Error, opts: ExecuteOptions<T>): boolean {
    if (opts.errorEvaluator) {
      return opts.errorEvaluator(err);
    }

    if (opts.ignoreErrors) {
      for (const ErrorClass of opts.ignoreErrors) {
        if (err instanceof ErrorClass) return false;
      }
    }

    return true;
  }

  private resolveMetrics(
    metrics: ExecuteOptions['metrics'] | undefined,
    durationMs: number,
  ): Array<{ metric: string; value: number }> {
    if (!metrics) return [];

    const result: Array<{ metric: string; value: number }> = [];

    for (const [key, val] of Object.entries(metrics)) {
      if (!key) continue;

      if (val === Latency) {
        result.push({ metric: key, value: durationMs });
      } else if (typeof val === 'function') {
        try {
          result.push({ metric: key, value: val() });
        } catch (err) {
          this.logger.warn('metric closure threw', 'metric', key, 'error', err);
        }
      } else if (typeof val === 'number') {
        result.push({ metric: key, value: val });
      } else {
        this.logger.warn(
          'unsupported metric value type',
          'metric', key,
          'type', typeof val,
        );
      }
    }

    return result;
  }

  private mergeTags(
    dynamic?: Record<string, string>,
  ): Record<string, string> | undefined {
    if (!dynamic || Object.keys(dynamic).length === 0) {
      return Object.keys(this.globalTags).length > 0 ? this.globalTags : undefined;
    }
    if (Object.keys(this.globalTags).length === 0) {
      return dynamic;
    }
    return { ...this.globalTags, ...dynamic };
  }

  private enqueue(sample: Sample): void {
    const accepted = this.buffer.push(sample);
    if (!accepted) {
      // Buffer full, sample dropped (counted by buffer)
      return;
    }

    // Trigger flush if batch size reached
    if (this.buffer.size >= BATCH_SIZE) {
      this.flush().catch((err) => {
        this.logger.error('flush failed', 'error', err);
      });
    }
  }

  private async flush(): Promise<void> {
    const samples = this.buffer.drain(BATCH_SIZE);
    if (samples.length === 0) return;
    await this.sendBatch(samples);
  }

  private async sendBatch(samples: Sample[]): Promise<void> {
    if (samples.length === 0) return;

    this.inFlightSends++;

    try {
      // Convert to wire format
      const wireSamples: SampleWire[] = samples.map((s) => {
        const w: SampleWire = {
          router_id: s.routerId,
          metric: s.metric,
          ts_ms: s.tsMs,
          value: s.value,
          ok: s.ok,
        };
        if (s.tags) w.tags = s.tags;
        if (s.traceId) w.trace_id = s.traceId;
        return w;
      });

      const payload = JSON.stringify({ samples: wireSamples });
      const compressed = new Uint8Array(await compress(new TextEncoder().encode(payload)));

      const timestampMs = String(Date.now());

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'X-EB-Timestamp': timestampMs,
      };

      if (this.ingestSecret) {
        headers['X-EB-Signature'] = sign(
          this.ingestSecret,
          timestampMs,
          compressed,
        );
      }

      const url = `${this.baseUrl}/v1/projects/${this.projectId}/ingest`;

      for (let attempt = 0; attempt <= BACKOFF_SCHEDULE.length; attempt++) {
        if (this.abortController.signal.aborted && attempt > 0) {
          // On shutdown, don't retry
          break;
        }

        if (attempt > 0) {
          const delay = BACKOFF_SCHEDULE[attempt - 1];
          await new Promise((r) => setTimeout(r, delay));
        }

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: compressed,
          });

          if (response.status >= 200 && response.status < 300) {
            this.lastSuccessfulFlush = new Date();
            return;
          }

          this.logger.error(
            'batch request failed',
            'status', response.status,
            'attempt', attempt + 1,
          );
        } catch (err) {
          if (this.abortController.signal.aborted) break;
          this.logger.error(
            'failed to send batch',
            'error', err,
            'attempt', attempt + 1,
          );
        }
      }

      // Retries exhausted
      this.logger.error(
        'dropping batch after retries exhausted',
        'count', samples.length,
      );
      this.flushFailures++;
    } finally {
      this.inFlightSends--;
    }
  }

  private async refreshMetadata(): Promise<void> {
    await Promise.all([
      this.refreshBreakersMetadata(),
      this.refreshRoutersMetadata(),
    ]);
  }

  private async refreshBreakersMetadata(): Promise<void> {
    try {
      const url = `${this.baseUrl}/v1/projects/${this.projectId}/breakers/metadata`;
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      if (this.breakersETag) {
        headers['If-None-Match'] = this.breakersETag;
      }

      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.status === 304) return;
      if (response.status === 401 || response.status === 403) {
        this.logger.warn('metadata sync stopping due to auth failure');
        if (this.metaSyncTimer) {
          clearInterval(this.metaSyncTimer);
          this.metaSyncTimer = null;
        }
        return;
      }

      if (!response.ok) {
        this.logger.warn('failed to refresh breakers metadata', 'status', response.status);
        return;
      }

      const data = await response.json() as { breakers?: Array<{ id: string; name: string; metadata?: Record<string, string> }> };
      const etag = response.headers.get('etag') ?? '';

      this.breakersMeta = Object.freeze(
        (data.breakers ?? []).map((b) =>
          Object.freeze({
            id: b.id,
            name: b.name,
            metadata: Object.freeze(b.metadata ?? {}),
          }),
        ),
      );
      this.breakersETag = etag;
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
        this.logger.warn('metadata sync stopping due to auth failure');
        if (this.metaSyncTimer) {
          clearInterval(this.metaSyncTimer);
          this.metaSyncTimer = null;
        }
        return;
      }
      this.logger.warn('failed to refresh breakers metadata', 'error', err);
    }
  }

  private async refreshRoutersMetadata(): Promise<void> {
    try {
      const url = `${this.baseUrl}/v1/projects/${this.projectId}/routers/metadata`;
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      if (this.routersETag) {
        headers['If-None-Match'] = this.routersETag;
      }

      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.status === 304) return;
      if (response.status === 401 || response.status === 403) {
        this.logger.warn('metadata sync stopping due to auth failure');
        if (this.metaSyncTimer) {
          clearInterval(this.metaSyncTimer);
          this.metaSyncTimer = null;
        }
        return;
      }

      if (!response.ok) {
        this.logger.warn('failed to refresh routers metadata', 'status', response.status);
        return;
      }

      const data = await response.json() as { routers?: Array<{ id: string; name: string; metadata?: Record<string, string> }> };
      const etag = response.headers.get('etag') ?? '';

      this.routersMeta = Object.freeze(
        (data.routers ?? []).map((r) =>
          Object.freeze({
            id: r.id,
            name: r.name,
            metadata: Object.freeze(r.metadata ?? {}),
          }),
        ),
      );
      this.routersETag = etag;
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
        this.logger.warn('metadata sync stopping due to auth failure');
        if (this.metaSyncTimer) {
          clearInterval(this.metaSyncTimer);
          this.metaSyncTimer = null;
        }
        return;
      }
      this.logger.warn('failed to refresh routers metadata', 'error', err);
    }
  }
}

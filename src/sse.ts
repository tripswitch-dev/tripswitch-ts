import EventSource from 'eventsource';
import type { BreakerState, BreakerStatus, Logger } from './types.js';

/** Reconnection backoff schedule in seconds, capped at the last value. */
const RECONNECT_BACKOFFS = [1, 2, 4, 8, 15, 30];

/** SSE event payload from the server. */
interface SSEBreakerEvent {
  breaker: string;
  state: 'open' | 'closed' | 'half_open';
  allow_rate: number | null;
}

export interface BreakerStateManagerOptions {
  baseUrl: string;
  projectId: string;
  apiKey: string;
  logger: Logger;
  onStateChange?: (name: string, from: string, to: string) => void;
}

/**
 * Manages SSE connection and breaker state cache.
 *
 * Connects to the TripSwitch SSE endpoint and maintains an in-memory
 * map of breaker states, updated in real-time.
 */
export class BreakerStateManager {
  private readonly states = new Map<string, BreakerState>();
  private readonly logger: Logger;
  private readonly onStateChange?: (name: string, from: string, to: string) => void;
  private readonly url: string;
  private readonly apiKey: string;

  private eventSource: EventSource | null = null;
  private closed = false;
  private reconnects = 0;
  private connected = false;
  private lastEventTime: Date | null = null;

  private readyResolve!: () => void;
  readonly ready: Promise<void>;

  constructor(opts: BreakerStateManagerOptions) {
    this.logger = opts.logger;
    this.onStateChange = opts.onStateChange;
    this.url = `${opts.baseUrl}/v1/projects/${opts.projectId}/breakers/state:stream`;
    this.apiKey = opts.apiKey;

    this.ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
  }

  /** Start the SSE connection. */
  connect(): void {
    if (this.closed) return;
    this.doConnect();
  }

  private doConnect(): void {
    if (this.closed) return;

    this.eventSource = new EventSource(this.url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    const handleEvent = (event: MessageEvent) => {
      try {
        const data: SSEBreakerEvent = JSON.parse(event.data);
        // Default to 0 when null. allowRate is only meaningful for half_open
        // state; for closed/open breakers, the gating logic ignores it.
        const allowRate = data.allow_rate ?? 0;

        if (data.state === 'half_open' && data.allow_rate === null) {
          this.logger.warn(
            'SSE event has null allow_rate for half_open breaker',
            'breaker', data.breaker,
          );
        }

        this.updateState(data.breaker, data.state, allowRate);

        this.connected = true;
        this.lastEventTime = new Date();

        // Resolve ready on first event
        this.readyResolve();
      } catch (err) {
        this.logger.error(
          'failed to parse SSE event',
          'error', err,
          'data', event.data,
        );
      }
    };

    // Listen for named "state" events from the server
    this.eventSource.addEventListener('state', handleEvent as any);
    // Also handle unnamed/message events for backwards compatibility
    this.eventSource.onmessage = handleEvent;

    this.eventSource.onerror = () => {
      if (this.closed) return;

      this.connected = false;
      this.reconnects++;

      // Close the current connection and schedule reconnect
      this.eventSource?.close();
      this.eventSource = null;

      const backoffIdx = Math.min(
        this.reconnects - 1,
        RECONNECT_BACKOFFS.length - 1,
      );
      const delay = RECONNECT_BACKOFFS[backoffIdx] * 1000;

      this.logger.warn(
        'SSE connection lost, reconnecting',
        'reconnects', this.reconnects,
        'backoffMs', delay,
      );

      setTimeout(() => this.doConnect(), delay);
    };
  }

  private updateState(
    name: string,
    newState: 'open' | 'closed' | 'half_open',
    allowRate: number,
  ): void {
    const existing = this.states.get(name);
    const oldState = existing?.state ?? '';

    this.states.set(name, { state: newState, allowRate });

    this.logger.info(
      'breaker state updated',
      'name', name,
      'oldState', oldState,
      'newState', newState,
      'allowRate', allowRate,
    );

    if (oldState && oldState !== newState && this.onStateChange) {
      this.onStateChange(name, oldState, newState);
    }
  }

  /** Get the state of a single breaker. */
  getState(name: string): BreakerStatus | undefined {
    const state = this.states.get(name);
    if (!state) return undefined;
    return { name, state: state.state, allowRate: state.allowRate };
  }

  /** Get all cached breaker states. */
  getAllStates(): ReadonlyMap<string, BreakerStatus> {
    const result = new Map<string, BreakerStatus>();
    for (const [name, state] of this.states) {
      result.set(name, { name, state: state.state, allowRate: state.allowRate });
    }
    return result;
  }

  /** Check if a breaker exists in the cache. */
  has(name: string): boolean {
    return this.states.has(name);
  }

  /** Get raw internal state (used by the client for gating). */
  getRawState(name: string): BreakerState | undefined {
    return this.states.get(name);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get reconnectCount(): number {
    return this.reconnects;
  }

  get lastEvent(): Date | null {
    return this.lastEventTime;
  }

  get cachedBreakerCount(): number {
    return this.states.size;
  }

  /** Close the SSE connection and stop reconnecting. */
  close(): void {
    this.closed = true;
    this.connected = false;
    this.eventSource?.close();
    this.eventSource = null;
  }
}

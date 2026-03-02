import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Logger } from '../src/types.js';

// Use vi.hoisted to define mock before vi.mock hoisting
const { MockES, getMockInstances, resetMockInstances } = vi.hoisted(() => {
  const instances: any[] = [];
  class MockES {
    onmessage: ((event: any) => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    url: string;
    opts: any;
    private listeners = new Map<string, Set<(event: any) => void>>();

    constructor(url: string, opts: any) {
      this.url = url;
      this.opts = opts;
      instances.push(this);
    }

    addEventListener(type: string, handler: (event: any) => void) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(handler);
    }

    close() { this.closed = true; }

    simulateEvent(data: object) {
      const event = { data: JSON.stringify(data) };
      // Dispatch to named 'state' listeners (matches real server behavior)
      for (const handler of this.listeners.get('state') ?? []) {
        handler(event);
      }
      // Also dispatch to onmessage
      this.onmessage?.(event);
    }

    simulateError() {
      this.onerror?.();
    }
  }

  return {
    MockES,
    getMockInstances: () => instances,
    resetMockInstances: () => { instances.length = 0; },
  };
});

vi.mock('eventsource', () => ({ default: MockES }));

import { BreakerStateManager } from '../src/sse.js';

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeManager(overrides?: Partial<ConstructorParameters<typeof BreakerStateManager>[0]>) {
  const logger = makeLogger();
  return {
    manager: new BreakerStateManager({
      baseUrl: 'https://api.tripswitch.dev',
      projectId: 'proj_test',
      apiKey: 'eb_pk_test',
      logger,
      ...overrides,
    }),
    logger,
  };
}

function lastES() {
  const instances = getMockInstances();
  return instances[instances.length - 1];
}

describe('BreakerStateManager', () => {
  afterEach(() => {
    resetMockInstances();
    vi.restoreAllMocks();
  });

  it('starts with no states', () => {
    const { manager } = makeManager();
    expect(manager.getState('test')).toBeUndefined();
    expect(manager.getAllStates().size).toBe(0);
    expect(manager.cachedBreakerCount).toBe(0);
  });

  it('connect creates EventSource and resolves ready on first event', async () => {
    const { manager } = makeManager();
    manager.connect();

    const es = lastES();
    expect(es).toBeDefined();
    expect(es.url).toContain('/v1/projects/proj_test/breakers/state:stream');
    expect(es.opts.headers.Authorization).toBe('Bearer eb_pk_test');

    es.simulateEvent({ breaker: 'checkout-latency', state: 'closed', allow_rate: 0 });
    await manager.ready;

    const state = manager.getState('checkout-latency');
    expect(state).toBeDefined();
    expect(state!.state).toBe('closed');
    expect(state!.allowRate).toBe(0);
    expect(manager.isConnected).toBe(true);

    manager.close();
  });

  it('updates state on subsequent events', async () => {
    const { manager } = makeManager();
    manager.connect();
    const es = lastES();

    es.simulateEvent({ breaker: 'api-errors', state: 'closed', allow_rate: 0 });
    await manager.ready;

    es.simulateEvent({ breaker: 'api-errors', state: 'open', allow_rate: null });
    expect(manager.getState('api-errors')!.state).toBe('open');

    manager.close();
  });

  it('fires onStateChange callback on transitions', async () => {
    const onChange = vi.fn();
    const { manager } = makeManager({ onStateChange: onChange });
    manager.connect();
    const es = lastES();

    es.simulateEvent({ breaker: 'test-breaker', state: 'closed', allow_rate: 0 });
    await manager.ready;
    expect(onChange).not.toHaveBeenCalled();

    es.simulateEvent({ breaker: 'test-breaker', state: 'open', allow_rate: null });
    expect(onChange).toHaveBeenCalledWith('test-breaker', 'closed', 'open');

    manager.close();
  });

  it('does not fire callback when state is the same', async () => {
    const onChange = vi.fn();
    const { manager } = makeManager({ onStateChange: onChange });
    manager.connect();
    const es = lastES();

    es.simulateEvent({ breaker: 'test', state: 'closed', allow_rate: 0 });
    await manager.ready;
    es.simulateEvent({ breaker: 'test', state: 'closed', allow_rate: 0 });
    expect(onChange).not.toHaveBeenCalled();

    manager.close();
  });

  it('handles half_open with allow_rate', async () => {
    const { manager } = makeManager();
    manager.connect();
    lastES().simulateEvent({ breaker: 'test', state: 'half_open', allow_rate: 0.3 });
    await manager.ready;

    const state = manager.getState('test');
    expect(state!.state).toBe('half_open');
    expect(state!.allowRate).toBe(0.3);
    manager.close();
  });

  it('warns on null allow_rate for half_open', async () => {
    const { manager, logger } = makeManager();
    manager.connect();
    lastES().simulateEvent({ breaker: 'test', state: 'half_open', allow_rate: null });
    await manager.ready;

    expect(logger.warn).toHaveBeenCalled();
    manager.close();
  });

  it('getAllStates returns all cached states', async () => {
    const { manager } = makeManager();
    manager.connect();
    const es = lastES();

    es.simulateEvent({ breaker: 'a', state: 'closed', allow_rate: 0 });
    es.simulateEvent({ breaker: 'b', state: 'open', allow_rate: null });
    await manager.ready;

    const all = manager.getAllStates();
    expect(all.size).toBe(2);
    expect(all.get('a')!.state).toBe('closed');
    expect(all.get('b')!.state).toBe('open');
    manager.close();
  });

  it('close stops the event source', () => {
    const { manager } = makeManager();
    manager.connect();
    const es = lastES();
    manager.close();
    expect(es.closed).toBe(true);
    expect(manager.isConnected).toBe(false);
  });

  it('tracks lastEvent timestamp', async () => {
    const { manager } = makeManager();
    expect(manager.lastEvent).toBeNull();
    manager.connect();
    lastES().simulateEvent({ breaker: 'x', state: 'closed', allow_rate: 0 });
    await manager.ready;
    expect(manager.lastEvent).toBeInstanceOf(Date);
    manager.close();
  });

  it('getRawState returns internal state for gating', async () => {
    const { manager } = makeManager();
    manager.connect();
    lastES().simulateEvent({ breaker: 'x', state: 'half_open', allow_rate: 0.5 });
    await manager.ready;

    const raw = manager.getRawState('x');
    expect(raw!.state).toBe('half_open');
    expect(raw!.allowRate).toBe(0.5);
    expect(manager.getRawState('nonexistent')).toBeUndefined();
    manager.close();
  });

  it('reconnects on error', async () => {
    vi.useFakeTimers();
    const { manager } = makeManager();
    manager.connect();
    const es1 = lastES();

    es1.simulateEvent({ breaker: 'x', state: 'closed', allow_rate: 0 });
    await manager.ready;
    expect(manager.reconnectCount).toBe(0);

    es1.simulateError();
    expect(manager.reconnectCount).toBe(1);
    expect(manager.isConnected).toBe(false);

    vi.advanceTimersByTime(1500);
    expect(getMockInstances().length).toBe(2);

    manager.close();
    vi.useRealTimers();
  });
});

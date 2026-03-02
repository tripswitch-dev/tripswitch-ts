import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '../src/client.js';
import { BreakerOpenError, ConflictingOptionsError, MetadataUnavailableError } from '../src/errors.js';
import { Latency } from '../src/types.js';

const { MockES, getMockInstances, resetMockInstances } = vi.hoisted(() => {
  const instances: any[] = [];
  class MockES {
    onmessage: ((event: any) => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;

    constructor(_url: string, _opts: any) {
      instances.push(this);
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({ breaker: '__init__', state: 'closed', allow_rate: 0 }),
        });
      });
    }

    close() { this.closed = true; }

    simulateEvent(data: object) {
      this.onmessage?.({ data: JSON.stringify(data) });
    }
  }

  return {
    MockES,
    getMockInstances: () => instances,
    resetMockInstances: () => { instances.length = 0; },
  };
});

vi.mock('eventsource', () => ({ default: MockES }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function respondWith(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(data),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  });
}

describe('execute()', () => {
  afterEach(async () => {
    resetMockInstances();
    mockFetch.mockReset();
    vi.restoreAllMocks();
  });

  async function makeClient(opts: Record<string, unknown> = {}) {
    mockFetch.mockImplementation(() => respondWith({ breakers: [], routers: [] }));
    return Client.create({
      projectId: 'proj_test',
      apiKey: 'eb_pk_test',
      ingestSecret: 'a'.repeat(64),
      metadataSyncInterval: 0,
      ...opts,
    });
  }

  function lastES() {
    const instances = getMockInstances();
    return instances[instances.length - 1];
  }

  it('executes a sync task and returns its result', async () => {
    const client = await makeClient();
    const result = await client.execute(() => 42);
    expect(result).toBe(42);
    await client.close();
  });

  it('executes an async task and returns its result', async () => {
    const client = await makeClient();
    const result = await client.execute(async () => 'hello');
    expect(result).toBe('hello');
    await client.close();
  });

  it('re-throws task errors', async () => {
    const client = await makeClient();
    await expect(
      client.execute(() => { throw new Error('task failed'); }),
    ).rejects.toThrow('task failed');
    await client.close();
  });

  it('re-throws async task errors', async () => {
    const client = await makeClient();
    await expect(
      client.execute(async () => { throw new Error('async fail'); }),
    ).rejects.toThrow('async fail');
    await client.close();
  });

  it('throws ConflictingOptionsError for breakers + selectBreakers', async () => {
    const client = await makeClient();
    await expect(
      client.execute(() => 1, { breakers: ['a'], selectBreakers: () => ['b'] }),
    ).rejects.toThrow(ConflictingOptionsError);
    await client.close();
  });

  it('throws ConflictingOptionsError for router + selectRouter', async () => {
    const client = await makeClient();
    await expect(
      client.execute(() => 1, { router: 'r1', selectRouter: () => 'r2' }),
    ).rejects.toThrow(ConflictingOptionsError);
    await client.close();
  });

  it('throws MetadataUnavailableError when selectBreakers used without metadata', async () => {
    const client = await makeClient();
    await expect(
      client.execute(() => 1, {
        selectBreakers: (breakers) => breakers.map((b) => b.name),
      }),
    ).rejects.toThrow(MetadataUnavailableError);
    await client.close();
  });

  it('throws MetadataUnavailableError when selectRouter used without metadata', async () => {
    const client = await makeClient();
    await expect(
      client.execute(() => 1, {
        selectRouter: (routers) => routers[0]?.id ?? '',
      }),
    ).rejects.toThrow(MetadataUnavailableError);
    await client.close();
  });

  it('throws BreakerOpenError when breaker is open', async () => {
    const client = await makeClient();
    lastES().simulateEvent({ breaker: 'test-breaker', state: 'open', allow_rate: null });

    await expect(
      client.execute(() => 1, { breakers: ['test-breaker'] }),
    ).rejects.toThrow(BreakerOpenError);
    await client.close();
  });

  it('allows request through closed breaker', async () => {
    const client = await makeClient();
    lastES().simulateEvent({ breaker: 'test-breaker', state: 'closed', allow_rate: 0 });

    const result = await client.execute(() => 'ok', { breakers: ['test-breaker'] });
    expect(result).toBe('ok');
    await client.close();
  });

  it('enqueues samples when router is specified', async () => {
    const client = await makeClient();
    await client.execute(() => 'result', {
      router: 'router-1',
      metrics: { latency: Latency },
    });
    expect(client.stats.bufferSize).toBe(1);
    await client.close();
  });

  it('enqueues multiple samples for multiple metrics', async () => {
    const client = await makeClient();
    await client.execute(() => 'result', {
      router: 'router-1',
      metrics: { latency: Latency, custom: 42, computed: () => 100 },
    });
    expect(client.stats.bufferSize).toBe(3);
    await client.close();
  });

  it('does not enqueue samples when no router', async () => {
    const client = await makeClient();
    await client.execute(() => 'result', { metrics: { latency: Latency } });
    expect(client.stats.bufferSize).toBe(0);
    await client.close();
  });

  it('merges global tags with per-call tags', async () => {
    const client = await makeClient({ globalTags: { env: 'test', version: '1.0' } });
    await client.execute(() => 'result', {
      router: 'router-1',
      metrics: { latency: Latency },
      tags: { env: 'staging', region: 'us-east' },
    });
    expect(client.stats.bufferSize).toBe(1);
    await client.close();
  });

  it('resolves Latency sentinel to duration', async () => {
    const client = await makeClient();
    const result = await client.execute(
      () => 'done',
      { router: 'router-1', metrics: { latency: Latency } },
    );
    expect(result).toBe('done');
    expect(client.stats.bufferSize).toBe(1);
    await client.close();
  });

  it('handles metric closures that throw', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const client = await makeClient({ logger });
    await client.execute(() => 'result', {
      router: 'router-1',
      metrics: {
        good: () => 42,
        bad: () => { throw new Error('boom'); },
      },
    });
    expect(logger.warn).toHaveBeenCalled();
    expect(client.stats.bufferSize).toBe(1);
    await client.close();
  });

  it('supports deferred metrics', async () => {
    const client = await makeClient();
    await client.execute(
      () => ({ tokens: 150 }),
      {
        router: 'router-1',
        metrics: { latency: Latency },
        deferredMetrics: (result, _err) => ({ tokens: result?.tokens ?? 0 }),
      },
    );
    expect(client.stats.bufferSize).toBe(2);
    await client.close();
  });

  it('handles deferred metrics that throw', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const client = await makeClient({ logger });
    await client.execute(
      () => 'result',
      {
        router: 'router-1',
        deferredMetrics: () => { throw new Error('deferred boom'); },
      },
    );
    expect(logger.warn).toHaveBeenCalled();
    await client.close();
  });

  it('ignores errors listed in ignoreErrors', async () => {
    const client = await makeClient();
    class MyCustomError extends Error {}
    await expect(
      client.execute(
        () => { throw new MyCustomError('expected'); },
        { router: 'router-1', metrics: { count: 1 }, ignoreErrors: [MyCustomError] },
      ),
    ).rejects.toThrow(MyCustomError);
    expect(client.stats.bufferSize).toBe(1);
    await client.close();
  });

  it('uses custom errorEvaluator', async () => {
    const client = await makeClient();
    await expect(
      client.execute(
        () => { throw new Error('soft error'); },
        { router: 'router-1', metrics: { count: 1 }, errorEvaluator: () => false },
      ),
    ).rejects.toThrow('soft error');
    expect(client.stats.bufferSize).toBe(1);
    await client.close();
  });

  it('uses explicit traceId', async () => {
    const client = await makeClient();
    await client.execute(
      () => 'result',
      { router: 'router-1', metrics: { latency: Latency }, traceId: 'trace-abc-123' },
    );
    expect(client.stats.bufferSize).toBe(1);
    await client.close();
  });

  it('ignores unknown breakers during gating', async () => {
    const client = await makeClient();
    const result = await client.execute(() => 'ok', { breakers: ['unknown-breaker'] });
    expect(result).toBe('ok');
    await client.close();
  });

  it('half-open breaker probabilistic throttle with allow_rate=0', async () => {
    const client = await makeClient();
    lastES().simulateEvent({ breaker: 'half', state: 'half_open', allow_rate: 0 });
    await expect(
      client.execute(() => 'nope', { breakers: ['half'] }),
    ).rejects.toThrow(BreakerOpenError);
    await client.close();
  });

  it('half-open breaker allows at allow_rate=1', async () => {
    const client = await makeClient();
    lastES().simulateEvent({ breaker: 'half', state: 'half_open', allow_rate: 1.0 });
    const result = await client.execute(() => 'ok', { breakers: ['half'] });
    expect(result).toBe('ok');
    await client.close();
  });
});

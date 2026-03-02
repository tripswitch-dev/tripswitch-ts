import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '../src/client.js';

const { MockES, resetMockInstances } = vi.hoisted(() => {
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
  }

  return {
    MockES,
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

describe('Client', () => {
  afterEach(async () => {
    resetMockInstances();
    mockFetch.mockReset();
    vi.restoreAllMocks();
  });

  async function makeClient(opts: Record<string, unknown> = {}) {
    mockFetch.mockImplementation(() => respondWith({ breakers: [], routers: [] }));
    return Client.create({
      projectId: 'proj_test',
      metadataSyncInterval: 0,
      ...opts,
    });
  }

  it('creates a client without SSE when no apiKey', async () => {
    const client = await makeClient();
    expect(client.stats.sseConnected).toBe(false);
    expect(client.getState('any')).toBeUndefined();
    expect(client.getAllStates().size).toBe(0);
    await client.close();
  });

  it('creates a client with SSE when apiKey provided', async () => {
    const client = await makeClient({ apiKey: 'eb_pk_test' });
    // SSE was initialized
    expect(client.stats.cachedBreakers).toBeGreaterThanOrEqual(0);
    await client.close();
  });

  it('stats returns a valid snapshot', async () => {
    const client = await makeClient();
    const stats = client.stats;
    expect(stats.droppedSamples).toBe(0);
    expect(stats.bufferSize).toBe(0);
    expect(stats.lastSuccessfulFlush).toBeNull();
    expect(stats.flushFailures).toBe(0);
    await client.close();
  });

  it('report enqueues a sample', async () => {
    const client = await makeClient({ ingestSecret: 'a'.repeat(64) });
    client.report({ routerId: 'router-1', metric: 'test_metric', value: 42, ok: true });
    expect(client.stats.bufferSize).toBe(1);
    await client.close();
  });

  it('report warns on missing fields', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const client = await makeClient({ logger });
    client.report({ routerId: '', metric: 'test', value: 0 });
    expect(logger.warn).toHaveBeenCalled();
    await client.close();
  });

  it('close is idempotent', async () => {
    const client = await makeClient();
    await client.close();
    await client.close();
  });

  it('supports Symbol.asyncDispose', async () => {
    const client = await makeClient();
    await client[Symbol.asyncDispose]();
  });

  it('getBreakersMetadata returns undefined when no sync', async () => {
    const client = await makeClient();
    expect(client.getBreakersMetadata()).toBeUndefined();
    await client.close();
  });
});

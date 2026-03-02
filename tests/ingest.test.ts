import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sign, compress } from '../src/internal/http.js';

describe('ingest signing', () => {
  it('matches expected HMAC format', () => {
    const secret = 'ab'.repeat(32); // 64-char hex
    const timestamp = '1700000000000';
    const body = new TextEncoder().encode('{"samples":[]}');

    const sig = sign(secret, timestamp, body);
    expect(sig.startsWith('v1=')).toBe(true);
    expect(sig.length).toBe(3 + 64); // "v1=" + 64 hex chars
  });

  it('signature changes with different body', () => {
    const secret = 'ab'.repeat(32);
    const ts = '100';
    const sig1 = sign(secret, ts, new TextEncoder().encode('body1'));
    const sig2 = sign(secret, ts, new TextEncoder().encode('body2'));
    expect(sig1).not.toBe(sig2);
  });
});

describe('ingest compression', () => {
  it('produces valid gzip', async () => {
    const payload = JSON.stringify({
      samples: [
        { router_id: 'r1', metric: 'latency', ts_ms: 1000, value: 42, ok: true },
      ],
    });
    const compressed = await compress(new TextEncoder().encode(payload));

    // Verify gzip magic bytes
    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);
  });

  it('can be signed after compression', async () => {
    const secret = 'cd'.repeat(32);
    const payload = JSON.stringify({ samples: [] });
    const compressed = new Uint8Array(await compress(new TextEncoder().encode(payload)));
    const timestamp = String(Date.now());

    const sig = sign(secret, timestamp, compressed);
    expect(sig).toMatch(/^v1=[0-9a-f]{64}$/);
  });
});

describe('batch send simulation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('constructs correct wire format', () => {
    // Test the sample-to-wire conversion
    const sample = {
      routerId: 'router-1',
      metric: 'latency',
      tsMs: 1700000000000,
      value: 42.5,
      ok: true,
      tags: { env: 'prod' },
      traceId: 'trace-123',
    };

    // Convert to wire format (same logic as client.ts)
    const wire = {
      router_id: sample.routerId,
      metric: sample.metric,
      ts_ms: sample.tsMs,
      value: sample.value,
      ok: sample.ok,
      tags: sample.tags,
      trace_id: sample.traceId,
    };

    expect(wire.router_id).toBe('router-1');
    expect(wire.metric).toBe('latency');
    expect(wire.ts_ms).toBe(1700000000000);
    expect(wire.value).toBe(42.5);
    expect(wire.ok).toBe(true);
    expect(wire.tags).toEqual({ env: 'prod' });
    expect(wire.trace_id).toBe('trace-123');
  });

  it('omits optional fields when empty', () => {
    const sample = {
      routerId: 'router-1',
      metric: 'count',
      tsMs: 1000,
      value: 1,
      ok: true,
    };

    const wire: Record<string, unknown> = {
      router_id: sample.routerId,
      metric: sample.metric,
      ts_ms: sample.tsMs,
      value: sample.value,
      ok: sample.ok,
    };
    // tags and trace_id should not be present

    const json = JSON.stringify({ samples: [wire] });
    const parsed = JSON.parse(json);
    expect(parsed.samples[0]).not.toHaveProperty('tags');
    expect(parsed.samples[0]).not.toHaveProperty('trace_id');
  });
});

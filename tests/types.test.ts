import { describe, it, expect } from 'vitest';
import { Latency, CONTRACT_VERSION } from '../src/types.js';

describe('Latency sentinel', () => {
  it('is a unique symbol', () => {
    expect(typeof Latency).toBe('symbol');
  });

  it('is globally registered via Symbol.for', () => {
    expect(Latency).toBe(Symbol.for('tripswitch.latency'));
  });

  it('can be used as a map key', () => {
    const map: Record<string | symbol, unknown> = {};
    map[Latency] = 'test';
    expect(map[Latency]).toBe('test');
  });

  it('is usable in a metrics-like object', () => {
    const metrics: Record<string, unknown> = {
      latency: Latency,
      custom: 42,
    };
    expect(metrics.latency).toBe(Latency);
    expect(metrics.custom).toBe(42);
  });
});

describe('CONTRACT_VERSION', () => {
  it('is "0.2"', () => {
    expect(CONTRACT_VERSION).toBe('0.2');
  });
});

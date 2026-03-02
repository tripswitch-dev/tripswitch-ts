import { describe, it, expect } from 'vitest';
import { sign, compress } from '../../src/internal/http.js';

describe('sign', () => {
  it('computes HMAC-SHA256 with v1= prefix', () => {
    // Known test vector: 64-char hex secret
    const secret = 'a'.repeat(64);
    const timestamp = '1700000000000';
    const body = new Uint8Array([1, 2, 3]);

    const sig = sign(secret, timestamp, body);
    expect(sig).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  it('produces consistent signatures', () => {
    const secret = 'abcd'.repeat(16);
    const timestamp = '12345';
    const body = new TextEncoder().encode('hello');

    const sig1 = sign(secret, timestamp, body);
    const sig2 = sign(secret, timestamp, body);
    expect(sig1).toBe(sig2);
  });

  it('different secrets produce different signatures', () => {
    const body = new TextEncoder().encode('test');
    const sig1 = sign('a'.repeat(64), '100', body);
    const sig2 = sign('b'.repeat(64), '100', body);
    expect(sig1).not.toBe(sig2);
  });

  it('different timestamps produce different signatures', () => {
    const secret = 'a'.repeat(64);
    const body = new TextEncoder().encode('test');
    const sig1 = sign(secret, '100', body);
    const sig2 = sign(secret, '200', body);
    expect(sig1).not.toBe(sig2);
  });
});

describe('compress', () => {
  it('produces gzip output', async () => {
    const input = new TextEncoder().encode('hello world');
    const output = await compress(input);
    // Gzip magic bytes: 0x1f 0x8b
    expect(output[0]).toBe(0x1f);
    expect(output[1]).toBe(0x8b);
  });

  it('compressed output is smaller for large inputs', async () => {
    const input = new TextEncoder().encode('a'.repeat(10000));
    const output = await compress(input);
    expect(output.length).toBeLessThan(input.length);
  });
});

import { describe, it, expect } from 'vitest';
import { SampleBuffer } from '../../src/internal/buffer.js';
import type { Sample } from '../../src/types.js';

function makeSample(metric = 'latency', value = 42): Sample {
  return {
    routerId: 'router-1',
    metric,
    tsMs: Date.now(),
    value,
    ok: true,
  };
}

describe('SampleBuffer', () => {
  it('starts empty with zero drops', () => {
    const buf = new SampleBuffer();
    expect(buf.size).toBe(0);
    expect(buf.droppedCount).toBe(0);
  });

  it('push and drain', () => {
    const buf = new SampleBuffer();
    buf.push(makeSample('a', 1));
    buf.push(makeSample('b', 2));
    buf.push(makeSample('c', 3));

    expect(buf.size).toBe(3);

    const drained = buf.drain(2);
    expect(drained).toHaveLength(2);
    expect(drained[0].metric).toBe('a');
    expect(drained[1].metric).toBe('b');
    expect(buf.size).toBe(1);

    const rest = buf.drain(100);
    expect(rest).toHaveLength(1);
    expect(rest[0].metric).toBe('c');
    expect(buf.size).toBe(0);
  });

  it('drain returns empty array when buffer is empty', () => {
    const buf = new SampleBuffer();
    expect(buf.drain(10)).toEqual([]);
  });

  it('drops samples when capacity exceeded', () => {
    const buf = new SampleBuffer(3);
    expect(buf.push(makeSample('a'))).toBe(true);
    expect(buf.push(makeSample('b'))).toBe(true);
    expect(buf.push(makeSample('c'))).toBe(true);
    expect(buf.push(makeSample('d'))).toBe(false);
    expect(buf.push(makeSample('e'))).toBe(false);

    expect(buf.size).toBe(3);
    expect(buf.droppedCount).toBe(2);
  });

  it('accepts again after draining', () => {
    const buf = new SampleBuffer(2);
    buf.push(makeSample('a'));
    buf.push(makeSample('b'));
    expect(buf.push(makeSample('c'))).toBe(false);

    buf.drain(1);
    expect(buf.push(makeSample('d'))).toBe(true);
    expect(buf.size).toBe(2);
  });

  it('uses default capacity of 10000', () => {
    const buf = new SampleBuffer();
    for (let i = 0; i < 10_000; i++) {
      expect(buf.push(makeSample())).toBe(true);
    }
    expect(buf.push(makeSample())).toBe(false);
    expect(buf.size).toBe(10_000);
    expect(buf.droppedCount).toBe(1);
  });
});

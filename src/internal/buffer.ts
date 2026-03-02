import type { Sample } from '../types.js';

const DEFAULT_CAPACITY = 10_000;

/**
 * Bounded sample buffer with non-blocking push and drop counting.
 *
 * Thread-safety: Not needed in single-threaded JS, but the buffer
 * is designed to be used from a single event loop context.
 */
export class SampleBuffer {
  private readonly items: Sample[] = [];
  private readonly capacity: number;
  private _droppedCount = 0;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  /** Number of samples currently in the buffer. */
  get size(): number {
    return this.items.length;
  }

  /** Number of samples dropped due to buffer overflow. */
  get droppedCount(): number {
    return this._droppedCount;
  }

  /**
   * Push a sample into the buffer.
   * If the buffer is full, the sample is dropped and the drop counter incremented.
   * Returns `true` if the sample was accepted, `false` if dropped.
   */
  push(sample: Sample): boolean {
    if (this.items.length >= this.capacity) {
      this._droppedCount++;
      return false;
    }
    this.items.push(sample);
    return true;
  }

  /**
   * Drain up to `max` samples from the front of the buffer.
   * Returns the drained samples.
   */
  drain(max: number): Sample[] {
    const count = Math.min(max, this.items.length);
    return this.items.splice(0, count);
  }
}

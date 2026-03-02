declare module 'eventsource' {
  interface EventSourceInit {
    headers?: Record<string, string>;
  }

  class EventSource {
    constructor(url: string, init?: EventSourceInit);
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: (() => void) | null;
    addEventListener(type: string, listener: (event: MessageEvent) => void): void;
    close(): void;
  }

  export default EventSource;
}

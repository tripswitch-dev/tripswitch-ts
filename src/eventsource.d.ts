declare module 'eventsource' {
  interface EventSourceInit {
    headers?: Record<string, string>;
  }

  class EventSource {
    constructor(url: string, init?: EventSourceInit);
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: (() => void) | null;
    close(): void;
  }

  export default EventSource;
}

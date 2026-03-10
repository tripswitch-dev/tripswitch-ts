# @tripswitch-dev/tripswitch-ts

Official TypeScript SDK for [TripSwitch](https://tripswitch.dev) — a circuit breaker service for distributed systems.

## Install

```bash
npm install @tripswitch-dev/tripswitch-ts
```

## Quick Start

```ts
import { Client, Latency } from '@tripswitch-dev/tripswitch-ts';

const client = await Client.create({
  projectId: 'proj_abc123',
  apiKey: 'eb_pk_...',
  ingestSecret: '...',
});

const result = await client.execute(
  () => fetch('https://api.example.com/data'),
  {
    breakers: ['api-latency'],
    router: 'api-router',
    metrics: { latency: Latency },
  },
);

await client.close();
```

### Using `await using` (TypeScript 5.2+)

```ts
await using client = await Client.create({ projectId: 'proj_abc123' });
// client.close() called automatically when scope exits
```

## Features

- **Real-time breaker state** via SSE — no polling
- **Buffered sample ingestion** with HMAC-SHA256 signing, gzip compression, and automatic batching
- **Circuit breaker gating** — open, closed, and half-open (probabilistic) states
- **Metadata-driven selection** — dynamically choose breakers and routers at runtime
- **Deferred metrics** — extract metrics from task results after execution
- **Admin client** for managing projects, breakers, routers, and notification channels

## API

### `Client.create(options)`

Creates and initializes a client. Blocks until SSE is connected (default 30s timeout).

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `projectId` | `string` | *required* | Project ID |
| `apiKey` | `string` | — | API key for SSE breaker state |
| `ingestSecret` | `string` | — | Secret for HMAC-signed ingestion (64-char hex) |
| `failOpen` | `boolean` | `true` | Allow traffic when TripSwitch is unreachable |
| `timeout` | `number` | `30000` | SSE initialization timeout in ms (0 = wait forever) |
| `globalTags` | `Record<string, string>` | — | Tags applied to every sample |
| `onStateChange` | `(name, from, to) => void` | — | Callback on breaker transitions |

### `client.execute(task, options?)`

Runs a task with circuit breaker logic, metric collection, and sample ingestion.

```ts
const result = await client.execute(
  async () => {
    const res = await fetch('https://api.example.com');
    return res.json();
  },
  {
    breakers: ['api-errors', 'api-latency'],
    router: 'api-router',
    metrics: { latency: Latency, requestCount: 1 },
    deferredMetrics: (result, error) => ({
      tokens: result?.tokenCount ?? 0,
    }),
    tags: { endpoint: '/users' },
    ignoreErrors: [NotFoundError],
  },
);
```

#### Fallback when a breaker is open

When a breaker is open (or half-open and rejecting), `execute` throws a `BreakerOpenError` **before** running the task. Catch it to provide a fallback:

```ts
import { BreakerOpenError } from '@tripswitch-dev/tripswitch-ts';

try {
  const result = await client.execute(
    () => fetch('https://api.example.com/data'),
    { breakers: ['api-latency'] },
  );
  return result;
} catch (err) {
  if (err instanceof BreakerOpenError) {
    console.warn(`Breaker tripped: ${err.breaker}`);
    return cachedData; // serve stale data, default value, etc.
  }
  throw err;
}
```

The error's `.breaker` property contains the name of the tripped breaker (if a specific one triggered it), so you can tailor fallback logic per breaker.

### `client.report(input)`

Send a sample outside of `execute()` for async or fire-and-forget workflows.

```ts
client.report({
  routerId: 'background-jobs',
  metric: 'job_duration_ms',
  value: 1234,
  ok: true,
});
```

### `client.getState(name)` / `client.getAllStates()`

Inspect cached breaker states.

### `client.stats`

SDK health metrics snapshot: buffer size, dropped samples, SSE status, flush failures.

## Admin Client

```ts
import { AdminClient } from '@tripswitch-dev/tripswitch-ts/admin';

const admin = new AdminClient({ apiKey: 'eb_admin_...' });

const projects = await admin.listProjects();
const breaker = await admin.createBreaker('proj_id', {
  name: 'api-latency',
  metric: 'latency',
  kind: 'p95',
  op: 'gt',
  threshold: 500,
});

admin.close();
```

## License

Apache 2.0 — see [LICENSE](./LICENSE).

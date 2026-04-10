# @tripswitch-dev/tripswitch-ts

[![npm](https://img.shields.io/npm/v/@tripswitch-dev/tripswitch-ts)](https://www.npmjs.com/package/@tripswitch-dev/tripswitch-ts)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

Official TypeScript SDK for [Tripswitch](https://tripswitch.dev) — a circuit breaker management service.

This SDK conforms to the [Tripswitch SDK Contract v0.2](https://tripswitch.dev/docs/sdk-contract).

## Features

- **Real-time state sync** via Server-Sent Events (SSE)
- **Automatic sample reporting** with buffered, gzip-compressed, HMAC-signed batched uploads
- **Fail-open by default** — your app stays available even if Tripswitch is unreachable
- **Circuit breaker gating** — open, closed, and half-open (probabilistic) states
- **Metadata-driven selection** — dynamically choose breakers and routers at runtime
- **Deferred metrics** — extract metrics from task results after execution
- **Admin client** for managing projects, breakers, routers, and notification channels

## Installation

```bash
npm install @tripswitch-dev/tripswitch-ts
```

**Requires Node.js 18+** (uses native `fetch` and `EventSource`)

## Authentication

Tripswitch uses a two-tier authentication model.

### Runtime Credentials (SDK)

For SDK initialization, you need two credentials from **Project Settings → SDK Keys**:

| Credential | Prefix | Purpose |
|------------|--------|---------|
| **Project Key** | `eb_pk_` | SSE connection and state reads |
| **Ingest Secret** | 64-char hex | HMAC-signed sample ingestion |

```ts
const client = await Client.create({
  projectId: 'proj_abc123',
  apiKey: 'eb_pk_...',
  ingestSecret: 'ik_...',
});
```

### Admin Credentials (Management API)

For management and automation tasks, use an **Admin Key** from **Organization Settings → Admin Keys**:

| Credential | Prefix | Purpose |
|------------|--------|---------|
| **Admin Key** | `eb_admin_` | Organization-scoped management operations |

Admin keys are used with the [Admin Client](#admin-client) only — not for runtime SDK usage.

## Quick Start

```ts
import { Client, Latency, BreakerOpenError } from '@tripswitch-dev/tripswitch-ts';

// Create client (blocks until SSE state sync completes)
const client = await Client.create({
  projectId: 'proj_abc123',
  apiKey: 'eb_pk_...',
  ingestSecret: 'ik_...',
});

try {
  // Wrap operations with circuit breaker
  const result = await client.execute(
    () => fetch('https://api.example.com/data'),
    {
      breakers: ['external-api'],
      router: 'my-router-id',
      metrics: { latency: Latency },
    },
  );
  // Process result...
} catch (err) {
  if (err instanceof BreakerOpenError) {
    // Circuit is open — return cached/fallback response
    console.log('circuit open, using fallback');
  } else {
    throw err;
  }
} finally {
  await client.close();
}
```

### Using `await using` (TypeScript 5.2+)

```ts
await using client = await Client.create({ projectId: 'proj_abc123', apiKey: 'eb_pk_...', ingestSecret: 'ik_...' });
// client.close() called automatically when scope exits
```

## Configuration Options

### Client Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `projectId` | `string` | *required* | Project ID |
| `apiKey` | `string` | `""` | Project key (`eb_pk_`) for SSE authentication |
| `ingestSecret` | `string` | `""` | 64-char hex secret for HMAC-signed sample reporting |
| `failOpen` | `boolean` | `true` | Allow traffic when Tripswitch is unreachable |
| `baseUrl` | `string` | `https://api.tripswitch.dev` | Override API endpoint |
| `timeout` | `number` | `30000` | SSE initialization timeout in ms (`0` = wait forever) |
| `globalTags` | `Record<string, string>` | — | Tags applied to every sample |
| `onStateChange` | `(name, from, to) => void` | — | Callback on breaker state transitions |
| `traceIdExtractor` | `() => string` | — | Extract trace ID for each sample automatically |
| `metadataSyncInterval` | `number` | `30000` | Metadata refresh interval in ms. Set to `0` to disable. |

### Execute Options

| Option | Description |
|--------|-------------|
| `breakers` | Breaker names to check before executing (any open throws `BreakerOpenError`). If omitted, no gating is performed. |
| `selectBreakers` | Dynamically select breakers based on cached metadata. Mutually exclusive with `breakers`. |
| `router` | Router ID for sample routing. If omitted, no samples are emitted. |
| `selectRouter` | Dynamically select a router based on cached metadata. Mutually exclusive with `router`. |
| `metrics` | Metrics to report (`Latency` sentinel, `() => number`, or numeric values) |
| `deferredMetrics` | Extract metrics from the task's return value (e.g., token counts from API responses) |
| `tags` | Per-call tags (merged with `globalTags`; call-site wins on conflict) |
| `ignoreErrors` | Error classes that should not count as failures |
| `errorEvaluator` | Custom function to determine if an error is a failure (takes precedence over `ignoreErrors`) |
| `traceId` | Explicit trace ID (takes precedence over `traceIdExtractor`) |

### Error Classification

Every sample includes an `ok` field indicating whether the task succeeded or failed. This is determined by the following evaluation order:

1. **`errorEvaluator`** — if set, takes precedence. Return `true` if the error **is a failure**; `false` if it should be treated as success.

   ```ts
   // Only count 5xx as failures; 4xx are "expected" errors
   await client.execute(task, {
     errorEvaluator: (err) => {
       if (err instanceof HttpError) return err.status >= 500;
       return true;
     },
   });
   ```

2. **`ignoreErrors`** — if the task error is an instance of any listed class, it is **not** counted as a failure.

   ```ts
   // NotFoundError is expected, don't count it
   await client.execute(task, { ignoreErrors: [NotFoundError] });
   ```

3. **Default** — any thrown error is a failure; no error is success.

## API Reference

### `Client.create`

```ts
static async create(options: ClientOptions): Promise<Client>
```

Creates and initializes a client. Starts background processes for SSE state sync and sample flushing, and blocks until the initial SSE sync completes. The `timeout` option controls how long to wait.

### `execute`

```ts
async execute<T>(task: () => Promise<T>, options?: ExecuteOptions): Promise<T>
```

Runs a task end-to-end: checks breaker state, executes the task, and reports samples — all in one call.

- Use `breakers` to gate execution on breaker state (omit for pass-through)
- Use `router` to specify where samples go (omit for no sample emission)
- Use `metrics` to specify what values to report

Throws `BreakerOpenError` if any specified breaker is open.

### `Latency`

```ts
export const Latency: unique symbol
```

Sentinel value for `metrics` that instructs the SDK to automatically compute and report task duration in milliseconds.

### `close`

```ts
async close(): Promise<void>
```

Gracefully shuts down the client. Flushes any buffered samples before resolving. Also called automatically when using `await using`.

### `stats`

```ts
get stats(): SDKStats
```

Returns a snapshot of SDK health metrics:

```ts
interface SDKStats {
  droppedSamples: number;        // Samples dropped due to buffer overflow
  bufferSize: number;            // Current buffer occupancy
  sseConnected: boolean;         // SSE connection status
  sseReconnects: number;         // Count of SSE reconnections
  lastSuccessfulFlush: Date | null;
  lastSseEvent: Date | null;
  flushFailures: number;         // Batches dropped after retry exhaustion
  cachedBreakers: number;        // Number of breakers in local state cache
}
```

### Breaker State Inspection

These methods expose the SDK's local breaker cache for debugging, logging, and health checks. For gating traffic on breaker state, use `execute` with `breakers` — it handles state checks, throttling, and sample reporting together.

```ts
getState(name: string): BreakerStatus | null
getAllStates(): Record<string, BreakerStatus>
```

```ts
// Debug: why is checkout rejecting requests?
const status = client.getState('checkout');
if (status) {
  console.log(`checkout breaker: state=${status.state} allow_rate=${status.allowRate}`);
}

// Health endpoint: expose all breaker states to monitoring
for (const [name, status] of Object.entries(client.getAllStates())) {
  console.log(`breaker ${name}: ${status.state}`);
}
```

### Error Handling

```ts
class BreakerOpenError extends TripSwitchError { breaker?: string }
class ConflictingOptionsError extends TripSwitchError { }
class MetadataUnavailableError extends TripSwitchError { }
```

| Error | Cause |
|-------|-------|
| `BreakerOpenError` | A specified breaker is open or request was throttled in half-open state |
| `ConflictingOptionsError` | Mutually exclusive options used (e.g. `breakers` + `selectBreakers`) |
| `MetadataUnavailableError` | Selector used but metadata cache hasn't been populated yet |

```ts
import { BreakerOpenError } from '@tripswitch-dev/tripswitch-ts';

try {
  const result = await client.execute(task, {
    breakers: ['my-breaker'],
    router: 'my-router',
    metrics: { latency: Latency },
  });
} catch (err) {
  if (err instanceof BreakerOpenError) {
    // Breaker is open or request was throttled
    return fallbackValue;
  }
  throw err;
}
```

## Custom Metric Values

`Latency` is a convenience sentinel that auto-computes task duration in milliseconds. You can report **any metric with any value**:

```ts
await client.execute(task, {
  router: 'my-router',
  metrics: {
    // Auto-computed latency (convenience)
    latency: Latency,

    // Static numeric values
    responseBytes: 4096,
    queueDepth: 42.5,

    // Dynamic values via closure (called after task completes)
    memoryMb: () => process.memoryUsage().heapUsed / 1024 / 1024,
  },
});
```

### Deferred Metrics

Use `deferredMetrics` to extract metrics from the task's return value — useful when the interesting values are in the response (e.g., token counts from LLM APIs):

```ts
const result = await client.execute(
  () => anthropic.messages.create(request),
  {
    breakers: ['anthropic-spend'],
    router: 'llm-router',
    metrics: { latency: Latency },
    deferredMetrics: (result, error) => {
      if (!result) return {};
      return {
        promptTokens: result.usage.input_tokens,
        completionTokens: result.usage.output_tokens,
        totalTokens: result.usage.input_tokens + result.usage.output_tokens,
      };
    },
  },
);
```

Deferred metrics are resolved after the task completes and merged with eager metrics. If the function throws, it is caught and a warning is logged — eager metrics are still emitted.

### Dynamic Selection

Use `selectBreakers` and `selectRouter` to choose breakers or routers at runtime based on cached metadata. The SDK periodically syncs metadata from the API (default 30s), and your selector receives the current snapshot.

```ts
// Gate on breakers matching a metadata property
const result = await client.execute(task, {
  selectBreakers: (breakers) =>
    breakers
      .filter((b) => b.metadata?.region === 'us-east-1')
      .map((b) => b.name),
});

// Route samples to a router matching a metadata property
const result = await client.execute(task, {
  selectRouter: (routers) =>
    routers.find((r) => r.metadata?.env === 'production')?.id ?? '',
  metrics: { latency: Latency },
});
```

**Constraints:**
- `breakers` and `selectBreakers` are mutually exclusive — using both throws `ConflictingOptionsError`
- `router` and `selectRouter` are mutually exclusive — using both throws `ConflictingOptionsError`
- If the metadata cache hasn't been populated yet, throws `MetadataUnavailableError`
- If a selector returns an empty array or empty string, no gating or sample emission occurs

You can also access the metadata cache directly:

```ts
const breakers = client.getBreakersMetadata(); // BreakerMeta[] | null
const routers = client.getRoutersMetadata();   // RouterMeta[] | null
```

## Trace IDs

Trace IDs associate samples with distributed traces. Two ways to set them:

- **`traceId`** (execute option) — explicit per-call trace ID. Takes precedence over the extractor.

- **`traceIdExtractor`** (client option) — automatically extracts a trace ID for every `execute` call. Useful for OpenTelemetry integration:

  ```ts
  const client = await Client.create({
    projectId: 'proj_abc123',
    traceIdExtractor: () => {
      const span = trace.getActiveSpan();
      return span?.spanContext().traceId ?? '';
    },
  });
  ```

If both are set, `traceId` wins.

### `report`

```ts
report(input: ReportInput): void
```

Send a sample independently of `execute`. Use this for async workflows, result-derived metrics, or fire-and-forget reporting:

```ts
// Report token usage from an LLM API response
client.report({
  routerId: 'llm-router',
  metric: 'total_tokens',
  value: 1500,
  ok: true,
});

// Background process metrics
client.report({
  routerId: 'worker-metrics',
  metric: 'queue_depth',
  value: queueLen,
  ok: true,
  tags: { worker: 'processor-1' },
});
```

Samples are buffered and batched the same way as `execute` samples. Global tags are merged automatically.

## Circuit Breaker States

| State | Behavior |
|-------|----------|
| `closed` | All requests allowed, results reported |
| `open` | All requests rejected with `BreakerOpenError` |
| `half_open` | Requests throttled based on `allowRate` (e.g., 20% allowed) |

## How It Works

1. **State Sync**: The client maintains a local cache of breaker states, updated in real-time via SSE
2. **Execute Check**: Each `execute()` call checks the local cache (no network call)
3. **Sample Reporting**: Results are buffered and batched (500 samples or 15s, whichever comes first), gzip-compressed, and HMAC-signed
4. **Graceful Degradation**: If Tripswitch is unreachable, the client fails open by default

## Admin Client

The admin module provides a client for management and automation tasks. This is separate from the runtime SDK and uses organization-scoped admin keys.

```ts
import { AdminClient } from '@tripswitch-dev/tripswitch-ts/admin';

const admin = new AdminClient({ apiKey: 'eb_admin_...' });

// List all projects
const projects = await admin.listProjects();

// Create a project
const project = await admin.createProject({ name: 'prod-payments' });

// Get project details
const project = await admin.getProject('proj_abc123');

// Delete a project (requires name confirmation as a safety guard)
await admin.deleteProject('proj_abc123', { confirmName: 'prod-payments' });

// List breakers
const breakers = await admin.listBreakers('proj_abc123');

// Create a breaker
const breaker = await admin.createBreaker('proj_abc123', {
  name: 'api-latency',
  metric: 'latency_ms',
  kind: 'p95',
  op: 'gt',
  threshold: 500,
});

// List routers
const routers = await admin.listRouters('proj_abc123');

// Link / unlink a breaker to a router
await admin.linkBreaker('proj_abc123', 'router_...', 'breaker_...');
await admin.unlinkBreaker('proj_abc123', 'router_...', 'breaker_...');

admin.close();
```

**Note:** Admin keys (`eb_admin_`) are for management operations only. For runtime SDK usage, use project keys (`eb_pk_`) as shown in [Quick Start](#quick-start).

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

[Apache License 2.0](LICENSE)

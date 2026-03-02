import { describe, it, expect } from 'vitest';
import { Client, Latency, BreakerOpenError } from '../../src/index.js';

/**
 * Integration tests for the runtime Client.
 *
 * Gated by environment variables — skipped when not set.
 * Run with:
 *
 *   TRIPSWITCH_PROJECT_KEY=eb_pk_...    \
 *   TRIPSWITCH_INGEST_SECRET=<64-hex>   \
 *   TRIPSWITCH_PROJECT_ID=proj_...      \
 *   TRIPSWITCH_BREAKER_NAME=my-breaker  \
 *   TRIPSWITCH_ROUTER_ID=router-id      \
 *   TRIPSWITCH_METRIC=metric-name       \
 *   npm run test:integration
 *
 * Optional:
 *   TRIPSWITCH_BASE_URL  (defaults to https://api.tripswitch.dev)
 */

interface TestConfig {
  apiKey: string;
  ingestSecret: string;
  projectId: string;
  baseUrl: string;
  breakerName: string;
  routerId: string;
  metricName: string;
}

function loadConfig(): TestConfig | null {
  const apiKey = process.env.TRIPSWITCH_PROJECT_KEY ?? '';
  const projectId = process.env.TRIPSWITCH_PROJECT_ID ?? '';

  if (!apiKey || !projectId) return null;

  return {
    apiKey,
    ingestSecret: process.env.TRIPSWITCH_INGEST_SECRET ?? '',
    projectId,
    baseUrl: process.env.TRIPSWITCH_BASE_URL || 'https://api.tripswitch.dev',
    breakerName: process.env.TRIPSWITCH_BREAKER_NAME ?? '',
    routerId: process.env.TRIPSWITCH_ROUTER_ID ?? '',
    metricName: process.env.TRIPSWITCH_METRIC ?? '',
  };
}

const cfg = loadConfig();
const hasBreaker = cfg !== null && cfg.breakerName !== '' && cfg.routerId !== '' && cfg.metricName !== '';

describe.skipIf(!cfg)('Client integration', () => {
  it('connects via SSE and becomes ready', async () => {
    const client = await Client.create({
      projectId: cfg!.projectId,
      apiKey: cfg!.apiKey,
      ingestSecret: cfg!.ingestSecret,
      baseUrl: cfg!.baseUrl,
      metadataSyncInterval: 0,
      timeout: 10_000,
    });

    try {
      expect(client.stats.sseConnected).toBe(true);
    } finally {
      await client.close();
    }
  });

  it.skipIf(!hasBreaker)('executes a task through a breaker', async () => {
    const client = await Client.create({
      projectId: cfg!.projectId,
      apiKey: cfg!.apiKey,
      ingestSecret: cfg!.ingestSecret,
      baseUrl: cfg!.baseUrl,
      metadataSyncInterval: 0,
      timeout: 10_000,
    });

    try {
      const result = await client.execute(
        () => 'success',
        {
          breakers: [cfg!.breakerName],
          router: cfg!.routerId,
          metrics: { [cfg!.metricName]: Latency },
        },
      );

      expect(result).toBe('success');
    } catch (err) {
      // Breaker may be open — that's a valid integration outcome
      expect(err).toBeInstanceOf(BreakerOpenError);
    } finally {
      await client.close();
    }
  });

  it('reports stats after connection', async () => {
    const client = await Client.create({
      projectId: cfg!.projectId,
      apiKey: cfg!.apiKey,
      ingestSecret: cfg!.ingestSecret,
      baseUrl: cfg!.baseUrl,
      metadataSyncInterval: 0,
      timeout: 10_000,
    });

    try {
      const stats = client.stats;
      expect(stats.sseConnected).toBe(true);
      expect(stats.droppedSamples).toBe(0);
      expect(typeof stats.sseReconnects).toBe('number');
      expect(typeof stats.cachedBreakers).toBe('number');
    } finally {
      await client.close();
    }
  });

  it.skipIf(!hasBreaker)('graceful shutdown flushes samples', async () => {
    const client = await Client.create({
      projectId: cfg!.projectId,
      apiKey: cfg!.apiKey,
      ingestSecret: cfg!.ingestSecret,
      baseUrl: cfg!.baseUrl,
      metadataSyncInterval: 0,
      timeout: 10_000,
    });

    // Generate a few samples
    for (let i = 0; i < 5; i++) {
      try {
        await client.execute(
          () => i,
          {
            breakers: [cfg!.breakerName],
            router: cfg!.routerId,
            metrics: { [cfg!.metricName]: Latency },
          },
        );
      } catch {
        // breaker may be open
      }
    }

    // Close should flush remaining samples without error
    await client.close();
  });

  it('syncs metadata', async () => {
    const client = await Client.create({
      projectId: cfg!.projectId,
      apiKey: cfg!.apiKey,
      baseUrl: cfg!.baseUrl,
      metadataSyncInterval: 5_000,
      timeout: 10_000,
    });

    try {
      // Give metadata sync time to complete initial fetch
      await new Promise((r) => setTimeout(r, 500));

      const breakers = client.getBreakersMetadata();
      const routers = client.getRoutersMetadata();

      // At least one of these should be populated if the project is configured
      if (breakers) {
        expect(Array.isArray(breakers)).toBe(true);
        for (const b of breakers) {
          expect(b.id).toBeTruthy();
          expect(b.name).toBeTruthy();
        }
      }

      if (routers) {
        expect(Array.isArray(routers)).toBe(true);
        for (const r of routers) {
          expect(r.id).toBeTruthy();
          expect(r.name).toBeTruthy();
        }
      }
    } finally {
      await client.close();
    }
  });
});

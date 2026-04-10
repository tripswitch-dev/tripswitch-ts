import { describe, it, expect } from 'vitest';
import {
  AdminClient,
  BreakerKind,
  BreakerOp,
  RouterMode,
} from '../../src/admin/index.js';
import { NotFoundError, UnauthorizedError, ForbiddenError } from '../../src/errors.js';

/**
 * Integration tests for the AdminClient.
 *
 * Gated by environment variables — skipped when not set.
 * Run with:
 *
 *   TRIPSWITCH_ADMIN_KEY=eb_admin_...  \
 *   TRIPSWITCH_PROJECT_ID=proj_...    \
 *   npm run test:integration
 *
 * Optional:
 *   TRIPSWITCH_BASE_URL  (defaults to https://api.tripswitch.dev)
 */

function loadConfig() {
  const apiKey = process.env.TRIPSWITCH_ADMIN_KEY ?? '';
  const projectId = process.env.TRIPSWITCH_PROJECT_ID ?? '';
  const baseUrl = process.env.TRIPSWITCH_BASE_URL || 'https://api.tripswitch.dev';
  const workspaceId = process.env.TRIPSWITCH_WORKSPACE_ID;

  if (!apiKey || !projectId) return null;
  return { apiKey, projectId, baseUrl, workspaceId };
}

const cfg = loadConfig();

describe.skipIf(!cfg)('AdminClient integration', () => {
  function makeClient() {
    return new AdminClient({
      apiKey: cfg!.apiKey,
      baseUrl: cfg!.baseUrl,
    });
  }

  it('getProject', async () => {
    const client = makeClient();
    try {
      const project = await client.getProject(cfg!.projectId);
      expect(project.id).toBe(cfg!.projectId);
      expect(project.name).toBeTruthy();
    } finally {
      client.close();
    }
  });

  it('project CRUD lifecycle', async () => {
    const client = makeClient();
    const projectName = `integration-test-project-${Date.now()}`;

    let createdId = '';
    try {
      // Create
      const project = await client.createProject({ name: projectName, workspaceId: cfg!.workspaceId });
      createdId = project.id;
      expect(project.name).toBe(projectName);
      expect(project.id).toBeTruthy();

      // List
      const projects = await client.listProjects();
      const found = projects.some((p) => p.id === createdId);
      expect(found).toBe(true);

      // Delete
      await client.deleteProject(createdId, projectName);

      // Verify deletion
      await expect(client.getProject(createdId)).rejects.toThrow(NotFoundError);
    } finally {
      // Best-effort cleanup if test failed before delete
      if (createdId) {
        try { await client.deleteProject(createdId, projectName); } catch { /* already deleted */ }
      }
      client.close();
    }
  });

  it('listBreakers', async () => {
    const client = makeClient();
    try {
      const breakers = await client.listBreakers(cfg!.projectId, { limit: 10 });
      expect(Array.isArray(breakers)).toBe(true);
    } finally {
      client.close();
    }
  });

  it('breaker CRUD lifecycle', async () => {
    const client = makeClient();
    const breakerName = `integration-test-breaker-${Date.now()}`;

    let breakerId = '';
    try {
      // Create
      const breaker = await client.createBreaker(cfg!.projectId, {
        name: breakerName,
        metric: 'test_metric',
        kind: BreakerKind.ErrorRate,
        op: BreakerOp.Gt,
        threshold: 0.5,
        windowMs: 60_000,
        minCount: 10,
      });
      breakerId = breaker.id;
      expect(breaker.id).toBeTruthy();

      // Read
      const fetched = await client.getBreaker(cfg!.projectId, breakerId);
      expect(fetched.name).toBe(breakerName);

      // Update
      const updated = await client.updateBreaker(cfg!.projectId, breakerId, {
        threshold: 0.75,
      });
      expect(updated.threshold).toBe(0.75);

      // Delete
      await client.deleteBreaker(cfg!.projectId, breakerId);

      // Verify deletion
      await expect(
        client.getBreaker(cfg!.projectId, breakerId),
      ).rejects.toThrow(NotFoundError);
    } finally {
      // Best-effort cleanup
      if (breakerId) {
        try { await client.deleteBreaker(cfg!.projectId, breakerId); } catch { /* already deleted */ }
      }
      client.close();
    }
  });

  it('listRouters', async () => {
    const client = makeClient();
    try {
      const routers = await client.listRouters(cfg!.projectId, { limit: 10 });
      expect(Array.isArray(routers)).toBe(true);
    } finally {
      client.close();
    }
  });

  it('listNotificationChannels', async () => {
    const client = makeClient();
    try {
      const channels = await client.listNotificationChannels(cfg!.projectId, { limit: 10 });
      expect(Array.isArray(channels)).toBe(true);
    } finally {
      client.close();
    }
  });

  it('listEvents', async () => {
    const client = makeClient();
    try {
      const events = await client.listEvents(cfg!.projectId, { limit: 10 });
      expect(Array.isArray(events)).toBe(true);
    } finally {
      client.close();
    }
  });

  it('listProjects', async () => {
    const client = makeClient();
    try {
      const projects = await client.listProjects();
      expect(Array.isArray(projects)).toBe(true);
      const found = projects.some((p) => p.id === cfg!.projectId);
      expect(found).toBe(true);
    } finally {
      client.close();
    }
  });

  it('listProjectKeys', async () => {
    const client = makeClient();
    try {
      const keys = await client.listProjectKeys(cfg!.projectId);
      expect(Array.isArray(keys)).toBe(true);
    } finally {
      client.close();
    }
  });

  it('getWorkspace', async () => {
    if (!cfg!.workspaceId) return;
    const client = makeClient();
    try {
      const ws = await client.getWorkspace(cfg!.workspaceId);
      expect(ws.id).toBe(cfg!.workspaceId);
    } finally {
      client.close();
    }
  });

  it('notFoundError', async () => {
    const client = makeClient();
    try {
      await expect(
        client.getProject('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(NotFoundError);
    } finally {
      client.close();
    }
  });

  it('unauthorizedError', async () => {
    const client = new AdminClient({
      apiKey: 'eb_admin_invalid',
      baseUrl: cfg!.baseUrl,
    });
    try {
      await expect(client.getProject('any')).rejects.toSatisfy(
        (e: unknown) => e instanceof UnauthorizedError || e instanceof ForbiddenError,
      );
    } finally {
      client.close();
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdminClient } from '../src/admin/client.js';
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  ServerFaultError,
  TransportError,
} from '../src/errors.js';
import { BreakerKind, BreakerOp, RouterMode, NotificationChannelType, NotificationEventType } from '../src/admin/types.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function respondWith(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    json: () => Promise.resolve(data),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  });
}

function respondEmpty(status = 204) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-length': '0' }),
    json: () => Promise.reject(new Error('no body')),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  });
}

describe('AdminClient', () => {
  let client: AdminClient;

  beforeEach(() => {
    client = new AdminClient({ apiKey: 'eb_admin_test' });
    mockFetch.mockReset();
  });

  afterEach(() => {
    client.close();
  });

  // ── Projects ─────────────────────────────────────────────────────

  describe('projects', () => {
    it('listProjects', async () => {
      mockFetch.mockReturnValue(respondWith({
        projects: [
          { project_id: 'p1', name: 'My Project' },
          { project_id: 'p2', name: 'Other Project' },
        ],
      }));

      const projects = await client.listProjects();
      expect(projects).toHaveLength(2);
      expect(projects[0].id).toBe('p1');
      expect(projects[0].name).toBe('My Project');
    });

    it('getProject', async () => {
      mockFetch.mockReturnValue(respondWith({
        project_id: 'p1',
        name: 'Test Project',
        enable_signed_ingest: true,
      }));

      const project = await client.getProject('p1');
      expect(project.id).toBe('p1');
      expect(project.enableSignedIngest).toBe(true);
    });

    it('createProject', async () => {
      mockFetch.mockReturnValue(respondWith({
        project_id: 'p_new',
        name: 'New Project',
      }));

      const project = await client.createProject({ name: 'New Project' });
      expect(project.id).toBe('p_new');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.name).toBe('New Project');
    });

    it('updateProject sends only set fields', async () => {
      mockFetch.mockReturnValue(respondWith({
        project_id: 'p1',
        name: 'Updated',
      }));

      await client.updateProject('p1', { name: 'Updated' });

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body).toEqual({ name: 'Updated' });
    });

    it('deleteProject requires name confirmation', async () => {
      mockFetch.mockReturnValueOnce(respondWith({
        project_id: 'p1',
        name: 'Real Name',
      }));

      await expect(
        client.deleteProject('p1', 'Wrong Name'),
      ).rejects.toThrow('does not match');
    });

    it('rotateIngestSecret', async () => {
      mockFetch.mockReturnValue(respondWith({
        ingest_secret: 'newsecret123',
      }));

      const result = await client.rotateIngestSecret('p1');
      expect(result.ingestSecret).toBe('newsecret123');
    });
  });

  // ── Breakers ─────────────────────────────────────────────────────

  describe('breakers', () => {
    it('listBreakers', async () => {
      mockFetch.mockReturnValue(respondWith({
        breakers: [
          { id: 'b1', name: 'latency-breaker', kind: 'p95', op: 'gt', threshold: 500 },
        ],
      }));

      const breakers = await client.listBreakers('p1');
      expect(breakers).toHaveLength(1);
      expect(breakers[0].kind).toBe(BreakerKind.P95);
    });

    it('createBreaker sends correct body', async () => {
      mockFetch.mockReturnValue(respondWith({
        id: 'b_new',
        name: 'error-rate',
        kind: 'error_rate',
        op: 'gt',
        threshold: 0.05,
      }));

      const breaker = await client.createBreaker('p1', {
        name: 'error-rate',
        metric: 'errors',
        kind: BreakerKind.ErrorRate,
        op: BreakerOp.Gt,
        threshold: 0.05,
        windowMs: 60000,
        metadata: { region: 'us-east' },
      });

      expect(breaker.id).toBe('b_new');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.kind).toBe('error_rate');
      expect(body.op).toBe('gt');
      expect(body.window_ms).toBe(60000);
      expect(body.metadata).toEqual({ region: 'us-east' });
    });

    it('getBreakerState', async () => {
      mockFetch.mockReturnValue(respondWith({
        breaker_id: 'b1',
        state: 'half_open',
        allow_rate: 0.3,
        updated_at: '2024-01-01T00:00:00Z',
      }));

      const state = await client.getBreakerState('p1', 'b1');
      expect(state.breakerId).toBe('b1');
      expect(state.state).toBe('half_open');
      expect(state.allowRate).toBe(0.3);
      expect(state.updatedAt).toBeInstanceOf(Date);
    });

    it('syncBreakers', async () => {
      mockFetch.mockReturnValue(respondWith({
        breakers: [
          { id: 'b1', name: 'synced', kind: 'error_rate', op: 'gt', threshold: 0.1 },
        ],
      }));

      const result = await client.syncBreakers('p1', {
        breakers: [{
          name: 'synced',
          metric: 'errors',
          kind: BreakerKind.ErrorRate,
          op: BreakerOp.Gt,
          threshold: 0.1,
        }],
      });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('synced');
    });

    it('deleteBreaker', async () => {
      mockFetch.mockReturnValue(respondEmpty());
      await client.deleteBreaker('p1', 'b1');

      const call = mockFetch.mock.calls[0];
      expect(call[1].method).toBe('DELETE');
    });
  });

  // ── Routers ──────────────────────────────────────────────────────

  describe('routers', () => {
    it('listRouters', async () => {
      mockFetch.mockReturnValue(respondWith({
        routers: [
          { id: 'r1', name: 'main-router', mode: 'static', enabled: true },
        ],
      }));

      const routers = await client.listRouters('p1');
      expect(routers).toHaveLength(1);
      expect(routers[0].mode).toBe(RouterMode.Static);
    });

    it('createRouter', async () => {
      mockFetch.mockReturnValue(respondWith({
        id: 'r_new',
        name: 'api-router',
        mode: 'canary',
        enabled: true,
      }));

      const router = await client.createRouter('p1', {
        name: 'api-router',
        mode: RouterMode.Canary,
      });
      expect(router.mode).toBe('canary');
    });

    it('linkBreaker', async () => {
      mockFetch.mockReturnValue(respondEmpty());
      await client.linkBreaker('p1', 'r1', { breakerId: 'b1' });

      const call = mockFetch.mock.calls[0];
      expect(call[1].method).toBe('POST');
      const body = JSON.parse(call[1].body);
      expect(body.breaker_id).toBe('b1');
    });

    it('unlinkBreaker', async () => {
      mockFetch.mockReturnValue(respondEmpty());
      await client.unlinkBreaker('p1', 'r1', 'b1');

      const call = mockFetch.mock.calls[0];
      expect(call[1].method).toBe('DELETE');
    });
  });

  // ── Notification channels ────────────────────────────────────────

  describe('notification channels', () => {
    it('listNotificationChannels', async () => {
      mockFetch.mockReturnValue(respondWith({
        items: [
          { id: 'nc1', name: 'alerts', channel: 'slack', enabled: true },
        ],
      }));

      const channels = await client.listNotificationChannels('p1');
      expect(channels).toHaveLength(1);
      expect(channels[0].channel).toBe(NotificationChannelType.Slack);
    });

    it('createNotificationChannel', async () => {
      mockFetch.mockReturnValue(respondWith({
        id: 'nc_new',
        name: 'webhook-alerts',
        channel: 'webhook',
        config: { url: 'https://hooks.example.com' },
        events: ['trip', 'recover'],
        enabled: true,
      }));

      const channel = await client.createNotificationChannel('p1', {
        name: 'webhook-alerts',
        channel: NotificationChannelType.Webhook,
        config: { url: 'https://hooks.example.com' },
        events: [NotificationEventType.Trip, NotificationEventType.Recover],
      });

      expect(channel.id).toBe('nc_new');
      expect(channel.events).toContain('trip');
    });

    it('iterNotificationChannels paginates', async () => {
      mockFetch
        .mockReturnValueOnce(respondWith({
          items: [{ id: 'nc1', name: 'first', channel: 'slack' }],
          next_cursor: 'cursor-2',
        }))
        .mockReturnValueOnce(respondWith({
          items: [{ id: 'nc2', name: 'second', channel: 'email' }],
          next_cursor: '',
        }));

      const channels: string[] = [];
      for await (const ch of client.iterNotificationChannels('p1')) {
        channels.push(ch.id);
      }

      expect(channels).toEqual(['nc1', 'nc2']);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('testNotificationChannel', async () => {
      mockFetch.mockReturnValue(respondEmpty());
      await client.testNotificationChannel('p1', 'nc1');

      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('/notification-channels/nc1/test');
    });
  });

  // ── Events ───────────────────────────────────────────────────────

  describe('events', () => {
    it('listEvents', async () => {
      mockFetch.mockReturnValue(respondWith({
        events: [
          {
            id: 'ev1',
            project_id: 'p1',
            breaker_id: 'b1',
            from_state: 'closed',
            to_state: 'open',
            reason: 'threshold exceeded',
            timestamp: '2024-01-01T00:00:00Z',
          },
        ],
      }));

      const events = await client.listEvents('p1');
      expect(events).toHaveLength(1);
      expect(events[0].fromState).toBe('closed');
      expect(events[0].toState).toBe('open');
      expect(events[0].timestamp).toBeInstanceOf(Date);
    });

    it('iterEvents paginates', async () => {
      mockFetch
        .mockReturnValueOnce(respondWith({
          events: [{ id: 'ev1', from_state: 'closed', to_state: 'open' }],
          next_cursor: 'c2',
        }))
        .mockReturnValueOnce(respondWith({
          events: [{ id: 'ev2', from_state: 'open', to_state: 'closed' }],
        }));

      const ids: string[] = [];
      for await (const ev of client.iterEvents('p1')) {
        ids.push(ev.id);
      }

      expect(ids).toEqual(['ev1', 'ev2']);
    });
  });

  // ── Project keys ─────────────────────────────────────────────────

  describe('project keys', () => {
    it('listProjectKeys', async () => {
      mockFetch.mockReturnValue(respondWith({
        keys: [
          { id: 'k1', name: 'my-key', key_prefix: 'eb_pk_abc...' },
        ],
      }));

      const keys = await client.listProjectKeys('p1');
      expect(keys).toHaveLength(1);
      expect(keys[0].keyPrefix).toBe('eb_pk_abc...');
    });

    it('createProjectKey returns full key', async () => {
      mockFetch.mockReturnValue(respondWith({
        id: 'k_new',
        name: 'new-key',
        key: 'eb_pk_full_key_value',
        key_prefix: 'eb_pk_ful...',
        message: 'Store this key securely',
      }));

      const result = await client.createProjectKey('p1', { name: 'new-key' });
      expect(result.key).toBe('eb_pk_full_key_value');
      expect(result.message).toContain('Store');
    });

    it('deleteProjectKey', async () => {
      mockFetch.mockReturnValue(respondEmpty());
      await client.deleteProjectKey('p1', 'k1');

      const call = mockFetch.mock.calls[0];
      expect(call[1].method).toBe('DELETE');
    });
  });

  // ── Error handling ───────────────────────────────────────────────

  describe('error handling', () => {
    it('throws NotFoundError on 404', async () => {
      mockFetch.mockReturnValue(respondWith(
        { message: 'not found', code: 'NOT_FOUND' },
        404,
      ));

      await expect(client.getProject('nonexistent')).rejects.toThrow(NotFoundError);
    });

    it('throws UnauthorizedError on 401', async () => {
      mockFetch.mockReturnValue(respondWith(
        { message: 'invalid key' },
        401,
      ));

      await expect(client.listProjects()).rejects.toThrow(UnauthorizedError);
    });

    it('throws ValidationError on 422', async () => {
      mockFetch.mockReturnValue(respondWith(
        { message: 'name is required', code: 'VALIDATION_ERROR' },
        422,
      ));

      await expect(
        client.createProject({ name: '' }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ServerFaultError on 500', async () => {
      mockFetch.mockReturnValue(respondWith(
        { message: 'internal error' },
        500,
      ));

      await expect(client.listProjects()).rejects.toThrow(ServerFaultError);
    });

    it('throws TransportError on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(client.listProjects()).rejects.toThrow(TransportError);
    });
  });

  // ── Request options ──────────────────────────────────────────────

  describe('request options', () => {
    it('sends idempotency key header', async () => {
      mockFetch.mockReturnValue(respondWith({ project_id: 'p1', name: 'test' }));

      await client.createProject(
        { name: 'test' },
        { idempotencyKey: 'idem-123' },
      );

      const call = mockFetch.mock.calls[0];
      expect(call[1].headers['Idempotency-Key']).toBe('idem-123');
    });

    it('sends request ID header', async () => {
      mockFetch.mockReturnValue(respondWith({ projects: [] }));

      await client.listProjects({ requestId: 'req-abc' });

      const call = mockFetch.mock.calls[0];
      expect(call[1].headers['X-Request-ID']).toBe('req-abc');
    });

    it('sends authorization header', async () => {
      mockFetch.mockReturnValue(respondWith({ projects: [] }));

      await client.listProjects();

      const call = mockFetch.mock.calls[0];
      expect(call[1].headers['Authorization']).toBe('Bearer eb_admin_test');
    });
  });
});

import {
  APIError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ServerFaultError,
  TransportError,
  UnauthorizedError,
  ValidationError,
} from '../errors.js';
import type {
  BatchGetBreakerStatesInput,
  Breaker,
  BreakerState,
  CreateBreakerInput,
  CreateNotificationChannelInput,
  CreateProjectInput,
  CreateProjectKeyInput,
  CreateProjectKeyResponse,
  CreateRouterInput,
  Event,
  IngestSecretRotation,
  LinkBreakerInput,
  ListEventsParams,
  ListParams,
  NotificationChannel,
  Project,
  ProjectKey,
  RequestOptions,
  Router,
  SyncBreakersInput,
  UpdateBreakerInput,
  UpdateNotificationChannelInput,
  UpdateProjectInput,
  UpdateRouterInput,
} from './types.js';
import { parseDt } from './types.js';
import type { BreakerKind, BreakerOp, HalfOpenPolicy, RouterMode, NotificationChannelType, NotificationEventType } from './types.js';

const DEFAULT_BASE_URL = 'https://api.tripswitch.dev';
const DEFAULT_TIMEOUT = 30_000;

/**
 * Client for the TripSwitch management API.
 *
 * Requires an admin API key (`eb_admin_...`) which is org-scoped.
 *
 * @example
 * ```ts
 * import { AdminClient } from 'tripswitch-ts/admin';
 *
 * const client = new AdminClient({ apiKey: 'eb_admin_...' });
 * const project = await client.getProject('proj_abc123');
 * ```
 */
export class AdminClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(opts: {
    apiKey: string;
    baseUrl?: string;
    timeout?: number;
  }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  }

  close(): void {
    // No persistent connections to clean up with fetch()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }

  // ── Projects ─────────────────────────────────────────────────────────

  async listProjects(options?: RequestOptions): Promise<Project[]> {
    const data = await this.request('GET', '/v1/projects', undefined, undefined, options);
    return ((data as any).projects ?? []).map(parseProject);
  }

  async getProject(projectId: string, options?: RequestOptions): Promise<Project> {
    const data = await this.request('GET', `/v1/projects/${projectId}`, undefined, undefined, options);
    return parseProject(data);
  }

  async createProject(input: CreateProjectInput, options?: RequestOptions): Promise<Project> {
    const data = await this.request('POST', '/v1/projects', { name: input.name }, undefined, options);
    return parseProject(data);
  }

  async updateProject(
    projectId: string,
    input: UpdateProjectInput,
    options?: RequestOptions,
  ): Promise<Project> {
    const body = buildUpdateProjectBody(input);
    const data = await this.request('PATCH', `/v1/projects/${projectId}`, body, undefined, options);
    return parseProject(data);
  }

  async deleteProject(
    projectId: string,
    confirmName: string,
    options?: RequestOptions,
  ): Promise<void> {
    const project = await this.getProject(projectId, options);
    if (project.name !== confirmName) {
      throw new Error(
        `project name '${project.name}' does not match confirmation '${confirmName}'`,
      );
    }
    await this.request('DELETE', `/v1/projects/${projectId}`, undefined, undefined, options);
  }

  async rotateIngestSecret(
    projectId: string,
    options?: RequestOptions,
  ): Promise<IngestSecretRotation> {
    const data = await this.request(
      'POST',
      `/v1/projects/${projectId}/ingest_secret/rotate`,
      undefined,
      undefined,
      options,
    );
    return { ingestSecret: (data as any).ingest_secret };
  }

  // ── Breakers ─────────────────────────────────────────────────────────

  async listBreakers(
    projectId: string,
    params?: ListParams,
    options?: RequestOptions,
  ): Promise<Breaker[]> {
    const data = await this.request(
      'GET',
      `/v1/projects/${projectId}/breakers`,
      undefined,
      listQuery(params),
      options,
    );
    return ((data as any).breakers ?? []).map((b: any) => parseBreaker(b));
  }

  async getBreaker(
    projectId: string,
    breakerId: string,
    options?: RequestOptions,
  ): Promise<Breaker> {
    const data = await this.request(
      'GET',
      `/v1/projects/${projectId}/breakers/${breakerId}`,
      undefined,
      undefined,
      options,
    );
    const routerId = (data as any).router_id ?? '';
    const breakerData = (data as any).breaker ?? data;
    return parseBreaker(breakerData, routerId);
  }

  async createBreaker(
    projectId: string,
    input: CreateBreakerInput,
    options?: RequestOptions,
  ): Promise<Breaker> {
    const body = buildCreateBreakerBody(input);
    const data = await this.request(
      'POST',
      `/v1/projects/${projectId}/breakers`,
      body,
      undefined,
      options,
    );
    const routerId = (data as any).router_id ?? '';
    const breakerData = (data as any).breaker ?? data;
    return parseBreaker(breakerData, routerId);
  }

  async updateBreaker(
    projectId: string,
    breakerId: string,
    input: UpdateBreakerInput,
    options?: RequestOptions,
  ): Promise<Breaker> {
    const body = buildUpdateBreakerBody(input);
    const data = await this.request(
      'PATCH',
      `/v1/projects/${projectId}/breakers/${breakerId}`,
      body,
      undefined,
      options,
    );
    const routerId = (data as any).router_id ?? '';
    const breakerData = (data as any).breaker ?? data;
    return parseBreaker(breakerData, routerId);
  }

  async deleteBreaker(
    projectId: string,
    breakerId: string,
    options?: RequestOptions,
  ): Promise<void> {
    await this.request(
      'DELETE',
      `/v1/projects/${projectId}/breakers/${breakerId}`,
      undefined,
      undefined,
      options,
    );
  }

  async syncBreakers(
    projectId: string,
    input: SyncBreakersInput,
    options?: RequestOptions,
  ): Promise<Breaker[]> {
    const body = {
      breakers: input.breakers.map(buildCreateBreakerBody),
    };
    const data = await this.request(
      'PUT',
      `/v1/projects/${projectId}/breakers`,
      body,
      undefined,
      options,
    );
    const items = Array.isArray(data) ? data : (data as any).breakers ?? [];
    return items.map((b: any) => parseBreaker(b));
  }

  async getBreakerState(
    projectId: string,
    breakerId: string,
    options?: RequestOptions,
  ): Promise<BreakerState> {
    const data = await this.request(
      'GET',
      `/v1/projects/${projectId}/breakers/${breakerId}/state`,
      undefined,
      undefined,
      options,
    );
    return parseBreakerState(data);
  }

  async batchGetBreakerStates(
    projectId: string,
    input: BatchGetBreakerStatesInput,
    options?: RequestOptions,
  ): Promise<BreakerState[]> {
    const body: Record<string, unknown> = {};
    if (input.breakerIds) body.breaker_ids = input.breakerIds;
    if (input.routerId) body.router_id = input.routerId;
    const data = await this.request(
      'POST',
      `/v1/projects/${projectId}/breakers/state:batch`,
      body,
      undefined,
      options,
    );
    const items = Array.isArray(data) ? data : (data as any).states ?? [];
    return items.map(parseBreakerState);
  }

  async updateBreakerMetadata(
    projectId: string,
    breakerId: string,
    metadata: Record<string, string>,
    options?: RequestOptions,
  ): Promise<void> {
    await this.request(
      'PATCH',
      `/v1/projects/${projectId}/breakers/${breakerId}/metadata`,
      metadata,
      undefined,
      options,
    );
  }

  // ── Routers ──────────────────────────────────────────────────────────

  async listRouters(
    projectId: string,
    params?: ListParams,
    options?: RequestOptions,
  ): Promise<Router[]> {
    const data = await this.request(
      'GET',
      `/v1/projects/${projectId}/routers`,
      undefined,
      listQuery(params),
      options,
    );
    return ((data as any).routers ?? []).map(parseRouter);
  }

  async getRouter(
    projectId: string,
    routerId: string,
    options?: RequestOptions,
  ): Promise<Router> {
    const data = await this.request(
      'GET',
      `/v1/projects/${projectId}/routers/${routerId}`,
      undefined,
      undefined,
      options,
    );
    return parseRouter(data);
  }

  async createRouter(
    projectId: string,
    input: CreateRouterInput,
    options?: RequestOptions,
  ): Promise<Router> {
    const body: Record<string, unknown> = {
      name: input.name,
      mode: input.mode,
      enabled: input.enabled ?? true,
    };
    if (input.description != null) body.description = input.description;
    if (input.metadata != null) body.metadata = input.metadata;
    const data = await this.request(
      'POST',
      `/v1/projects/${projectId}/routers`,
      body,
      undefined,
      options,
    );
    return parseRouter(data);
  }

  async updateRouter(
    projectId: string,
    routerId: string,
    input: UpdateRouterInput,
    options?: RequestOptions,
  ): Promise<Router> {
    const body: Record<string, unknown> = {};
    if (input.name != null) body.name = input.name;
    if (input.description != null) body.description = input.description;
    if (input.mode != null) body.mode = input.mode;
    if (input.enabled != null) body.enabled = input.enabled;
    if (input.metadata != null) body.metadata = input.metadata;
    const data = await this.request(
      'PATCH',
      `/v1/projects/${projectId}/routers/${routerId}`,
      body,
      undefined,
      options,
    );
    return parseRouter(data);
  }

  async deleteRouter(
    projectId: string,
    routerId: string,
    options?: RequestOptions,
  ): Promise<void> {
    await this.request(
      'DELETE',
      `/v1/projects/${projectId}/routers/${routerId}`,
      undefined,
      undefined,
      options,
    );
  }

  async linkBreaker(
    projectId: string,
    routerId: string,
    input: LinkBreakerInput,
    options?: RequestOptions,
  ): Promise<void> {
    await this.request(
      'POST',
      `/v1/projects/${projectId}/routers/${routerId}/breakers`,
      { breaker_id: input.breakerId },
      undefined,
      options,
    );
  }

  async unlinkBreaker(
    projectId: string,
    routerId: string,
    breakerId: string,
    options?: RequestOptions,
  ): Promise<void> {
    await this.request(
      'DELETE',
      `/v1/projects/${projectId}/routers/${routerId}/breakers/${breakerId}`,
      undefined,
      undefined,
      options,
    );
  }

  async updateRouterMetadata(
    projectId: string,
    routerId: string,
    metadata: Record<string, string>,
    options?: RequestOptions,
  ): Promise<void> {
    await this.request(
      'PATCH',
      `/v1/projects/${projectId}/routers/${routerId}/metadata`,
      metadata,
      undefined,
      options,
    );
  }

  // ── Notification channels ────────────────────────────────────────────

  async listNotificationChannels(
    projectId: string,
    params?: ListParams,
    options?: RequestOptions,
  ): Promise<NotificationChannel[]> {
    const data = await this.request(
      'GET',
      `/v1/projects/${projectId}/notification-channels`,
      undefined,
      listQuery(params),
      options,
    );
    return ((data as any).items ?? []).map(parseNotificationChannel);
  }

  async *iterNotificationChannels(
    projectId: string,
    params?: ListParams,
    options?: RequestOptions,
  ): AsyncGenerator<NotificationChannel> {
    let cursor = params?.cursor;
    const limit = params?.limit;
    while (true) {
      const data = await this.request(
        'GET',
        `/v1/projects/${projectId}/notification-channels`,
        undefined,
        listQuery({ cursor, limit }),
        options,
      );
      const items = (data as any).items ?? [];
      for (const item of items) {
        yield parseNotificationChannel(item);
      }
      const nextCursor = (data as any).next_cursor ?? '';
      if (!nextCursor || items.length === 0) break;
      cursor = nextCursor;
    }
  }

  async getNotificationChannel(
    projectId: string,
    channelId: string,
    options?: RequestOptions,
  ): Promise<NotificationChannel> {
    const data = await this.request(
      'GET',
      `/v1/projects/${projectId}/notification-channels/${channelId}`,
      undefined,
      undefined,
      options,
    );
    return parseNotificationChannel(data);
  }

  async createNotificationChannel(
    projectId: string,
    input: CreateNotificationChannelInput,
    options?: RequestOptions,
  ): Promise<NotificationChannel> {
    const body: Record<string, unknown> = {
      name: input.name,
      channel: input.channel,
      config: input.config,
      events: input.events,
      enabled: input.enabled ?? true,
    };
    const data = await this.request(
      'POST',
      `/v1/projects/${projectId}/notification-channels`,
      body,
      undefined,
      options,
    );
    return parseNotificationChannel(data);
  }

  async updateNotificationChannel(
    projectId: string,
    channelId: string,
    input: UpdateNotificationChannelInput,
    options?: RequestOptions,
  ): Promise<NotificationChannel> {
    const body: Record<string, unknown> = {};
    if (input.name != null) body.name = input.name;
    if (input.config != null) body.config = input.config;
    if (input.events != null) body.events = input.events;
    if (input.enabled != null) body.enabled = input.enabled;
    const data = await this.request(
      'PATCH',
      `/v1/projects/${projectId}/notification-channels/${channelId}`,
      body,
      undefined,
      options,
    );
    return parseNotificationChannel(data);
  }

  async deleteNotificationChannel(
    projectId: string,
    channelId: string,
    options?: RequestOptions,
  ): Promise<void> {
    await this.request(
      'DELETE',
      `/v1/projects/${projectId}/notification-channels/${channelId}`,
      undefined,
      undefined,
      options,
    );
  }

  async testNotificationChannel(
    projectId: string,
    channelId: string,
    options?: RequestOptions,
  ): Promise<void> {
    await this.request(
      'POST',
      `/v1/projects/${projectId}/notification-channels/${channelId}/test`,
      undefined,
      undefined,
      options,
    );
  }

  // ── Events ───────────────────────────────────────────────────────────

  async listEvents(
    projectId: string,
    params?: ListEventsParams,
    options?: RequestOptions,
  ): Promise<Event[]> {
    const data = await this.request(
      'GET',
      `/v1/projects/${projectId}/events`,
      undefined,
      eventsQuery(params),
      options,
    );
    return ((data as any).events ?? []).map(parseEvent);
  }

  async *iterEvents(
    projectId: string,
    params?: ListEventsParams,
    options?: RequestOptions,
  ): AsyncGenerator<Event> {
    let cursor = params?.cursor;
    while (true) {
      const effectiveParams: ListEventsParams = {
        ...params,
        cursor,
      };
      const data = await this.request(
        'GET',
        `/v1/projects/${projectId}/events`,
        undefined,
        eventsQuery(effectiveParams),
        options,
      );
      const events = (data as any).events ?? [];
      for (const event of events) {
        yield parseEvent(event);
      }
      const nextCursor = (data as any).next_cursor ?? '';
      if (!nextCursor || events.length === 0) break;
      cursor = nextCursor;
    }
  }

  // ── Project keys ─────────────────────────────────────────────────────

  async listProjectKeys(
    projectId: string,
    options?: RequestOptions,
  ): Promise<ProjectKey[]> {
    const data = await this.request(
      'GET',
      `/v1/projects/${projectId}/keys`,
      undefined,
      undefined,
      options,
    );
    return ((data as any).keys ?? []).map(parseProjectKey);
  }

  async createProjectKey(
    projectId: string,
    input?: CreateProjectKeyInput,
    options?: RequestOptions,
  ): Promise<CreateProjectKeyResponse> {
    const body: Record<string, unknown> = {};
    if (input?.name) body.name = input.name;
    const data = await this.request(
      'POST',
      `/v1/projects/${projectId}/keys`,
      body,
      undefined,
      options,
    );
    return parseCreateProjectKeyResponse(data);
  }

  async deleteProjectKey(
    projectId: string,
    keyId: string,
    options?: RequestOptions,
  ): Promise<void> {
    await this.request(
      'DELETE',
      `/v1/projects/${projectId}/keys/${keyId}`,
      undefined,
      undefined,
      options,
    );
  }

  // ── Internal: HTTP ───────────────────────────────────────────────────

  private async request(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
    options?: RequestOptions,
  ): Promise<unknown> {
    let url = this.baseUrl + path;
    if (query && Object.keys(query).length > 0) {
      const params = new URLSearchParams(query);
      url += '?' + params.toString();
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    if (body != null) {
      headers['Content-Type'] = 'application/json';
    }
    if (options?.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }
    if (options?.requestId) {
      headers['X-Request-ID'] = options.requestId;
    }
    if (options?.headers) {
      Object.assign(headers, options.headers);
    }

    const timeout = options?.timeout ?? this.timeout;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      throw new TransportError(
        err instanceof Error ? err.message : String(err),
      );
    }

    if (response.status >= 400) {
      await this.raiseForStatus(response);
    }

    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return {};
    }

    return response.json();
  }

  private async raiseForStatus(response: Response): Promise<never> {
    const status = response.status;
    const requestId = response.headers.get('x-request-id') ?? '';

    let code = '';
    let message = '';
    try {
      const data = await response.json();
      code = data.code ?? '';
      message = data.message ?? '';
    } catch {
      // ignore parse failures
    }

    if (!message) {
      message = `HTTP ${status}`;
    }

    let retryAfter: number | null = null;
    if (status === 429) {
      const raw = response.headers.get('retry-after') ?? '';
      if (raw) {
        const parsed = parseFloat(raw);
        if (!isNaN(parsed)) retryAfter = parsed;
      }
    }

    const body = new Uint8Array();
    const opts = { status, code, requestId, body, retryAfter };

    if (status === 404) throw new NotFoundError(message, opts);
    if (status === 401) throw new UnauthorizedError(message, opts);
    if (status === 403) throw new ForbiddenError(message, opts);
    if (status === 429) throw new RateLimitedError(message, opts);
    if (status === 409) throw new ConflictError(message, opts);
    if (status === 400 || status === 422) throw new ValidationError(message, opts);
    if (status >= 500 && status < 600) throw new ServerFaultError(message, opts);
    throw new APIError(message, opts);
  }
}

// ── Parse helpers ──────────────────────────────────────────────────────

function parseProject(d: any): Project {
  return {
    id: d.project_id ?? d.id ?? '',
    name: d.name ?? '',
    slackWebhookUrl: d.slack_webhook_url ?? '',
    traceIdUrlTemplate: d.trace_id_url_template ?? '',
    enableSignedIngest: d.enable_signed_ingest ?? false,
  };
}

function parseBreaker(d: any, routerId = ''): Breaker {
  return {
    id: d.id ?? '',
    name: d.name ?? '',
    metric: d.metric ?? '',
    kind: (d.kind ?? 'error_rate') as BreakerKind,
    op: (d.op ?? 'gt') as BreakerOp,
    threshold: d.threshold ?? 0,
    routerId: routerId || d.router_id || '',
    kindParams: Object.freeze(d.kind_params ?? {}),
    windowMs: d.window_ms ?? 0,
    minCount: d.min_count ?? 0,
    minStateDurationMs: d.min_state_duration_ms ?? 0,
    cooldownMs: d.cooldown_ms ?? 0,
    evalIntervalMs: d.eval_interval_ms ?? 0,
    halfOpenConfirmationMs: d.half_open_confirmation_ms ?? 0,
    halfOpenBackoffEnabled: d.half_open_backoff_enabled ?? false,
    halfOpenBackoffCapMs: d.half_open_backoff_cap_ms ?? 0,
    halfOpenIndeterminatePolicy: d.half_open_indeterminate_policy
      ? (d.half_open_indeterminate_policy as HalfOpenPolicy)
      : null,
    recoveryWindowMs: d.recovery_window_ms ?? 0,
    recoveryAllowRateRampSteps: d.recovery_allow_rate_ramp_steps ?? 0,
    actions: Object.freeze(d.actions ?? {}),
    metadata: Object.freeze(d.metadata ?? {}),
  };
}

function parseBreakerState(d: any): BreakerState {
  return {
    breakerId: d.breaker_id ?? '',
    state: d.state ?? '',
    allowRate: d.allow_rate ?? 0,
    updatedAt: parseDt(d.updated_at),
  };
}

function parseRouter(d: any): Router {
  return {
    id: d.id ?? '',
    name: d.name ?? '',
    mode: (d.mode ?? 'static') as RouterMode,
    enabled: d.enabled ?? false,
    breakerCount: d.breaker_count ?? 0,
    breakers: (d.breakers ?? []).map((b: any) => parseBreaker(b)),
    insertedAt: parseDt(d.inserted_at),
    createdBy: d.created_by ?? '',
    metadata: Object.freeze(d.metadata ?? {}),
  };
}

function parseNotificationChannel(d: any): NotificationChannel {
  return {
    id: d.id ?? '',
    projectId: d.project_id ?? '',
    name: d.name ?? '',
    channel: (d.channel ?? 'webhook') as NotificationChannelType,
    config: Object.freeze(d.config ?? {}),
    events: (d.events ?? []) as NotificationEventType[],
    enabled: d.enabled ?? true,
    createdAt: parseDt(d.created_at),
    updatedAt: parseDt(d.updated_at),
  };
}

function parseEvent(d: any): Event {
  return {
    id: d.id ?? '',
    projectId: d.project_id ?? '',
    breakerId: d.breaker_id ?? '',
    fromState: d.from_state ?? '',
    toState: d.to_state ?? '',
    reason: d.reason ?? '',
    timestamp: parseDt(d.timestamp),
  };
}

function parseProjectKey(d: any): ProjectKey {
  return {
    id: d.id ?? '',
    name: d.name ?? '',
    keyPrefix: d.key_prefix ?? '',
    insertedAt: parseDt(d.inserted_at),
    lastUsedAt: parseDt(d.last_used_at),
  };
}

function parseCreateProjectKeyResponse(d: any): CreateProjectKeyResponse {
  return {
    id: d.id ?? '',
    name: d.name ?? '',
    key: d.key ?? '',
    keyPrefix: d.key_prefix ?? '',
    message: d.message ?? '',
  };
}

// ── Query helpers ──────────────────────────────────────────────────────

function listQuery(params?: ListParams): Record<string, string> | undefined {
  if (!params) return undefined;
  const q: Record<string, string> = {};
  if (params.cursor) q.cursor = params.cursor;
  if (params.limit && params.limit > 0) q.limit = String(params.limit);
  return Object.keys(q).length > 0 ? q : undefined;
}

function eventsQuery(
  params?: ListEventsParams,
): Record<string, string> | undefined {
  if (!params) return undefined;
  const q: Record<string, string> = {};
  if (params.breakerId) q.breaker_id = params.breakerId;
  if (params.startTime) q.start_time = params.startTime.toISOString();
  if (params.endTime) q.end_time = params.endTime.toISOString();
  if (params.cursor) q.cursor = params.cursor;
  if (params.limit && params.limit > 0) q.limit = String(params.limit);
  return Object.keys(q).length > 0 ? q : undefined;
}

function buildCreateBreakerBody(input: CreateBreakerInput): Record<string, unknown> {
  const d: Record<string, unknown> = {
    name: input.name,
    metric: input.metric,
    kind: input.kind,
    op: input.op,
    threshold: input.threshold,
  };
  if (input.kindParams != null) d.kind_params = input.kindParams;
  if (input.windowMs != null) d.window_ms = input.windowMs;
  if (input.minCount != null) d.min_count = input.minCount;
  if (input.minStateDurationMs != null) d.min_state_duration_ms = input.minStateDurationMs;
  if (input.cooldownMs != null) d.cooldown_ms = input.cooldownMs;
  if (input.evalIntervalMs != null) d.eval_interval_ms = input.evalIntervalMs;
  if (input.halfOpenBackoffEnabled != null) d.half_open_backoff_enabled = input.halfOpenBackoffEnabled;
  if (input.halfOpenBackoffCapMs != null) d.half_open_backoff_cap_ms = input.halfOpenBackoffCapMs;
  if (input.halfOpenIndeterminatePolicy != null) d.half_open_indeterminate_policy = input.halfOpenIndeterminatePolicy;
  if (input.recoveryAllowRateRampSteps != null) d.recovery_allow_rate_ramp_steps = input.recoveryAllowRateRampSteps;
  if (input.actions != null) d.actions = input.actions;
  if (input.metadata != null) d.metadata = input.metadata;
  return d;
}

function buildUpdateBreakerBody(input: UpdateBreakerInput): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (input.name != null) d.name = input.name;
  if (input.metric != null) d.metric = input.metric;
  if (input.kind != null) d.kind = input.kind;
  if (input.kindParams != null) d.kind_params = input.kindParams;
  if (input.op != null) d.op = input.op;
  if (input.threshold != null) d.threshold = input.threshold;
  if (input.windowMs != null) d.window_ms = input.windowMs;
  if (input.minCount != null) d.min_count = input.minCount;
  if (input.minStateDurationMs != null) d.min_state_duration_ms = input.minStateDurationMs;
  if (input.cooldownMs != null) d.cooldown_ms = input.cooldownMs;
  if (input.evalIntervalMs != null) d.eval_interval_ms = input.evalIntervalMs;
  if (input.halfOpenBackoffEnabled != null) d.half_open_backoff_enabled = input.halfOpenBackoffEnabled;
  if (input.halfOpenBackoffCapMs != null) d.half_open_backoff_cap_ms = input.halfOpenBackoffCapMs;
  if (input.halfOpenIndeterminatePolicy != null) d.half_open_indeterminate_policy = input.halfOpenIndeterminatePolicy;
  if (input.recoveryAllowRateRampSteps != null) d.recovery_allow_rate_ramp_steps = input.recoveryAllowRateRampSteps;
  if (input.actions != null) d.actions = input.actions;
  if (input.metadata != null) d.metadata = input.metadata;
  return d;
}

function buildUpdateProjectBody(input: UpdateProjectInput): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (input.name != null) d.name = input.name;
  if (input.slackWebhookUrl != null) d.slack_webhook_url = input.slackWebhookUrl;
  if (input.traceIdUrlTemplate != null) d.trace_id_url_template = input.traceIdUrlTemplate;
  if (input.enableSignedIngest != null) d.enable_signed_ingest = input.enableSignedIngest;
  return d;
}

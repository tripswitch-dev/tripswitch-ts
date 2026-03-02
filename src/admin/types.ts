// ── Enums ────────────────────────────────────────────────────────────────

export const BreakerKind = {
  ErrorRate: 'error_rate',
  Avg: 'avg',
  P95: 'p95',
  Max: 'max',
  Min: 'min',
  Sum: 'sum',
  Stddev: 'stddev',
  Count: 'count',
  Percentile: 'percentile',
  ConsecutiveFailures: 'consecutive_failures',
  Delta: 'delta',
} as const;
export type BreakerKind = (typeof BreakerKind)[keyof typeof BreakerKind];

export const BreakerOp = {
  Gt: 'gt',
  Lt: 'lt',
  Gte: 'gte',
  Lte: 'lte',
} as const;
export type BreakerOp = (typeof BreakerOp)[keyof typeof BreakerOp];

export const HalfOpenPolicy = {
  Optimistic: 'optimistic',
  Conservative: 'conservative',
  Pessimistic: 'pessimistic',
} as const;
export type HalfOpenPolicy = (typeof HalfOpenPolicy)[keyof typeof HalfOpenPolicy];

export const RouterMode = {
  Static: 'static',
  Canary: 'canary',
  Weighted: 'weighted',
} as const;
export type RouterMode = (typeof RouterMode)[keyof typeof RouterMode];

export const NotificationChannelType = {
  Slack: 'slack',
  PagerDuty: 'pagerduty',
  Email: 'email',
  Webhook: 'webhook',
} as const;
export type NotificationChannelType =
  (typeof NotificationChannelType)[keyof typeof NotificationChannelType];

export const NotificationEventType = {
  Trip: 'trip',
  Recover: 'recover',
} as const;
export type NotificationEventType =
  (typeof NotificationEventType)[keyof typeof NotificationEventType];

// ── Request options ──────────────────────────────────────────────────────

export interface RequestOptions {
  idempotencyKey?: string;
  timeout?: number;
  requestId?: string;
  headers?: Record<string, string>;
}

// ── Pagination ───────────────────────────────────────────────────────────

export interface ListParams {
  cursor?: string;
  limit?: number;
}

// ── Projects ─────────────────────────────────────────────────────────────

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly slackWebhookUrl: string;
  readonly traceIdUrlTemplate: string;
  readonly enableSignedIngest: boolean;
}

export interface CreateProjectInput {
  name: string;
}

export interface UpdateProjectInput {
  name?: string;
  slackWebhookUrl?: string;
  traceIdUrlTemplate?: string;
  enableSignedIngest?: boolean;
}

export interface IngestSecretRotation {
  readonly ingestSecret: string;
}

// ── Breakers ─────────────────────────────────────────────────────────────

export interface Breaker {
  readonly id: string;
  readonly name: string;
  readonly metric: string;
  readonly kind: BreakerKind;
  readonly op: BreakerOp;
  readonly threshold: number;
  readonly routerId: string;
  readonly kindParams: Readonly<Record<string, unknown>>;
  readonly windowMs: number;
  readonly minCount: number;
  readonly minStateDurationMs: number;
  readonly cooldownMs: number;
  readonly evalIntervalMs: number;
  readonly halfOpenConfirmationMs: number;
  readonly halfOpenBackoffEnabled: boolean;
  readonly halfOpenBackoffCapMs: number;
  readonly halfOpenIndeterminatePolicy: HalfOpenPolicy | null;
  readonly recoveryWindowMs: number;
  readonly recoveryAllowRateRampSteps: number;
  readonly actions: Readonly<Record<string, unknown>>;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface CreateBreakerInput {
  name: string;
  metric: string;
  kind: BreakerKind;
  op: BreakerOp;
  threshold: number;
  kindParams?: Record<string, unknown>;
  windowMs?: number;
  minCount?: number;
  minStateDurationMs?: number;
  cooldownMs?: number;
  evalIntervalMs?: number;
  halfOpenBackoffEnabled?: boolean;
  halfOpenBackoffCapMs?: number;
  halfOpenIndeterminatePolicy?: HalfOpenPolicy;
  recoveryAllowRateRampSteps?: number;
  actions?: Record<string, unknown>;
  metadata?: Record<string, string>;
}

export interface UpdateBreakerInput {
  name?: string;
  metric?: string;
  kind?: BreakerKind;
  kindParams?: Record<string, unknown>;
  op?: BreakerOp;
  threshold?: number;
  windowMs?: number;
  minCount?: number;
  minStateDurationMs?: number;
  cooldownMs?: number;
  evalIntervalMs?: number;
  halfOpenBackoffEnabled?: boolean;
  halfOpenBackoffCapMs?: number;
  halfOpenIndeterminatePolicy?: HalfOpenPolicy;
  recoveryAllowRateRampSteps?: number;
  actions?: Record<string, unknown>;
  metadata?: Record<string, string>;
}

export interface SyncBreakersInput {
  breakers: CreateBreakerInput[];
}

export interface BreakerState {
  readonly breakerId: string;
  readonly state: string;
  readonly allowRate: number;
  readonly updatedAt: Date | null;
}

export interface BatchGetBreakerStatesInput {
  breakerIds?: string[];
  routerId?: string;
}

// ── Routers ──────────────────────────────────────────────────────────────

export interface Router {
  readonly id: string;
  readonly name: string;
  readonly mode: RouterMode;
  readonly enabled: boolean;
  readonly breakerCount: number;
  readonly breakers: readonly Breaker[];
  readonly insertedAt: Date | null;
  readonly createdBy: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface CreateRouterInput {
  name: string;
  mode: RouterMode;
  description?: string;
  enabled?: boolean;
  metadata?: Record<string, string>;
}

export interface UpdateRouterInput {
  name?: string;
  description?: string;
  mode?: RouterMode;
  enabled?: boolean;
  metadata?: Record<string, string>;
}

export interface LinkBreakerInput {
  breakerId: string;
}

// ── Notification channels ────────────────────────────────────────────────

export interface NotificationChannel {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly channel: NotificationChannelType;
  readonly config: Readonly<Record<string, unknown>>;
  readonly events: readonly NotificationEventType[];
  readonly enabled: boolean;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
}

export interface CreateNotificationChannelInput {
  name: string;
  channel: NotificationChannelType;
  config: Record<string, unknown>;
  events: NotificationEventType[];
  enabled?: boolean;
}

export interface UpdateNotificationChannelInput {
  name?: string;
  config?: Record<string, unknown>;
  events?: NotificationEventType[];
  enabled?: boolean;
}

// ── Events ───────────────────────────────────────────────────────────────

export interface Event {
  readonly id: string;
  readonly projectId: string;
  readonly breakerId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly timestamp: Date | null;
  readonly reason: string;
}

export interface ListEventsParams {
  breakerId?: string;
  startTime?: Date;
  endTime?: Date;
  cursor?: string;
  limit?: number;
}

// ── Project keys ─────────────────────────────────────────────────────────

export interface ProjectKey {
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly insertedAt: Date | null;
  readonly lastUsedAt: Date | null;
}

export interface CreateProjectKeyInput {
  name?: string;
}

export interface CreateProjectKeyResponse {
  readonly id: string;
  readonly name: string;
  readonly key: string;
  readonly keyPrefix: string;
  readonly message: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** @internal */
export function parseDt(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

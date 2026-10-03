import { z } from 'zod';
import {
  PeriodSchema,
  type ActionState,
  type AuditEventKind,
  type Grain,
  type MembershipClaims,
  type PageQuery,
  type Period,
  type RoleId,
  type ScopeEntity,
} from '@orbit/contracts';
import type { ScopeDeps } from '../plugins/scope.ts';
import type { ModelProvider } from './ask/narrator.ts';
import type { ErpStore } from './erp/ports.ts';

/*
 * Ports between the API modules and the data they read or write.
 *
 * Every port takes the verified membership so its database implementation can
 * run inside `withMembershipTx` and let RLS filter rows (ARCH §6.3, §8.3).
 * Ports return rows unparsed; modules parse them against contracts and fail
 * closed on a mismatch. The SQL implementations land once Maruti's schema
 * (ARCH §7.1) fixes table and column names; until then `app.ts` wires
 * `pendingModuleDeps()`, which answers `unavailable`.
 */

/** Dataset facts the modules attach to every response (PRD §8.4, FR-07). */
export const DatasetInfoSchema = z.strictObject({
  datasetChecksum: z.string().min(1),
  definitionVersion: z.string().min(1),
  /** Simulated as-of time of the synthetic dataset. */
  asOf: z.iso.datetime({ offset: true }),
  /** The reporting period the brief and guided prompts default to. */
  currentPeriod: PeriodSchema,
});
export type DatasetInfo = z.infer<typeof DatasetInfoSchema>;

export interface DatasetSource {
  current(membership: MembershipClaims): Promise<unknown>;
}

export interface SeriesQuery {
  assignmentId: string;
  entity: ScopeEntity;
  from?: string | undefined;
  to?: string | undefined;
}

export interface BreakdownQuery {
  assignmentId: string;
  parent: ScopeEntity;
  grain: Grain;
  period: Period;
}

/** Derived KPI observations (`kpi_observations`, ARCH §7.1). */
export interface ObservationSource {
  /** Observations for one entity, oldest period first. */
  series(membership: MembershipClaims, query: SeriesQuery): Promise<readonly unknown[]>;
  /** Observations for the children of `parent` at `grain`, for one period. */
  breakdown(membership: MembershipClaims, query: BreakdownQuery): Promise<readonly unknown[]>;
  /** Observations by id, for verifying evidence a client sends back. */
  byIds(membership: MembershipClaims, observationIds: readonly string[]): Promise<readonly unknown[]>;
}

/** Brief content before the module splits and checks it. */
export interface BriefRows {
  exceptions: readonly unknown[];
  onTrack: readonly unknown[];
  dataLimitations: readonly unknown[];
}

export interface InboxRows {
  items: readonly unknown[];
  nextCursor: string | null;
  /** How the source ordered the items; returned to the user verbatim (PRD FR-03). */
  orderingBasis: string;
}

/** Exceptions raised by a reviewed rule or a labelled seeded scenario (PRD FR-03). */
export interface ExceptionSource {
  brief(membership: MembershipClaims, period: Period): Promise<BriefRows>;
  inbox(membership: MembershipClaims, page: PageQuery): Promise<InboxRows>;
}

export type ActionRelation = 'creator' | 'assignee';

export interface AuditDraft {
  kind: AuditEventKind;
  target: { type: 'action' | 'assignment' | 'ask' | 'route'; id: string } | null;
  outcome: string;
  requestId: string;
}

export interface NewAction {
  idempotencyKey: string;
  title: string;
  assignmentId: string;
  entity: ScopeEntity;
  evidence: { observationIds: string[]; definitionVersion: string; datasetChecksum: string };
  assigneeId: string;
  dueDate: string;
  /** Set for a delegated sub-action: the action this one was delegated from. */
  parentActionId?: string | null;
  /** The entity's display name as the creator sees it, snapshotted onto the action. */
  entityLabel?: string | null;
}

export type TransitionResult =
  | { status: 'ok'; action: unknown }
  | { status: 'stale' }
  | { status: 'not_found' };

/**
 * Actions and their audit rows. Implementations must write the action, its
 * `action_events` row, and the audit event in one transaction (ARCH §10).
 */
export interface ActionStore {
  /** Returns the existing action with `replayed: true` when the idempotency key was already used by this creator. */
  create(membership: MembershipClaims, action: NewAction, audit: AuditDraft): Promise<{ action: unknown; replayed: boolean }>;
  /** The action and the caller's relation to it, or null when the caller may not see it. */
  get(membership: MembershipClaims, actionId: string): Promise<{ action: unknown; relation: ActionRelation } | null>;
  /** Compare-and-swap on `expectedVersion`; a mismatch returns `stale`, never an overwrite. */
  transition(
    membership: MembershipClaims,
    change: { actionId: string; expectedVersion: number; toState: ActionState; reason: string },
    audit: AuditDraft,
  ): Promise<TransitionResult>;
  list(membership: MembershipClaims, page: PageQuery): Promise<{ items: readonly unknown[]; nextCursor: string | null }>;
  /** The action's recorded state changes, oldest first, as ActionEventSchema rows. Empty when not visible. */
  history(membership: MembershipClaims, actionId: string): Promise<readonly unknown[]>;
  /** Actions delegated from this one that the caller can see, oldest first. */
  children(membership: MembershipClaims, actionId: string): Promise<readonly unknown[]>;
}

/**
 * Who the caller may assign an action on this evidence to, resolved
 * server-side (ADR 0011 §6). Only people whose scope lies inside the caller's
 * own; the actions module re-checks that containment with the scope resolver.
 */
export interface AssigneeDirectory {
  permitted(membership: MembershipClaims, target: { assignmentId: string; entity: ScopeEntity }): Promise<readonly unknown[]>;
}

export type TransitionDecision = 'allowed' | 'invalid_transition' | 'not_permitted';

/** Aditya's action transition matrix (ARCH §17.3) — open decision, supplied as data. */
export interface TransitionPolicy {
  /** Every state the caller may move this action to from `from`; the UI offers exactly these. */
  moves(input: { role: RoleId; relation: ActionRelation; from: ActionState }): Promise<ActionState[]>;
  decide(input: { role: RoleId; relation: ActionRelation; from: ActionState; to: ActionState }): Promise<TransitionDecision>;
}

/** Append-only audit trail (ARCH §10): INSERT and gated SELECT only. */
export interface AuditStore {
  record(membership: MembershipClaims, event: AuditDraft): Promise<void>;
  /**
   * Audit events for actions the caller created or is assigned — nothing else
   * (ADR 0011 §7). Filtered by actor and assignee from the verified claims,
   * not by a per-role flag.
   */
  list(membership: MembershipClaims, page: PageQuery): Promise<{ items: readonly unknown[]; nextCursor: string | null }>;
}

/** Names of the organizational entities the caller can see (`GET /api/entities`). */
export interface EntityDirectory {
  visible(membership: MembershipClaims): Promise<readonly unknown[]>;
}

/** Retrieved knowledge chunk (ADR 0019). */
export interface KnowledgeChunk {
  id: string;
  title: string;
  content: string;
  source: string;
  /** Kind of knowledge, which is what role grants are made on. */
  domain: string;
  similarity: number;
  matchedBy: 'vector' | 'text' | 'hybrid';
  /** ISO time the chunk text was last built from the data. */
  updatedAt: string;
}

/** What to search for: the words always, and the question's vector when one could be made. */
export interface KnowledgeQuery {
  text: string;
  embedding: number[] | null;
}

/**
 * Knowledge search over `orbit.knowledge_chunks`: full-text always, vector when
 * an embedding is given. What is searched is decided by the database from the
 * caller's verified membership (organization, scope, role and domain grants),
 * never by a field the client sent.
 */
export interface KnowledgeSource {
  search(
    membership: MembershipClaims,
    query: KnowledgeQuery,
    options?: { threshold?: number; limit?: number },
  ): Promise<readonly KnowledgeChunk[]>;
}

/** How the question is embedded for vector search. Without a provider the chatbot uses text search only. */
export interface EmbeddingConfig {
  provider: ModelProvider | undefined;
  model: string;
  fetchImpl?: typeof fetch;
}

/**
 * Model narration for Ask answers (ADR 0014). No providers means every answer
 * stays deterministic, which is the default.
 */
export interface AskNarration {
  /** Tried in order: Groq, then OpenRouter. */
  providers: readonly ModelProvider[];
  /** Per-provider budget; a slow model is a declined one. */
  timeoutMs: number;
  /** Injected so tests never touch the network. */
  fetchImpl?: typeof fetch;
}

/**
 * Aggregates of the hospital operations (ERP) data for a leader's own
 * hospitals (ADR 0018). Counts only: no person, patient or visit. The database
 * functions behind it apply the caller's scope; the route re-checks the role.
 */
export interface OperationsSource {
  /** Per hospital, right now. */
  snapshot(membership: MembershipClaims): Promise<readonly unknown[]>;
  /** Per hospital and finished day, for `days` days before today. */
  daily(membership: MembershipClaims, days: number): Promise<readonly unknown[]>;
}

export interface ModuleDeps {
  scope: ScopeDeps;
  dataset: DatasetSource;
  observations: ObservationSource;
  exceptions: ExceptionSource;
  actions: ActionStore;
  assignees: AssigneeDirectory;
  transitions: TransitionPolicy;
  audit: AuditStore;
  entities: EntityDirectory;
  /** Hospital operations (ADR 0016). Served only to ERP operator accounts. */
  erp: ErpStore;
  /** Leadership's aggregate view of the same data (ADR 0018). */
  operations: OperationsSource;
  askNarration: AskNarration;
  /** Knowledge retrieval for the chatbot. */
  knowledge: KnowledgeSource;
  embedding: EmbeddingConfig;
  /** The disclosure rendered on every number surface (PRD §8.4). */
  disclosure: string;
}

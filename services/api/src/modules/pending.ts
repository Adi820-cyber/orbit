import { FRAMEWORK_MANIFEST } from '@orbit/kpi-framework';
import { ApiError } from '../plugins/errors.ts';
import { ILLUSTRATIVE_DISCLOSURE } from './index.ts';
import { DEFAULT_EMBEDDING_MODEL } from './chatbot/embedder.ts';
import { pendingErpStore } from './erp/pending.ts';
import type { ModuleDeps } from './ports.ts';

/** ADR 0014: Ask must stay responsive, so each provider gets at most this long. */
export const ASK_NARRATION_TIMEOUT_MS = 8000;

/**
 * Fail-closed module dependencies for deployment until the real sources exist.
 *
 * Each one waits on work owned by someone else, so none is guessed here:
 * - observations, exceptions, dataset, actions, audit, assignees: Maruti's
 *   schema and seed (ARCH §7.1);
 * - entitlements: the signed entitlement matrix (ADR 0005, Aditya);
 * - scope resolver: the organization hierarchy tables (Maruti);
 * - transitions: the action transition matrix (ARCH §17.3, Aditya).
 */
export function pendingModuleDeps(): ModuleDeps {
  const pending = (what: string): never => {
    throw new ApiError('unavailable', 'Orbit is not available yet.', `${what}_not_implemented`);
  };
  return {
    disclosure: ILLUSTRATIVE_DISCLOSURE,
    // No providers: Ask answers stay deterministic until keys are configured.
    askNarration: { providers: [], timeoutMs: ASK_NARRATION_TIMEOUT_MS },
    scope: {
      frameworkVersion: FRAMEWORK_MANIFEST.definitionVersion,
      entitlements: { forMembership: async () => pending('entitlement_store') },
      resolver: { contains: async () => pending('scope_resolver') },
    },
    dataset: { current: async () => pending('dataset_store') },
    observations: {
      series: async () => pending('observation_store'),
      breakdown: async () => pending('observation_store'),
      byIds: async () => pending('observation_store'),
    },
    exceptions: {
      brief: async () => pending('exception_store'),
      inbox: async () => pending('exception_store'),
    },
    actions: {
      create: async () => pending('action_store'),
      get: async () => pending('action_store'),
      transition: async () => pending('action_store'),
      list: async () => pending('action_store'),
      history: async () => pending('action_store'),
      children: async () => pending('action_store'),
    },
    assignees: { permitted: async () => pending('assignee_directory') },
    transitions: {
      moves: async () => pending('transition_matrix'),
      decide: async () => pending('transition_matrix'),
    },
    entities: { visible: async () => pending('entity_directory') },
    knowledge: { search: async () => pending('knowledge_store') },
    embedding: { provider: undefined, model: DEFAULT_EMBEDDING_MODEL },
    operations: {
      snapshot: async () => pending('operations_store'),
      daily: async () => pending('operations_store'),
    },
    surveillance: {
      feed: async () => pending('surveillance_store'),
      hospitals: async () => pending('surveillance_store'),
      run: async () => pending('surveillance_store'),
    },
    revenue: {
      summary: async () => pending('revenue_store'),
      daily: async () => pending('revenue_store'),
      currency: async () => pending('revenue_store'),
    },
    erp: pendingErpStore(() => pending('erp_store')),
    audit: {
      record: async () => pending('audit_store'),
      list: async () => pending('audit_store'),
    },
  };
}

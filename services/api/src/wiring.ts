import type { ApiConfig } from './config.ts';
import { createDbActionStore } from './db/actions.ts';
import { createDbAssigneeDirectory } from './db/assignees.ts';
import { createDbAuditStore } from './db/audit.ts';
import { createDatabase, type Database } from './db/client.ts';
import { createDbDatasetSource, createDbExceptionSource, createDbObservationSource } from './db/kpi-data.ts';
import { createDbMembershipSource } from './db/memberships.ts';
import { createDbErpStore } from './db/erp.ts';
import { DEFAULT_EMBEDDING_MODEL, embeddingProvider } from './modules/chatbot/embedder.ts';
import { createDbKnowledgeSource } from './db/knowledge.ts';
import { createDbOperationsSource } from './db/operations.ts';
import { createDbRevenueSource } from './db/revenue.ts';
import { createDbEntitlementSource, createDbEntityDirectory, createDbScopeResolver, membershipQuery } from './db/sources.ts';
import { createMatrixTransitionPolicy, PROPOSED_TRANSITIONS } from './modules/actions/transitions.ts';
import type { ModuleDeps } from './modules/index.ts';
import { pendingModuleDeps } from './modules/pending.ts';
import { ApiError } from './plugins/errors.ts';
import type { MembershipSource } from './plugins/auth.ts';

export interface Sources {
  memberships: MembershipSource;
  modules: ModuleDeps;
}

/** Fails closed until `ORBIT_LIVE_SOURCES` includes `memberships`. */
export const pendingMembershipSource: MembershipSource = {
  async findBySubject() {
    throw new ApiError('unavailable', 'Orbit is not available yet.', 'membership_store_not_implemented');
  },
};

/**
 * Chooses a real or fail-closed implementation for each source, from
 * configuration alone. Turning a source on once its prerequisite lands is an
 * environment change, not a build. Anything not named in
 * `ORBIT_LIVE_SOURCES` keeps answering `unavailable`.
 */
export function wireSources(
  config: Pick<ApiConfig, 'liveSources' | 'databaseUrl'> & Partial<Pick<ApiConfig, 'askProviders' | 'embeddingModel'>>,
  openDatabase: (url: string) => Database = (url) => createDatabase({ url }),
): Sources {
  const live = config.liveSources;
  const modules = pendingModuleDeps();
  // Narration is not a data source: it is on whenever a provider key is configured.
  modules.askNarration = { ...modules.askNarration, providers: config.askProviders ?? [] };
  // Embeddings use the OpenRouter key when there is one; otherwise search is by words only.
  modules.embedding = {
    provider: embeddingProvider(config.askProviders ?? []),
    model: config.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
  };
  let db: Database | undefined;
  const database = (): Database => {
    if (!config.databaseUrl) {
      // loadConfig already refuses this combination; kept so a direct caller cannot bypass it.
      throw new Error('A database source is live but DATABASE_URL is not set');
    }
    db ??= openDatabase(config.databaseUrl);
    return db;
  };

  if (live.has('entitlements')) {
    modules.scope.entitlements = createDbEntitlementSource(database());
  }
  if (live.has('scope')) {
    modules.scope.resolver = createDbScopeResolver(database());
  }
  if (live.has('entities')) {
    modules.entities = createDbEntityDirectory(database());
  }
  if (live.has('actions')) {
    modules.actions = createDbActionStore(database());
  }
  if (live.has('audit')) {
    modules.audit = createDbAuditStore(database());
  }
  if (live.has('assignees')) {
    modules.assignees = createDbAssigneeDirectory(database());
  }
  if (live.has('dataset')) {
    modules.dataset = createDbDatasetSource(database());
  }
  if (live.has('observations')) {
    modules.observations = createDbObservationSource(database());
  }
  if (live.has('exceptions')) {
    modules.exceptions = createDbExceptionSource(database());
  }
  if (live.has('erp')) {
    modules.erp = createDbErpStore(database());
    // The leadership view reads the same ERP data, as aggregates (ADR 0018).
    modules.operations = createDbOperationsSource(database());
    modules.revenue = createDbRevenueSource(database());
  }
  if (live.has('transitions')) {
    modules.transitions = createMatrixTransitionPolicy(PROPOSED_TRANSITIONS);
  }
  if (live.has('knowledge')) {
    modules.knowledge = createDbKnowledgeSource(database());
  }

  return {
    memberships: live.has('memberships') ? createDbMembershipSource(database(), membershipQuery) : pendingMembershipSource,
    modules,
  };
}

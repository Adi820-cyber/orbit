import type { ApiConfig } from './config.ts';
import { createDbActionStore } from './db/actions.ts';
import { createDbAssigneeDirectory } from './db/assignees.ts';
import { createDbAuditStore } from './db/audit.ts';
import { createDatabase, type Database } from './db/client.ts';
import { createDbMembershipSource } from './db/memberships.ts';
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
  config: Pick<ApiConfig, 'liveSources' | 'databaseUrl'> & Partial<Pick<ApiConfig, 'askProviders'>>,
  openDatabase: (url: string) => Database = (url) => createDatabase({ url }),
): Sources {
  const live = config.liveSources;
  const modules = pendingModuleDeps();
  // Narration is not a data source: it is on whenever a provider key is configured.
  modules.askNarration = { ...modules.askNarration, providers: config.askProviders ?? [] };
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
  if (live.has('transitions')) {
    modules.transitions = createMatrixTransitionPolicy(PROPOSED_TRANSITIONS);
  }

  return {
    memberships: live.has('memberships') ? createDbMembershipSource(database(), membershipQuery) : pendingMembershipSource,
    modules,
  };
}

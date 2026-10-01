import type { FastifyInstance } from 'fastify';
import { registerActionRoutes } from './actions/routes.ts';
import { registerAskRoutes } from './ask/routes.ts';
import { recordDenials, registerAuditRoutes } from './audit/routes.ts';
import { registerBriefRoutes } from './brief/routes.ts';
import { registerChatbotRoutes } from './chatbot/routes.ts';
import { registerEntityRoutes } from './entities/routes.ts';
import { registerErpModule } from './erp/routes.ts';
import { registerInboxRoutes } from './inbox/routes.ts';
import { registerKpiRoutes } from './kpi/routes.ts';
import type { ModuleDeps } from './ports.ts';

export type { ModuleDeps } from './ports.ts';

/** PRD §8.4 disclosure wording; rendered by the UI on every number surface. */
export const ILLUSTRATIVE_DISCLOSURE =
  'Fictional demonstration company. All figures and targets are illustrative; not validated clinical or financial guidance.';

/** Registers the six modules inside an already-authenticated `/api` scope. */
export function registerModules(api: FastifyInstance, deps: ModuleDeps): void {
  recordDenials(api, deps);
  registerBriefRoutes(api, deps);
  registerInboxRoutes(api, deps);
  registerKpiRoutes(api, deps);
  registerAskRoutes(api, deps);
  registerActionRoutes(api, deps);
  registerAuditRoutes(api, deps);
  registerEntityRoutes(api, deps);
  registerErpModule(api, deps);
  registerChatbotRoutes(api, deps);
}

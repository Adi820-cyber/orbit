import {
  EvidenceRefSchema,
  GrainSchema,
  PeriodSchema,
  ScopeEntitySchema,
  type EvidenceRef,
  type Grain,
  type Period,
  type ScopeEntity,
} from "@orbit/contracts";
import { workspacePath } from "./environment";

/*
 * URLs carry evidence and scope between surfaces as a convenience only. Every
 * receiving loader parses them against contracts, and the API re-authorizes
 * and re-verifies everything it is sent.
 */

export function explorerHref(
  basePath: string,
  assignmentId: string,
  entity: ScopeEntity,
  options: { breakdown?: Grain } = {},
) {
  const query = new URLSearchParams({ grain: entity.grain, entityId: entity.entityId });
  if (options.breakdown) query.set("breakdown", options.breakdown);
  return `${workspacePath(basePath, `/explorer/${encodeURIComponent(assignmentId)}`)}?${query.toString()}`;
}

export type AskPrefill =
  | { intent: "explain_definition"; assignmentId: string }
  | { intent: "report_performance"; assignmentId: string; target: ScopeEntity; period: Period }
  | { intent: "explain_contributors"; assignmentId: string; target: ScopeEntity; period: Period; breakdown: Grain };

export function askHref(basePath: string, prefill: AskPrefill) {
  const query = new URLSearchParams({ intent: prefill.intent, assignmentId: prefill.assignmentId });
  if ("target" in prefill) {
    query.set("grain", prefill.target.grain);
    query.set("entityId", prefill.target.entityId);
    query.set("month", prefill.period.start.slice(0, 7));
  }
  if ("breakdown" in prefill) query.set("breakdown", prefill.breakdown);
  return `${workspacePath(basePath, "/ask")}?${query.toString()}`;
}

export function newActionHref(
  basePath: string,
  input: { assignmentId: string; entity: ScopeEntity; evidence: EvidenceRef },
) {
  const query = new URLSearchParams({
    assignmentId: input.assignmentId,
    grain: input.entity.grain,
    entityId: input.entity.entityId,
    definitionVersion: input.evidence.definitionVersion,
    datasetChecksum: input.evidence.datasetChecksum,
  });
  for (const id of input.evidence.observationIds) query.append("observationId", id);
  return `${workspacePath(basePath, "/actions/new")}?${query.toString()}`;
}

export interface ActionDraftSource {
  assignmentId: string;
  entity: ScopeEntity;
  evidence: EvidenceRef;
}

export function parseActionDraft(search: URLSearchParams): ActionDraftSource | null {
  const assignmentId = search.get("assignmentId");
  const entity = ScopeEntitySchema.safeParse({ grain: search.get("grain"), entityId: search.get("entityId") });
  const evidence = EvidenceRefSchema.safeParse({
    observationIds: search.getAll("observationId"),
    definitionVersion: search.get("definitionVersion"),
    datasetChecksum: search.get("datasetChecksum"),
  });

  if (!assignmentId || !entity.success || !evidence.success) {
    return null;
  }

  return { assignmentId, entity: entity.data, evidence: evidence.data };
}

export function parseEntity(search: URLSearchParams): ScopeEntity | null {
  const parsed = ScopeEntitySchema.safeParse({ grain: search.get("grain"), entityId: search.get("entityId") });
  return parsed.success ? parsed.data : null;
}

export function parseGrain(value: string | null): Grain | undefined {
  const parsed = GrainSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function monthPeriod(month: string | null): Period | null {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, monthIndex] = month.split("-").map(Number);
  if (!year || !monthIndex) return null;
  const end = new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10);
  const parsed = PeriodSchema.safeParse({ cadence: "month", start: `${month}-01`, end });
  return parsed.success ? parsed.data : null;
}

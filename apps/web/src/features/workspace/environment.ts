import { createContext, useContext } from "react";
import { redirect } from "react-router";
import type {
  EntityDirectoryEntry,
  KpiAssignmentSummary,
  KpiListResponse,
  MeResponse,
  ScopeEntity,
} from "@orbit/contracts";
import {
  ApiRequestError,
  createApiClient,
  httpTransport,
  type ApiClient,
} from "../../lib/api";
import { AuthConfigurationError, getCurrentSession } from "../../lib/auth";

/**
 * Where a workspace route tree gets its data. `live` authenticates with
 * Supabase and calls the API; `preview` (development builds only) binds the
 * same routes to the in-memory fixture API with no authentication.
 */
export interface WorkspaceEnvironment {
  kind: "live" | "preview";
  basePath: string;
  routeId: string;
  client(request: Request): Promise<ApiClient>;
  reset?: () => Promise<void>;
}

export function loginRedirect(request: Request) {
  const url = new URL(request.url);
  return redirect(`/login?returnTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
}

export const liveEnvironment: WorkspaceEnvironment = {
  kind: "live",
  basePath: "",
  routeId: "workspace",
  async client(request) {
    let session;

    try {
      session = await getCurrentSession();
    } catch (error: unknown) {
      if (error instanceof AuthConfigurationError) {
        throw loginRedirect(request);
      }
      throw error;
    }

    if (!session) {
      throw loginRedirect(request);
    }

    return createApiClient(httpTransport(session.access_token));
  },
};

/** Runs a read with the environment's client; an expired session goes back to sign-in. */
export async function withClient<T>(
  environment: WorkspaceEnvironment,
  request: Request,
  run: (client: ApiClient) => Promise<T>,
): Promise<T> {
  const client = await environment.client(request);

  try {
    return await run(client);
  } catch (error: unknown) {
    if (error instanceof ApiRequestError && error.code === "unauthenticated") {
      throw loginRedirect(request);
    }
    throw error;
  }
}

export interface MutationFailure {
  ok: false;
  code: ApiRequestError["code"] | "unavailable";
  message: string;
}

/** Mutations report failures inline instead of replacing the page with an error boundary. */
export async function mutate<T>(
  environment: WorkspaceEnvironment,
  request: Request,
  run: (client: ApiClient) => Promise<T>,
): Promise<{ ok: true; value: T } | MutationFailure> {
  try {
    return { ok: true, value: await withClient(environment, request, run) };
  } catch (error: unknown) {
    if (error instanceof ApiRequestError) {
      return { ok: false, code: error.code, message: error.message };
    }
    if (error instanceof Response) {
      throw error;
    }
    return { ok: false, code: "unavailable", message: "Orbit could not complete this request." };
  }
}

export interface WorkspaceData {
  membership: MeResponse;
  kpis: KpiListResponse;
  /** Display names from `GET /api/entities`; empty when the directory is unavailable. */
  entities: EntityDirectoryEntry[];
}

export interface WorkspaceContextValue extends WorkspaceData {
  environment: Pick<WorkspaceEnvironment, "kind" | "basePath">;
  assignments: ReadonlyMap<string, KpiAssignmentSummary>;
  entityLabels: ReadonlyMap<string, string>;
}

export function entityKey(entity: ScopeEntity) {
  return `${entity.grain}:${entity.entityId}`;
}

export function entityLabelMap(entities: readonly EntityDirectoryEntry[]): ReadonlyMap<string, string> {
  return new Map(entities.map((entry) => [entityKey(entry), entry.label]));
}

/**
 * Loads display names for the entities the caller can see. Names are
 * display-only, so an unavailable or not-yet-deployed directory degrades to
 * showing ids rather than failing the workspace. Every other failure,
 * including an expired session, still propagates.
 */
export async function loadEntities(client: ApiClient): Promise<EntityDirectoryEntry[]> {
  try {
    return (await client.entities()).entities;
  } catch (error: unknown) {
    if (error instanceof ApiRequestError && (error.code === "unavailable" || error.code === "not_found")) {
      return [];
    }
    throw error;
  }
}

/**
 * The entity's display name, or its id when the directory has no name for it.
 * Outside a workspace (a component rendered on its own) it falls back to ids.
 */
export function useEntityLabel() {
  const entityLabels = useContext(WorkspaceContext)?.entityLabels;
  return (entity: ScopeEntity) => entityLabels?.get(entityKey(entity)) ?? entity.entityId;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const value = useContext(WorkspaceContext);

  if (!value) {
    throw new Error("Workspace surfaces must render inside the workspace layout.");
  }

  return value;
}

export function workspacePath(basePath: string, path: string) {
  if (path === "/" || path === "") {
    return basePath || "/";
  }

  return `${basePath}${path}`;
}

export function useWorkspacePath() {
  const { environment } = useWorkspace();
  return (path: string) => workspacePath(environment.basePath, path);
}

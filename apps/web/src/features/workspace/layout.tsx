import { useEffect, useMemo } from "react";
import {
  Form,
  NavLink,
  Outlet,
  redirect,
  useLoaderData,
  useNavigate,
  useNavigation,
  useRevalidator,
  type LoaderFunctionArgs,
} from "react-router";
import { seesOperations, type RoleId } from "@orbit/contracts";
import { OrbitBrand } from "@orbit/ui-kit";
import { ApiRequestError } from "../../lib/api";
import { onSessionEnded } from "../../lib/auth";
import { APP_SURFACE, servesOperators } from "../../lib/surface";
import { AskChat } from "../ask/chat";
import { ChatbotPanel } from "../chatbot/panel";
import { assignmentMap, humanize } from "../../lib/format";
import { roleViewConfigFor } from "../../roles/config";
import { Icon, type IconName } from "./components";
import {
  WorkspaceContext,
  entityKey,
  entityLabelMap,
  loadEntities,
  withClient,
  workspacePath,
  type WorkspaceData,
  type WorkspaceEnvironment,
} from "./environment";
import { RoleViewUnavailableError } from "./states";
import "./workspace.css";

const SURFACES: readonly { path: string; label: string; short: string; icon: IconName; operationsOnly?: true }[] = [
  { path: "/", label: "Morning brief", short: "Brief", icon: "brief" },
  { path: "/inbox", label: "Priority inbox", short: "Inbox", icon: "inbox" },
  { path: "/explorer", label: "KPI explorer", short: "Explorer", icon: "explorer" },
  { path: "/actions", label: "Actions", short: "Actions", icon: "actions" },
  { path: "/operations", label: "Hospital operations", short: "Operations", icon: "operations", operationsOnly: true },
  { path: "/audit", label: "Audit", short: "Audit", icon: "audit" },
];

export function workspaceLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<WorkspaceData> =>
    withClient(environment, request, async (client) => {
      const membership = await client.identity();

      // An ERP operator account has no leader workspace; its home is hospital operations (ADR 0016).
      if ("operatorRole" in membership) {
        if (!servesOperators(APP_SURFACE)) {
          throw new ApiRequestError("forbidden", "This portal is for leadership accounts. Use the hospital operations portal.", 403);
        }
        throw redirect("/erp");
      }

      // Role selects the view configuration, never the data scope (ARCH §5).
      if (!roleViewConfigFor(membership.role)) {
        throw new RoleViewUnavailableError(membership.role);
      }

      const [kpis, entities] = await Promise.all([client.kpiList(), loadEntities(client)]);
      return { membership, kpis, entities };
    });
}

function Navigation({ environment, role, compact }: { environment: WorkspaceEnvironment; role: RoleId; compact: boolean }) {
  return (
    <nav className="workspace-nav" aria-label={compact ? "Orbit workspace, compact" : "Orbit workspace"}>
      {SURFACES.filter((surface) => !surface.operationsOnly || seesOperations(role)).map((surface) => (
        <NavLink key={surface.path} end={surface.path === "/"} to={workspacePath(environment.basePath, surface.path)}>
          <Icon name={surface.icon} />
          <span>{compact ? surface.short : surface.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function ExitControl({ environment }: { environment: WorkspaceEnvironment }) {
  if (environment.kind === "live") {
    return (
      <Form method="post" action="/logout">
        <button className="orbit-button workspace-signout" data-variant="quiet" type="submit">
          <Icon name="signout" />
          Sign out
        </button>
      </Form>
    );
  }

  return (
    <a className="orbit-button workspace-signout" data-variant="quiet" href="/login">
      <Icon name="signout" />
      Exit preview
    </a>
  );
}

function PreviewBanner({ environment }: { environment: WorkspaceEnvironment }) {
  const revalidator = useRevalidator();

  return (
    <div className="workspace-preview-banner" role="note">
      <strong>Developer preview</strong>
      <span>
        Contract fixtures with no authentication and no live data. Actions and audit events persist only in this browser tab.
      </span>
      {environment.reset ? (
        <button
          className="orbit-button"
          data-variant="quiet"
          type="button"
          onClick={() => {
            void environment.reset?.().then(() => revalidator.revalidate());
          }}
        >
          <Icon name="reset" />
          Reset preview data
        </button>
      ) : null}
    </div>
  );
}

export function WorkspaceLayout({ environment }: { environment: WorkspaceEnvironment }) {
  const data = useLoaderData<WorkspaceData>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const value = useMemo(
    () => ({
      ...data,
      environment: { kind: environment.kind, basePath: environment.basePath },
      assignments: assignmentMap(data.kpis.assignments),
      entityLabels: entityLabelMap(data.entities),
    }),
    [data, environment.kind, environment.basePath],
  );
  const roleConfig = roleViewConfigFor(data.membership.role);
  if (!roleConfig) {
    throw new RoleViewUnavailableError(data.membership.role);
  }

  useEffect(() => {
    if (environment.kind !== "live") return undefined;
    let unsubscribe: (() => void) | undefined;
    let active = true;

    // Clear protected state when the session ends in another tab (PRD FR-01).
    void onSessionEnded(() => {
      void navigate("/login", { replace: true });
    })
      .then((cleanup) => {
        if (active) unsubscribe = cleanup;
        else cleanup();
      })
      .catch(() => undefined);

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [environment.kind, navigate]);

  // Names from GET /api/entities; the id only when the directory has no name for it.
  const scopes = data.membership.scopes.map(
    (scope) => `${humanize(scope.grain)} · ${value.entityLabels.get(entityKey(scope)) ?? scope.entityId}`,
  );

  return (
    <WorkspaceContext.Provider value={value}>
      <div className="workspace-shell">
        <a className="workspace-skip" href="#workspace-content">
          Skip to content
        </a>
        <aside className="workspace-sidebar">
          <OrbitBrand compact tagline="Healthcare performance platform" />
          <Navigation environment={environment} role={data.membership.role} compact={false} />
          <div className="workspace-sidebar__scope">
            <span className="orbit-meta">Verified membership</span>
            <strong>{roleConfig.title}</strong>
            {scopes.map((scope) => (
              <span key={scope} className="workspace-reference">
                {scope}
              </span>
            ))}
            <ExitControl environment={environment} />
          </div>
        </aside>

        <div className="workspace-frame">
          <header className="workspace-mobile-header">
            <OrbitBrand compact />
            <div className="workspace-mobile-header__scope">
              <strong>{roleConfig.title}</strong>
              <span className="workspace-reference">{scopes.join(", ")}</span>
            </div>
            <ExitControl environment={environment} />
          </header>
          <div className="workspace-mobile-nav">
            <Navigation environment={environment} role={data.membership.role} compact />
          </div>
          <div className="workspace-progress" data-active={navigation.state !== "idle"} aria-hidden="true" />
          <p className="orbit-visually-hidden" aria-live="polite">
            {navigation.state !== "idle" ? "Loading workspace surface." : ""}
          </p>
          {import.meta.env.DEV && environment.kind === "preview" ? <PreviewBanner environment={environment} /> : null}
          <main id="workspace-content" tabIndex={-1} className="workspace-content" aria-busy={navigation.state !== "idle"}>
            <Outlet />
          </main>
          <footer className="workspace-footer">
            <span>Framework {data.kpis.frameworkVersion}</span>
            <span>Role and scope are derived from the verified membership boundary; filters only narrow what you are authorized to see.</span>
          </footer>
        </div>
        <AskChat />
        <ChatbotPanel />
      </div>
    </WorkspaceContext.Provider>
  );
}

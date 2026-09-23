import { useEffect, useMemo } from "react";
import {
  Form,
  NavLink,
  Outlet,
  useLoaderData,
  useNavigate,
  useNavigation,
  useRevalidator,
  type LoaderFunctionArgs,
} from "react-router";
import { OrbitBrand } from "@orbit/ui-kit";
import { onSessionEnded } from "../../lib/auth";
import { assignmentMap, humanize } from "../../lib/format";
import { regionalCooViewConfig } from "../../roles/regional-coo/config";
import { Icon, type IconName } from "./components";
import {
  WorkspaceContext,
  withClient,
  workspacePath,
  type WorkspaceData,
  type WorkspaceEnvironment,
} from "./environment";
import { RoleViewUnavailableError } from "./states";
import "./workspace.css";

const SURFACES: readonly { path: string; label: string; short: string; icon: IconName }[] = [
  { path: "/", label: "Morning brief", short: "Brief", icon: "brief" },
  { path: "/inbox", label: "Priority inbox", short: "Inbox", icon: "inbox" },
  { path: "/explorer", label: "KPI explorer", short: "Explorer", icon: "explorer" },
  { path: "/ask", label: "Guided Ask", short: "Ask", icon: "ask" },
  { path: "/actions", label: "Actions", short: "Actions", icon: "actions" },
  { path: "/audit", label: "Audit", short: "Audit", icon: "audit" },
];

export function workspaceLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<WorkspaceData> =>
    withClient(environment, request, async (client) => {
      const membership = await client.me();

      // Role selects the view configuration, never the data scope (ARCH §5).
      if (membership.role !== regionalCooViewConfig.roleId) {
        throw new RoleViewUnavailableError(membership.role);
      }

      return { membership, kpis: await client.kpiList() };
    });
}

function Navigation({ environment, compact }: { environment: WorkspaceEnvironment; compact: boolean }) {
  return (
    <nav className="workspace-nav" aria-label={compact ? "Orbit workspace, compact" : "Orbit workspace"}>
      {SURFACES.map((surface) => (
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
    }),
    [data, environment.kind, environment.basePath],
  );

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

  const scopes = data.membership.scopes.map((scope) => `${humanize(scope.grain)} · ${scope.entityId}`);

  return (
    <WorkspaceContext.Provider value={value}>
      <div className="workspace-shell">
        <a className="workspace-skip" href="#workspace-content">
          Skip to content
        </a>
        <aside className="workspace-sidebar">
          <OrbitBrand compact tagline="Healthcare performance platform" />
          <Navigation environment={environment} compact={false} />
          <div className="workspace-sidebar__scope">
            <span className="orbit-meta">Verified membership</span>
            <strong>{regionalCooViewConfig.title}</strong>
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
              <strong>{regionalCooViewConfig.title}</strong>
              <span className="workspace-reference">{scopes.join(", ")}</span>
            </div>
            <ExitControl environment={environment} />
          </header>
          <div className="workspace-mobile-nav">
            <Navigation environment={environment} compact />
          </div>
          <div className="workspace-progress" data-active={navigation.state !== "idle"} aria-hidden="true" />
          {import.meta.env.DEV && environment.kind === "preview" ? <PreviewBanner environment={environment} /> : null}
          <main id="workspace-content" tabIndex={-1} className="workspace-content">
            <Outlet />
          </main>
          <footer className="workspace-footer">
            <span>Framework {data.kpis.frameworkVersion}</span>
            <span>Role and scope are derived from the verified membership boundary; filters only narrow what you are authorized to see.</span>
          </footer>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}

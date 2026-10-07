import type { RouteObject } from "react-router";
import { OrbitBrand } from "@orbit/ui-kit";
import { ActionDetailRoute, actionDetailLoader, actionTransitionAction } from "../actions/detail-route";
import { ActionsRoute, actionsLoader } from "../actions/list-route";
import { NewActionRoute, newActionAction, newActionLoader } from "../actions/new-route";
import { AskRoute, askAction, askLoader } from "../ask/route";
import { AuditRoute, auditLoader } from "../audit/route";
import { BriefRoute, briefLoader } from "../brief/route";
import { chatbotAction } from "../chatbot/action";
import { ExplorerDetailRoute, explorerDetailLoader } from "../explorer/detail-route";
import { ExplorerIndexRoute } from "../explorer/index-route";
import { InboxRoute, inboxLoader } from "../inbox/route";
import { OperationsRoute, operationsLoader } from "../operations/route";
import { RevenueRoute, revenueLoader } from "../revenue/route";
import { SurveillanceRoute, surveillanceLoader } from "../surveillance/route";
import { SurfaceState } from "./components";
import type { WorkspaceEnvironment } from "./environment";
import { WorkspaceLayout, workspaceLoader } from "./layout";
import { SurfaceErrorBoundary, WorkspaceErrorBoundary } from "./states";

export function LoadingShell() {
  return (
    <main className="orbit-page workspace-failure" aria-busy="true">
      <OrbitBrand compact tagline="Healthcare performance platform" />
      <output className="orbit-text-muted">Verifying your membership and loading your workspace…</output>
    </main>
  );
}

function UnknownSurface() {
  return (
    <SurfaceState kind="not_found" title="This page does not exist." message="Use the workspace navigation to choose a surface." />
  );
}

/** The four surfaces plus actions and audit, bound to one data environment (ARCH §5). */
export function workspaceRoutes(environment: WorkspaceEnvironment): RouteObject {
  const surface = { ErrorBoundary: SurfaceErrorBoundary };

  function Layout() {
    return <WorkspaceLayout environment={environment} />;
  }

  return {
    id: environment.routeId,
    path: environment.basePath || "/",
    loader: workspaceLoader(environment),
    Component: Layout,
    ErrorBoundary: WorkspaceErrorBoundary,
    HydrateFallback: LoadingShell,
    children: [
      { index: true, loader: briefLoader(environment), Component: BriefRoute, ...surface },
      { path: "inbox", loader: inboxLoader(environment), Component: InboxRoute, ...surface },
      { path: "explorer", Component: ExplorerIndexRoute, ...surface },
      { path: "explorer/:assignmentId", loader: explorerDetailLoader(environment), Component: ExplorerDetailRoute, ...surface },
      { path: "operations", loader: operationsLoader(environment), Component: OperationsRoute, ...surface },
      { path: "revenue", loader: revenueLoader(environment), Component: RevenueRoute, ...surface },
      { path: "outbreak-watch", loader: surveillanceLoader(environment), Component: SurveillanceRoute, ...surface },
      { path: "ask", loader: askLoader(environment), action: askAction(environment), Component: AskRoute, ...surface },
      { path: "chatbot", action: chatbotAction(environment) },
      { path: "actions", loader: actionsLoader(environment), Component: ActionsRoute, ...surface },
      { path: "actions/new", loader: newActionLoader(environment), action: newActionAction(environment), Component: NewActionRoute, ...surface },
      {
        path: "actions/:actionId",
        loader: actionDetailLoader(environment),
        action: actionTransitionAction(environment),
        Component: ActionDetailRoute,
        ...surface,
      },
      { path: "audit", loader: auditLoader(environment), Component: AuditRoute, ...surface },
      { path: "*", Component: UnknownSurface },
    ],
  };
}

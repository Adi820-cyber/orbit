import { createBrowserRouter, redirect, type RouteObject } from "react-router";
import { LoginRoute, loginAction, loginLoader } from "./features/auth/login-route";
import { liveEnvironment } from "./features/workspace/environment";
import { LoadingShell, workspaceRoutes } from "./features/workspace/routes";
import { AuthConfigurationError, signOut } from "./lib/auth";

async function logoutAction() {
  try {
    await signOut();
  } catch (error: unknown) {
    if (!(error instanceof AuthConfigurationError)) throw error;
  }
  return redirect("/login");
}

const routes: RouteObject[] = [
  {
    path: "/login",
    loader: loginLoader,
    action: loginAction,
    Component: LoginRoute,
    HydrateFallback: LoadingShell,
  },
  {
    path: "/logout",
    loader: () => redirect("/"),
    action: logoutAction,
  },
  workspaceRoutes(liveEnvironment),
];

if (import.meta.env.DEV) {
  // Removed from production builds: the whole block, and the preview chunk it imports.
  const loadPreview = () => import("./preview/environment");
  routes.push(
    workspaceRoutes({
      kind: "preview",
      basePath: "/preview/chairman",
      routeId: "preview-chairman-workspace",
      client: async () => (await loadPreview()).previewClient("chairman"),
      reset: async () => (await loadPreview()).resetPreview("chairman"),
    }),
    workspaceRoutes({
      kind: "preview",
      basePath: "/preview/clinical-director",
      routeId: "preview-clinical-director-workspace",
      client: async () => (await loadPreview()).previewClient("clinical-director"),
      reset: async () => (await loadPreview()).resetPreview("clinical-director"),
    }),
    workspaceRoutes({
      kind: "preview",
      basePath: "/preview/hospital-dho",
      routeId: "preview-hospital-dho-workspace",
      client: async () => (await loadPreview()).previewClient("hospital-dho"),
      reset: async () => (await loadPreview()).resetPreview("hospital-dho"),
    }),
    workspaceRoutes({
      kind: "preview",
      basePath: "/preview/people-executive",
      routeId: "preview-people-executive-workspace",
      client: async () => (await loadPreview()).previewClient("people-executive"),
      reset: async () => (await loadPreview()).resetPreview("people-executive"),
    }),
    workspaceRoutes({
      kind: "preview",
      basePath: "/preview/bd-lead",
      routeId: "preview-bd-lead-workspace",
      client: async () => (await loadPreview()).previewClient("bd-lead"),
      reset: async () => (await loadPreview()).resetPreview("bd-lead"),
    }),
    workspaceRoutes({
      kind: "preview",
      basePath: "/preview/billing-lead",
      routeId: "preview-billing-lead-workspace",
      client: async () => (await loadPreview()).previewClient("billing-lead"),
      reset: async () => (await loadPreview()).resetPreview("billing-lead"),
    }),
    workspaceRoutes({
      kind: "preview",
      basePath: "/preview/coe-lead",
      routeId: "preview-coe-lead-workspace",
      client: async () => (await loadPreview()).previewClient("coe-lead"),
      reset: async () => (await loadPreview()).resetPreview("coe-lead"),
    }),
    workspaceRoutes({
      kind: "preview",
      basePath: "/preview/corporate-revenue-lead",
      routeId: "preview-corporate-revenue-lead-workspace",
      client: async () => (await loadPreview()).previewClient("corporate-revenue-lead"),
      reset: async () => (await loadPreview()).resetPreview("corporate-revenue-lead"),
    }),
    workspaceRoutes({
      kind: "preview",
      basePath: "/preview/group-cfo",
      routeId: "preview-group-cfo-workspace",
      client: async () => (await loadPreview()).previewClient("group-cfo"),
      reset: async () => (await loadPreview()).resetPreview("group-cfo"),
    }),
    workspaceRoutes({
      kind: "preview",
      basePath: "/preview/procurement-head",
      routeId: "preview-procurement-head-workspace",
      client: async () => (await loadPreview()).previewClient("procurement-head"),
      reset: async () => (await loadPreview()).resetPreview("procurement-head"),
    }),
    workspaceRoutes({
      kind: "preview",
      basePath: "/preview/hr-head",
      routeId: "preview-hr-head-workspace",
      client: async () => (await loadPreview()).previewClient("hr-head"),
      reset: async () => (await loadPreview()).resetPreview("hr-head"),
    }),
    workspaceRoutes({
      kind: "preview",
      basePath: "/preview/legal-head",
      routeId: "preview-legal-head-workspace",
      client: async () => (await loadPreview()).previewClient("legal-head"),
      reset: async () => (await loadPreview()).resetPreview("legal-head"),
    }),
    workspaceRoutes({
      kind: "preview",
      basePath: "/preview/analytics-head",
      routeId: "preview-analytics-head-workspace",
      client: async () => (await loadPreview()).previewClient("analytics-head"),
      reset: async () => (await loadPreview()).resetPreview("analytics-head"),
    }),
    workspaceRoutes({
      kind: "preview",
      basePath: "/preview/regional-coo",
      routeId: "preview-workspace",
      client: async () => (await loadPreview()).previewClient(),
      reset: async () => (await loadPreview()).resetPreview(),
    }),
  );
}

export const router = createBrowserRouter(routes);

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
      basePath: "/preview/regional-coo",
      routeId: "preview-workspace",
      client: async () => (await loadPreview()).previewClient(),
      reset: async () => (await loadPreview()).resetPreview(),
    }),
  );
}

export const router = createBrowserRouter(routes);

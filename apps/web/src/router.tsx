import { createBrowserRouter, type RouteObject } from "react-router";
import {
  LoginRoute,
  loginAction,
  loginLoader,
} from "./features/auth/login-route";
import { BriefRoute, briefLoader } from "./features/brief/route";

const routes: RouteObject[] = [
  {
    path: "/login",
    loader: loginLoader,
    action: loginAction,
    Component: LoginRoute,
  },
  {
    path: "/",
    loader: briefLoader,
    Component: BriefRoute,
  },
];

if (import.meta.env.DEV) {
  routes.push({
    path: "/preview/regional-coo",
    lazy: async () => {
      const { RegionalCooBriefPreviewRoute } = await import(
        "./features/brief/preview-route"
      );
      return { Component: RegionalCooBriefPreviewRoute };
    },
  });
}

export const router = createBrowserRouter(routes);

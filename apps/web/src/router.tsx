import { createBrowserRouter, redirect, type LoaderFunctionArgs } from "react-router";
import { BriefPlaceholder } from "./features/brief/route";
import {
  LoginRoute,
  loginAction,
  loginLoader,
} from "./features/auth/login-route";
import { AuthConfigurationError, getCurrentSession } from "./lib/auth";

async function requireSession({ request }: LoaderFunctionArgs) {
  try {
    const session = await getCurrentSession();

    if (session) {
      return null;
    }
  } catch (error: unknown) {
    if (!(error instanceof AuthConfigurationError)) {
      throw error;
    }
  }

  const requestUrl = new URL(request.url);
  const returnTo = `${requestUrl.pathname}${requestUrl.search}`;
  return redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export const router = createBrowserRouter([
  {
    path: "/login",
    loader: loginLoader,
    action: loginAction,
    Component: LoginRoute,
  },
  {
    path: "/",
    loader: requireSession,
    Component: BriefPlaceholder,
  },
]);

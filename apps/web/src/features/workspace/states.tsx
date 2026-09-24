import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { OrbitBrand } from "@orbit/ui-kit";
import { ApiConfigurationError, ApiRequestError } from "../../lib/api";
import { roleLabel } from "../../lib/format";
import { SurfaceState, type SurfaceStateKind } from "./components";
import { useWorkspacePath } from "./environment";

export class RoleViewUnavailableError extends Error {
  readonly role: string;

  constructor(role: string) {
    super(`No workspace view exists for the ${role} role yet.`);
    this.name = "RoleViewUnavailableError";
    this.role = role;
  }
}

interface DescribedError {
  kind: SurfaceStateKind;
  title: string;
  message: string;
}

export function describeError(error: unknown): DescribedError {
  if (error instanceof RoleViewUnavailableError) {
    return {
      kind: "unavailable",
      title: "Your role's workspace is not available yet.",
      message: `Orbit verified a ${roleLabel(error.role)} membership, but that role's view has not been built yet. No data was loaded for another role's view.`,
    };
  }

  if (error instanceof ApiConfigurationError) {
    return {
      kind: "unavailable",
      title: "The decision service is not configured here.",
      message: "Orbit's API connection has not been configured for this environment, so no data was loaded.",
    };
  }

  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case "out_of_scope":
        return {
          kind: "out_of_scope",
          title: "This request is outside your authorized scope.",
          message: `${error.message} Nothing was narrowed or partially shown.`,
        };
      case "forbidden":
        return {
          kind: "forbidden",
          title: "Your membership does not permit this.",
          message: error.message,
        };
      case "not_found":
        return { kind: "not_found", title: "This record does not exist or is not visible to you.", message: error.message };
      case "invalid_request":
        return { kind: "invalid_request", title: "This request was incomplete.", message: error.message };
      case "invalid_response":
        return {
          kind: "unavailable",
          title: "Orbit received data it could not trust.",
          message: `${error.message} Nothing was displayed in its place.`,
        };
      default:
        return {
          kind: "unavailable",
          title: "This surface is temporarily unavailable.",
          message: error.message,
        };
    }
  }

  if (isRouteErrorResponse(error) && error.status === 404) {
    return { kind: "not_found", title: "This page does not exist.", message: "Check the address or return to your brief." };
  }

  return {
    kind: "unavailable",
    title: "This surface is temporarily unavailable.",
    message: "Orbit could not prepare this view. No fallback data was shown.",
  };
}

/** Renders inside the workspace shell, so navigation stays available after a refusal. */
export function SurfaceErrorBoundary() {
  const error = useRouteError();
  const described = describeError(error);
  const path = useWorkspacePath();

  return (
    <>
      <title>Unavailable | Orbit</title>
      <SurfaceState kind={described.kind} title={described.title} message={described.message}>
        <Link className="orbit-button" data-variant="secondary" to={path("/")}>
          Back to morning brief
        </Link>
      </SurfaceState>
    </>
  );
}

/** Full-page failure for when the workspace itself (membership, role view) cannot load. */
export function WorkspaceErrorBoundary() {
  const error = useRouteError();
  const described = describeError(error);

  return (
    <main className="orbit-page workspace-failure">
      <title>Unavailable | Orbit</title>
      <OrbitBrand compact tagline="Healthcare performance platform" />
      <SurfaceState kind={described.kind} title={described.title} message={described.message}>
        <a className="orbit-button" data-variant="secondary" href="/login">
          Return to sign-in
        </a>
      </SurfaceState>
    </main>
  );
}

import { useEffect } from "react";
import {
  Form,
  NavLink,
  Outlet,
  redirect,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  type LoaderFunctionArgs,
} from "react-router";
import { OrbitBrand } from "@orbit/ui-kit";
import { ApiRequestError } from "../../lib/api";
import { onSessionEnded } from "../../lib/auth";
import { APP_SURFACE, servesLeaders } from "../../lib/surface";
import { Icon } from "../workspace/components";
import { withClient, type WorkspaceEnvironment } from "../workspace/environment";
import "../workspace/workspace.css";
import { ErpContext, useErpHref, type ErpData } from "./shared";
import "./erp.css";

const SECTIONS: readonly { path: string; label: string; adminOnly?: boolean }[] = [
  { path: "/", label: "Today" },
  { path: "/attendance", label: "Attendance" },
  { path: "/rosters", label: "Rosters" },
  { path: "/corrections", label: "Corrections" },
  { path: "/staff", label: "Staff" },
  { path: "/doctors", label: "Doctors" },
  { path: "/patients", label: "Patients" },
  { path: "/visits", label: "Visits" },
  { path: "/services", label: "Services" },
  { path: "/billing", label: "Billing" },
  { path: "/revenue", label: "Revenue" },
  { path: "/audit", label: "Audit trail", adminOnly: true },
];

/**
 * Loads the verified operator and the form options. A leader account is sent
 * to the leader workspace; an admin without a chosen facility gets the first one.
 */
export function erpLayoutLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<ErpData> =>
    withClient(environment, request, async (client) => {
      const identity = await client.identity();
      if (!("operatorRole" in identity)) {
        // In the hospital-operations build "/" leads back here, so redirecting would loop.
        if (!servesLeaders(APP_SURFACE)) {
          throw new ApiRequestError("forbidden", "This portal is for hospital operations accounts.", 403);
        }
        throw redirect("/");
      }
      const reference = await client.erp.reference();
      const url = new URL(request.url);

      if (identity.operatorRole === "hospital") {
        const own = identity.scopes.find((scope) => scope.grain === "facility")?.entityId;
        if (!own) throw new ApiRequestError("forbidden", "This hospital account has no facility.", 403);
        return { identity, reference, facilityId: own };
      }

      const requested = url.searchParams.get("facility");
      if (requested && reference.facilities.some((facility) => facility.facilityId === requested)) {
        return { identity, reference, facilityId: requested };
      }
      const first = reference.facilities[0]?.facilityId;
      if (!first) throw new ApiRequestError("not_found", "No facilities are visible to this account.", 404);
      url.searchParams.set("facility", first);
      throw redirect(`${url.pathname}?${url.searchParams.toString()}`);
    });
}

function Navigation({ admin, compact }: { admin: boolean; compact: boolean }) {
  const href = useErpHref();
  return (
    <nav className="workspace-nav" aria-label={compact ? "Hospital operations, compact" : "Hospital operations"}>
      {SECTIONS.filter((section) => admin || !section.adminOnly).map((section) => (
        <NavLink key={section.path} end={section.path === "/"} to={href(section.path)}>
          <span>{section.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Admins choose the facility they are working on; hospital accounts have exactly one. */
function FacilityPicker({ data }: { data: ErpData }) {
  const { pathname } = useLocation();
  if (data.identity.operatorRole !== "admin") return null;
  return (
    <Form method="get" action={pathname} className="erp-facility-picker">
      <label className="orbit-field">
        <span className="orbit-field-label">Facility</span>
        <select className="orbit-select" name="facility" defaultValue={data.facilityId} key={data.facilityId}>
          {data.reference.facilities.map((facility) => (
            <option key={facility.facilityId} value={facility.facilityId}>
              {facility.name}
            </option>
          ))}
        </select>
      </label>
      <button className="orbit-button" data-variant="secondary" type="submit">
        Switch
      </button>
    </Form>
  );
}

function SignOut() {
  return (
    <Form method="post" action="/logout">
      <button className="orbit-button workspace-signout" data-variant="quiet" type="submit">
        <Icon name="signout" />
        Sign out
      </button>
    </Form>
  );
}

export function ErpLayout() {
  const data = useLoaderData<ErpData>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const admin = data.identity.operatorRole === "admin";
  const facilityName = data.reference.facilities.find((facility) => facility.facilityId === data.facilityId)?.name ?? "Facility";
  const roleTitle = admin ? "Hospital operations admin" : "Hospital operations desk";

  useEffect(() => {
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
  }, [navigate]);

  return (
    <ErpContext.Provider value={data}>
      <div className="workspace-shell erp-shell">
        <a className="workspace-skip" href="#erp-content">
          Skip to content
        </a>
        <aside className="workspace-sidebar">
          <OrbitBrand compact tagline="Hospital operations" />
          <Navigation admin={admin} compact={false} />
          <div className="workspace-sidebar__scope">
            <span className="orbit-meta">Verified membership</span>
            <strong>{roleTitle}</strong>
            <span className="workspace-reference">{admin ? "Whole group" : facilityName}</span>
            <FacilityPicker data={data} />
            <SignOut />
          </div>
        </aside>

        <div className="workspace-frame">
          <header className="workspace-mobile-header">
            <OrbitBrand compact />
            <div className="workspace-mobile-header__scope">
              <strong>{roleTitle}</strong>
              <span className="workspace-reference">{facilityName}</span>
            </div>
            <SignOut />
          </header>
          <div className="workspace-mobile-nav">
            <Navigation admin={admin} compact />
            <FacilityPicker data={data} />
          </div>
          <div className="workspace-progress" data-active={navigation.state !== "idle"} aria-hidden="true" />
          <p className="orbit-visually-hidden" aria-live="polite">
            {navigation.state !== "idle" ? "Loading." : ""}
          </p>
          <main id="erp-content" tabIndex={-1} className="workspace-content" aria-busy={navigation.state !== "idle"}>
            <Outlet />
          </main>
          <footer className="workspace-footer">
            <span>Working on: {facilityName}</span>
            <span>
              Role and facility come from your verified account; the server checks them on every request. Fictional records only.
            </span>
          </footer>
        </div>
      </div>
    </ErpContext.Provider>
  );
}

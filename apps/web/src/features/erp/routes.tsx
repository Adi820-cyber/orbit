import type { RouteObject } from "react-router";
import { SurfaceState } from "../workspace/components";
import type { WorkspaceEnvironment } from "../workspace/environment";
import { LoadingShell } from "../workspace/routes";
import { WorkspaceErrorBoundary } from "../workspace/states";
import { ErpLayout, erpLayoutLoader } from "./layout";
import { ErpErrorBoundary } from "./shared";

const attendance = () => import("./attendance");
const people = () => import("./people");
const care = () => import("./care");

function UnknownErpPage() {
  return <SurfaceState kind="not_found" title="This page does not exist." message="Use the hospital operations navigation." />;
}

/**
 * Hospital operations (ADR 0016) at `/erp`, for ERP operator accounts only.
 * The live environment only: there is no unauthenticated preview of patient
 * or staff records. Pages load lazily, so leader accounts never download them.
 */
export function erpRoutes(environment: WorkspaceEnvironment): RouteObject {
  const page = { ErrorBoundary: ErpErrorBoundary };
  return {
    id: "erp",
    path: "/erp",
    loader: erpLayoutLoader(environment),
    Component: ErpLayout,
    ErrorBoundary: WorkspaceErrorBoundary,
    HydrateFallback: LoadingShell,
    children: [
      {
        index: true,
        ...page,
        lazy: async () => {
          const m = await import("./home");
          return { loader: m.erpHomeLoader(environment), Component: m.ErpHomeRoute };
        },
      },
      {
        path: "attendance",
        ...page,
        lazy: async () => {
          const m = await attendance();
          return { loader: m.attendanceLoader(environment), action: m.attendanceAction(environment), Component: m.AttendanceRoute };
        },
      },
      {
        path: "corrections",
        ...page,
        lazy: async () => {
          const m = await attendance();
          return { loader: m.correctionsLoader(environment), action: m.correctionsAction(environment), Component: m.CorrectionsRoute };
        },
      },
      {
        path: "rosters",
        ...page,
        lazy: async () => {
          const m = await attendance();
          return { loader: m.rostersLoader(environment), action: m.rostersAction(environment), Component: m.RostersRoute };
        },
      },
      {
        path: "staff",
        ...page,
        lazy: async () => {
          const m = await people();
          return { loader: m.staffListLoader(environment), action: m.staffListAction(environment), Component: m.StaffListRoute };
        },
      },
      {
        path: "staff/:staffId",
        ...page,
        lazy: async () => {
          const m = await people();
          return { loader: m.staffDetailLoader(environment), action: m.staffDetailAction(environment), Component: m.StaffDetailRoute };
        },
      },
      {
        path: "doctors",
        ...page,
        lazy: async () => {
          const m = await people();
          return { loader: m.doctorsLoader(environment), action: m.staffListAction(environment), Component: m.DoctorsRoute };
        },
      },
      {
        path: "doctors/:staffId",
        ...page,
        lazy: async () => {
          const m = await people();
          return { loader: m.doctorDetailLoader(environment), action: m.doctorDetailAction(environment), Component: m.DoctorDetailRoute };
        },
      },
      {
        path: "patients",
        ...page,
        lazy: async () => {
          const m = await care();
          return { loader: m.patientsLoader(environment), action: m.patientsAction(environment), Component: m.PatientsRoute };
        },
      },
      {
        path: "patients/:patientId",
        ...page,
        lazy: async () => {
          const m = await care();
          return { loader: m.patientDetailLoader(environment), action: m.patientDetailAction(environment), Component: m.PatientDetailRoute };
        },
      },
      {
        path: "visits",
        ...page,
        lazy: async () => {
          const m = await care();
          return { loader: m.visitsLoader(environment), Component: m.VisitsRoute };
        },
      },
      {
        path: "visits/:encounterId",
        ...page,
        lazy: async () => {
          const m = await care();
          return { loader: m.visitDetailLoader(environment), action: m.visitDetailAction(environment), Component: m.VisitDetailRoute };
        },
      },
      {
        path: "services",
        ...page,
        lazy: async () => {
          const m = await care();
          return { loader: m.servicesLoader(environment), action: m.servicesAction(environment), Component: m.ServicesRoute };
        },
      },
      {
        path: "audit",
        ...page,
        lazy: async () => {
          const m = await care();
          return { loader: m.erpAuditLoader(environment), Component: m.ErpAuditRoute };
        },
      },
      { path: "*", Component: UnknownErpPage },
    ],
  };
}

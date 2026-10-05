/**
 * Which half of Orbit this web deployment is (ADR 0016 §9), fixed at build time
 * by `VITE_APP_SURFACE`:
 *
 * - `all`:    leadership workspace and hospital operations in one app (default).
 * - `leader`: the leadership workspace only. There is no `/erp`.
 * - `erp`:    hospital operations only. `/` goes to `/erp`; there is no
 *             leadership workspace.
 *
 * This chooses what the app shows. It is not an access control: the API
 * decides what each account may read, and a matching `ORBIT_SURFACE` there
 * refuses the other kind of account.
 */
export type AppSurface = "all" | "leader" | "erp";

export function parseSurface(value: string | undefined): AppSurface {
  return value === "leader" || value === "erp" ? value : "all";
}

export const APP_SURFACE: AppSurface = parseSurface(import.meta.env.VITE_APP_SURFACE);

export const servesLeaders = (surface: AppSurface) => surface !== "erp";
export const servesOperators = (surface: AppSurface) => surface !== "leader";

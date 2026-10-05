import { describe, expect, it } from "vitest";
import { appRoutes } from "./app-routes";

const paths = (surface: Parameters<typeof appRoutes>[0]) => appRoutes(surface).map((route) => route.path);

describe("appRoutes", () => {
  it("serves both halves by default", () => {
    expect(paths("all")).toEqual(expect.arrayContaining(["/login", "/logout", "/erp", "/"]));
  });

  it("the leadership build has no hospital operations area", () => {
    const leader = paths("leader");
    expect(leader).toContain("/");
    expect(leader).not.toContain("/erp");
  });

  it("the hospital operations build has no leadership workspace and sends everything else to /erp", () => {
    const erp = appRoutes("erp");
    expect(erp.map((route) => route.path)).toEqual(["/login", "/logout", "/erp", "*"]);
    expect(erp.find((route) => route.id === "workspace")).toBeUndefined();
  });
});

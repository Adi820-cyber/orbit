import { describe, expect, it } from "vitest";
import { parseSurface, servesLeaders, servesOperators } from "./surface";

describe("parseSurface", () => {
  it("defaults to serving both halves, including for a misspelling", () => {
    expect(parseSurface(undefined)).toBe("all");
    expect(parseSurface("")).toBe("all");
    expect(parseSurface("everything")).toBe("all");
  });

  it("accepts the two single-purpose builds", () => {
    expect(parseSurface("leader")).toBe("leader");
    expect(parseSurface("erp")).toBe("erp");
  });

  it("maps each surface to the account kinds it shows", () => {
    expect([servesLeaders("all"), servesOperators("all")]).toEqual([true, true]);
    expect([servesLeaders("leader"), servesOperators("leader")]).toEqual([true, false]);
    expect([servesLeaders("erp"), servesOperators("erp")]).toEqual([false, true]);
  });
});

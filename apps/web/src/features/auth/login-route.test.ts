import { describe, expect, it } from "vitest";
import { getSafeReturnPath, validateLoginInput } from "./login-route";

describe("getSafeReturnPath", () => {
  it("keeps a local Orbit path", () => {
    expect(getSafeReturnPath("/inbox?period=2026-09")).toBe("/inbox?period=2026-09");
  });

  it.each([
    [null],
    ["https://attacker.example"],
    ["//attacker.example"],
    ["/\\attacker.example"],
    ["/login"],
  ])("falls back to the brief for an unsafe return path", (value) => {
    expect(getSafeReturnPath(value)).toBe("/");
  });
});

describe("validateLoginInput", () => {
  it("accepts a work email and password", () => {
    const formData = new FormData();
    formData.set("email", " leader@organization.org ");
    formData.set("password", "not-returned-to-the-ui");

    expect(validateLoginInput(formData)).toEqual({
      input: {
        email: "leader@organization.org",
        password: "not-returned-to-the-ui",
      },
    });
  });

  it("reports empty fields without retaining the password", () => {
    const formData = new FormData();
    const result = validateLoginInput(formData);

    expect(result).toEqual({
      email: "",
      errors: {
        email: "Enter your work email.",
        password: "Enter your password.",
      },
    });
  });

  it("rejects an invalid email shape", () => {
    const formData = new FormData();
    formData.set("email", "not-an-email");
    formData.set("password", "provided");

    expect(validateLoginInput(formData)).toEqual({
      email: "not-an-email",
      errors: { email: "Enter a valid work email." },
    });
  });
});

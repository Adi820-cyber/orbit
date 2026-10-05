import { describe, expect, it } from "vitest";
import { DEMO_SIGN_IN_DOMAIN, getSafeReturnPath, signInEmail, validateLoginInput } from "./login-route";

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
        email: "Enter your work email or sign-in ID.",
        password: "Enter your password.",
      },
    });
  });

  it.each(["name@nowhere", "two words", "x", "9starts-with-digit"])("rejects %j as neither an email nor a sign-in ID", (value) => {
    const formData = new FormData();
    formData.set("email", value);
    formData.set("password", "provided");

    expect(validateLoginInput(formData)).toEqual({
      email: value,
      errors: { email: "Enter a valid work email or sign-in ID." },
    });
  });

  it("completes a short sign-in ID with the demo domain, and leaves emails alone", () => {
    const formData = new FormData();
    formData.set("email", " Hospital ");
    formData.set("password", "checked-by-supabase-not-here");

    expect(validateLoginInput(formData)).toEqual({
      input: { email: `hospital@${DEMO_SIGN_IN_DOMAIN}`, password: "checked-by-supabase-not-here" },
    });
    expect(signInEmail("admin")).toBe("admin@kestrion.demo");
    expect(signInEmail("leader@organization.org")).toBe("leader@organization.org");
  });
});

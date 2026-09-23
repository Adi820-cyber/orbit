import { afterEach, describe, expect, it, vi } from "vitest";
import { regionalCooBriefFixture } from "../features/brief/brief.fixture";
import { ApiRequestError, getBriefPagePayload } from "./api";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getBriefPagePayload", () => {
  it("parses all three API boundaries and sends only the bearer token", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.orbit.test");
    const responses = new Map<string, unknown>([
      ["/api/me", regionalCooBriefFixture.membership],
      ["/api/brief", regionalCooBriefFixture.brief],
      ["/api/kpi", regionalCooBriefFixture.kpis],
    ]);
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const authorization = new Headers(init?.headers).get("Authorization");
      expect(authorization).toBe("Bearer fixture-access-token");
      return Promise.resolve(
        new Response(JSON.stringify(responses.get(url.pathname)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBriefPagePayload("fixture-access-token")).resolves.toEqual(
      regionalCooBriefFixture,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects a successful response that breaks the shared contract", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.orbit.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ unexpected: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );

    await expect(getBriefPagePayload("fixture-access-token")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("preserves typed out-of-scope refusals", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.orbit.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "out_of_scope",
                message: "The requested scope is not available.",
                requestId: "fixture-request",
              },
            }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          ),
        ),
      ),
    );

    try {
      await getBriefPagePayload("fixture-access-token");
      throw new Error("Expected getBriefPagePayload to reject.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).toMatchObject({ code: "out_of_scope", status: 403 });
    }
  });
});

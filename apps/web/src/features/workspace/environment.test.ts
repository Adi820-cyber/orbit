import { describe, expect, it } from "vitest";
import { createApiClient, type ApiTransport } from "../../lib/api";
import { entityKey, entityLabelMap, loadEntities } from "./environment";

const replyWith =
  (status: number, body: unknown): ApiTransport =>
  async () => ({ status, body });
const error = (code: string) => ({ error: { code, message: "x", requestId: "r" } });

describe("loadEntities", () => {
  it("returns the directory when the API serves it", async () => {
    const entities = [{ grain: "region", entityId: "r1", label: "North", parent: null }];
    expect(await loadEntities(createApiClient(replyWith(200, { entities })))).toEqual(entities);
  });

  it.each([
    [503, "unavailable"],
    [404, "not_found"],
  ])("degrades to no names (ids shown) on %i %s", async (status, code) => {
    expect(await loadEntities(createApiClient(replyWith(status, error(code))))).toEqual([]);
  });

  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [500, "internal"],
  ])("still propagates %i %s, so an expired session goes back to sign-in", async (status, code) => {
    await expect(loadEntities(createApiClient(replyWith(status, error(code))))).rejects.toMatchObject({ code });
  });

  it("does not accept a response that breaks the contract", async () => {
    await expect(loadEntities(createApiClient(replyWith(200, { entities: [{ entityId: "r1" }] })))).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});

describe("entityLabelMap", () => {
  it("keys names by grain and id, so the same id at two grains cannot collide", () => {
    const labels = entityLabelMap([
      { grain: "region", entityId: "same", label: "A region", parent: null },
      { grain: "coe", entityId: "same", label: "A COE", parent: null },
    ]);
    expect(labels.get(entityKey({ grain: "region", entityId: "same" }))).toBe("A region");
    expect(labels.get(entityKey({ grain: "coe", entityId: "same" }))).toBe("A COE");
  });
});

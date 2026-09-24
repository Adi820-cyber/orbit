import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { AskResponse } from "@orbit/contracts";
import { WorkspaceContext, type WorkspaceContextValue } from "../workspace/environment";
import { EvidenceCard } from "./route";

const workspace: WorkspaceContextValue = {
  membership: {
    role: "regional-coo",
    organizationId: "30000000-0000-4000-8000-000000000001",
    scopes: [{ grain: "region", entityId: "fixture-region-a" }],
  },
  kpis: { frameworkVersion: "v1", assignments: [], disclosure: "Illustrative." },
  entities: [],
  environment: { kind: "preview", basePath: "/preview" },
  assignments: new Map(),
  entityLabels: new Map(),
};

function card(mode: "deterministic" | "assisted"): AskResponse {
  return {
    outcome: "answered",
    mode,
    card: {
      answer: "Capacity utilisation was 5 percent.",
      definitionBasis: [],
      reasoning: [],
      scope: { role: "regional-coo", entities: [{ grain: "region", entityId: "fixture-region-a" }] },
      period: null,
      limitations: [],
      relevantRecords: { observations: [], exceptions: [] },
      nextAction: null,
    },
    disclosure: "Illustrative.",
  };
}

function render(response: AskResponse) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <WorkspaceContext.Provider value={workspace}>
        <EvidenceCard response={response} />
      </WorkspaceContext.Provider>
    </MemoryRouter>,
  );
}

describe("EvidenceCard answer mode (ADR 0014 §5)", () => {
  it("says which words a model wrote when the answer is assisted", () => {
    const markup = render(card("assisted"));
    expect(markup).toContain("Assisted mode");
    expect(markup).toContain("wording was written by an AI model");
  });

  it("shows no model note on a deterministic answer", () => {
    const markup = render(card("deterministic"));
    expect(markup).toContain("Deterministic mode");
    expect(markup).not.toContain("AI model");
  });
});

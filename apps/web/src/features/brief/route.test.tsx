import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BriefPagePayload } from "../../lib/api";
import { regionalCooBriefFixture } from "./brief.fixture";
import { RegionalCooBriefPreviewRoute } from "./preview-route";
import { RegionalCooBriefPage } from "./route";

function render(payload: BriefPagePayload = regionalCooBriefFixture) {
  return renderToStaticMarkup(<RegionalCooBriefPage payload={payload} />);
}

describe("RegionalCooBriefPage", () => {
  it("renders the decision-first FR-02 sections in order", () => {
    const markup = render();
    const sectionPositions = [
      'id="act-now"',
      'id="monitor"',
      'id="on-track"',
      'id="limitations"',
    ].map((section) => markup.indexOf(section));

    expect(sectionPositions.every((position) => position >= 0)).toBe(true);
    expect(
      sectionPositions.every(
        (position, index) => index === 0 || position > sectionPositions[index - 1]!,
      ),
    ).toBe(true);
  });

  it("uses generated assignment labels and preserves illustrative disclosure", () => {
    const markup = render();
    const capacityAssignment = regionalCooBriefFixture.kpis.assignments[0];

    if (!capacityAssignment) {
      throw new Error("The Regional COO fixture has no assignments.");
    }

    expect(markup).toContain(capacityAssignment.kpi);
    expect(markup).toContain("Illustrative environment");
    expect(markup).toContain(regionalCooBriefFixture.brief.disclosure);
    expect(markup.match(/class="is-illustrative"/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("shows reconciliation, freshness, and the explicit source limitation", () => {
    const markup = render();

    expect(markup).toContain("Unreconciled");
    expect(markup).toContain("Late");
    expect(markup).toContain(
      "The illustrative financial source is late and has not been reconciled.",
    );
  });

  it("fails visibly when assignment metadata is absent instead of inventing a KPI name", () => {
    const payload: BriefPagePayload = {
      ...regionalCooBriefFixture,
      kpis: {
        ...regionalCooBriefFixture.kpis,
        assignments: [],
      },
    };

    expect(render(payload)).toContain("Assignment unavailable");
  });

  it("labels the unauthenticated development preview", () => {
    const markup = renderToStaticMarkup(<RegionalCooBriefPreviewRoute />);

    expect(markup).toContain("Developer preview");
    expect(markup).toContain("without authentication or live operational data");
  });
});

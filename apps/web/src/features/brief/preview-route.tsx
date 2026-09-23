import { regionalCooBriefFixture } from "./brief.fixture";
import { RegionalCooBriefPage } from "./route";

export function RegionalCooBriefPreviewRoute() {
  return (
    <div className="brief-preview-frame">
      <div className="brief-preview-banner" role="note">
        <strong>Developer preview</strong>
        <span>
          This route uses a validated contract fixture without authentication or
          live operational data.
        </span>
      </div>
      <RegionalCooBriefPage payload={regionalCooBriefFixture} />
    </div>
  );
}

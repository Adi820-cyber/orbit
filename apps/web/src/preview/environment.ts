import { createApiClient } from "../lib/api";
import { createFixtureApi, type StateStorage } from "./fixture-api";

/** Development builds only; `router.tsx` imports this lazily behind `import.meta.env.DEV`. */

function tabStorage(): StateStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const fixture = createFixtureApi({ storage: tabStorage() });

export function previewClient() {
  return createApiClient(fixture.transport);
}

export function resetPreview() {
  fixture.reset();
}

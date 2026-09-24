import { createApiClient } from "../lib/api";
import { createFixtureApi, type PreviewPersona, type StateStorage } from "./fixture-api";

/** Development builds only; `router.tsx` imports this lazily behind `import.meta.env.DEV`. */

function tabStorage(): StateStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const fixtures = new Map<PreviewPersona, ReturnType<typeof createFixtureApi>>();

function fixtureFor(persona: PreviewPersona = "north") {
  const existing = fixtures.get(persona);
  if (existing) return existing;
  const created = createFixtureApi({ persona, storage: tabStorage() });
  fixtures.set(persona, created);
  return created;
}

export function previewClient(persona: PreviewPersona = "north") {
  const fixture = fixtureFor(persona);
  return createApiClient(fixture.transport);
}

export function resetPreview(persona: PreviewPersona = "north") {
  fixtureFor(persona).reset();
}

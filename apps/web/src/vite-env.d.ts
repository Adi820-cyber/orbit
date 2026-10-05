/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_API_BASE_URL?: string;
  /** `all` (default), `leader` or `erp`: which half of Orbit this build is (src/lib/surface.ts). */
  readonly VITE_APP_SURFACE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

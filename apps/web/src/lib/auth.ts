import type { SupabaseClient } from "@supabase/supabase-js";

export type SignInFailure = "invalid_credentials" | "unavailable";

export type SignInResult =
  | { ok: true }
  | { ok: false; reason: SignInFailure };

export class AuthConfigurationError extends Error {
  constructor() {
    super("Orbit authentication is not configured.");
    this.name = "AuthConfigurationError";
  }
}

let authClientPromise: Promise<SupabaseClient> | undefined;

function readAuthConfiguration() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    throw new AuthConfigurationError();
  }

  return { publishableKey, url };
}

export async function getAuthClient() {
  if (authClientPromise) {
    return authClientPromise;
  }

  const { publishableKey, url } = readAuthConfiguration();
  authClientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    }),
  );

  return authClientPromise;
}

export async function getCurrentSession() {
  const client = await getAuthClient();
  const { data, error } = await client.auth.getSession();

  if (error) {
    return null;
  }

  return data.session;
}

export async function signOut() {
  const client = await getAuthClient();
  await client.auth.signOut();
}

/** Calls `onEnded` when the session is signed out elsewhere or can no longer be refreshed. */
export async function onSessionEnded(onEnded: () => void) {
  const client = await getAuthClient();
  const { data } = client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      onEnded();
    }
  });

  return () => data.subscription.unsubscribe();
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<SignInResult> {
  try {
    const client = await getAuthClient();
    const { error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (!error) {
      return { ok: true };
    }

    if (error.code === "invalid_credentials" || error.status === 400) {
      return { ok: false, reason: "invalid_credentials" };
    }

    return { ok: false, reason: "unavailable" };
  } catch (error: unknown) {
    if (error instanceof AuthConfigurationError) {
      throw error;
    }

    return { ok: false, reason: "unavailable" };
  }
}

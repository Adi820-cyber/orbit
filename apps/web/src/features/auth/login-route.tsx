import { useState } from "react";
import {
  data,
  Form,
  redirect,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { OrbitBrand } from "@orbit/ui-kit";
import {
  AuthConfigurationError,
  getCurrentSession,
  signInWithPassword,
} from "../../lib/auth";
import { createApiClient, httpTransport } from "../../lib/api";
import "./login.css";

interface LoginFieldErrors {
  email?: string;
  password?: string;
}

interface LoginActionData {
  email?: string;
  errors?: LoginFieldErrors;
  message?: string;
}

interface LoginInput {
  email: string;
  password: string;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The fictional demo organization's sign-in domain (DEMO_RUNBOOK.md). A short
 * sign-in ID such as `hospital` or `admin` is completed with it, so the demo
 * accounts can be typed quickly. This only builds the email address: Supabase
 * Auth still checks the password, and the API still derives role and scope from
 * the verified membership. Not a secret.
 */
export const DEMO_SIGN_IN_DOMAIN = "kestrion.demo";
const signInIdPattern = /^[a-z][a-z0-9._-]{1,39}$/i;

/** An email stays as typed; a short sign-in ID becomes an address on the demo domain. */
export function signInEmail(value: string) {
  return !value.includes("@") && signInIdPattern.test(value) ? `${value.toLowerCase()}@${DEMO_SIGN_IN_DOMAIN}` : value;
}

export function getSafeReturnPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }

  const parsed = new URL(value, "https://orbit.invalid");

  if (parsed.origin !== "https://orbit.invalid" || parsed.pathname === "/login") {
    return "/";
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function validateLoginInput(formData: FormData):
  | { input: LoginInput; errors?: never }
  | { input?: never; errors: LoginFieldErrors; email: string } {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");
  const typed = typeof emailValue === "string" ? emailValue.trim() : "";
  const email = signInEmail(typed);
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const errors: LoginFieldErrors = {};

  if (!typed) {
    errors.email = "Enter your work email or sign-in ID.";
  } else if (!emailPattern.test(email)) {
    errors.email = "Enter a valid work email or sign-in ID.";
  }

  if (!password) {
    errors.password = "Enter your password.";
  }

  if (Object.keys(errors).length > 0) {
    return { email: typed, errors };
  }

  return { input: { email, password } };
}

export async function loginLoader({ request }: LoaderFunctionArgs) {
  const returnTo = getSafeReturnPath(new URL(request.url).searchParams.get("returnTo"));

  try {
    const session = await getCurrentSession();

    if (session) {
      return redirect(returnTo);
    }
  } catch (error: unknown) {
    if (!(error instanceof AuthConfigurationError)) {
      throw error;
    }
  }

  return null;
}

export async function loginAction({ request }: ActionFunctionArgs) {
  const validation = validateLoginInput(await request.formData());

  if (validation.errors) {
    return data<LoginActionData>(
      { email: validation.email, errors: validation.errors },
      { status: 400 },
    );
  }

  try {
    const result = await signInWithPassword(
      validation.input.email,
      validation.input.password,
    );

    if (!result.ok) {
      const message =
        result.reason === "invalid_credentials"
          ? "We couldn't sign you in with those credentials. Check your email or sign-in ID and password."
          : "The sign-in service is unavailable right now. Please try again shortly.";

      return data<LoginActionData>(
        { email: validation.input.email, message },
        { status: result.reason === "invalid_credentials" ? 401 : 503 },
      );
    }
  } catch (error: unknown) {
    if (!(error instanceof AuthConfigurationError)) {
      throw error;
    }

    return data<LoginActionData>(
      {
        email: validation.input.email,
        message: "Sign-in is not configured in this environment yet.",
      },
      { status: 503 },
    );
  }

  const returnTo = getSafeReturnPath(new URL(request.url).searchParams.get("returnTo"));
  return redirect(returnTo === "/" ? await landingPath() : returnTo);
}

/**
 * The first page for whoever just signed in, when no page was requested.
 *
 * Leaders start on the brief (`/`). Hospital-operations accounts start in the
 * ERP, and an admin with a hospital already chosen. Going there directly, rather
 * than through `/`, keeps the first screen from requesting a page the account
 * cannot use: the leaders' brief for an ERP account, or a hospital summary with
 * no hospital chosen for an admin. Each answered with an error before the
 * redirect, found in testing. Any failure here falls back to `/`, whose own
 * checks then decide.
 */
async function landingPath(): Promise<string> {
  try {
    const session = await getCurrentSession();
    if (!session) return "/";
    const client = createApiClient(httpTransport(session.access_token));
    const identity = await client.identity();
    if (!("operatorRole" in identity)) return "/";
    if (identity.operatorRole !== "admin") return "/erp";
    const first = (await client.erp.reference()).facilities[0]?.facilityId;
    return first ? `/erp?${new URLSearchParams({ facility: first }).toString()}` : "/erp";
  } catch {
    return "/";
  }
}

function MailIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 6.5h16v11H4z" />
      <path d="m5 8 7 5 7-5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect height="10" rx="2" width="14" x="5" y="10" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
    </svg>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z" />
      <circle cx="12" cy="12" r="2.5" />
      {hidden ? <path d="m4 4 16 16" /> : null}
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 12h14M14 7l5 5-5 5" />
    </svg>
  );
}

export function LoginRoute() {
  const actionData = useActionData<LoginActionData>();
  const navigation = useNavigation();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isSubmitting = navigation.state === "submitting";

  return (
    <main className="login-page">
      <section aria-labelledby="orbit-login-promise" className="login-story">
        <div className="login-story__glow login-story__glow--one" />
        <div className="login-story__glow login-story__glow--two" />

        <OrbitBrand tagline="Healthcare performance platform" />

        <div className="login-story__content">
          <p className="login-eyebrow">People · Performance · Better decisions</p>
          <h1 id="orbit-login-promise">
            Better performance.
            <span>Brighter care.</span>
          </h1>
          <p className="login-story__intro">
            Turn authorized healthcare evidence into focused decisions and accountable action.
          </p>

          <ul className="login-benefits">
            <li><span>01</span>See what changed</li>
            <li><span>02</span>Understand the evidence</li>
            <li><span>03</span>Record the next action</li>
          </ul>
        </div>

        <div aria-hidden="true" className="login-orbit-scene">
          <span className="login-orbit-scene__ring login-orbit-scene__ring--outer" />
          <span className="login-orbit-scene__ring login-orbit-scene__ring--middle" />
          <span className="login-orbit-scene__ring login-orbit-scene__ring--inner" />
          <span className="login-orbit-scene__core" />
          <span className="login-orbit-scene__node login-orbit-scene__node--data">Data</span>
          <span className="login-orbit-scene__node login-orbit-scene__node--evidence">Evidence</span>
          <span className="login-orbit-scene__node login-orbit-scene__node--action">Action</span>
        </div>

        <p className="login-story__footnote">A clearer view of what needs attention.</p>
      </section>

      <section aria-labelledby="login-title" className="login-entry">
        <div className="login-entry__mobile-brand">
          <OrbitBrand compact />
        </div>

        <div className="login-card">
          <header className="login-card__header">
            <p className="login-eyebrow">Welcome to Orbit</p>
            <h2 id="login-title">Sign in to your workspace</h2>
            <p>Use the work account provisioned for your authorized role and scope.</p>
          </header>

          {actionData?.message ? (
            <div className="login-alert" role="alert">
              <span aria-hidden="true">!</span>
              <p>{actionData.message}</p>
            </div>
          ) : null}

          <Form className="login-form" method="post" noValidate>
            <div className="login-field">
              <label htmlFor="email">Work email or sign-in ID</label>
              <div className="login-control" data-invalid={Boolean(actionData?.errors?.email)}>
                <span className="login-control__icon"><MailIcon /></span>
                <input
                  aria-describedby={actionData?.errors?.email ? "email-error" : undefined}
                  aria-invalid={Boolean(actionData?.errors?.email)}
                  autoComplete="username"
                  defaultValue={actionData?.email}
                  id="email"
                  autoCapitalize="none"
                  inputMode="email"
                  name="email"
                  placeholder="name@organization.org"
                  required
                  spellCheck={false}
                  type="text"
                />
              </div>
              {actionData?.errors?.email ? (
                <p className="login-field__error" id="email-error">{actionData.errors.email}</p>
              ) : null}
            </div>

            <div className="login-field">
              <label htmlFor="password">Password</label>
              <div className="login-control" data-invalid={Boolean(actionData?.errors?.password)}>
                <span className="login-control__icon"><LockIcon /></span>
                <input
                  aria-describedby={actionData?.errors?.password ? "password-error" : undefined}
                  aria-invalid={Boolean(actionData?.errors?.password)}
                  autoComplete="current-password"
                  id="password"
                  name="password"
                  placeholder="Enter your password"
                  required
                  type={passwordVisible ? "text" : "password"}
                />
                <button
                  aria-label={passwordVisible ? "Hide password" : "Show password"}
                  className="login-password-toggle"
                  onClick={() => setPasswordVisible((visible) => !visible)}
                  type="button"
                >
                  <EyeIcon hidden={passwordVisible} />
                </button>
              </div>
              {actionData?.errors?.password ? (
                <p className="login-field__error" id="password-error">{actionData.errors.password}</p>
              ) : null}
            </div>

            <button className="login-submit" disabled={isSubmitting} type="submit">
              <span>{isSubmitting ? "Signing in…" : "Sign in"}</span>
              {isSubmitting ? <span aria-hidden="true" className="login-spinner" /> : <ArrowIcon />}
            </button>
          </Form>

          <div className="login-access-note">
            <p><strong>Need access?</strong> Contact your administrator.</p>
            <p>Accounts and role access are provisioned by your organization.</p>
          </div>

          <div className="login-demo-note">
            <span className="chip-illustrative">Illustrative environment</span>
            <p>Fictional demonstration company. No patient or employee records are used.</p>
          </div>
        </div>

        <footer className="login-entry__footer">
          <span>Authorized users only</span>
          <span aria-hidden="true">·</span>
          <span>Orbit</span>
        </footer>
      </section>
    </main>
  );
}

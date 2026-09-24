/**
 * Provisions the demo Auth accounts and their Orbit memberships.
 *
 * Run: npm run provision:demo --workspace=@orbit/data-gen
 * Then: npx supabase db push --linked --include-seed
 *
 * Reads SUPABASE_URL and SUPABASE_SECRET_KEY from supabase/.env.provisioning
 * (gitignored). The secret key is used only here, to call the Auth admin API;
 * the API and the web app never see it.
 *
 * Writes two gitignored files under supabase/seed/local/:
 * - demo-accounts.txt: email, password, role and scope, for out-of-band
 *   handover (ADR 0013 §2). Never commit it or paste it anywhere.
 * - 0100_demo_memberships.sql: idempotent membership + scope seed, keyed on the
 *   Auth user ids just created, applied by `db push --include-seed`.
 *
 * Re-running is safe: existing accounts are reused and get a fresh password,
 * and the SQL skips memberships that already exist.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const envPath = resolve(repoRoot, "supabase/.env.provisioning");
const localDir = resolve(repoRoot, "supabase/seed/local");

type Scope =
  | { grain: "group"; org: string }
  | { grain: "region"; org: string; region: string }
  | { grain: "facility"; org: string; facility: string }
  | { grain: "coe"; org: string; coe: string };

interface DemoAccount {
  email: string;
  role: string;
  scope: Scope;
  label: string;
}

const DEMO = "kestrion";
const OTHER_ORG = "halveston-test-fixture";
const group = { grain: "group", org: DEMO } as const;

/** 14 roles, plus region, facility and organization isolation accounts. */
const ACCOUNTS: readonly DemoAccount[] = [
  { email: "chairman@orbit-demo.example.com", role: "chairman", scope: group, label: "Chairman, Kestrion group" },
  { email: "clinical.director@orbit-demo.example.com", role: "clinical-director", scope: group, label: "Clinical Director, group" },
  { email: "coo.north@orbit-demo.example.com", role: "regional-coo", scope: { grain: "region", org: DEMO, region: "north" }, label: "Regional COO, North" },
  { email: "coo.south@orbit-demo.example.com", role: "regional-coo", scope: { grain: "region", org: DEMO, region: "south" }, label: "Regional COO, South (region isolation)" },
  { email: "dho.avenhurst@orbit-demo.example.com", role: "hospital-dho", scope: { grain: "facility", org: DEMO, facility: "avenhurst" }, label: "Hospital DHO, Avenhurst (North)" },
  { email: "dho.dunmarrow@orbit-demo.example.com", role: "hospital-dho", scope: { grain: "facility", org: DEMO, facility: "dunmarrow" }, label: "Hospital DHO, Dunmarrow (South)" },
  { email: "people@orbit-demo.example.com", role: "people-executive", scope: { grain: "facility", org: DEMO, facility: "avenhurst" }, label: "People Executive, Avenhurst" },
  { email: "bd@orbit-demo.example.com", role: "bd-lead", scope: { grain: "facility", org: DEMO, facility: "avenhurst" }, label: "BD Lead, Avenhurst" },
  { email: "billing@orbit-demo.example.com", role: "billing-lead", scope: { grain: "facility", org: DEMO, facility: "avenhurst" }, label: "Billing & Revenue Lead, Avenhurst" },
  { email: "coe@orbit-demo.example.com", role: "coe-lead", scope: { grain: "coe", org: DEMO, coe: "cardiac-sciences" }, label: "COE Lead, Cardiac Sciences" },
  { email: "corporate@orbit-demo.example.com", role: "corporate-revenue-lead", scope: group, label: "Corporate Revenue & Insurance Lead" },
  { email: "cfo@orbit-demo.example.com", role: "group-cfo", scope: group, label: "Group CFO" },
  { email: "procurement@orbit-demo.example.com", role: "procurement-head", scope: group, label: "Procurement Head" },
  { email: "hr@orbit-demo.example.com", role: "hr-head", scope: group, label: "HR Head" },
  { email: "legal@orbit-demo.example.com", role: "legal-head", scope: group, label: "Legal Head" },
  { email: "analytics@orbit-demo.example.com", role: "analytics-head", scope: group, label: "Head of Analytics & Digital" },
  { email: "chairman.other-org@orbit-demo.example.com", role: "chairman", scope: { grain: "group", org: OTHER_ORG }, label: "Chairman, test organization (organization isolation)" },
];

function readEnv(): { url: string; secret: string } {
  const vars = Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
  );
  const url = vars["SUPABASE_URL"];
  const secret = vars["SUPABASE_SECRET_KEY"];
  if (!url || !secret) throw new Error(`SUPABASE_URL and SUPABASE_SECRET_KEY must be set in ${envPath}`);
  return { url: url.replace(/\/+$/, ""), secret };
}

function q(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function admin(env: { url: string; secret: string }, method: string, path: string, body?: unknown) {
  const response = await fetch(`${env.url}/auth/v1/admin${path}`, {
    method,
    headers: { apikey: env.secret, Authorization: `Bearer ${env.secret}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    // Never echo the request (it may carry a password); the status and error code are enough.
    throw new Error(`Auth admin ${method} ${path.split("?")[0]} failed: ${response.status} ${text.slice(0, 200)}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function existingUsers(env: { url: string; secret: string }): Promise<Map<string, string>> {
  const byEmail = new Map<string, string>();
  const page = await admin(env, "GET", "/users?page=1&per_page=1000");
  const users = Array.isArray(page["users"]) ? page["users"] : [];
  for (const user of users) {
    if (user && typeof user === "object" && "email" in user && "id" in user) {
      byEmail.set(String(user.email), String(user.id));
    }
  }
  return byEmail;
}

function scopeSql(subject: string, scope: Scope): string {
  const membership = `(select m.id from orbit.org_memberships m where m.subject = ${q(subject)}::uuid and m.status = 'active')`;
  const org = `(select o.id from orbit.organizations o where o.slug = ${q(scope.org)})`;
  const columns = "insert into orbit.org_membership_scopes (membership_id, organization_id, grain, region_id, facility_id, coe_id)";
  switch (scope.grain) {
    case "group":
      return `${columns}\nselect ${membership}, ${org}, 'group', null, null, null\non conflict (membership_id, grain, entity_id) do nothing;`;
    case "region":
      return `${columns}\nselect ${membership}, r.organization_id, 'region', r.id, null, null from orbit.regions r where r.organization_id = ${org} and r.slug = ${q(scope.region)}\non conflict (membership_id, grain, entity_id) do nothing;`;
    case "facility":
      return `${columns}\nselect ${membership}, f.organization_id, 'facility', null, f.id, null from orbit.facilities f where f.organization_id = ${org} and f.slug = ${q(scope.facility)}\non conflict (membership_id, grain, entity_id) do nothing;`;
    case "coe":
      return `${columns}\nselect ${membership}, c.organization_id, 'coe', null, null, c.id from orbit.coes c where c.organization_id = ${org} and c.slug = ${q(scope.coe)}\non conflict (membership_id, grain, entity_id) do nothing;`;
  }
}

async function main() {
  const env = readEnv();
  const existing = await existingUsers(env);
  const credentials: string[] = [
    "Orbit demo accounts — LOCAL ONLY. Hand over out of band (ADR 0013 §2). Never commit or paste.",
    "",
  ];
  const sql: string[] = [
    "-- GENERATED by packages/data-gen/scripts/provision-demo-accounts.ts — LOCAL ONLY (gitignored).",
    "-- Demo memberships for the Auth users created by that script. Idempotent.",
    "begin;",
  ];

  for (const account of ACCOUNTS) {
    const password = randomBytes(18).toString("base64url");
    let id = existing.get(account.email);
    if (id) {
      await admin(env, "PUT", `/users/${id}`, { password });
    } else {
      const created = await admin(env, "POST", "/users", { email: account.email, password, email_confirm: true });
      id = String(created["id"]);
    }
    credentials.push(`${account.label}\n  email:    ${account.email}\n  password: ${password}\n  role:     ${account.role}\n`);
    sql.push(
      "",
      `-- ${account.label}`,
      `insert into orbit.org_memberships (subject, organization_id, role_id, status)`,
      `select ${q(id)}::uuid, o.id, ${q(account.role)}, 'active' from orbit.organizations o where o.slug = ${q(account.scope.org)}`,
      `  and not exists (select 1 from orbit.org_memberships m where m.subject = ${q(id)}::uuid);`,
      scopeSql(id, account.scope),
    );
  }
  sql.push("", "commit;", "");

  mkdirSync(localDir, { recursive: true });
  writeFileSync(resolve(localDir, "demo-accounts.txt"), credentials.join("\n"));
  writeFileSync(resolve(localDir, "0100_demo_memberships.sql"), sql.join("\n"));
  console.log(`Provisioned ${ACCOUNTS.length} accounts. Credentials: supabase/seed/local/demo-accounts.txt (gitignored).`);
}

await main();

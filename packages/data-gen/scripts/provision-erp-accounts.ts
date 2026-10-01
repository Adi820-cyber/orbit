/**
 * Provisions the two ERP operator sign-ins (ADR 0016) and writes their
 * membership seed:
 *
 *   hospital@kestrion.demo   operator role `hospital`, facility scope (Avenhurst)
 *   admin@kestrion.demo      operator role `admin`, group scope (Kestrion)
 *
 * On the sign-in page either account can also be entered as just `hospital`
 * or `admin`; the page completes the demo domain.
 *
 * Run:  npm run provision:erp --workspace=@orbit/data-gen
 * Then: apply supabase/seed/local/0101_erp_operator_memberships.sql as the
 *       database owner, e.g.  psql "<owner connection>" -f supabase/seed/local/0101_erp_operator_memberships.sql
 *
 * Reads from supabase/.env.provisioning (gitignored; never commit it):
 *   SUPABASE_URL                 the project URL
 *   SUPABASE_SECRET_KEY          used here only, for the Auth admin API
 *   ORBIT_HOSPITAL_PASSWORD      password for hospital@kestrion.demo
 *   ORBIT_ADMIN_PASSWORD         password for admin@kestrion.demo
 *
 * Passwords are chosen by the demo owner and live only in that file and in
 * Supabase Auth: this script never prints them and never writes them anywhere
 * else (ADR 0013 §2). The membership SQL it writes is gitignored too, because
 * it carries the Auth user ids of a specific project.
 *
 * Re-running is safe: an existing account is reused and gets the password from
 * the file; the SQL skips memberships that already exist.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const envPath = resolve(repoRoot, "supabase/.env.provisioning");
const localDir = resolve(repoRoot, "supabase/seed/local");

const ORG = "kestrion";

interface OperatorAccount {
  email: string;
  operatorRole: "admin" | "hospital";
  passwordVar: "ORBIT_HOSPITAL_PASSWORD" | "ORBIT_ADMIN_PASSWORD";
  scope: { grain: "group" } | { grain: "facility"; facility: string };
  label: string;
}

const ACCOUNTS: readonly OperatorAccount[] = [
  {
    email: "hospital@kestrion.demo",
    operatorRole: "hospital",
    passwordVar: "ORBIT_HOSPITAL_PASSWORD",
    scope: { grain: "facility", facility: "avenhurst" },
    label: "Hospital operations desk, Avenhurst",
  },
  {
    email: "admin@kestrion.demo",
    operatorRole: "admin",
    passwordVar: "ORBIT_ADMIN_PASSWORD",
    scope: { grain: "group" },
    label: "Hospital operations admin, Kestrion group",
  },
];

type Env = Record<string, string>;

function readEnv(): Env {
  let text: string;
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    throw new Error(`Create ${envPath} (gitignored) with the variables listed at the top of this script.`);
  }
  const vars = Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
  );
  for (const name of ["SUPABASE_URL", "SUPABASE_SECRET_KEY", ...ACCOUNTS.map((a) => a.passwordVar)]) {
    if (!vars[name]) throw new Error(`${name} must be set in ${envPath}`);
  }
  for (const account of ACCOUNTS) {
    // Supabase Auth's own minimum is lower; 8 keeps an obviously weak value out.
    if ((vars[account.passwordVar] ?? "").length < 8) throw new Error(`${account.passwordVar} must be at least 8 characters`);
  }
  return vars;
}

function q(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function admin(env: Env, method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const url = (env["SUPABASE_URL"] ?? "").replace(/\/+$/, "");
  const secret = env["SUPABASE_SECRET_KEY"] ?? "";
  const response = await fetch(`${url}/auth/v1/admin${path}`, {
    method,
    headers: { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    // Never echo the request: it may carry a password. Status and error text are enough.
    throw new Error(`Auth admin ${method} ${path.split("?")[0]} failed: ${response.status} ${text.slice(0, 200)}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function findUser(env: Env, email: string): Promise<string | undefined> {
  for (let page = 1; page <= 20; page++) {
    const result = await admin(env, "GET", `/users?page=${page}&per_page=200`);
    const users = Array.isArray(result["users"]) ? (result["users"] as Array<Record<string, unknown>>) : [];
    const match = users.find((user) => String(user["email"]).toLowerCase() === email);
    if (match) return String(match["id"]);
    if (users.length < 200) return undefined;
  }
  return undefined;
}

function membershipSql(subject: string, account: OperatorAccount): string[] {
  const org = `(select o.id from orbit.organizations o where o.slug = ${q(ORG)})`;
  const membership = `(select m.id from orbit.org_memberships m where m.subject = ${q(subject)}::uuid and m.status = 'active')`;
  const scope =
    account.scope.grain === "group"
      ? `insert into orbit.org_membership_scopes (membership_id, organization_id, grain)
select ${membership}, ${org}, 'group'
on conflict (membership_id, grain, entity_id) do nothing;`
      : `insert into orbit.org_membership_scopes (membership_id, organization_id, grain, facility_id)
select ${membership}, f.organization_id, 'facility', f.id
from orbit.facilities f where f.organization_id = ${org} and f.slug = ${q(account.scope.facility)}
on conflict (membership_id, grain, entity_id) do nothing;`;
  return [
    "",
    `-- ${account.label} (${account.email})`,
    `insert into orbit.org_memberships (subject, organization_id, role_id, operator_role, status)`,
    `select ${q(subject)}::uuid, ${org}, null, ${q(account.operatorRole)}, 'active'`,
    `where not exists (select 1 from orbit.org_memberships m where m.subject = ${q(subject)}::uuid and m.status = 'active');`,
    scope,
  ];
}

async function main() {
  const env = readEnv();
  const sql: string[] = [
    "-- GENERATED by packages/data-gen/scripts/provision-erp-accounts.ts — LOCAL ONLY (gitignored).",
    "-- ERP operator memberships for the Auth users that script created. Idempotent.",
    "-- Requires migration 20261001000100_orbit_erp_operations.sql. Apply as the database owner.",
    "begin;",
  ];

  for (const account of ACCOUNTS) {
    const password = env[account.passwordVar] ?? "";
    let id = await findUser(env, account.email);
    if (id) {
      await admin(env, "PUT", `/users/${id}`, { password });
    } else {
      const created = await admin(env, "POST", "/users", { email: account.email, password, email_confirm: true });
      id = String(created["id"]);
    }
    sql.push(...membershipSql(id, account));
    console.log(`Ready: ${account.email} (${account.operatorRole}).`);
  }
  sql.push("", "commit;", "");

  mkdirSync(localDir, { recursive: true });
  const out = resolve(localDir, "0101_erp_operator_memberships.sql");
  writeFileSync(out, sql.join("\n"));
  console.log(`Membership SQL: ${out} (gitignored). Apply it as the database owner.`);
}

await main();

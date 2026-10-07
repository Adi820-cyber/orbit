import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from 'postgres';
import { connect } from './client.ts';

/*
 * Outbreak watch against Postgres (migration 20261007000100, ADR 0023).
 *
 * Needs ORBIT_TEST_OWNER_DATABASE_URL (a THROWAWAY database with every
 * migration applied, as for erp.test.ts). Builds its own organization with five
 * hospitals in two regions, stages a surge, and reads the feed as orbit_app
 * with real claims. Skipped otherwise; a skip is "not verified".
 */
const ownerUrl = process.env.ORBIT_TEST_OWNER_DATABASE_URL;

describe.skipIf(!ownerUrl)('outbreak watch against Postgres (integration)', { timeout: 60_000 }, () => {
  let sql: Sql;
  const org = randomUUID();
  const regions = [randomUUID(), randomUUID()] as const;
  const facilities = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
  const department = randomUUID();
  const fever = randomUUID();
  const quiet = randomUUID();
  const suffix = org.slice(0, 8);

  /** Runs one read as orbit_app with the given claims. */
  async function as<T>(claims: object, query: string): Promise<T[]> {
    return sql.begin(async (tx) => {
      await tx.unsafe('set local role orbit_app');
      await tx.unsafe(`select set_config('orbit.membership', $1, true)`, [JSON.stringify(claims)]);
      return [...(await tx.unsafe(query))] as T[];
    }) as Promise<T[]>;
  }
  const leader = (role: string, scope: { grain: string; entityId: string }) => ({
    membershipId: randomUUID(), subject: randomUUID(), organizationId: org, role, scopes: [scope],
  });

  beforeAll(async () => {
    sql = connect({ url: ownerUrl ?? '', ssl: process.env.ORBIT_TEST_DATABASE_SSL !== 'false', max: 2 });
    await sql.begin(async (tx) => {
      await tx.unsafe(
        `insert into orbit.organizations (id, slug, name, kind, currency, fiscal_year_start_month, timezone)
         values ($1, $2, 'Surveillance test org', 'test-fixture', 'INR', 4, 'UTC')`,
        [org, `surv-${suffix}`],
      );
      await tx.unsafe(`insert into orbit.regions (id, organization_id, slug, name, short_name) values ($1, $3, 'n', 'North', 'N'), ($2, $3, 's', 'South', 'S')`, [regions[0], regions[1], org]);
      for (const [index, facility] of facilities.entries()) {
        await tx.unsafe(
          `insert into orbit.facilities (id, organization_id, region_id, slug, name, staffed_beds, revenue_weight) values ($1, $2, $3, $4, $5, 100, 0.2)`,
          [facility, org, index < 3 ? regions[0] : regions[1], `h${index}`, `Hospital ${index + 1}`],
        );
      }
      await tx.unsafe(`insert into orbit_erp.departments (id, organization_id, code, name) values ($1, $2, 'OPD', 'Outpatients')`, [department, org]);
      await tx.unsafe(
        `insert into orbit_erp.conditions (id, organization_id, code, name, category) values ($1, $3, 'VIRAL-FEVER', 'Viral Fever', 'Infectious'), ($2, $3, 'HERNIA', 'Hernia', 'Surgical')`,
        [fever, quiet, org],
      );
      await tx.unsafe(`insert into orbit_erp.surveillance_settings (organization_id, window_days, min_patients, min_hospitals) values ($1, 7, 50, 5) on conflict do nothing`, [org]);
      // 52 fever patients this week across all five hospitals; one hernia patient.
      for (let i = 0; i < 53; i += 1) {
        const patient = randomUUID();
        const facility = facilities[i % 5] ?? org;
        await tx.unsafe(
          `insert into orbit_erp.patients (id, organization_id, home_facility_id, display_name, sex, birth_year) values ($1, $2, $3, $4, 'female', 1990)`,
          [patient, org, facility, `Patient ${i}`],
        );
        await tx.unsafe(
          `insert into orbit_erp.encounters (organization_id, patient_id, facility_id, department_id, encounter_type, started_at, presenting_condition_id)
           values ($1, $2, $3, $4, 'outpatient', now() - make_interval(hours => $5::int), $6)`,
          [org, patient, facility, department, (i % 6) * 20 + 1, i < 52 ? fever : quiet],
        );
      }
    });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it('fires the rule at 50+ patients across 5+ hospitals, and not for a quiet condition', async () => {
    const rows = await as<{ name: string; patients: number; hospitals: number; alert: boolean }>(
      leader('chairman', { grain: 'group', entityId: org }),
      `select name, patients, hospitals, alert from orbit_erp.surveillance_feed()`,
    );
    expect(rows.find((row) => row.name === 'Viral Fever')).toMatchObject({ patients: 52, hospitals: 5, alert: true });
    expect(rows.find((row) => row.name === 'Hernia')).toMatchObject({ patients: 1, alert: false });
    // Alerts come first.
    expect(rows[0]?.name).toBe('Viral Fever');
  });

  it('tells a hospital DHO about the group surge, but shows only its own hospital', async () => {
    const dho = leader('hospital-dho', { grain: 'facility', entityId: facilities[3] });
    const [fever7] = await as<{ patients: number; hospitals: number; alert: boolean }>(
      dho,
      `select patients, hospitals, alert from orbit_erp.surveillance_feed() where name = 'Viral Fever'`,
    );
    expect(fever7).toMatchObject({ patients: 52, hospitals: 5, alert: true });
    const own = await as<{ facility_id: string; patients: number }>(dho, `select facility_id::text, patients from orbit_erp.surveillance_hospitals()`);
    expect(new Set(own.map((row) => row.facility_id))).toEqual(new Set([facilities[3]]));
  });

  it("keeps a regional COO's per-hospital counts inside the region", async () => {
    const coo = leader('regional-coo', { grain: 'region', entityId: regions[0] });
    const rows = await as<{ facility_id: string }>(coo, `select facility_id::text from orbit_erp.surveillance_hospitals()`);
    expect(new Set(rows.map((row) => row.facility_id))).toEqual(new Set(facilities.slice(0, 3)));
  });

  it('gives an operator, or no claims at all, nothing', async () => {
    const operator = { membershipId: randomUUID(), subject: randomUUID(), organizationId: org, operatorRole: 'admin', scopes: [{ grain: 'group', entityId: org }] };
    expect(await as(operator, `select * from orbit_erp.surveillance_feed()`)).toHaveLength(0);
    expect(await as(operator, `select * from orbit_erp.surveillance_hospitals()`)).toHaveLength(0);
    expect(await as({}, `select * from orbit_erp.surveillance_feed()`)).toHaveLength(0);
  });

  it('stores a forecast run and serves it to the leader, refusing rows of another organization', async () => {
    const run = {
      organizationId: org, model: 'XGBoost test', dataThrough: '2026-10-06', horizonDays: 7, trainingRows: 10,
      modelMae: 0.9, baselineMae: 1.0, notes: 'test run',
      rows: [
        { conditionId: fever, facilityId: '', expectedPatients: 60, pPatients: 0.9, pHospitals: 0.95 },
        { conditionId: fever, facilityId: facilities[0], expectedPatients: 12 },
      ],
    };
    await as({}, `select orbit_erp.store_forecast_run('${JSON.stringify(run).replaceAll("'", "''")}'::jsonb)`);
    const [served] = await as<{ expected_patients: string; p_patients: string }>(
      leader('chairman', { grain: 'group', entityId: org }),
      `select expected_patients::text, p_patients::text from orbit_erp.surveillance_feed() where name = 'Viral Fever'`,
    );
    expect(Number(served?.expected_patients)).toBe(60);
    expect(Number(served?.p_patients)).toBeCloseTo(0.9);
    const foreign = { ...run, rows: [{ conditionId: randomUUID(), facilityId: '', expectedPatients: 1, pPatients: 0, pHospitals: 0 }] };
    await expect(as({}, `select orbit_erp.store_forecast_run('${JSON.stringify(foreign).replaceAll("'", "''")}'::jsonb)`)).rejects.toThrow();
  });
});

# ADR 0020: Two reference hospital datasets loaded into Orbit

- **Status:** Accepted by the product owner on 2026-10-05.
- **Builds on:** ADR 0016 (hospital operations), ADR 0017 (live simulator), ADR 0019 (knowledge chatbot).

## Context

The product owner supplied two synthetic hospital datasets and asked for them to be built into Orbit's tables and its knowledge base:

- **Hospital dataset:** one synthetic hospital in 19 tables: 30,000 patients, 45,000 admissions, 500 employees, 98 doctors, 27 wards and 415 beds. It also has bills with line items, diagnostic tests, prescriptions, drugs and stock, suppliers and insurers.
- **Clinic dataset:** 5 tables with 50 patients, 10 doctors, and 200 appointments, treatments and bills.

## Decisions

The product owner chose to:
- map the data into Orbit's own tables;
- add it alongside the existing data;
- have it built so the platform gives the best and most accurate answers.

### §1 Outside data stays out of Git

The archives and everything derived from them stay out of the repository (`DataSets/` and `supabase/seed/local/` are ignored), as `docs/source-material/README.md` requires. What is committed:
- the loader (`packages/data-gen/src/reference.ts`, `scripts/load-reference-datasets.ts`);
- its tests;
- a manifest of counts (`data/snapshots/reference-manifest.json`).

### §2 What becomes hospital-operations records

| Records | Count | Notes |
|---|---|---|
| Staff | 510 | 500 employees plus 10 clinic doctors |
| Doctors | 108 | New specialties: neurology, pulmonology, paediatrics, nephrology, dermatology |
| Patients | 30,050 | Fictional name, sex and birth year only |
| Visits | 43,777 | Hospital stays, plus completed, cancelled and no-show clinic appointments |
| Services | 118,157 | Bed-days, diagnostic tests, procedures and clinic treatments |

**Spreading one hospital across six:** the people and visits are spread across Kestrion's six hospitals in proportion to staffed beds, the same way every run.

**Dates:** each dataset moves forward by whole weeks so its history ends on 2026-09-30. This keeps weekdays and every interval exact (hospital dataset +259 days, clinic dataset +1,001 days).

**Not loaded:**
- **Personal details:** names (replaced by Orbit's fictional names), phone numbers, addresses, cities, emails, blood groups and insurance numbers.
- **Clinical detail:** no diagnosis, test result or prescription is attached to a patient (ADR 0016).

**Exclusions** (listed in the manifest):
- 1,372 admissions in the source fall before the patient's birth year.
- 51 clinic appointments are still marked scheduled; they are bookings, not visits.
- The source lists 103 treatments on no-shows and cancellations.

**Invented values:** the source has no doctor credential dates, so each doctor gets an illustrative expiry after the end of the history.

**Bill dates:** the source does not tie them to their admissions, so only the bill amounts are used.

### §3 What becomes chatbot knowledge

Clinical and financial detail is summarised into 57 knowledge entries: per hospital and for the group, with exact counts, rates and amounts computed from the full data. Each is visible only to the roles it concerns:

| Topic | Who can ask about it |
|---|---|
| Admissions history; beds and wards | Regional COOs, hospital directors, clinical director |
| Diagnoses, diagnostic tests, medicines prescribed | Clinical director, hospital directors (diagnoses also regional COOs) |
| Billing and collections | Billing, corporate revenue and finance leads; hospital directors; regional COOs |
| Insurance cover | Corporate revenue, billing and finance leads |
| Workforce | People executive, HR head, hospital directors, regional COOs |
| Medicine stock; suppliers | Procurement head and CFO (suppliers also the legal head) |
| Outpatient appointments | Hospital directors, regional COOs, billing and business development leads |

The chairman sees every area. Amounts are in the source dataset's own currency units and are labelled as not converted to USD.

**Wording:** the entries include plain words alongside the source's terms (unpaid, outstanding, missed appointments), so everyday questions find them.

## Verification (2026-10-05, dev project)

- **Hosted counts:** after loading, every count matches the loader exactly, and no record is dated in the future. Staff are spread in proportion to beds; Avenhurst has 24.4% of the staff against 24.7% of the beds.
- **Loader tests:**
  - patients keep only a name, sex and birth year, and no source contact detail appears anywhere;
  - nothing is dated after the end of the history;
  - every service falls inside its visit and is given by someone at that hospital;
  - each doctor's credential covers all their recorded work;
  - excluded records are counted;
  - the output is the same on every run.
- **Search as each role, as `orbit_app` with real claims:** every role got the right summary, and none outside it.
  - The procurement head asking which medicines are running low got medicine stock.
  - The Avenhurst hospital director asking the same got nothing about stock.
  - The billing lead asking how much is still unpaid got Avenhurst billing.
  - The legal head asking about expired supplier contracts got suppliers.
- **Model answers:** two full answers from the free model were correct, cited their source, and passed the number guard.

## Notes

- The dataset staff are now ordinary staff, so the live simulator rosters and punches them like everyone else. The roster backlog for 728 staff fills in over the first hours of scheduled runs.
- To reload or change the mapping:
  1. Extract the archives into `DataSets/extracted/{hospital,clinic}/`.
  2. Run `npm run load:reference --workspace=@orbit/data-gen`.
  3. Apply the files in `supabase/seed/local/reference/`.
  4. Run the knowledge sync.

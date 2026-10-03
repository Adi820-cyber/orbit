# ADR 0017: A live hospital simulator as a separate, always-on service

- **Status:** Accepted by the product owner on 2026-10-03, who chose to decide this directly instead of routing it through the named reviewers (a user instruction overriding the review rule in AGENTS.md). Built and verified locally (see "Verification"). **Ghansham** owns the code.
- **Author:** Ghansham
- **Date opened:** 2026-10-01
- **Builds on:** [ADR 0016](0016-erp-module-and-operator-roles.md) (the ERP and its operator roles).

## Context

The ERP module (ADR 0016) was demonstrated with seeded history: a fixed set of people, rosters, punches and visits that stops at the day it was generated. The product owner wants a hospital that keeps going: staff who punch in and out each day, patients who arrive and are treated, an admin who reviews corrections, running until it is stopped, so a demonstration shows live activity rather than frozen data.

Two constraints shaped the answer. First, the ERP is a system whose value in a demonstration is that records are made by the ERP's own rules and screens, so the activity must go **through the ERP API**, not around it. Second, the process must be **always on**.

## Decisions

### §1 Where it runs: not on Vercel

Vercel hosts the web app and the API, and cannot host this. Its functions are short-lived, and its scheduled jobs are too infrequent (on the free plan) or too limited for a process that acts all day. The simulator is therefore its **own service**, `services/simulator`, and runs on a host that keeps an ordinary Node process alive: **Render** (a background worker) or **Railway**. It is a separate project with its own environment and credentials, deployable and stoppable without touching the app or the API.

### §2 It drives the ERP through the API, as real accounts

- It signs in to Supabase Auth with a password, as the web app does, and calls the ERP API with that token. It has **no database access and no service key**.
- Every request body is parsed against `@orbit/contracts` before it is sent and every response after it arrives, so it can never write something the API contract would refuse.
- Role and facility come from the login, never from the request. What it may do is exactly what those accounts may do.
- It uses an **admin** account and, optionally, one **desk** (hospital) account per hospital. A hospital with no desk is served by the admin. With a desk, the desk punches staff and runs visits, and the admin decides corrections: the API's four-eyes rule holds, because the admin never decides a request it made.

### §3 It keeps no schedule

Each tick reads what the ERP says is happening and does whatever should have happened by now.

- Every decision (who is late, how long a visit lasts, which services it needs) is drawn from a seeded stream keyed on the person, visit and date. Every write carries an idempotency key from the same labels. A tick is therefore safe to repeat, skip or run after a long pause, and a restart never re-decides a day or records anything twice. (Verified: a second process replaying the same state created no duplicate rows.)
- After downtime it catches up. A punch within a few minutes of its time is recorded by the desk at the real time. A later one is back-dated by the admin to when it should have happened. Planned events older than a limit (24 hours by default; the API allows 31 days) are never back-filled, so history is not rewritten. This applies to services as well as punches (fixed 2026-10-03: services on long-open visits were being back-dated a week).
- **Single-run mode (`--once`).** Used by the scheduled GitHub Actions run every ten minutes. A fresh process cannot tell which services earlier runs recorded, so it only considers services due within three run intervals; without this each run re-sent every open visit's history, which the API ignored as duplicates but which used up the write budget. The tick length is set to the run interval (600 seconds), because patient arrivals per tick scale with it.

### §4 The day director: a model chooses an hour's mood, nothing more

About once an hour a language model is asked what kind of hour each hospital is having. It answers with a small structured mood (a demand multiplier and an absence multiplier per hospital).

- It **never touches a record**. The simulator applies the mood to its own rules.
- The answer is untrusted: it must parse as JSON and match a schema, may name only the hospitals it was given, and every number is clamped. Anything else is discarded.
- It is **never on the critical path**: with no key, or every provider failing, the day is ordinary. A mood lasts one hour at most, so a failure never leaves a stale surge running.
- Keys are tried in order (all Groq, then all OpenRouter). A rate-limited or rejected key is parked and not retried every hour. No key is ever logged. The request contains no personal or clinical data. The same approach and provider conventions as ADR 0014.
- **A caution on keys.** Rotating many free-tier keys from different accounts to avoid rate limits may breach a provider's terms. One call an hour needs only one or two keys, so this is not needed.

The reason for a rule-based simulator with a model on the side, and not a model per action: a day is thousands of punches and visits. A model per action would be slow, costly, rate-limited and different on every run. Rules are cheap, reliable and testable.

### §5 It replaces the seeded people and history

- **The database still provides configuration:** migrations, the organization and hospitals (seed `0001`), and the reference data (seed `0008`: departments, specialties, shift patterns, settings, service catalogue). There is no API to create these.
- **The simulator provides the rest.** If a hospital has fewer than a small minimum of staff, the admin hires up to it through the API (doctors get consultation slots), and if the whole service catalogue is empty it builds one. With data already present it hires and creates nothing, so seeds `0009` and `0010` (people and history) are not needed, and if they are already loaded the simulator carries on from them. Turn this off with `SIM_BOOTSTRAP=false`.
- Wiping already-seeded people and history from a database is a separate, destructive step and is **not done**. Say so if you want it.

### §6 It is simulated data, and says so

Everything it creates is fictional (invented names, `DEMO-` codes) and generated by rules. It is not real hospital data. The ERP screens keep their "illustrative" disclosure, and the product must not describe the activity as real. There is no clinical content: visits have a type, a length and service categories, never a diagnosis or note.

### §7 Safety rails and cost

- `SIM_PAUSED` reads and plans but writes nothing. `SIM_MAX_WRITES_PER_TICK` bounds a tick. Stopping the service is the off switch, and nothing it did is undone.
- One failing hospital or record is logged and skipped. Repeated tick failures back off up to five minutes. A rule refusing a write is never retried.
- Plain `http` API URLs are refused, except localhost.
- **Load.** A tick costs about three reads per hospital plus its writes. At six hospitals a 60-second tick is roughly 0.9 million reads a month. If the API is on a plan with a monthly request allowance, lengthen the tick or limit the hospitals. Corrections are listed once for the whole group, not once per hospital.
- **Data growth.** Each write adds an ERP audit row. At six hospitals expect about two thousand new rows a day. That is an estimate, not measured, and there is no automatic cleanup.

### §8 Accounts

- The simulator accounts are ordinary operator accounts. For a hosted run they should be **dedicated, with strong passwords** held only in the host's secret settings, not the demo `email = password` accounts. Anything a bot can do, whoever holds its password can do.
- Provisioning more accounts (a desk per hospital) uses the existing `provision:erp` pattern. This was not extended here.

## Verification (2026-10-01)

- **95 unit and scenario tests**, with no network, run the engine against an in-memory ERP typed from the real contracts. They include a full simulated hospital day, catch-up after downtime, restart safety, failure isolation, the write budget, paused mode, bootstrapping from an empty hospital, and the director's fallback and cool-down behaviour (including that a key never reaches the log).
- **A real run:** the simulator, signing in to the real Supabase Auth as `admin@kestrion.demo` and `hospital@kestrion.demo`, ran against a local copy of the ERP API and database. It back-dated 21 morning punches to their planned times and closed two missed punches from the previous night. It recorded services on open visits, performed by doctors at plausible times, and a restarted process created no duplicates.
- **The hosting recipe** was run from a clean copy of the repository with a production-only install (4 packages, about 8 MB, 6 seconds, no TypeScript or test tooling), then started with `node services/simulator/src/main.ts`.
- Two defects were found by running it, not by the tests, and fixed: a sign-in failure was reported as "API unreachable" (the token lookup sat inside the network guard), and a request body the contract rejected threw synchronously instead of rejecting.

**Not verified:** Render and Railway themselves, the real model providers (scripted responses only), a run of days, stopping on a host's termination signal, and any run against the hosted Supabase project or deployed API.

## Follow-ups (owners)

1. ~~Sign off §1 to §8, then update FILE_STRUCTURE.md for `services/simulator` and `render.yaml`.~~ Done 2026-10-03.
2. Provision dedicated simulator accounts with strong passwords, and the hospital desk accounts if wanted (Aditya).
3. Decide whether to wipe the seeded people and history before starting (Aditya, Maruti).
4. Decide the hosted tick length against the API plan's request allowance, and whether to add a retention job for audit rows (Ghansham, Aditya).
5. A first deploy to Render or Railway, watched for a day, before relying on it for a demonstration (Ghansham).

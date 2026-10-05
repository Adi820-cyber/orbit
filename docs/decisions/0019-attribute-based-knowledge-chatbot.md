# ADR 0019: An attribute-based knowledge chatbot that keeps itself current

- **Status:** Accepted by the product owner on 2026-10-03, who chose to decide this directly instead of routing it through the named reviewers (a user instruction overriding the review rule in AGENTS.md). Built, applied to the dev Supabase project and verified there. The grants in §1 are decided. **Ghansham** owns the code.
- **Author:** Ghansham
- **Date opened:** 2026-10-03
- **Builds on:** commit `1212040` (the first chatbot), [ADR 0014](0014-ask-model-providers.md) (model narration and the numeric guard), [ADR 0018](0018-orbit-uses-erp-data.md) (operations aggregates).

## Context

The product owner asked for a chatbot that answers each leader from what their role covers: the chairman across the whole organization, the CFO on finance, and so on. Its knowledge should follow the data as it changes, so decisions are not delayed by a leader lacking information their role is entitled to.

The first chatbot could not do this:

- Its knowledge table was empty, and nothing filled it.
- Access was a hand-typed role list per chunk. The chairman did not see everything, and scope was a single exact entity match taken from the first scope.
- The question's vector could not be made. Groq has no embeddings endpoint, and a chat model's name was sent as the embedding model. Without a vector it searched with a zero vector, which matches nothing.
- The API's database role had no `USAGE` on the `extensions` schema, so pgvector's operator could never have run for it.
- The ivfflat index with 100 lists over a few hundred rows misses most neighbours.

## Decisions

### §1 Who may read what is decided by attributes, in the database

A chunk is visible when all of these hold:

1. it belongs to the caller's organization;
2. the caller's verified scope covers its entity, using `orbit.scope_within_caller`, the same check as every other read (group covers everything, a region covers its hospitals, a facility covers itself); and
3. the caller's role is named on the chunk, **or** the role holds a grant on the chunk's domain in `orbit.knowledge_role_access`. `*` is every domain.

A chunk nobody is granted is visible to nobody. The rule is row-level security on `orbit.knowledge_chunks`, so the API's search cannot widen it, and the route sends no entity, role or filter of its own.

**Proposed grants:**
- **Chairman:** `*`, the whole organization.
- **Hospital operations domain:** clinical director, regional COO, hospital DHO, people executive and HR head. These are the same roles as the operations page.
- **KPI material:** each KPI's definition, latest readings and exceptions are named for the role that owns that KPI in the workbook. The exception owner role also sees its exceptions.

So the CFO sees the CFO's finance KPIs, and the legal head sees legal KPIs, by construction from the workbook rather than by a separate list.

### §2 Knowledge is built from the database, not typed in

`orbit.knowledge_refresh()` builds plain-text chunks from what is already stored:

| Kind | From | Visible to |
|---|---|---|
| KPI definitions (109 per organization) | `role_kpi_assignments` | the owning role |
| Latest KPI reading per entity (575) | `kpi_observations` | the owning role, within scope |
| Exceptions (84) | `exceptions` | the owner role and the KPI's role, within scope |
| Data limitations | `data_limitations` | the KPI's role, or every role if general |
| Hospital operations (per hospital, region, group) | `orbit_erp.ops_snapshot()` / `ops_daily()` | the operations domain, within scope |

**Only aggregates and framework text.** No patient, staff or visit record is read: the operations text comes from the counts-only functions of ADR 0018.

The function is idempotent. A chunk whose text is unchanged is not touched, so its embedding stays valid and costs nothing. A chunk whose source is gone is deleted. Manual chunks are left alone.

### §3 It keeps itself current

A scheduled job (`npm run knowledge:sync`, a Render cron in `render.yaml`, every 10 minutes) does two things:
1. It runs the refresh.
2. It embeds the chunks whose text changed, through `knowledge_pending` / `knowledge_set_embedding`. An embedding is stored only if the chunk still has the text it was made from.

**How current it is:** "when data enters the database it goes to the vector database" means here: within one sync interval. A per-write database trigger was not chosen, because embedding needs an external call, and doing that inside a write would make every ERP or KPI write depend on a model provider.

### §4 Search works without a model

`orbit.search_knowledge()` always runs Postgres full-text search, as an OR of the question's word stems, and adds cosine similarity when the question could be embedded. With no key, or the provider down, the chatbot still answers from word matches.

Search is exact rather than approximate. At this size it is fast and always right, and an approximate index filtered by row-level security could return almost nothing for a narrow role. Revisit with HNSW and iterative scans past roughly ten thousand chunks.

### §5 Models: free on OpenRouter

Revised 2026-10-03, after the product owner chose free models. Both were picked by testing on Orbit's own questions and sources, not from a list.

**Embeddings: `liquid/lfm-2.5-embedding-350m:free`.**
- Among the free models it separated a staffing question from unrelated finance text best.
- It returns 1024 numbers per text, so the column is `vector(1024)` (migration `20261001000400`).
- A vector of any other length is refused.
- Its provider may keep free requests for training; acceptable because the knowledge base holds only fictional, aggregate text.

**Answers: `nvidia/nemotron-3-super-120b-a12b:free`.**
- It wrote correct, cited answers that passed the number guard in about 6 seconds.
- `qwen/qwen3.8-27b:free` also passed, more slowly.
- `google/gemma-4-31b-it:free` had no endpoint for structured replies.

**The free tier allows about 50 requests a day, so:**
- The text sent for embedding has its figures masked, and a chunk is re-embedded only when its meaning changes. Counts moving every ten minutes cost nothing.
- Embedding runs in batches of 50; the first full pass of 888 chunks took 18 requests.
- When the allowance runs out, the chatbot falls back to word search and a deterministic answer. It does not fail.

**Verified on the dev project:**
- **Legal head:** "How quickly do we close agreements?" found *Contract turnaround time* by meaning alone.
- **North COO:** "Are beds being used well in my area?" found capacity utilisation.
- **Chairman and CFO:** "Are our hospitals short of people today?" found staffing for the chairman and nothing for the CFO.

### §6 The answer is grounded, cited and guarded

**When a model is configured:**
- It answers from the numbered sources only, and is told the asker's role.
- The answer is refused, and a deterministic summary served instead, if any of these happen:
  - it cites a source number that does not exist;
  - it cites nothing;
  - it writes a number that appears in neither the sources nor the question (the ADR 0014 guard).

**What the response always carries:**
- the asker's role and scope;
- every source used, with its domain, when it was built, how it matched, and whether the answer cited it;
- `coverage: no_sources` when nothing the role may read matches. The wording never says whether something exists outside the role.

## Verification (2026-10-03)

- **Dev Supabase project:** migration applied; 892 chunks built.
- **Row-level security, run as `orbit_app` with real claims:**
  - The chairman sees all 775 chunks of the organization across every domain.
  - The CFO sees finance KPIs, definitions and exceptions, and no hospital operations. A "staff late" question returns finance material only.
  - The Avenhurst DHO sees only Avenhurst's operations chunk and Avenhurst KPIs.
  - The north regional COO sees three hospitals plus the region, not the group.
  - The legal head sees legal KPIs only.
- **The API's search statement:** run as `orbit_app` including the vector cast, which failed before the `USAGE` grant.
- **Unit tests:** routes (the grounded answer, each refusal, text-only fallback, a client cannot widen search, store failure), the embedder (order, dimension, provider choice) and the sync job (batching, nothing-changed, no provider, provider failure, per-run bound).

**Question test, 2026-10-03 (migration `20261001000300`).** Fourteen real questions were asked as six roles on the dev project as `orbit_app`, and the answers were built with the chatbot's own responder. It found and fixed:

- **A wrong figure.** Chunks were built from every KPI dataset. The project holds an older one, so the chatbot could say Group EBITDA was 103.8 percent while the brief said 82.6 percent. Chunks now come from the current dataset only.
- **Ranking by a shared word.** "How many staff are on duty at my hospital?" ranked finance exceptions first, because they say "hospital". Results now rank by how many of the question's words they contain.
- **Duplicates.** A KPI owned by two roles (Group EBITDA: chairman and CFO) appeared twice.
- **Weak matches.** A CFO asking about staff got a finance item that only shared the word "late"; now a chunk must contain half the question's words. Exception titles name their hospital.

After the fix:
- Every answer comes from the caller's own area.
- An organization-wide question gets the group total before each hospital.
- The CFO and the legal head asking about staffing get "nothing available to your role".

**Not verified:**
- a real embedding run, because no OpenRouter key was available to this session, so every chunk is still unembedded and search is by words;
- a real model answer;
- the Render cron itself;
- the deployed API, because `knowledge` is not yet in `ORBIT_LIVE_SOURCES`.

## Decided (2026-10-03, product owner)

- The grants in §1, including the KPI-owner rule.
- **People executive and HR head keep the whole hospital-operations domain**, not staffing alone. Everything in it is counts; staffing, attendance, doctors' credentials and corrections are their remit, and visit and service volumes are the context for staffing decisions. Splitting the domain would also make the chatbot disagree with the operations page they already see.
- Ten minutes is the sync interval. A shorter interval adds cost for little value; a per-write trigger is ruled out (§3).

## Still needed before the chatbot is live

These are settings, not decisions, and need someone with access to the hosting accounts:

1. Add `knowledge` to `ORBIT_LIVE_SOURCES` on `orbit-api`, and redeploy.
2. Run the knowledge sync on a schedule with `DATABASE_URL` and `OPENROUTER_API_KEY` (the Render cron in `render.yaml`). Until then search is by words only.

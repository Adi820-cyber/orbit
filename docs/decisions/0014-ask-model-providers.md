# ADR 0014: Ask model providers — Groq primary, OpenRouter fallback

- **Status:** Proposed. §1–§4 are Aditya's calls (ARCHITECTURE.md §17 item 4, the "unresolved model decision" PRD §9 refers to). §5 changes `AskMode` in `packages/contracts`, so it needs **Ghansham** (serves it) and **Ayas** (renders it) before it lands. Nothing in §5 is implemented yet.
- **Owners:** Aditya (decision, security), Ghansham (Ask module), Ayas (Evidence Card UI)
- **Date opened:** 2026-09-24
- **Date resolved:** _(fill in when Accepted)_

## Context

PRD FR-05 requires a governed Ask surface. PRD §9 lists the model decision as
unresolved, and `AskModeSchema` in `packages/contracts/src/ask.ts` is currently
`z.literal('deterministic')` — there is no model in the product at all today.

The constraints are not negotiable and they come from three places:

- **RULES.md / AGENTS.md:** no invented numbers, no fabricated confidence, no
  invented policy citations, no arbitrary SQL, **no browser-side model secret**.
- **ADR 0005 §2:** an out-of-scope Ask returns HTTP 200 with outcome
  `out_of_scope`, because FR-05 requires the Evidence Card to carry the scope and
  limitations disclosure. An HTTP error would destroy that disclosure.
- **PRD FR-05:** every answer is evidence-backed, with definition basis, period,
  scope, limitations and relevant records.

Two providers were nominated: Groq primary, OpenRouter fallback.

## 1. What the model is allowed to do — the load-bearing decision

**The model narrates. It does not retrieve, compute, select, or cite.**

The deterministic pipeline that exists today keeps doing all of the work that
carries authority:

| Concern | Owner | Why not the model |
|---|---|---|
| Authorization, scope, entitlement | `plugins/scope.ts` | A model must never be in an authorization path |
| Which records are relevant | `modules/ask/catalogue.ts` | Record selection is a scope decision |
| Every number | observations | A generated number is a fabricated number |
| Definition basis, governance rules | `@orbit/kpi-framework` | A generated citation is a fabricated citation |
| Period, data quality, disclosure | dataset + contracts | Provenance must be mechanical |

The model receives an **already-built, already-authorized Evidence Card** and may
rewrite one field: the prose `answer`. That is the entire surface.

This inverts the usual RAG shape on purpose. The normal design — let the model
choose what to fetch and summarise — cannot satisfy "no invented numbers" by
construction, only by hope. Narrating a finished card can.

### The invariant that makes it enforceable

**A narrated answer may not contain a numeric token that is not already present
in the deterministic card.** This is mechanically checkable: extract the numeric
tokens from the model's output, extract them from the card, and reject the
narration if the output introduces one.

This is the difference between a policy and a control. "We told the model not to
invent figures" is a policy. Refusing output that contains a figure the card does
not is a control. If the check fails, the deterministic answer is served and the
failure is logged — the user gets a correct answer, not an error.

## 2. Providers, with model IDs verified against the vendor docs

Researched 2026-09-24 against the official documentation, because the commonly
cited model IDs are wrong now.

### Groq — primary

- Base URL `https://api.groq.com/openai/v1`, OpenAI-compatible.
  `Authorization: Bearer $GROQ_API_KEY`.
- **`llama-3.3-70b-versatile` and `llama-3.1-8b-instant` are Enterprise /
  Contact Sales**, per [Groq's own models
  page](https://console.groq.com/docs/models). Most tutorials still name them.
  They are not available on a standard key, and Groq's *own* JSON-mode example
  still uses one — so the docs contradict the catalogue on the same site.
- Generally available production chat models are **`openai/gpt-oss-20b`** and
  **`openai/gpt-oss-120b`** (131,072 context).
- **Chosen: `openai/gpt-oss-20b`.** Narration is a small task, this is the
  cheapest production model that supports the guarantee in the next point, and
  120b is a one-line change if quality is short.

### Structured Outputs with `strict: true` is the reason Groq is primary

Per [Groq's structured-outputs
doc](https://console.groq.com/docs/structured-outputs), `strict: true` uses
**constrained decoding** and *guarantees* schema-compliant output. Supported on
`openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`.

Requirements, which shape our schema: every property must be listed in
`required`, every object needs `additionalProperties: false`, and optional fields
must be expressed as a union with `null`. Supported subset: primitives, object,
array, enum, `anyOf`, `$defs`/`$ref`.

### OpenRouter — fallback, with a weaker guarantee stated plainly

- `https://openrouter.ai/api/v1/chat/completions`, also OpenAI-compatible,
  `Authorization: Bearer $OPENROUTER_API_KEY`. The `HTTP-Referer` and `X-Title`
  headers are **optional** (leaderboard attribution only) and we will not send
  them — they leak deployment information for no benefit.
- **Structured output support is per *endpoint*, not per model.** The same model
  served by different providers may or may not support it, and support changes
  over time.
- [OpenRouter's own
  doc](https://openrouter.ai/docs/guides/features/structured-outputs) says of
  `strict: true` that enforcement varies by provider — some guarantee conformance,
  others translate the schema into their own format or **treat it as a strong
  hint, so exact compliance is not guaranteed on every endpoint**.
- Mitigation: send `provider: { require_parameters: true }` so OpenRouter only
  routes to endpoints that actually support `response_format`.

**Consequence, and it is the reason this section exists:** the fallback cannot be
trusted to honour the schema. So **both paths parse the response through the same
Zod schema and both enforce the numeric-token invariant.** The Groq guarantee is
a latency and reliability optimisation, never a licence to skip validation. A
"guaranteed" provider response is still parsed at the boundary, as everything
else in this repository is.

## 3. When to fail over — and when not to

Failover is not "retry on any error". Per [OpenRouter's error
reference](https://openrouter.ai/docs/api_reference/errors-and-debugging) and
Groq's OpenAI-compatible codes:

| Status | Meaning | Fail over? |
|---|---|---|
| 429 | Rate limited | **Yes**, honour `Retry-After` |
| 408 | Timeout | **Yes** |
| 502 | Model down / invalid upstream response | **Yes** |
| 503 | No provider meets routing requirements | **Yes** |
| network / DNS / socket | Provider unreachable | **Yes** |
| 400 | Our request is malformed | **No** |
| 401 | Bad or disabled key | **No** |
| 402 | Out of credits | **No** |
| 403 | Moderation or guardrail block | **No** |

The three "no" cases matter more than the yes cases:

- **400 is our bug.** A malformed schema fails identically on the fallback, so
  failing over doubles the latency and hides the defect behind an intermittent
  symptom. It should surface immediately.
- **401/402 is a configuration or billing fact.** Retrying on a different
  provider converts a clear "your key is wrong" into a confusing partial outage.
- **403 is a decision, not an outage.** Shopping a moderation block to a second
  provider is trying to get a different answer to the same question. If content
  is blocked, the deterministic answer is served.

**When both providers fail, Ask does not error.** It serves the deterministic
answer with `mode: 'deterministic'`. Narration is an enhancement; losing it must
never lose the answer. Combined with §1 this means the model is never on the
critical path — a property worth keeping even when it is tempting to give the
model more to do.

## 4. Secrets and where the model runs

- **Server only.** `GROQ_API_KEY` and `OPENROUTER_API_KEY` live in the API
  environment and are read solely by `services/api/src/config.ts`, which is
  already the only module that touches `process.env`.
- **Never `VITE_*`.** Vite inlines `VITE_*` into the browser bundle, so a model
  key in one is a published key. This is not hypothetical: earlier today
  `VITE_SUPABASE_PUBLISHABLE_KEY` was found sitting in `services/api/.env`, the
  wrong file in the other direction. The bundle is grepped for both key names as
  part of verification.
- **Off by default.** Absent keys mean Ask stays fully deterministic. No
  behaviour changes until a key is present, so a missing key degrades rather than
  breaks.
- **No prompt contains a credential, connection string, or another tenant's
  data.** The model receives one card, for one caller, already scoped.
- **Prompt input is untrusted.** A guided prompt is selected from a typed
  catalogue, so there is no free-text path to the model in this design. If free
  text is ever added, that is a new decision and this ADR does not authorize it.

### Credential hygiene, recorded because it happened

Both keys were first shared by pasting them into a chat transcript. They are
compromised by that act and must be rotated before use, and this ADR should not
be read as approving the keys that were pasted. The handover rule in ADR 0013 §2
applies: out of band, never in a message body. This is the third credential
exposure in this project, which is why ADR 0001 remains open.

## 5. Contract change — NOT yet implemented

`AskModeSchema` is `z.literal('deterministic')`. Narration needs a second value
so the UI can be honest about which answers were machine-worded:

```ts
export const AskModeSchema = z.enum(['deterministic', 'assisted']);
```

`assisted` means: every number, record, citation and disclosure is deterministic;
only the prose wording was model-generated. Ayas should surface that distinction
on the card rather than leave it invisible — a user who cannot tell which words
came from a model cannot calibrate trust in them.

This is a contracts change and therefore needs Ghansham and Ayas. **It is
deliberately not part of the first implementation**, which adds the provider
client and its tests only, so the client can be reviewed and tested without
touching a shared contract or the Ask response shape.

## Alternatives considered

- **OpenRouter as primary.** Rejected. Its own documentation says schema
  enforcement varies by endpoint, and "select a provider that happens to enforce
  today" is not a foundation. Groq's constrained decoding is a stated guarantee
  on a named model.
- **Groq only, no fallback.** Rejected. A single provider on a free tier with a
  daily token ceiling will be unavailable at some point, and Ask is a
  demonstration surface.
- **Let the model choose records or write SQL.** Rejected outright — forbidden by
  RULES.md, and it makes "no invented numbers" unenforceable.
- **Let the model produce the numbers and check them afterwards.** Rejected. If
  the check fails there is nothing to fall back to, and it invites relaxing the
  check under deadline. Narrating a finished card cannot fail that way.
- **A model-provider SDK (`groq-sdk`, `openai`).** Rejected for now. Both APIs
  are one `fetch` to an OpenAI-compatible endpoint, and a dependency that exists
  to build a JSON body is not worth the supply-chain surface. Revisit if
  streaming or tool use is ever needed.
- **Adding `confidence` to the card.** Rejected. A model's self-reported
  confidence is not a measurement, and RULES.md names fabricated confidence
  specifically.

## Consequences

- Ask keeps working with no keys configured, which is the current state.
- The model can never change a number, a record, a citation or a scope. The worst
  a compromised or misbehaving provider can do is produce prose that fails
  validation and gets discarded.
- The numeric-token invariant needs the card's numbers in a comparable form; the
  check is conservative by design, and a false positive costs a narration, not an
  answer.
- Latency: one extra network hop on Ask, or two when failing over. Acceptable for
  a non-blocking enhancement; a timeout serves the deterministic answer.

## Open questions

- Which model, exactly, for the OpenRouter fallback. Left unset on purpose: it
  should be chosen against the models page with `structured_outputs` confirmed
  for the specific endpoint at the time of configuration, not pinned here from
  documentation I cannot verify per-endpoint today.
- Whether narration is worth it at all once the deterministic answers are
  visible with real data. It may not be. This ADR authorizes the mechanism; it
  does not commit to shipping the feature.

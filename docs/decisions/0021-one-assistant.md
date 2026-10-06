# ADR 0021: One assistant instead of "Ask Orbit" and "Chatbot"

**Status:** Accepted (2026-10-06, product owner)
**Builds on:** ADR 0014 (Ask model providers), ADR 0019 (knowledge chatbot)

## Context

Every workspace page had two floating buttons in the same corner: **Ask Orbit** (typed, evidence-backed KPI answers with guided questions) and **Chatbot** (knowledge search over the hospital datasets, KPIs, exceptions and operations). Users had to guess which one to use, and the two panels looked and behaved differently. The product owner asked for one assistant that keeps role-based answers.

Testing the merge found a defect in the chatbot that predates it. The North COO asked "Show me the south region revenue" and got North figures, presented as "sources found in your scope". Search can only return what the role may read, so a question about a place outside the scope was quietly answered with something similar inside it. Orbit never narrows a request silently: `out_of_scope` is an explicit result.

## Decisions

### §1 One launcher, one panel

The **Assistant** button opens the **Orbit Assistant** panel (`apps/web/src/features/ask/chat.tsx`). The separate chatbot panel and its stylesheet are removed. The header names the verified role. The full Ask page and the "Ask about this" links on cards are unchanged; the panel links to the Ask page ("Open Ask").

### §2 Where a question goes

- A **suggested question** (the caller's own guided prompts) goes to Ask: a typed evidence card with its tables and "Record an action from this".
- A **typed question** goes to the knowledge search first (`POST /api/chatbot`). If that finds nothing the role may read, the same question goes to Ask's interpreter (`POST /api/ask/question`). Its card is shown when it answered, or when it says the question is out of scope. Otherwise the knowledge search's "nothing available to your role" stands.

Both calls are authorized on the server against the verified membership. The routing (`apps/web/src/features/chatbot/action.ts`) only picks which answer to show; it cannot widen what a role sees.

### §3 Questions about a place outside the scope are refused, not narrowed

`POST /api/chatbot` now checks the places a question names before searching (`services/api/src/modules/chatbot/places.ts`): a word before "region", "hospital", "facility" or "centre", and direction words (north, southern…). Generic words ("my region", "which hospital", "the reference hospital") are ignored. If a named place matches none of the caller's own visible entities, the answer is `coverage: "out_of_scope"`. Nothing is searched, no model is called, and the answer says so. The check only compares the question with the caller's own entity names, so it never confirms whether something outside the scope exists. `ChatbotResponse.coverage` gains `out_of_scope` (`packages/contracts`).

## Verification (2026-10-06)

- `@orbit/contracts` 61 tests, `@orbit/api` 439 tests, `apps/web` 122 tests pass; typecheck clean; no new lint warnings. New tests cover the place check (in scope, out of scope, generic words, "least" is not "east"), the route (out of scope searches nothing and calls no model), and the single launcher.
- Browser (local, Edge), four roles: one launcher; the header names the role; a suggested question gives an evidence card with a table; a typed question gives a cited answer. The North COO's "south region" question gives **Out of scope**, and the CFO's staffing question gives "Nothing found for your role". axe finds no violations on the open panel, and there are no console errors.

## Limits

- The place check reads words, not meaning. A place named some other way (a nickname, a misspelling) is not caught, and then search still returns only in-scope data.
- Plain-words comparisons ("did revenue go up since July?") are answered best on the full Ask page. In the Assistant they reach the knowledge search first, which holds the latest reading rather than the history.

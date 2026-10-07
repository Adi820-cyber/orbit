# Orbit handover pack

Written on 2026-10-07, when Orbit is live and built by one person (Ghansham, GitHub `ghanshamrna27`).

| File | Who it is for | What it holds |
|---|---|---|
| [PROJECT_BRIEF.md](PROJECT_BRIEF.md) | Anyone you want to show the project to: a friend, a reviewer, an interviewer | What Orbit is, what it does, how it is built, and where to see it. Safe to share. |
| [HANDBOOK.md](HANDBOOK.md) | Whoever runs or changes Orbit | Live addresses, accounts, the systems behind them, how to develop, test, release and operate, and the open items |
| [AI_CONTEXT.md](AI_CONTEXT.md) | An AI coding agent, or you, picking the work up later | Working rules, the traps already hit and how they were solved, the current state, and what to do next |

**No secret is written in any of these files.** Passwords, keys and connection strings live only in:

- Vercel project settings;
- GitHub Actions secrets;
- local `.env` files, which Git ignores.

The documents name the variable, never the value. Keep it that way. The backup copy of this repository (`ghanshamrna27-source/Pragyan`) is **public**, so anything committed here is published.

The deeper references remain:

- [`docs/orbit/`](../orbit/): the PRD, architecture, deployment, demo runbook and ERP plan;
- [`docs/decisions/`](../decisions/): ADRs 0001 to 0023, one per decision.

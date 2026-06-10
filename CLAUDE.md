# CLAUDE.md

## Project

Personal zero-based budgeting web app (YNAB-style). Single user, manual entry only, deployed on Vercel. The full product spec lives in **docs/PRD.md — read it before any feature work.** Build milestones are PRD §10; work on exactly one milestone per session unless told otherwise.

## Commands

- `npm run dev` — local dev server
- `npm run build` — production build (must pass before any milestone is "done")
- `npm run test` / `npm run test:watch` — Vitest (engine + unit tests)
- `npm run test:e2e` — Playwright
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint`
- `npm run db:generate` / `db:migrate` / `db:seed` / `db:studio` — Drizzle Kit

(Create any of these scripts if they don't exist yet.)

## Stack

Next.js App Router + TypeScript (strict mode), Tailwind + shadcn/ui, Drizzle ORM + Neon Postgres (`DATABASE_URL`), server actions for all mutations, Zod validation at every boundary, Recharts, date-fns, Vitest, Playwright.

## Architecture

- `lib/engine/` — **pure budget math.** No React, no DB, no I/O imports. Functions take plain data (transactions, assignments, accounts, categories, month) and return computed state. Everything in here must have unit tests.
- `lib/db/` — Drizzle schema (mirrors PRD §9 exactly) + query helpers.
- `app/` — routes and layouts; mutations live in server actions under `app/actions/`.
- `components/` — UI components; shadcn primitives in `components/ui/`.
- Auth: middleware password gate against `APP_PASSWORD` env var, signed httpOnly cookie. No signup, no user table.

## Iron rules

1. **Money is integer milliunits** (`bigint`): $1.00 = `1000`, outflows negative. Never floats, never decimals in engine/DB/actions. Format currency only at the UI edge.
2. **Activity, Available, and Ready to Assign are derived — never stored.** Always recompute from transactions + assignments per PRD §4. Do not "fix" numbers by mutating stored values.
3. **Engine changes are test-first.** Update/add Vitest cases (PRD §12 list + the §4 invariant as a property test) before touching engine code.
4. **Transfers are linked pairs.** Any create/edit/delete must keep both sides consistent in one DB transaction.
5. Months are always `date` values normalized to the first of the month (`YYYY-MM-01`).
6. Validate every server-action input with Zod; never trust client values.
7. Don't add dependencies without asking. Don't edit already-applied migration files — create new migrations.
8. Split-transaction subtransaction amounts must sum exactly to the parent amount (enforce in the action).

## Workflow

- Enter plan mode for any multi-file change; show the plan before writing code.
- Definition of done per milestone: `typecheck`, `lint`, `test`, and `build` all pass, plus a manual check note telling me what to click in `npm run dev`.
- Small commits, conventional messages (`feat:`, `fix:`, `test:`, `chore:`), one milestone per branch is fine but committing to `main` is acceptable for this solo project.
- If the PRD is ambiguous, ask before inventing behavior — the budget math must match PRD §4 exactly.

# Personal Budget App — PRD & Data Model

A single-user, manual-entry budgeting web app implementing the zero-based ("envelope") budgeting method popularized by YNAB. Built with Next.js, deployed on Vercel. This document is the source of truth for Claude Code — reference it from CLAUDE.md.

## 1. Goals

Replicate the core YNAB workflow for one person: assign every dollar a job, track spending against categories by month, handle credit cards correctly, and report on spending and net worth. All data is entered manually. Speed of entry and correctness of the budget math matter more than visual polish.

## 2. Non-Goals

No bank sync or transaction import (v1), no multi-user or sharing, no multi-currency, no native mobile apps (responsive web is enough), no AI features, no email/notifications.

## 3. Money Representation (non-negotiable)

All monetary amounts are stored and computed as **integer milliunits**: $1.00 = `1000`. Outflows are negative, inflows positive. No floats anywhere in the engine, database, or API. Format for display only at the UI edge.

## 4. Core Domain Concepts

**Accounts.** Two classes:
- *Budget (on-budget) accounts*: `checking`, `savings`, `cash`, `credit_card`. Their transactions participate in the budget.
- *Tracking (off-budget) accounts*: `tracking_asset`, `tracking_liability` (investments, mortgage, car value). Only affect net worth. Transactions in tracking accounts are never categorized; transfers from a budget account to a tracking account ARE categorized (they're money leaving the budget).

**Categories.** User-defined categories organized into category groups, ordered by `sort_order`, hideable. Two system-managed groups exist:
- `Credit Card Payments` — contains one auto-created payment category per credit card account (linked via `categories.linked_account_id`). Created when a CC account is created; hidden when the account is closed.
- `Internal` — contains the system category `Ready to Assign`. All income is categorized to this category. It never appears in the budget grid; it feeds the RTA pool. (Using a real category row avoids overloading `category_id = NULL`, which is reserved for transfers and split parents.)

**Monthly budget.** For each (category, month), the user sets **Assigned**. **Activity** and **Available** are *derived, never stored*:

```
activity(c, m)  = Σ amounts of transactions + subtransactions in category c dated within m
available(c, m) = carryover(c, m) + assigned(c, m) + activity(c, m)
```

**Rollover & overspending rules.** Let, for category c in month m (treating spends as positive numbers):

```
A             = carryover(c, m) + assigned(c, m)   // available before spending
S_cash        = net cash-account outflow in c, m
S_credit      = net credit-card-account outflow in c, m
S_credit_pos  = max(S_credit, 0)                   // a net card-refund month has no credit spend to classify
available_end = A − S_cash − S_credit
```

- `carryover(c, m+1) = max(available_end, 0)` — positive balances roll forward; negatives never roll forward inside the category.
- If `available_end < 0`, classify the shortfall:
  - `funded_credit = clamp(A − S_cash, 0, S_credit_pos)`
  - `credit_overspent = S_credit_pos − funded_credit` (becomes card debt; no further effect)
  - `cash_overspent = (−available_end) − credit_overspent`
- All `cash_overspent` from months **before** the current month is subtracted from Ready to Assign (the money is gone, so it comes out of the unassigned pool).
- `credit_overspent` (the unfunded slice) leaves the budget as untracked card debt; the funded slice is reserved on the card's payment category (see below).

**Credit card mechanics.** When you spend on a credit card from a funded category, the cash you'd set aside must be reserved to pay the card:

- Per (category, month), the amount moved to payment categories is `S_credit − credit_overspent` (the funded slice; equals `funded_credit` for a normal net-spend month, and `S_credit` itself — negative — in a net-refund month). It is split across the cards that posted to that category: a net-refund card reverses in full (negative move, pulling its refund back out of its payment category), and the remainder funds the net-spend cards greedily in account order, capped at each card's spend. With a single card this is just "the funded slice lands on that card's payment category"; unfunded spending moves nothing (overspending → debt).
- Payments to the card are transfers `cash account → CC account`; the payment amount is negative activity on the card's payment category. The same routing covers card→card (balance transfer) and card→cash (cash advance): any transfer leg whose counterpart is a credit card posts its amount to that card's payment category.
- A categorized inflow to **Ready to Assign on a card** (cash-back, a refund booked to income) raises RTA though no cash moved, so it mirrors `−amount` onto that card's payment category to keep the books balanced.
- The payment category's Available = money reserved to pay that card. It carries no credit side of its own, so paying more than is reserved drives it negative and that shortfall is treated as `cash_overspent` (real cash left; it docks RTA next month). Refunds on the card naturally reverse the move because the rule operates on *net* spending per month.
- Pre-existing card debt: user assigns money directly to the payment category.

**Ready to Assign (single global number, modern-YNAB style).**

```
RTA = Σ inflows categorized to "Ready to Assign" (all on-budget accounts, all time)
    − Σ assigned across ALL months (past and future)
    − Σ cash_overspent across all months before the current month
```

**Engine invariant (must hold; property-test it):**

```
Σ balances of cash accounts (checking + savings + cash)
  = RTA + Σ available(c, current month) over all categories
         (including CC payment categories, including in-month negatives)
```

Holds exactly in any month with no fresh unfunded card spending. In a month
that *does* have unfunded card spending the cash side is short by that month's
`Σ credit_overspent` (the cash never left, and next month's carryover clamp
drops the negative from `available`), so the identity is
`Σ cash = RTA + Σ available + Σ credit_overspent(current month)` and reduces to
the form above once the month has passed. Property-test both: the residual form
every month, and the verbatim form at months after the last data point.

**Implementation note:** build the engine as pure TypeScript functions in `lib/engine/` that take `(transactions, assignments, accounts, categories, month)` and return computed state. No SQL-side math beyond simple sums. Months compute sequentially from the earliest transaction (carryover is recursive). Cache per-month results if needed later; correctness first.

## 5. Transactions

Fields: account, date, payee, category, memo, amount, cleared status (`uncleared → cleared → reconciled`), optional flag color.

- **Transfers**: a linked pair of transactions (mirrored amounts) referencing each other via `transfer_transaction_id`. Between two on-budget accounts: no category. Budget → tracking: categorized on the budget side. Editing/deleting one side updates/deletes the other.
- **Splits**: parent transaction has `category_id = NULL` and one or more rows in `subtransactions`; sub-amounts must sum to the parent amount (enforce in app layer).
- **Payees**: free-text creates/reuses a payee row; remember each payee's last category for auto-fill. Transfer payees are system rows linked to an account.
- **Scheduled transactions**: template + frequency (`weekly`, `every_other_week`, `monthly`, `twice_a_month`, `yearly`); a due scheduled transaction is shown in the register for one-click "enter now". (A Vercel Cron job may auto-enter ones marked automatic — v2.)
- **Reconciliation flow**: user enters the real account balance → app compares against cleared balance → user toggles cleared on items → if a difference remains, create a "Reconciliation Balance Adjustment" transaction categorized to Ready to Assign → lock all cleared items as `reconciled`.

## 6. Targets (per category, optional)

| Type | Stored | Underfunded shown in month m |
|---|---|---|
| `monthly_funding` | amount | `max(amount − assigned(m), 0)` |
| `target_balance` | amount | `max(amount − available(m), 0)` |
| `target_balance_by_date` | amount, target month | `max(ceil((amount − available_at_month_start) / months_remaining) − assigned(m), 0)` |

"Assign Underfunded" quick action fills all underfunded amounts from RTA in one click.

## 7. Screens

**Budget (home).** Month switcher (← Month →). RTA banner (green > 0, red < 0, gray = 0) with an Assign popover: **Manually** tab (default — amount input pre-filled with the full RTA amount, to-category dropdown grouped by category group showing each category's current Available) and **Auto** tab (Underfunded, Assigned Last Month, Spent Last Month, Reset to 0). Grid grouped by category group: Category | Assigned (inline-editable) | Activity (click → that month's transactions) | Available (pill: green positive / yellow credit-overspent / red cash-overspent / gray zero). Categories with a target show a thin progress bar under the name (assigned ÷ monthly need) labeled "Funded" or "$X more needed"; group rows have no bars. Clicking an Available pill opens **Move Money** (take from here / cover overspending from another category). Row click opens a side panel: notes, target editing, recent activity. Add/edit/reorder/hide groups and categories inline.

**Accounts & Register.** Sidebar lists Budget accounts and Tracking accounts with balances and a net-total. Register per account (and an "All Accounts" view): table of transactions, inline add/edit row at top, keyboard-friendly (Enter saves, Esc cancels, date defaults to today, payee autocompletes and pre-fills last category). Columns: Date, Payee, Category, Memo, Outflow, Inflow, Cleared (clickable ✓). Search box + filters (date range, category, payee, uncleared). Bulk select → delete / change category / mark cleared. Reconcile button runs the flow in §5. Cleared vs. uncleared vs. working balance shown in header.

**Reports.**
- *Spending*: pie/bar by category or payee over a date range with month-by-month trend line.
- *Net worth*: monthly stacked assets vs. debts and net line, across ALL accounts including tracking.
- *Income vs. Expense*: monthly table of income (RTA inflows) vs. spending by category group, with totals.

**Settings.** Budget name, currency symbol, first month; manage payees (merge/rename); export full data as JSON/CSV; "Fresh Start" (archive and re-seed).

**Auth.** Single user. A middleware password gate: compare against `APP_PASSWORD` env var, set a signed httpOnly session cookie (or Auth.js Credentials with one env-defined user). All routes protected; no public signup.

## 8. Tech Stack

Next.js (App Router) + TypeScript, Tailwind + shadcn/ui, Neon Postgres via Drizzle ORM, server actions for all mutations, Zod validation at every boundary, Recharts for reports, date-fns for dates, Vitest for the engine, Playwright for a few happy-path E2Es. Deployed on Vercel (preview deploys per PR, `main` → production). Engine code never imports React or DB — pure functions only.

## 9. Database Schema (Postgres DDL)

```sql
CREATE TABLE budgets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  currency      text NOT NULL DEFAULT 'USD',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id     uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  name          text NOT NULL,
  type          text NOT NULL CHECK (type IN
                  ('checking','savings','cash','credit_card',
                   'tracking_asset','tracking_liability')),
  on_budget     boolean NOT NULL,            -- derived from type at creation
  note          text,
  closed        boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payees (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id           uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  name                text NOT NULL,
  transfer_account_id uuid REFERENCES accounts(id),  -- non-null = system transfer payee
  UNIQUE (budget_id, name)
);

CREATE TABLE category_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id   uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  name        text NOT NULL,
  is_system   boolean NOT NULL DEFAULT false, -- 'Credit Card Payments', 'Internal'
  hidden      boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0
);

CREATE TABLE categories (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id          uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  group_id           uuid NOT NULL REFERENCES category_groups(id) ON DELETE CASCADE,
  name               text NOT NULL,
  note               text,
  hidden             boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 0,
  linked_account_id  uuid REFERENCES accounts(id),  -- set for CC payment categories
  is_system          boolean NOT NULL DEFAULT false, -- 'Ready to Assign'
  goal_type          text CHECK (goal_type IN
                       ('monthly_funding','target_balance','target_balance_by_date')),
  goal_amount        bigint,                         -- milliunits
  goal_target_month  date                            -- first of month
);

-- One row per (category, month) the user has touched; missing row = assigned 0.
CREATE TABLE category_months (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month        date NOT NULL,            -- always YYYY-MM-01
  assigned     bigint NOT NULL DEFAULT 0,
  UNIQUE (category_id, month)
);

CREATE TABLE transactions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id               uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  account_id              uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date                    date NOT NULL,
  amount                  bigint NOT NULL,          -- milliunits, outflow negative
  payee_id                uuid REFERENCES payees(id),
  category_id             uuid REFERENCES categories(id),
    -- NULL when: split parent, transfer between on-budget accounts,
    -- or any tracking-account transaction
  memo                    text,
  cleared                 text NOT NULL DEFAULT 'uncleared'
                            CHECK (cleared IN ('uncleared','cleared','reconciled')),
  flag                    text,
  transfer_account_id     uuid REFERENCES accounts(id),
  transfer_transaction_id uuid REFERENCES transactions(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_txn_account_date  ON transactions (account_id, date);
CREATE INDEX idx_txn_category_date ON transactions (category_id, date);
CREATE INDEX idx_txn_budget_date   ON transactions (budget_id, date);

CREATE TABLE subtransactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  amount       bigint NOT NULL,
  category_id  uuid REFERENCES categories(id),
  memo         text
);

CREATE TABLE scheduled_transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id    uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  frequency    text NOT NULL CHECK (frequency IN
                 ('weekly','every_other_week','twice_a_month','monthly','yearly')),
  next_date    date NOT NULL,
  amount       bigint NOT NULL,
  payee_id     uuid REFERENCES payees(id),
  category_id  uuid REFERENCES categories(id),
  memo         text
);
```

**Seed on first run:** one budget; `Internal` group with system category `Ready to Assign`; `Credit Card Payments` group (empty); a starter set of normal groups/categories (Bills: Rent, Electric, Internet, Phone; Needs: Groceries, Transportation, Medical; Wants: Dining Out, Fun Money, Subscriptions; Savings: Emergency Fund, Vacation). Creating an account with a starting balance creates a "Starting Balance" transaction (categorized to Ready to Assign for cash accounts; uncategorized debt for credit cards; uncategorized for tracking).

## 10. Build Milestones (one Claude Code session each)

1. Scaffold, Drizzle setup, schema migration, seed script, password gate.
2. Accounts CRUD + transaction register (add/edit/delete, cleared toggle, payee autocomplete, search/filter).
3. Budget engine v1 (cash only): assigned editing, activity, available, carryover, RTA — **write Vitest property tests for the §4 invariant before UI**.
4. Overspending classification + month rollover edge cases (tests first).
5. Credit cards: auto payment categories, funded-portion move, payments as transfers, debt display.
6. Transfers, splits, reconciliation flow.
7. Budget screen polish: move money, targets + underfunded, quick-assign actions.
8. Reports (all three).
9. Scheduled transactions + "enter now".
10. YNAB historical import (one-time script, run after Milestone 5):
`scripts/import-ynab.ts` reads YNAB's export (Register.csv +
Budget.csv) from a gitignored data/ folder. Maps accounts (with
types), payees, and category groups/categories, creating missing
ones; parses Outflow/Inflow with lib/money string math; maps the
Cleared column to cleared/reconciled; reconstructs transfers by
pairing "Transfer : <Account>" rows (matching date + amount);
rebuilds splits from "Split (n/m)" memo rows into parent +
subtransactions; imports Budget.csv "Budgeted" into
category_months.assigned. Supports wipe-and-reimport (replaces
manually-created starting balances); imports only transactions
dated before a cutoff date passed as an argument. Validation:
recompute Available per category-month and RTA with the engine
and diff against YNAB's exported values, reporting every
mismatch — this doubles as an end-to-end engine test on real
history.

## 11. v2 Backlog

Age of Money (average age, FIFO, of the cash spent in the last 10 cash outflows), CSV export per account, undo/redo, full keyboard navigation, PWA install + offline cache, auto-enter scheduled transactions via Vercel Cron, category notes history, multi-budget support.

## 12. Engine Test Cases Claude Code Must Cover

Assign then spend exactly (available 0); cash overspend rolls into next month's RTA, not the category; credit overspend becomes debt and does NOT credit the payment category; partial-funded credit spend moves only the funded slice; CC refund reverses the move; transfer cash→CC reduces payment category; transfer between cash accounts changes nothing in the budget; future-month assignment reduces RTA today; split transaction activity lands per sub-category; reconciliation adjustment flows through RTA; deleting a transaction restores all derived numbers (everything is recomputed, nothing mutated).

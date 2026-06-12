// Pure budget math per PRD §4 — no React, no DB, no I/O. Plain data in,
// computed state out; everything here is derived, never stored (iron rule 2),
// and callable from scripts (the M10 YNAB replay drives whole histories
// through computeBudget).
//
// Milestone 4 scope: activity is split by account class (credit_card vs
// cash) and each category-month shortfall partitions into fundedCredit /
// creditOverspent / cashOverspent per §4 — only the cash share ever docks
// RTA. M5 (credit card mechanics) adds the payment-category moves on top:
// fundedCredit is computed here but not yet re-reserved anywhere.

export type EngineAccountType =
  | "checking"
  | "savings"
  | "cash"
  | "credit_card"
  | "tracking_asset"
  | "tracking_liability";

export interface EngineAccount {
  id: string;
  type: EngineAccountType;
  onBudget: boolean;
}

export interface EngineCategory {
  id: string;
  /** The system "Ready to Assign" category: its flows are income, and it
   *  never appears as a budget row. */
  isReadyToAssign: boolean;
}

/** One (category, month) row the user has touched; months are YYYY-MM-01. */
export interface EngineAssignment {
  categoryId: string;
  month: string;
  assigned: bigint;
}

export interface EngineSubtransaction {
  amount: bigint;
  categoryId: string | null;
}

export interface EngineTransaction {
  accountId: string;
  date: string; // yyyy-MM-dd
  amount: bigint; // milliunits, outflows negative
  categoryId: string | null; // null: transfer side or split parent
  /** Split children. When present they replace the parent for category
   *  math (the parent's categoryId is null per the schema). */
  subtransactions?: readonly EngineSubtransaction[];
}

export interface BudgetInput {
  accounts: readonly EngineAccount[];
  categories: readonly EngineCategory[];
  /** Unique per (categoryId, month), like the category_months table. */
  assignments: readonly EngineAssignment[];
  transactions: readonly EngineTransaction[];
}

export interface CategoryMonthState {
  assigned: bigint;
  activity: bigint;
  carryover: bigint;
  available: bigint; // carryover + assigned + activity
  /** Funded slice of this month's net card spending,
   *  clamp(carryover + assigned − S_cash, 0, max(S_credit, 0)). Nonzero even
   *  when the category isn't overspent — it's the amount M5 moves to the
   *  card's payment category. */
  fundedCredit: bigint;
  /** Unfunded card spending: becomes card debt and never docks RTA. */
  creditOverspent: bigint;
  /** Cash share of the shortfall, max(−available, 0) − creditOverspent.
   *  Subtracted from RTA in every month after this one. */
  cashOverspent: bigint;
}

export interface MonthState {
  month: string;
  /** Keyed by category id; the RTA category is never included. */
  categories: Map<string, CategoryMonthState>;
  /** RTA as of this month being the current month: income (all time)
   *  − assigned (all months, past and future) − cash overspending from
   *  months strictly before this one. A single global number — the UI
   *  shows it for today's month regardless of the month being viewed. */
  readyToAssign: bigint;
}

// ---------------------------------------------------------------------------
// Month arithmetic on YYYY-MM-01 strings (string math only — no Date, no TZ).
// ---------------------------------------------------------------------------

export function monthOfDate(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(m + 1).padStart(2, "0")}-01`;
}

export function prevMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1
    ? `${year - 1}-12-01`
    : `${year}-${String(m - 1).padStart(2, "0")}-01`;
}

// ---------------------------------------------------------------------------
// Walker
// ---------------------------------------------------------------------------

/** Per-category amounts for one month, accumulated into `into`. */
function clamp(value: bigint, lo: bigint, hi: bigint): bigint {
  return value < lo ? lo : value > hi ? hi : value;
}

function accumulate(
  into: Map<string, Map<string, bigint>>,
  month: string,
  categoryId: string,
  amount: bigint,
): void {
  let byCategory = into.get(month);
  if (!byCategory) {
    byCategory = new Map();
    into.set(month, byCategory);
  }
  byCategory.set(categoryId, (byCategory.get(categoryId) ?? 0n) + amount);
}

/**
 * Compute every month from the earliest transaction/assignment through
 * `throughMonth` (carryover is recursive, so months always compute
 * sequentially from the start of history). If `throughMonth` precedes all
 * data, only that month is returned (all zeros plus the global RTA).
 */
export function computeBudget(
  input: BudgetInput,
  throughMonth: string,
): Map<string, MonthState> {
  const onBudgetAccounts = new Set(
    input.accounts.filter((a) => a.onBudget).map((a) => a.id),
  );
  const creditAccounts = new Set(
    input.accounts
      .filter((a) => a.onBudget && a.type === "credit_card")
      .map((a) => a.id),
  );
  const rtaCategories = new Set(
    input.categories.filter((c) => c.isReadyToAssign).map((c) => c.id),
  );
  const budgetCategories = input.categories.filter((c) => !c.isReadyToAssign);
  const knownCategories = new Set(budgetCategories.map((c) => c.id));

  // Index activity per (month, category), split by account class so §4 can
  // classify shortfalls; RTA-categorized flows are income wherever they land
  // (card cash-back counts too). Transactions on tracking accounts never
  // touch the budget; postings to unknown categories are ignored defensively
  // (FKs prevent them upstream).
  let incomeAllTime = 0n;
  const cashActivity = new Map<string, Map<string, bigint>>();
  const creditActivity = new Map<string, Map<string, bigint>>();
  let earliest: string | null = null;

  for (const txn of input.transactions) {
    if (!onBudgetAccounts.has(txn.accountId)) continue;
    const into = creditAccounts.has(txn.accountId)
      ? creditActivity
      : cashActivity;
    const month = monthOfDate(txn.date);
    if (earliest === null || month < earliest) earliest = month;
    const postings =
      txn.subtransactions !== undefined && txn.subtransactions.length > 0
        ? txn.subtransactions
        : [{ amount: txn.amount, categoryId: txn.categoryId }];
    for (const posting of postings) {
      if (posting.categoryId === null) continue;
      if (rtaCategories.has(posting.categoryId)) {
        incomeAllTime += posting.amount;
      } else if (knownCategories.has(posting.categoryId)) {
        accumulate(into, month, posting.categoryId, posting.amount);
      }
    }
  }

  // Assigned per (month, category) plus the all-months total RTA subtracts.
  let assignedAllMonths = 0n;
  const assigned = new Map<string, Map<string, bigint>>();
  for (const row of input.assignments) {
    if (!knownCategories.has(row.categoryId)) continue;
    if (earliest === null || row.month < earliest) earliest = row.month;
    assignedAllMonths += row.assigned;
    accumulate(assigned, row.month, row.categoryId, row.assigned);
  }

  const start = earliest !== null && earliest < throughMonth ? earliest : throughMonth;
  const months = new Map<string, MonthState>();
  const previousAvailable = new Map<string, bigint>();
  let cashOverspentBefore = 0n;

  for (let month = start; month <= throughMonth; month = nextMonth(month)) {
    const categories = new Map<string, CategoryMonthState>();
    let cashOverspentThisMonth = 0n;

    for (const category of budgetCategories) {
      const previous = previousAvailable.get(category.id) ?? 0n;
      const carryover = previous > 0n ? previous : 0n;
      const assignedHere = assigned.get(month)?.get(category.id) ?? 0n;
      const cashHere = cashActivity.get(month)?.get(category.id) ?? 0n;
      const creditHere = creditActivity.get(month)?.get(category.id) ?? 0n;
      const activityHere = cashHere + creditHere;
      const available = carryover + assignedHere + activityHere;

      // §4 classification, spends as positive numbers. Cash spending eats
      // the available-before-spending first; what's left funds card spending;
      // unfunded card spending is debt; any remaining shortfall is cash
      // overspending. A net card refund (S_credit < 0) has nothing to fund,
      // so the whole shortfall classifies cash-side.
      const sCash = -cashHere;
      const sCreditPos = creditHere < 0n ? -creditHere : 0n;
      const fundedCredit = clamp(
        carryover + assignedHere - sCash,
        0n,
        sCreditPos,
      );
      const creditOverspent = sCreditPos - fundedCredit;
      const cashOverspent =
        (available < 0n ? -available : 0n) - creditOverspent;

      categories.set(category.id, {
        assigned: assignedHere,
        activity: activityHere,
        carryover,
        available,
        fundedCredit,
        creditOverspent,
        cashOverspent,
      });
      previousAvailable.set(category.id, available);
      cashOverspentThisMonth += cashOverspent;
    }

    months.set(month, {
      month,
      categories,
      readyToAssign: incomeAllTime - assignedAllMonths - cashOverspentBefore,
    });
    cashOverspentBefore += cashOverspentThisMonth;
  }

  return months;
}

/** State for a single month (see computeBudget for the walk semantics). */
export function computeMonth(input: BudgetInput, month: string): MonthState {
  const state = computeBudget(input, month).get(month);
  if (!state) throw new Error(`computeBudget did not produce ${month}`);
  return state;
}

// Pure budget math per PRD §4 — no React, no DB, no I/O. Plain data in,
// computed state out; everything here is derived, never stored (iron rule 2),
// and callable from scripts (the M10 YNAB replay drives whole histories
// through computeBudget).
//
// Activity is split by account class (credit_card vs cash) and each
// category-month shortfall partitions into fundedCredit / creditOverspent /
// cashOverspent per §4 — only the cash share ever docks RTA. Milestone 5
// re-reserves the funded slice of card spending onto each card's payment
// category (a category with linkedAccountId) and routes card payments and
// card-RTA inflows there too, so the PRD invariant holds in full form:
//   Σ cash balances = RTA + Σ available over all categories (incl. payment).

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
  /** Set for a credit-card payment category — the card account it pays off.
   *  Such a category receives the funded slice of that card's spending and
   *  the card's payments instead of holding raw transaction activity. */
  linkedAccountId?: string | null;
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
  /** The other account of a linked transfer pair. When that account is a
   *  credit card, this (uncategorized) leg is a payment / cash-advance on its
   *  payment category. */
  transferAccountId?: string | null;
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

/** Net credit activity per card within a (month, category), keyed
 *  `month|category` → cardId → amount, for splitting the funded move. */
function accumulateCard(
  into: Map<string, Map<string, bigint>>,
  month: string,
  categoryId: string,
  cardId: string,
  amount: bigint,
): void {
  const key = `${month}|${categoryId}`;
  let byCard = into.get(key);
  if (!byCard) {
    byCard = new Map();
    into.set(key, byCard);
  }
  byCard.set(cardId, (byCard.get(cardId) ?? 0n) + amount);
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
  // Cards in input order — the deterministic order the funded move is split
  // across when several cards posted to one category in a month.
  const orderedCards = input.accounts.filter((a) => creditAccounts.has(a.id));
  const rtaCategories = new Set(
    input.categories.filter((c) => c.isReadyToAssign).map((c) => c.id),
  );

  // Payment categories: linkedAccountId set. Map each card to its payment
  // category (only when the card is a real on-budget credit account).
  const paymentCategoryByCard = new Map<string, string>();
  const paymentCategoryIds = new Set<string>();
  for (const c of input.categories) {
    if (c.linkedAccountId != null) {
      paymentCategoryIds.add(c.id);
      if (creditAccounts.has(c.linkedAccountId)) {
        paymentCategoryByCard.set(c.linkedAccountId, c.id);
      }
    }
  }

  const budgetCategories = input.categories.filter((c) => !c.isReadyToAssign);
  const normalCategories = budgetCategories.filter(
    (c) => !paymentCategoryIds.has(c.id),
  );
  const paymentCategories = budgetCategories.filter((c) =>
    paymentCategoryIds.has(c.id),
  );
  const knownNormal = new Set(normalCategories.map((c) => c.id));
  // Assignments may target any budget category, payment categories included
  // (assigning to a payment category funds pre-existing card debt, §4).
  const knownCategories = new Set(budgetCategories.map((c) => c.id));

  // Index activity per (month, category), split by account class so §4 can
  // classify shortfalls; RTA-categorized flows are income wherever they land.
  // Card payments / cash advances and card cash-back never hold raw category
  // activity — they land on payment categories (paymentSynthActivity).
  // Transactions on tracking accounts never touch the budget; postings to
  // unknown categories are ignored defensively (FKs prevent them upstream).
  let incomeAllTime = 0n;
  const cashActivity = new Map<string, Map<string, bigint>>();
  const creditActivity = new Map<string, Map<string, bigint>>();
  const creditByCard = new Map<string, Map<string, bigint>>();
  const paymentSynthActivity = new Map<string, Map<string, bigint>>();
  let earliest: string | null = null;

  for (const txn of input.transactions) {
    if (!onBudgetAccounts.has(txn.accountId)) continue;
    const month = monthOfDate(txn.date);
    if (earliest === null || month < earliest) earliest = month;

    // An uncategorized transfer leg is a payment INTO the other account when
    // that account is a credit card: cash→card (payment), card→card (balance
    // transfer), card→cash (cash advance). The leg's own amount lands on that
    // card's payment category; cash↔cash legs touch nothing.
    if (txn.transferAccountId != null && txn.categoryId === null) {
      const payCat = paymentCategoryByCard.get(txn.transferAccountId);
      if (payCat) accumulate(paymentSynthActivity, month, payCat, txn.amount);
      continue;
    }

    const isCard = creditAccounts.has(txn.accountId);
    const postings =
      txn.subtransactions !== undefined && txn.subtransactions.length > 0
        ? txn.subtransactions
        : [{ amount: txn.amount, categoryId: txn.categoryId }];
    for (const posting of postings) {
      if (posting.categoryId === null) continue;
      if (rtaCategories.has(posting.categoryId)) {
        incomeAllTime += posting.amount;
        // Income posted on a card (cash-back, a refund booked to RTA) raises
        // RTA though no cash moved; mirror −amount onto the card's payment
        // category so Σ cash = RTA + Σ available still holds.
        if (isCard) {
          const payCat = paymentCategoryByCard.get(txn.accountId);
          if (payCat) {
            accumulate(paymentSynthActivity, month, payCat, -posting.amount);
          }
        }
      } else if (paymentCategoryIds.has(posting.categoryId)) {
        // Defensive: a transaction categorized straight to a payment category
        // (not offered in the UI). Treat it as cash-side activity there.
        accumulate(paymentSynthActivity, month, posting.categoryId, posting.amount);
      } else if (knownNormal.has(posting.categoryId)) {
        if (isCard) {
          accumulate(creditActivity, month, posting.categoryId, posting.amount);
          accumulateCard(
            creditByCard,
            month,
            posting.categoryId,
            txn.accountId,
            posting.amount,
          );
        } else {
          accumulate(cashActivity, month, posting.categoryId, posting.amount);
        }
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
    // Funded slice routed to each payment category this month (built in the
    // normal-category pass, consumed by the payment-category pass).
    const moveActivity = new Map<string, bigint>();

    // Pass 1 — normal categories: §4 classification, then route the funded
    // slice of this month's card spending to the spending card's payment
    // category.
    for (const category of normalCategories) {
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

      // Split the move (= net card spend − creditOverspent) across the cards
      // that posted to this category this month: net-refund cards reverse in
      // full (negative move), the remainder funds the spend cards greedily in
      // account order, capped at each card's spend. Single-card months reduce
      // to "move = fundedCredit" exactly as §4 states.
      const totalMove = -creditHere - creditOverspent;
      const perCard = creditByCard.get(`${month}|${category.id}`);
      if (perCard) {
        let refundSum = 0n;
        for (const card of orderedCards) {
          const sk = -(perCard.get(card.id) ?? 0n);
          if (sk < 0n) refundSum += sk;
        }
        let remainder = totalMove - refundSum;
        for (const card of orderedCards) {
          const sk = -(perCard.get(card.id) ?? 0n);
          let move: bigint;
          if (sk < 0n) {
            move = sk;
          } else if (sk === 0n) {
            continue;
          } else {
            move = remainder < sk ? remainder : sk;
            remainder -= move;
          }
          const payCat = paymentCategoryByCard.get(card.id);
          if (payCat && move !== 0n) {
            moveActivity.set(payCat, (moveActivity.get(payCat) ?? 0n) + move);
          }
        }
      }
    }

    // Pass 2 — payment categories: activity is the funded moves plus payments
    // and card-RTA mirrors. No credit side, so available = carryover +
    // assigned + activity and any shortfall is cash overspending (overpaying
    // a card spends real cash) which docks RTA next month, like §4 cash.
    for (const category of paymentCategories) {
      const previous = previousAvailable.get(category.id) ?? 0n;
      const carryover = previous > 0n ? previous : 0n;
      const assignedHere = assigned.get(month)?.get(category.id) ?? 0n;
      const synth = paymentSynthActivity.get(month)?.get(category.id) ?? 0n;
      const activityHere = synth + (moveActivity.get(category.id) ?? 0n);
      const available = carryover + assignedHere + activityHere;
      const cashOverspent = available < 0n ? -available : 0n;

      categories.set(category.id, {
        assigned: assignedHere,
        activity: activityHere,
        carryover,
        available,
        fundedCredit: 0n,
        creditOverspent: 0n,
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

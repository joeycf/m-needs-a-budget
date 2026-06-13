import { describe, expect, it } from "vitest";

import {
  computeBudget,
  computeMonth,
  monthOfDate,
  nextMonth,
  prevMonth,
  type BudgetInput,
  type EngineAccount,
  type EngineAssignment,
  type EngineCategory,
  type EngineTransaction,
} from "@/lib/engine/budget";

// PRD §4 budget math through Milestone 4: cash core plus overspending
// classification (funded_credit / credit_overspent / cash_overspent). Card
// payment-category mechanics land in M5; the §12 list is the contract.

const CHECKING: EngineAccount = { id: "checking", type: "checking", onBudget: true };
const SAVINGS: EngineAccount = { id: "savings", type: "savings", onBudget: true };
const CARD: EngineAccount = { id: "card", type: "credit_card", onBudget: true };
const CARD2: EngineAccount = { id: "card2", type: "credit_card", onBudget: true };
const BROKERAGE: EngineAccount = {
  id: "brokerage",
  type: "tracking_asset",
  onBudget: false,
};

const RTA: EngineCategory = { id: "rta", isReadyToAssign: true };
const GROCERIES: EngineCategory = { id: "groceries", isReadyToAssign: false };
const RENT: EngineCategory = { id: "rent", isReadyToAssign: false };
const DINING: EngineCategory = { id: "dining", isReadyToAssign: false };
// Auto-created payment categories (M5), linked to a credit card account.
const CARD_PAY: EngineCategory = {
  id: "cardpay",
  isReadyToAssign: false,
  linkedAccountId: "card",
};
const CARD2_PAY: EngineCategory = {
  id: "card2pay",
  isReadyToAssign: false,
  linkedAccountId: "card2",
};

const MAY = "2026-05-01";
const JUNE = "2026-06-01";
const JULY = "2026-07-01";

function makeInput(partial: Partial<BudgetInput> = {}): BudgetInput {
  return {
    accounts: [CHECKING, SAVINGS],
    categories: [RTA, GROCERIES, RENT, DINING],
    assignments: [],
    transactions: [],
    ...partial,
  };
}

function txn(
  accountId: string,
  date: string,
  amount: bigint,
  categoryId: string | null,
): EngineTransaction {
  return { accountId, date, amount, categoryId };
}

function assign(
  categoryId: string,
  month: string,
  assigned: bigint,
): EngineAssignment {
  return { categoryId, month, assigned };
}

/** A linked transfer pair (mirrored amounts, each side naming the other),
 *  `amount` moving from → to. Both legs are uncategorized (PRD §5). */
function transfer(
  from: string,
  to: string,
  date: string,
  amount: bigint,
): EngineTransaction[] {
  return [
    { accountId: from, date, amount: -amount, categoryId: null, transferAccountId: to },
    { accountId: to, date, amount, categoryId: null, transferAccountId: from },
  ];
}

const income = (date: string, amount: bigint) =>
  txn("checking", date, amount, "rta");

function cat(state: ReturnType<typeof computeMonth>, id: string) {
  const row = state.categories.get(id);
  if (!row) throw new Error(`no state for category ${id}`);
  return row;
}

describe("month helpers", () => {
  it("normalizes dates to the first of the month", () => {
    expect(monthOfDate("2026-06-14")).toBe("2026-06-01");
    expect(monthOfDate("2026-06-01")).toBe("2026-06-01");
  });

  it("steps months across year boundaries", () => {
    expect(nextMonth("2026-12-01")).toBe("2027-01-01");
    expect(nextMonth("2026-06-01")).toBe("2026-07-01");
    expect(prevMonth("2026-01-01")).toBe("2025-12-01");
    expect(prevMonth("2026-07-01")).toBe("2026-06-01");
  });
});

describe("computeMonth — §4 core math", () => {
  it("assign then spend exactly leaves available at zero", () => {
    const state = computeMonth(
      makeInput({
        assignments: [assign("groceries", JUNE, 500_000n)],
        transactions: [
          income("2026-06-01", 1_000_000n),
          txn("checking", "2026-06-12", -500_000n, "groceries"),
        ],
      }),
      JUNE,
    );
    expect(cat(state, "groceries")).toEqual({
      assigned: 500_000n,
      activity: -500_000n,
      carryover: 0n,
      available: 0n,
      cashOverspent: 0n,
      fundedCredit: 0n,
      creditOverspent: 0n,
    });
    expect(state.readyToAssign).toBe(500_000n);
  });

  it("missing assignment rows mean assigned 0", () => {
    const state = computeMonth(
      makeInput({
        transactions: [txn("checking", "2026-06-03", -120_000n, "rent")],
      }),
      JUNE,
    );
    expect(cat(state, "rent").assigned).toBe(0n);
    expect(cat(state, "rent").available).toBe(-120_000n);
    expect(cat(state, "groceries").available).toBe(0n);
  });

  it("cash overspending hits next month's RTA, never the category carryover", () => {
    const input = makeInput({
      assignments: [assign("groceries", JUNE, 100_000n)],
      transactions: [
        income("2026-06-01", 1_000_000n),
        txn("checking", "2026-06-20", -150_000n, "groceries"),
      ],
    });

    const june = computeMonth(input, JUNE);
    expect(cat(june, "groceries").available).toBe(-50_000n);
    expect(cat(june, "groceries").cashOverspent).toBe(50_000n);
    // In-month overspending does not touch RTA yet (only months before).
    expect(june.readyToAssign).toBe(900_000n);

    const july = computeMonth(input, JULY);
    expect(cat(july, "groceries").carryover).toBe(0n);
    expect(cat(july, "groceries").available).toBe(0n);
    expect(july.readyToAssign).toBe(850_000n);
  });

  it("positive balances roll forward through empty months", () => {
    const input = makeInput({
      assignments: [assign("groceries", MAY, 200_000n)],
      transactions: [income("2026-05-02", 500_000n)],
    });
    const july = computeMonth(input, JULY);
    expect(cat(july, "groceries").carryover).toBe(200_000n);
    expect(cat(july, "groceries").available).toBe(200_000n);
    expect(july.readyToAssign).toBe(300_000n);
  });

  it("future-month assignment reduces RTA today", () => {
    const input = makeInput({
      assignments: [assign("rent", JULY, 300_000n)],
      transactions: [income("2026-06-01", 1_000_000n)],
    });
    const june = computeMonth(input, JUNE);
    expect(june.readyToAssign).toBe(700_000n);
    expect(cat(june, "rent").available).toBe(0n);

    const july = computeMonth(input, JULY);
    expect(cat(july, "rent").available).toBe(300_000n);
  });

  it("a transfer pair between cash accounts changes nothing in the budget", () => {
    const base = makeInput({
      assignments: [assign("groceries", JUNE, 250_000n)],
      transactions: [income("2026-06-01", 800_000n)],
    });
    const withTransfer = makeInput({
      assignments: base.assignments,
      transactions: [
        ...base.transactions,
        txn("checking", "2026-06-10", -250_000n, null),
        txn("savings", "2026-06-10", 250_000n, null),
      ],
    });
    expect(computeMonth(withTransfer, JUNE)).toEqual(computeMonth(base, JUNE));
    expect(computeMonth(withTransfer, JULY)).toEqual(computeMonth(base, JULY));
  });

  it("RTA-categorized flows move RTA in both directions (reconciliation adjustment)", () => {
    const state = computeMonth(
      makeInput({
        transactions: [
          income("2026-06-01", 1_000_000n),
          // Reconciliation balance adjustment categorized to Ready to Assign.
          income("2026-06-28", -37_500n),
        ],
      }),
      JUNE,
    );
    expect(state.readyToAssign).toBe(962_500n);
  });

  it("split activity lands per sub-category; RTA subs count as income", () => {
    const split: EngineTransaction = {
      accountId: "checking",
      date: "2026-06-15",
      amount: -80_000n,
      categoryId: null,
      subtransactions: [
        { amount: -50_000n, categoryId: "groceries" },
        { amount: -30_000n, categoryId: "dining" },
      ],
    };
    const splitWithIncome: EngineTransaction = {
      accountId: "checking",
      date: "2026-06-16",
      amount: -20_000n,
      categoryId: null,
      subtransactions: [
        { amount: -50_000n, categoryId: "rent" },
        { amount: 30_000n, categoryId: "rta" },
      ],
    };
    const state = computeMonth(
      makeInput({ transactions: [split, splitWithIncome] }),
      JUNE,
    );
    expect(cat(state, "groceries").activity).toBe(-50_000n);
    expect(cat(state, "dining").activity).toBe(-30_000n);
    expect(cat(state, "rent").activity).toBe(-50_000n);
    expect(state.readyToAssign).toBe(30_000n);
  });

  it("ignores tracking-account transactions entirely", () => {
    const state = computeMonth(
      makeInput({
        accounts: [CHECKING, BROKERAGE],
        transactions: [
          txn("brokerage", "2026-06-05", 5_000_000n, null),
          // Defensive: tracking transactions are never categorized, but if
          // one slipped through it still must not move the budget.
          txn("brokerage", "2026-06-06", -90_000n, "groceries"),
          txn("brokerage", "2026-06-07", 100_000n, "rta"),
        ],
      }),
      JUNE,
    );
    expect(cat(state, "groceries").activity).toBe(0n);
    expect(state.readyToAssign).toBe(0n);
  });

  it("the RTA category never appears as a budget row", () => {
    const state = computeMonth(
      makeInput({ transactions: [income("2026-06-01", 100_000n)] }),
      JUNE,
    );
    expect(state.categories.has("rta")).toBe(false);
    expect([...state.categories.keys()].sort()).toEqual([
      "dining",
      "groceries",
      "rent",
    ]);
  });

  it("months before any data are all zeros with the global RTA", () => {
    const input = makeInput({
      assignments: [assign("groceries", JUNE, 100_000n)],
      transactions: [income("2026-06-01", 400_000n)],
    });
    const january = computeMonth(input, "2026-01-01");
    expect(cat(january, "groceries").available).toBe(0n);
    // RTA is a single global number: income(all time) − assigned(all months).
    expect(january.readyToAssign).toBe(300_000n);
  });

  it("recomputing without a transaction equals a history that never had it", () => {
    const spend = txn("checking", "2026-06-12", -75_000n, "groceries");
    const rest: EngineTransaction[] = [
      income("2026-06-01", 1_000_000n),
      txn("checking", "2026-06-13", -40_000n, "dining"),
    ];
    const withSpend = makeInput({ transactions: [...rest, spend] });
    const without = makeInput({ transactions: rest });
    // Derived numbers are never stored, so "delete" is just recompute.
    expect(computeMonth(without, JUNE)).toEqual(
      computeMonth(
        makeInput({ transactions: withSpend.transactions.filter((t) => t !== spend) }),
        JUNE,
      ),
    );
    expect(cat(computeMonth(without, JUNE), "groceries").available).toBe(0n);
  });

  it("never mutates its input", () => {
    const input = makeInput({
      assignments: [assign("groceries", JUNE, 100_000n)],
      transactions: [income("2026-06-01", 400_000n)],
    });
    Object.freeze(input);
    Object.freeze(input.accounts);
    Object.freeze(input.categories);
    Object.freeze(input.assignments);
    Object.freeze(input.transactions);
    input.transactions.forEach(Object.freeze);
    input.assignments.forEach(Object.freeze);
    expect(() => computeBudget(input, JULY)).not.toThrow();
  });
});

describe("computeBudget — month walker", () => {
  it("returns every month from the earliest data through the target", () => {
    const input = makeInput({
      transactions: [
        income("2026-05-03", 500_000n),
        txn("checking", "2026-05-04", -100_000n, "groceries"),
      ],
    });
    const months = computeBudget(input, JULY);
    expect([...months.keys()]).toEqual([MAY, JUNE, JULY]);
    expect(months.get(MAY)?.readyToAssign).toBe(500_000n);
    // May's overspending: none. Groceries −100 carried as overspent cash.
    expect(months.get(JUNE)?.readyToAssign).toBe(400_000n);
    expect(months.get(JUNE)?.categories.get("groceries")?.carryover).toBe(0n);
  });

  it("walks only the target month when it precedes all data", () => {
    const input = makeInput({
      transactions: [income("2026-06-01", 400_000n)],
    });
    const months = computeBudget(input, MAY);
    expect([...months.keys()]).toEqual([MAY]);
  });
});

// ---------------------------------------------------------------------------
// §4 overspending classification (Milestone 4). Spends as positive numbers:
//   A = carryover + assigned
//   fundedCredit    = clamp(A − S_cash, 0, max(S_credit, 0))
//   creditOverspent = max(S_credit, 0) − fundedCredit   (card debt; no RTA hit)
//   cashOverspent   = max(−available, 0) − creditOverspent (docks later RTA)
// The formulas are total: fundedCredit is meaningful even when not overspent
// (it's the slice M5 moves to the card's payment category).
// ---------------------------------------------------------------------------

describe("computeMonth — §4 overspending classification", () => {
  const cardInput = (partial: Partial<BudgetInput>) =>
    makeInput({ accounts: [CHECKING, CARD], ...partial });

  it("fully funded credit spend classifies the whole spend as funded", () => {
    const state = computeMonth(
      cardInput({
        assignments: [assign("groceries", JUNE, 500_000n)],
        transactions: [
          income("2026-06-01", 1_000_000n),
          txn("card", "2026-06-10", -300_000n, "groceries"),
        ],
      }),
      JUNE,
    );
    expect(cat(state, "groceries")).toEqual({
      assigned: 500_000n,
      activity: -300_000n,
      carryover: 0n,
      available: 200_000n,
      cashOverspent: 0n,
      fundedCredit: 300_000n,
      creditOverspent: 0n,
    });
  });

  it("unfunded credit overspending becomes debt and never docks RTA (§12)", () => {
    const input = cardInput({
      transactions: [
        income("2026-06-01", 1_000_000n),
        txn("card", "2026-06-15", -80_000n, "dining"),
      ],
    });
    const june = computeMonth(input, JUNE);
    expect(cat(june, "dining")).toMatchObject({
      available: -80_000n,
      fundedCredit: 0n,
      creditOverspent: 80_000n,
      cashOverspent: 0n,
    });
    expect(june.readyToAssign).toBe(1_000_000n);

    const july = computeMonth(input, JULY);
    expect(cat(july, "dining").carryover).toBe(0n);
    expect(cat(july, "dining").available).toBe(0n);
    expect(july.readyToAssign).toBe(1_000_000n);
    expect(computeMonth(input, "2026-08-01").readyToAssign).toBe(1_000_000n);
  });

  it("crossing into next month clears both negatives, but only cash docks RTA", () => {
    // Same month, two overspends: groceries on cash, dining on the card. Both
    // available figures reset to 0 next month (negatives never carry), yet RTA
    // drops by only the cash share — credit overspending is card debt, the
    // cash never left, so it never touches the unassigned pool.
    const input = cardInput({
      transactions: [
        income("2026-06-01", 1_000_000n),
        txn("checking", "2026-06-10", -50_000n, "groceries"), // cash overspend
        txn("card", "2026-06-12", -80_000n, "dining"), // credit overspend
      ],
    });

    const june = computeMonth(input, JUNE);
    expect(cat(june, "groceries")).toMatchObject({
      available: -50_000n,
      cashOverspent: 50_000n,
      creditOverspent: 0n,
    });
    expect(cat(june, "dining")).toMatchObject({
      available: -80_000n,
      creditOverspent: 80_000n,
      cashOverspent: 0n,
    });
    expect(june.readyToAssign).toBe(1_000_000n); // in-month: neither docks yet

    const july = computeMonth(input, JULY);
    // Both negatives cleared by the carryover clamp.
    expect(cat(july, "groceries").available).toBe(0n);
    expect(cat(july, "dining").available).toBe(0n);
    // RTA docked by the $50 cash overspend only — not the $80 credit overspend.
    expect(july.readyToAssign).toBe(950_000n);
  });

  it("partially funded credit spend funds only the available slice (§12)", () => {
    const input = cardInput({
      assignments: [assign("groceries", JUNE, 50_000n)],
      transactions: [
        income("2026-06-01", 500_000n),
        txn("card", "2026-06-12", -80_000n, "groceries"),
      ],
    });
    expect(cat(computeMonth(input, JUNE), "groceries")).toMatchObject({
      available: -30_000n,
      fundedCredit: 50_000n,
      creditOverspent: 30_000n,
      cashOverspent: 0n,
    });
    const july = computeMonth(input, JULY);
    // 500 income − 50 assigned; the credit overspend is debt, not an RTA hit.
    expect(july.readyToAssign).toBe(450_000n);
    expect(cat(july, "groceries").available).toBe(0n);
  });

  it("mixed overspending docks RTA by only the cash share", () => {
    const input = cardInput({
      assignments: [assign("groceries", JUNE, 50_000n)],
      transactions: [
        income("2026-06-01", 500_000n),
        txn("checking", "2026-06-05", -60_000n, "groceries"),
        txn("card", "2026-06-06", -30_000n, "groceries"),
      ],
    });
    expect(cat(computeMonth(input, JUNE), "groceries")).toMatchObject({
      available: -40_000n,
      fundedCredit: 0n, // clamp(50 − 60, 0, 30)
      creditOverspent: 30_000n,
      cashOverspent: 10_000n,
    });
    expect(computeMonth(input, JULY).readyToAssign).toBe(440_000n);
  });

  it("cash spending consumes available before credit gets funded", () => {
    const state = computeMonth(
      cardInput({
        assignments: [assign("groceries", JUNE, 100_000n)],
        transactions: [
          income("2026-06-01", 500_000n),
          txn("checking", "2026-06-08", -70_000n, "groceries"),
          txn("card", "2026-06-09", -50_000n, "groceries"),
        ],
      }),
      JUNE,
    );
    expect(cat(state, "groceries")).toMatchObject({
      available: -20_000n,
      fundedCredit: 30_000n, // clamp(100 − 70, 0, 50)
      creditOverspent: 20_000n,
      cashOverspent: 0n,
    });
  });

  it("a net card refund classifies the whole shortfall as cash overspending", () => {
    const state = computeMonth(
      cardInput({
        assignments: [assign("groceries", JUNE, 10_000n)],
        transactions: [
          txn("checking", "2026-06-03", -30_000n, "groceries"),
          txn("card", "2026-06-04", 5_000n, "groceries"),
        ],
      }),
      JUNE,
    );
    expect(cat(state, "groceries")).toMatchObject({
      available: -15_000n,
      fundedCredit: 0n, // S_credit < 0: nothing to fund or owe
      creditOverspent: 0n,
      cashOverspent: 15_000n,
    });
  });

  it("a card refund reverses spending on a net basis within the month (§12)", () => {
    const state = computeMonth(
      cardInput({
        assignments: [assign("groceries", JUNE, 50_000n)],
        transactions: [
          income("2026-06-01", 100_000n),
          txn("card", "2026-06-10", -80_000n, "groceries"),
          txn("card", "2026-06-20", 30_000n, "groceries"),
        ],
      }),
      JUNE,
    );
    expect(cat(state, "groceries")).toEqual({
      assigned: 50_000n,
      activity: -50_000n,
      carryover: 0n,
      available: 0n,
      cashOverspent: 0n,
      fundedCredit: 50_000n,
      creditOverspent: 0n,
    });
  });

  it("spending across multiple cards aggregates for classification", () => {
    const state = computeMonth(
      makeInput({
        accounts: [CHECKING, CARD, CARD2],
        assignments: [assign("dining", JUNE, 40_000n)],
        transactions: [
          txn("card", "2026-06-11", -30_000n, "dining"),
          txn("card2", "2026-06-12", -30_000n, "dining"),
        ],
      }),
      JUNE,
    );
    expect(cat(state, "dining")).toMatchObject({
      available: -20_000n,
      fundedCredit: 40_000n,
      creditOverspent: 20_000n,
      cashOverspent: 0n,
    });
  });

  it("split postings on a card classify per sub-category", () => {
    const split: EngineTransaction = {
      accountId: "card",
      date: "2026-06-15",
      amount: -80_000n,
      categoryId: null,
      subtransactions: [
        { amount: -50_000n, categoryId: "groceries" },
        { amount: -30_000n, categoryId: "dining" },
      ],
    };
    const state = computeMonth(
      cardInput({
        assignments: [assign("groceries", JUNE, 20_000n)],
        transactions: [split],
      }),
      JUNE,
    );
    expect(cat(state, "groceries")).toMatchObject({
      available: -30_000n,
      fundedCredit: 20_000n,
      creditOverspent: 30_000n,
      cashOverspent: 0n,
    });
    expect(cat(state, "dining")).toMatchObject({
      available: -30_000n,
      fundedCredit: 0n,
      creditOverspent: 30_000n,
      cashOverspent: 0n,
    });
  });

  it("assigning enough mid-month erases the overspending (derived, never stored)", () => {
    const state = computeMonth(
      cardInput({
        assignments: [assign("groceries", JUNE, 80_000n)],
        transactions: [
          income("2026-06-01", 100_000n),
          txn("card", "2026-06-10", -80_000n, "groceries"),
        ],
      }),
      JUNE,
    );
    expect(cat(state, "groceries")).toMatchObject({
      available: 0n,
      fundedCredit: 80_000n,
      creditOverspent: 0n,
      cashOverspent: 0n,
    });
  });

  it("cash overspending docks RTA once, from the following month onward", () => {
    const input = makeInput({
      assignments: [assign("groceries", MAY, 100_000n)],
      transactions: [
        income("2026-05-01", 1_000_000n),
        txn("checking", "2026-05-20", -150_000n, "groceries"),
      ],
    });
    expect(computeMonth(input, MAY).readyToAssign).toBe(900_000n);
    expect(computeMonth(input, JUNE).readyToAssign).toBe(850_000n);
    expect(computeMonth(input, JULY).readyToAssign).toBe(850_000n);
  });

  it("carryover funds next month's card spending before classifying debt", () => {
    const input = cardInput({
      assignments: [assign("groceries", MAY, 200_000n)],
      transactions: [
        income("2026-05-01", 500_000n),
        txn("card", "2026-06-10", -250_000n, "groceries"),
      ],
    });
    expect(cat(computeMonth(input, JUNE), "groceries")).toMatchObject({
      carryover: 200_000n,
      available: -50_000n,
      fundedCredit: 200_000n,
      creditOverspent: 50_000n,
      cashOverspent: 0n,
    });
    const july = computeMonth(input, JULY);
    expect(july.readyToAssign).toBe(300_000n);
    expect(cat(july, "groceries").available).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// §4 credit card mechanics (Milestone 5). The funded slice of card spending
// is re-reserved as positive activity on the card's payment category; payments
// (transfers cash→card) are negative activity on it. Payment categories carry
// no credit side, so any shortfall is cash overspending and docks RTA.
// ---------------------------------------------------------------------------

describe("computeMonth — §4 credit card payment mechanics", () => {
  const payInput = (partial: Partial<BudgetInput>) =>
    makeInput({
      accounts: [CHECKING, CARD],
      categories: [RTA, GROCERIES, RENT, DINING, CARD_PAY],
      ...partial,
    });

  it("funded credit spend credits the card's payment category", () => {
    const state = computeMonth(
      payInput({
        assignments: [assign("groceries", JUNE, 500_000n)],
        transactions: [
          income("2026-06-01", 1_000_000n),
          txn("card", "2026-06-10", -300_000n, "groceries"),
        ],
      }),
      JUNE,
    );
    expect(cat(state, "groceries").fundedCredit).toBe(300_000n);
    expect(cat(state, "cardpay")).toEqual({
      assigned: 0n,
      activity: 300_000n,
      carryover: 0n,
      available: 300_000n,
      cashOverspent: 0n,
      fundedCredit: 0n,
      creditOverspent: 0n,
    });
  });

  it("unfunded credit overspend does NOT credit the payment category (§12)", () => {
    const state = computeMonth(
      payInput({
        transactions: [
          income("2026-06-01", 1_000_000n),
          txn("card", "2026-06-15", -80_000n, "dining"),
        ],
      }),
      JUNE,
    );
    expect(cat(state, "dining")).toMatchObject({
      available: -80_000n,
      creditOverspent: 80_000n,
    });
    expect(cat(state, "cardpay").activity).toBe(0n);
    expect(cat(state, "cardpay").available).toBe(0n);
  });

  it("partial-funded credit spend moves only the funded slice (§12)", () => {
    const state = computeMonth(
      payInput({
        assignments: [assign("groceries", JUNE, 50_000n)],
        transactions: [
          income("2026-06-01", 500_000n),
          txn("card", "2026-06-12", -80_000n, "groceries"),
        ],
      }),
      JUNE,
    );
    expect(cat(state, "groceries")).toMatchObject({
      fundedCredit: 50_000n,
      creditOverspent: 30_000n,
    });
    expect(cat(state, "cardpay").activity).toBe(50_000n);
    expect(cat(state, "cardpay").available).toBe(50_000n);
  });

  it("a card refund reverses the move on a net basis within the month (§12)", () => {
    const state = computeMonth(
      payInput({
        assignments: [assign("groceries", JUNE, 50_000n)],
        transactions: [
          income("2026-06-01", 100_000n),
          txn("card", "2026-06-10", -80_000n, "groceries"),
          txn("card", "2026-06-20", 30_000n, "groceries"),
        ],
      }),
      JUNE,
    );
    expect(cat(state, "groceries").available).toBe(0n);
    // Net spend 50 funded → 50 reserved on the payment category.
    expect(cat(state, "cardpay").activity).toBe(50_000n);
    expect(cat(state, "cardpay").available).toBe(50_000n);
  });

  it("a card refund a later month pulls the reserve back out (§12)", () => {
    const input = payInput({
      assignments: [assign("groceries", JUNE, 50_000n)],
      transactions: [
        income("2026-06-01", 100_000n),
        txn("card", "2026-06-10", -50_000n, "groceries"),
        ...transfer("checking", "card", "2026-06-25", 50_000n), // pay the card
        txn("card", "2026-07-05", 50_000n, "groceries"), // refund next month
      ],
    });
    // June: spend funded then paid off, payment category back to zero.
    expect(cat(computeMonth(input, JUNE), "cardpay").available).toBe(0n);
    // July: the refund (no spend to fund) drives a negative move — the card
    // now owes us, so the payment category goes negative (cash overspending).
    const july = computeMonth(input, JULY);
    expect(cat(july, "groceries").available).toBe(50_000n);
    expect(cat(july, "cardpay").activity).toBe(-50_000n);
    expect(cat(july, "cardpay").available).toBe(-50_000n);
    expect(cat(july, "cardpay").cashOverspent).toBe(50_000n);
  });

  it("a transfer cash→CC reduces the payment category (§12)", () => {
    const input = payInput({
      assignments: [assign("groceries", JUNE, 200_000n)],
      transactions: [
        income("2026-06-01", 1_000_000n),
        txn("card", "2026-06-10", -200_000n, "groceries"),
        ...transfer("checking", "card", "2026-06-20", 150_000n),
      ],
    });
    const state = computeMonth(input, JUNE);
    // 200 reserved by the funded spend, 150 spent paying the card → 50 left.
    expect(cat(state, "cardpay").activity).toBe(50_000n);
    expect(cat(state, "cardpay").available).toBe(50_000n);
    // The transfer legs are uncategorized — groceries only sees the spend.
    expect(cat(state, "groceries").activity).toBe(-200_000n);
    expect(cat(state, "groceries").available).toBe(0n);
  });

  it("paying a card with nothing reserved overspends and docks RTA next month", () => {
    const input = payInput({
      transactions: [
        income("2026-06-01", 1_000_000n),
        ...transfer("checking", "card", "2026-06-20", 100_000n),
      ],
    });
    const june = computeMonth(input, JUNE);
    expect(cat(june, "cardpay")).toMatchObject({
      activity: -100_000n,
      available: -100_000n,
      cashOverspent: 100_000n,
    });
    expect(june.readyToAssign).toBe(1_000_000n);
    // Overpayment is cash gone: it docks RTA once the month rolls.
    expect(computeMonth(input, JULY).readyToAssign).toBe(900_000n);
    expect(cat(computeMonth(input, JULY), "cardpay").available).toBe(0n);
  });

  it("card cash-back (RTA inflow on the card) mirrors into the payment category", () => {
    const state = computeMonth(
      payInput({
        transactions: [txn("card", "2026-06-08", 50_000n, "rta")],
      }),
      JUNE,
    );
    expect(state.readyToAssign).toBe(50_000n);
    expect(cat(state, "cardpay")).toMatchObject({
      activity: -50_000n,
      available: -50_000n,
      cashOverspent: 50_000n,
    });
  });

  it("splits the move greedily in account order, not chronological or id order", () => {
    // Account order is [card2, card], but "card" spends first chronologically
    // and sorts first by id — so the funded slice landing on card2 first pins
    // the split to account order specifically (the only order with this
    // result; chronological or id order would fund card first).
    const state = computeMonth(
      makeInput({
        accounts: [CHECKING, CARD2, CARD],
        categories: [RTA, GROCERIES, DINING, CARD_PAY, CARD2_PAY],
        assignments: [assign("dining", JUNE, 40_000n)],
        transactions: [
          txn("card", "2026-06-11", -30_000n, "dining"), // earlier date, id "card"
          txn("card2", "2026-06-20", -30_000n, "dining"), // later date, id "card2"
        ],
      }),
      JUNE,
    );
    // fundedCredit 40 across two 30-spends: card2 first (30), then card (10).
    expect(cat(state, "dining").fundedCredit).toBe(40_000n);
    expect(cat(state, "card2pay").available).toBe(30_000n);
    expect(cat(state, "cardpay").available).toBe(10_000n);
  });

  it("a refund on one card frees reserve toward another card's spend", () => {
    const state = computeMonth(
      makeInput({
        accounts: [CHECKING, CARD, CARD2],
        categories: [RTA, GROCERIES, CARD_PAY, CARD2_PAY],
        assignments: [assign("groceries", JUNE, 50_000n)],
        transactions: [
          income("2026-06-01", 1_000_000n),
          txn("card", "2026-06-11", -100_000n, "groceries"),
          txn("card2", "2026-06-12", 30_000n, "groceries"),
        ],
      }),
      JUNE,
    );
    // S_credit 70, funded 50, overspent 20. Refund card2 reverses −30; the
    // remaining 80 funds card (capped at its 100 spend).
    expect(cat(state, "groceries")).toMatchObject({
      fundedCredit: 50_000n,
      creditOverspent: 20_000n,
    });
    expect(cat(state, "cardpay").available).toBe(80_000n);
    expect(cat(state, "card2pay").available).toBe(-30_000n);
  });

  it("assigning directly to a payment category funds pre-existing debt", () => {
    const state = computeMonth(
      payInput({
        assignments: [assign("cardpay", JUNE, 200_000n)],
        transactions: [income("2026-06-01", 1_000_000n)],
      }),
      JUNE,
    );
    expect(cat(state, "cardpay")).toMatchObject({
      assigned: 200_000n,
      activity: 0n,
      available: 200_000n,
    });
    expect(state.readyToAssign).toBe(800_000n);
  });

  it("a credit card without a payment category still classifies, no crash", () => {
    const state = computeMonth(
      makeInput({
        accounts: [CHECKING, CARD],
        categories: [RTA, GROCERIES], // no payment category for the card
        assignments: [assign("groceries", JUNE, 500_000n)],
        transactions: [
          income("2026-06-01", 1_000_000n),
          txn("card", "2026-06-10", -300_000n, "groceries"),
        ],
      }),
      JUNE,
    );
    expect(cat(state, "groceries")).toMatchObject({
      available: 200_000n,
      fundedCredit: 300_000n,
      creditOverspent: 0n,
    });
    expect(state.categories.has("cardpay")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §4 invariant property test, M5 (PRD) form. The funded slice of card spending
// is re-reserved on each card's payment category, so the PRD identity holds:
//   Σ cash balances (checking + savings + cash)
//     = RTA(m) + Σ available(c, m) over ALL categories (incl. payment cats)
//        + Σ creditOverspent(c, m)   ← only the evaluated month's fresh
//                                       unfunded card spend; cash never left
//                                       and next month's carryover clamp drops
//                                       it, so it is 0 once m has no card spend.
// Hence at the two months after the last data month the residual vanishes and
// the verbatim PRD form (Σ cash = RTA + Σ available) holds. Cards leave the
// left side entirely (debt isn't cash); the move keeps both sides aligned.
// Holds at any month m with no transactions or assignments dated after it
// (future-dated data shifts RTA/cash without touching available(m) — that is
// §12's "future-month assignment reduces RTA today", not a bug).
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomScenario(rng: () => number) {
  const int = (min: number, max: number) =>
    min + Math.floor(rng() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];
  // Milliunits between min and max dollars, in whole cents.
  const money = (minDollars: number, maxDollars: number) =>
    BigInt(int(minDollars * 100, maxDollars * 100)) * 10n;

  // 1–3 cash accounts plus 0–2 credit cards; zero-card seeds keep the pure
  // cash (M3) behavior in the tested mix. The transfer branch below then
  // also emits cash↔card pairs (card payments / cash advances).
  const cashTypes = ["checking", "savings", "cash"] as const;
  const cards: EngineAccount[] = Array.from(
    { length: int(0, 2) },
    (_, i): EngineAccount => ({ id: `card${i}`, type: "credit_card", onBudget: true }),
  );
  const accounts: EngineAccount[] = [
    ...Array.from({ length: int(1, 3) }, (_, i): EngineAccount => ({
      id: `acct${i}`,
      type: pick(cashTypes),
      onBudget: true,
    })),
    ...cards,
  ];
  // One auto-created payment category per card (M5); kept out of the spend/
  // assign pool below so the generator only produces sensible postings.
  const normalCats: EngineCategory[] = Array.from(
    { length: int(4, 8) },
    (_, i) => ({ id: `cat${i}`, isReadyToAssign: false }),
  );
  const paymentCats: EngineCategory[] = cards.map((c) => ({
    id: `${c.id}pay`,
    isReadyToAssign: false,
    linkedAccountId: c.id,
  }));
  const categories: EngineCategory[] = [
    { id: "rta", isReadyToAssign: true },
    ...normalCats,
    ...paymentCats,
  ];
  const budgetCats = normalCats;

  const startYear = 2026;
  const startMonthNum = int(1, 6);
  const monthCount = int(1, 6);
  const months = Array.from({ length: monthCount }, (_, i) => {
    const m = startMonthNum + i;
    return `${startYear}-${String(m).padStart(2, "0")}-01`;
  });
  const dateIn = (month: string) =>
    `${month.slice(0, 8)}${String(int(1, 28)).padStart(2, "0")}`;

  const transactions: EngineTransaction[] = [];
  for (let i = int(0, 40); i > 0; i--) {
    const date = dateIn(pick(months));
    const account = pick(accounts).id;
    const roll = rng();
    if (roll < 0.3) {
      transactions.push(txn(account, date, money(1, 5000), "rta"));
    } else if (roll < 0.75) {
      transactions.push(txn(account, date, -money(1, 800), pick(budgetCats).id));
    } else if (roll < 0.85) {
      transactions.push(txn(account, date, money(1, 200), pick(budgetCats).id));
    } else if (roll < 0.95 && accounts.length >= 2) {
      const amount = money(1, 500);
      const from = pick(accounts).id;
      const to = pick(accounts).id;
      // Linked pair with transfer_account_id set: cash↔card legs become card
      // payments / cash advances on the payment category; cash↔cash net zero.
      if (to !== from) transactions.push(...transfer(from, to, date, amount));
    } else {
      const subtransactions = Array.from({ length: int(2, 3) }, () => ({
        amount: rng() < 0.2 ? money(1, 100) : -money(1, 300),
        categoryId: rng() < 0.15 ? "rta" : pick(budgetCats).id,
      }));
      transactions.push({
        accountId: account,
        date,
        amount: subtransactions.reduce((sum, s) => sum + s.amount, 0n),
        categoryId: null,
        subtransactions,
      });
    }
  }

  // Unique per (category, month) like the DB; months may run past the
  // transaction window (future assignments).
  const byKey = new Map<string, EngineAssignment>();
  for (let i = int(0, 15); i > 0; i--) {
    const month =
      rng() < 0.25
        ? nextMonth(rng() < 0.5 ? months[months.length - 1] : nextMonth(months[months.length - 1]))
        : pick(months);
    const categoryId = pick(budgetCats).id;
    const assigned =
      rng() < 0.15 ? -money(0, 200) : money(0, 600);
    byKey.set(`${categoryId}|${month}`, { categoryId, month, assigned });
  }
  const assignments = [...byKey.values()];

  return makeInput({ accounts, categories, assignments, transactions });
}

describe("§4 engine invariant (property test)", () => {
  it("cash balances = RTA + available (incl. payment cats), for 150 random histories", () => {
    const cashTypes = new Set(["checking", "savings", "cash"]);
    for (let seed = 0; seed < 150; seed++) {
      const rng = mulberry32(seed);
      const input = randomScenario(rng);

      // Only cash accounts sit on the left of the PRD identity — card debt
      // is not cash; the payment categories carry the reserved cash instead.
      const cashIds = new Set(
        input.accounts
          .filter((a) => a.onBudget && cashTypes.has(a.type))
          .map((a) => a.id),
      );
      let cashBalance = 0n;
      for (const t of input.transactions) {
        if (cashIds.has(t.accountId)) cashBalance += t.amount;
      }

      const dataMonths = [
        ...input.transactions.map((t) => monthOfDate(t.date)),
        ...input.assignments.map((a) => a.month),
      ].sort();
      const last = dataMonths[dataMonths.length - 1] ?? "2026-06-01";

      for (const m of [last, nextMonth(last), nextMonth(nextMonth(last))]) {
        const months = computeBudget(input, m);
        const state = months.get(m);
        if (!state) throw new Error(`no state for ${m}`);
        let availableTotal = 0n;
        let creditOverspentThisMonth = 0n;
        for (const row of state.categories.values()) {
          availableTotal += row.available;
          creditOverspentThisMonth += row.creditOverspent;
        }
        // Fresh unfunded card spend is the only slack: cash didn't move and
        // the funded part is already reserved on a payment category.
        const rhs =
          state.readyToAssign + availableTotal + creditOverspentThisMonth;
        if (cashBalance !== rhs) {
          throw new Error(
            `invariant failed: seed=${seed} month=${m} ` +
              `cash=${cashBalance} rta=${state.readyToAssign} ` +
              `available=${availableTotal} creditOverspent=${creditOverspentThisMonth}`,
          );
        }
        // Once the data month has passed there is no fresh card spend, so the
        // verbatim PRD form holds: Σ cash = RTA + Σ available.
        if (m !== last && cashBalance !== state.readyToAssign + availableTotal) {
          throw new Error(
            `PRD-form invariant failed: seed=${seed} month=${m} ` +
              `cash=${cashBalance} rta=${state.readyToAssign} available=${availableTotal}`,
          );
        }
      }
    }
  });

  it("per-month bookkeeping and classification formulas hold for 150 random histories", () => {
    const clamp = (v: bigint, lo: bigint, hi: bigint) =>
      v < lo ? lo : v > hi ? hi : v;

    for (let seed = 0; seed < 150; seed++) {
      const input = randomScenario(mulberry32(seed));
      const dataMonths = [
        ...input.transactions.map((t) => monthOfDate(t.date)),
        ...input.assignments.map((a) => a.month),
      ].sort();
      const last = dataMonths[dataMonths.length - 1] ?? "2026-06-01";
      const months = computeBudget(input, nextMonth(last));

      // Independent oracle: net cash/credit activity per (month, category),
      // re-bucketed from the raw input with §4's rules (on-budget accounts
      // only, subs replace the parent, RTA/uncategorized postings excluded).
      const onBudgetIds = new Set(
        input.accounts.filter((a) => a.onBudget).map((a) => a.id),
      );
      const cardIds = new Set(
        input.accounts
          .filter((a) => a.onBudget && a.type === "credit_card")
          .map((a) => a.id),
      );
      const rtaIds = new Set(
        input.categories.filter((c) => c.isReadyToAssign).map((c) => c.id),
      );
      const paymentCatIds = new Set(
        input.categories
          .filter((c) => c.linkedAccountId != null)
          .map((c) => c.id),
      );
      const cashActivity = new Map<string, bigint>(); // "month|category"
      const creditActivity = new Map<string, bigint>();
      for (const t of input.transactions) {
        if (!onBudgetIds.has(t.accountId)) continue;
        const into = cardIds.has(t.accountId) ? creditActivity : cashActivity;
        const postings =
          t.subtransactions !== undefined && t.subtransactions.length > 0
            ? t.subtransactions
            : [{ amount: t.amount, categoryId: t.categoryId }];
        for (const posting of postings) {
          if (posting.categoryId === null || rtaIds.has(posting.categoryId)) {
            continue;
          }
          const key = `${monthOfDate(t.date)}|${posting.categoryId}`;
          into.set(key, (into.get(key) ?? 0n) + posting.amount);
        }
      }

      let previous: ReturnType<typeof computeMonth> | null = null;
      let previousCashOverspent = 0n;
      for (const state of months.values()) {
        let cashOverspentHere = 0n;
        for (const [id, row] of state.categories) {
          if (row.available !== row.carryover + row.assigned + row.activity) {
            throw new Error(`available identity failed: seed=${seed} ${id}`);
          }

          const overspentTotal = row.available < 0n ? -row.available : 0n;
          if (paymentCatIds.has(id)) {
            // Payment categories carry no credit side: their activity (moves,
            // payments, card-RTA mirrors) is engine-derived, so the raw-posting
            // oracle below can't reproduce it. Their contract is simpler —
            // no funded/credit split, all shortfall is cash overspending.
            if (row.fundedCredit !== 0n || row.creditOverspent !== 0n) {
              throw new Error(`payment cat classified credit: seed=${seed} ${id} ${state.month}`);
            }
            if (row.cashOverspent !== overspentTotal) {
              throw new Error(`payment cat cashOverspent failed: seed=${seed} ${id} ${state.month}`);
            }
          } else {
            // §4 classification against the oracle, spends as positives.
            const key = `${state.month}|${id}`;
            const sCash = -(cashActivity.get(key) ?? 0n);
            const sCredit = -(creditActivity.get(key) ?? 0n);
            const sCreditPos = sCredit > 0n ? sCredit : 0n;
            const fundedCredit = clamp(
              row.carryover + row.assigned - sCash,
              0n,
              sCreditPos,
            );
            const creditOverspent = sCreditPos - fundedCredit;
            if (row.fundedCredit !== fundedCredit) {
              throw new Error(`fundedCredit failed: seed=${seed} ${id} ${state.month}`);
            }
            if (row.creditOverspent !== creditOverspent) {
              throw new Error(`creditOverspent failed: seed=${seed} ${id} ${state.month}`);
            }
            if (row.cashOverspent !== overspentTotal - creditOverspent) {
              throw new Error(`cashOverspent failed: seed=${seed} ${id} ${state.month}`);
            }
          }
          if (
            row.fundedCredit < 0n ||
            row.creditOverspent < 0n ||
            row.cashOverspent < 0n
          ) {
            throw new Error(`negative classification: seed=${seed} ${id} ${state.month}`);
          }
          cashOverspentHere += row.cashOverspent;

          if (previous) {
            const before = previous.categories.get(id);
            const expected =
              before && before.available > 0n ? before.available : 0n;
            if (row.carryover !== expected) {
              throw new Error(
                `carryover failed: seed=${seed} ${id} month=${state.month}`,
              );
            }
          }
        }

        // Only the cash share of overspending moves RTA, exactly one month on.
        if (previous) {
          const expectedRta = previous.readyToAssign - previousCashOverspent;
          if (state.readyToAssign !== expectedRta) {
            throw new Error(
              `RTA linkage failed: seed=${seed} month=${state.month} ` +
                `rta=${state.readyToAssign} expected=${expectedRta}`,
            );
          }
        }
        previous = state;
        previousCashOverspent = cashOverspentHere;
      }
    }
  });
});

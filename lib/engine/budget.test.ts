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

// PRD §4 budget math, cash only (Milestone 3). Credit classification (M4)
// and card mechanics (M5) extend these cases; the §12 list is the contract.

const CHECKING: EngineAccount = { id: "checking", type: "checking", onBudget: true };
const SAVINGS: EngineAccount = { id: "savings", type: "savings", onBudget: true };
const BROKERAGE: EngineAccount = {
  id: "brokerage",
  type: "tracking_asset",
  onBudget: false,
};

const RTA: EngineCategory = { id: "rta", isReadyToAssign: true };
const GROCERIES: EngineCategory = { id: "groceries", isReadyToAssign: false };
const RENT: EngineCategory = { id: "rent", isReadyToAssign: false };
const DINING: EngineCategory = { id: "dining", isReadyToAssign: false };

const MAY = "2026-05-01";
const JUNE = "2026-06-01";
const JULY = "2026-07-01";
const AUGUST = "2026-08-01";

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
// §4 invariant property test:
//   Σ balances of cash accounts = RTA + Σ available(c, m) over all categories
// holds at any month m with no transactions or assignments dated after it
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

  const cashTypes = ["checking", "savings", "cash"] as const;
  const accounts: EngineAccount[] = Array.from(
    { length: int(2, 4) },
    (_, i) => ({ id: `acct${i}`, type: pick(cashTypes), onBudget: true }),
  );
  const categories: EngineCategory[] = [
    { id: "rta", isReadyToAssign: true },
    ...Array.from({ length: int(4, 8) }, (_, i) => ({
      id: `cat${i}`,
      isReadyToAssign: false,
    })),
  ];
  const budgetCats = categories.filter((c) => !c.isReadyToAssign);

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
      const [from, to] = [pick(accounts).id, pick(accounts).id];
      transactions.push(txn(from, date, -amount, null));
      transactions.push(txn(to, date, amount, null));
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
  it("cash balances = RTA + total available, for 150 random histories", () => {
    for (let seed = 0; seed < 150; seed++) {
      const rng = mulberry32(seed);
      const input = randomScenario(rng);

      const cashTotal = input.transactions.reduce(
        (sum, t) => sum + t.amount,
        0n,
      );

      const dataMonths = [
        ...input.transactions.map((t) => monthOfDate(t.date)),
        ...input.assignments.map((a) => a.month),
      ].sort();
      const last = dataMonths[dataMonths.length - 1] ?? "2026-06-01";

      for (const m of [last, nextMonth(last), nextMonth(nextMonth(last))]) {
        const state = computeMonth(input, m);
        let availableTotal = 0n;
        for (const row of state.categories.values()) {
          availableTotal += row.available;
        }
        const rhs = state.readyToAssign + availableTotal;
        if (cashTotal !== rhs) {
          throw new Error(
            `invariant failed: seed=${seed} month=${m} ` +
              `cash=${cashTotal} rta=${state.readyToAssign} available=${availableTotal}`,
          );
        }
      }
    }
  });

  it("per-month bookkeeping holds for 150 random histories", () => {
    for (let seed = 0; seed < 150; seed++) {
      const input = randomScenario(mulberry32(seed));
      const dataMonths = [
        ...input.transactions.map((t) => monthOfDate(t.date)),
        ...input.assignments.map((a) => a.month),
      ].sort();
      const last = dataMonths[dataMonths.length - 1] ?? "2026-06-01";
      const months = computeBudget(input, nextMonth(last));

      let previous: ReturnType<typeof computeMonth> | null = null;
      for (const state of months.values()) {
        for (const [id, row] of state.categories) {
          if (row.available !== row.carryover + row.assigned + row.activity) {
            throw new Error(`available identity failed: seed=${seed} ${id}`);
          }
          if (row.cashOverspent !== (row.available < 0n ? -row.available : 0n)) {
            throw new Error(`overspent identity failed: seed=${seed} ${id}`);
          }
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
        previous = state;
      }
    }
  });
});

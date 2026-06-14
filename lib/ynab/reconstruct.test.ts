import { describe, expect, it } from "vitest";

import { reconstruct } from "./reconstruct";
import type { BudgetRow, RegisterRow } from "./types";

let rowCounter = 0;
function reg(over: Partial<RegisterRow>): RegisterRow {
  return {
    rowNum: ++rowCounter,
    account: "🟠 PNC Spend",
    flag: null,
    date: "2026-03-10",
    payee: "",
    group: "",
    category: "",
    memo: "",
    amount: 0n,
    cleared: "reconciled",
    ...over,
  };
}

const CUTOFF = "2026-05-15"; // cutoff month 2026-05

describe("reconstruct — a mixed history", () => {
  const register: RegisterRow[] = [
    reg({ date: "2026-03-01", payee: "Job", group: "Inflow", category: "Ready to Assign", amount: 500_000n }),
    reg({ date: "2026-03-05", payee: "Store", group: "Wants", category: "Grocer", amount: -30_000n }),
    reg({ account: "🟥 Bank of America", date: "2026-03-06", payee: "Shop", group: "Wants", category: "Grocer", amount: -20_000n }),
    // cash ↔ cash transfer
    reg({ date: "2026-03-07", payee: "Transfer : 🟣 Ally Bank", amount: -5_000n }),
    reg({ account: "🟣 Ally Bank", date: "2026-03-07", payee: "Transfer : 🟠 PNC Spend", amount: 5_000n }),
    // budget → tracking (categorized on the budget side)
    reg({ account: "🟣 Ally Bank", date: "2026-03-08", payee: "Transfer : 🏠 Pennymac", group: "Bills", category: "Mortgage", amount: -100_000n }),
    reg({ account: "🏠 Pennymac", date: "2026-03-08", payee: "Transfer : 🟣 Ally Bank", amount: 100_000n }),
    // cash → credit card (payment)
    reg({ date: "2026-03-09", payee: "Transfer : 🟥 Bank of America", amount: -15_000n }),
    reg({ account: "🟥 Bank of America", date: "2026-03-09", payee: "Transfer : 🟠 PNC Spend", amount: 15_000n }),
    // split on PNC
    reg({ date: "2026-03-10", payee: "Costco", group: "Wants", category: "Grocer", memo: "Split (1/2) food", amount: -7_000n }),
    reg({ date: "2026-03-10", payee: "Costco", group: "Bills", category: "Mortgage", memo: "Split (2/2) extra", amount: -3_000n }),
  ];
  const ds = reconstruct(register, [], CUTOFF);

  const acct = (name: string) => ds.accounts.find((a) => a.name === name)!;
  const cat = (name: string) => ds.categories.find((c) => c.name === name)!;
  const leg = (accountName: string, amount: bigint) =>
    ds.transactions.find(
      (t) => t.accountId === acct(accountName).id && t.amount === amount,
    )!;

  it("maps account types and on-budget flags", () => {
    expect(acct("🟠 PNC Spend")).toMatchObject({ type: "checking", onBudget: true });
    expect(acct("🟥 Bank of America")).toMatchObject({ type: "credit_card", onBudget: true });
    expect(acct("🟣 Ally Bank")).toMatchObject({ type: "savings", onBudget: true });
    expect(acct("🏠 Pennymac")).toMatchObject({ type: "tracking_liability", onBudget: false });
  });

  it("auto-creates one payment category per credit card", () => {
    const pay = cat("🟥 Bank of America");
    expect(pay.linkedAccountId).toBe(acct("🟥 Bank of America").id);
    const group = ds.groups.find((g) => g.id === pay.groupId)!;
    expect(group.name).toBe("Credit Card Payments");
  });

  it("links a cash↔cash transfer pair both ways", () => {
    const out = leg("🟠 PNC Spend", -5_000n);
    const into = leg("🟣 Ally Bank", 5_000n);
    expect(out.transferAccountId).toBe(acct("🟣 Ally Bank").id);
    expect(into.transferAccountId).toBe(acct("🟠 PNC Spend").id);
    expect(out.transferTransactionId).toBe(into.id);
    expect(into.transferTransactionId).toBe(out.id);
    expect(out.categoryId).toBeNull();
  });

  it("keeps the category on the budget side of a budget→tracking transfer", () => {
    const budgetSide = leg("🟣 Ally Bank", -100_000n);
    const trackingSide = leg("🏠 Pennymac", 100_000n);
    expect(budgetSide.categoryId).toBe(cat("Mortgage").id);
    expect(trackingSide.categoryId).toBeNull();
    expect(budgetSide.transferTransactionId).toBe(trackingSide.id);
  });

  it("routes a cash→card payment via transferAccountId", () => {
    const payment = leg("🟠 PNC Spend", -15_000n);
    expect(payment.transferAccountId).toBe(acct("🟥 Bank of America").id);
    expect(payment.categoryId).toBeNull();
  });

  it("rebuilds a split into a parent plus summed subtransactions", () => {
    const parent = ds.transactions.find(
      (t) =>
        t.accountId === acct("🟠 PNC Spend").id &&
        t.amount === -10_000n &&
        t.categoryId === null,
    )!;
    const subs = ds.subtransactions.filter((s) => s.transactionId === parent.id);
    expect(subs).toHaveLength(2);
    expect(subs.reduce((sum, s) => sum + s.amount, 0n)).toBe(-10_000n);
    expect(subs.map((s) => s.categoryId).sort()).toEqual(
      [cat("Grocer").id, cat("Mortgage").id].sort(),
    );
    expect(subs.map((s) => s.memo).sort()).toEqual(["extra", "food"]);
  });

  it("counts 10 transactions (split collapses 2 rows into 1 parent)", () => {
    expect(ds.transactions).toHaveLength(10);
    expect(ds.warnings).toHaveLength(0);
  });
});

describe("reconstruct — assignment cutoff (Option B)", () => {
  it("imports category_months only for months ≤ the cutoff month", () => {
    const register: RegisterRow[] = [
      reg({ date: "2026-03-01", payee: "Job", group: "Inflow", category: "Ready to Assign", amount: 100_000n }),
    ];
    const budget: BudgetRow[] = [
      { month: "2026-03-01", group: "Wants", category: "Grocer", assigned: 4_000n, activity: 0n, available: 4_000n },
      { month: "2026-06-01", group: "Wants", category: "Grocer", assigned: 5_000n, activity: 0n, available: 9_000n },
    ];
    const ds = reconstruct(register, budget, CUTOFF);
    expect(ds.categoryMonths.map((m) => m.month)).toEqual(["2026-03-01"]);
    // …but both months are still available for the validation diff.
    expect(ds.expected.map((e) => e.month).sort()).toEqual([
      "2026-03-01",
      "2026-06-01",
    ]);
  });
});

describe("reconstruct — fail-closed guards", () => {
  it("throws on an account name not in the type map", () => {
    expect(() =>
      reconstruct([reg({ account: "Mystery Bank", group: "Wants", category: "Grocer", amount: -1_000n })], [], CUTOFF),
    ).toThrow(/Unknown account/);
  });

  it("throws on a transfer inside a split (the engine can't model it)", () => {
    expect(() =>
      reconstruct(
        [
          reg({ payee: "Transfer : 🟣 Ally Bank", memo: "Split (1/2) a", amount: -1_000n }),
          reg({ payee: "Transfer : 🟣 Ally Bank", memo: "Split (2/2) b", amount: -2_000n }),
        ],
        [],
        CUTOFF,
      ),
    ).toThrow(/transfer inside a split/);
  });
});

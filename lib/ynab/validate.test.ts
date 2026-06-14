import { describe, expect, it } from "vitest";

import { reconstruct } from "./reconstruct";
import type { BudgetRow, RegisterRow } from "./types";
import { validate } from "./validate";

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

// $10 income, assign $4 to Grocer, spend $3 cash → available $1; cash on hand
// $7 = RTA $6 + available $1. YNAB's exported numbers agree, so it validates.
function build() {
  const register: RegisterRow[] = [
    reg({ date: "2026-03-01", payee: "Job", group: "Inflow", category: "Ready to Assign", amount: 10_000n }),
    reg({ date: "2026-03-10", payee: "Store", group: "Wants", category: "Grocer", amount: -3_000n }),
  ];
  const budget: BudgetRow[] = [
    { month: "2026-03-01", group: "Wants", category: "Grocer", assigned: 4_000n, activity: -3_000n, available: 1_000n },
  ];
  return reconstruct(register, budget, "2026-05-15");
}

describe("validate", () => {
  it("passes when the engine reproduces YNAB's numbers and the invariant holds", () => {
    const result = validate(build());
    expect(result.mismatches).toEqual([]);
    expect(result.invariants.every((c) => c.residualOk)).toBe(true);
    expect(result.cashBalance).toBe(7_000n);
    expect(result.finalRta).toBe(6_000n);
    expect(result.finalAvailable).toBe(1_000n);
    expect(result.ok).toBe(true);
  });

  it("flags a per-category mismatch when YNAB's Available disagrees", () => {
    const ds = build();
    ds.expected.find((e) => e.categoryName === "Grocer")!.available = 999_999n;
    const result = validate(ds);
    expect(result.ok).toBe(false);
    expect(
      result.mismatches.some(
        (m) => m.field === "available" && m.categoryName === "Grocer",
      ),
    ).toBe(true);
  });
});

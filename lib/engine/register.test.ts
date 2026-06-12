import { describe, expect, it } from "vitest";

import {
  accountBalances,
  registerBalances,
  sidebarTotals,
  type AccountForTotals,
} from "@/lib/engine/register";

describe("registerBalances", () => {
  it("returns zeros for an empty register", () => {
    expect(registerBalances([])).toEqual({
      cleared: 0n,
      uncleared: 0n,
      working: 0n,
    });
  });

  it("splits cleared and uncleared and sums the working balance", () => {
    const txns = [
      { amount: 3_500_000n, cleared: "cleared" as const },
      { amount: -84_120n, cleared: "cleared" as const },
      { amount: -42_070n, cleared: "uncleared" as const },
      { amount: 230_190n, cleared: "uncleared" as const },
    ];
    const b = registerBalances(txns);
    expect(b.cleared).toBe(3_415_880n);
    expect(b.uncleared).toBe(188_120n);
    expect(b.working).toBe(3_604_000n);
  });

  it("counts reconciled transactions as cleared", () => {
    const b = registerBalances([
      { amount: 1_000n, cleared: "reconciled" as const },
      { amount: 500n, cleared: "uncleared" as const },
    ]);
    expect(b.cleared).toBe(1_000n);
    expect(b.uncleared).toBe(500n);
    expect(b.working).toBe(1_500n);
  });

  it("handles negative working balances", () => {
    const b = registerBalances([
      { amount: -638_500n, cleared: "cleared" as const },
    ]);
    expect(b.cleared).toBe(-638_500n);
    expect(b.working).toBe(-638_500n);
  });
});

describe("accountBalances", () => {
  it("sums per account and defaults missing accounts to 0n via the map", () => {
    const balances = accountBalances([
      { accountId: "a", amount: 1_000n },
      { accountId: "a", amount: -250n },
      { accountId: "b", amount: 500n },
    ]);
    expect(balances.get("a")).toBe(750n);
    expect(balances.get("b")).toBe(500n);
    expect(balances.get("missing")).toBeUndefined();
  });
});

describe("sidebarTotals", () => {
  const acct = (
    id: string,
    onBudget: boolean,
    closed = false,
  ): AccountForTotals => ({ id, onBudget, closed });

  it("splits budget and tracking totals and sums the net total", () => {
    const accounts = [
      acct("checking", true),
      acct("cc", true),
      acct("brokerage", false),
      acct("car-loan", false),
    ];
    const balances = new Map<string, bigint>([
      ["checking", 4_812_330n],
      ["cc", -638_500n],
      ["brokerage", 48_920_110n],
      ["car-loan", -11_438_270n],
    ]);
    expect(sidebarTotals(accounts, balances)).toEqual({
      budgetTotal: 4_173_830n,
      trackingTotal: 37_481_840n,
      netTotal: 41_655_670n,
    });
  });

  it("treats accounts without transactions as zero", () => {
    const totals = sidebarTotals([acct("new", true)], new Map());
    expect(totals).toEqual({ budgetTotal: 0n, trackingTotal: 0n, netTotal: 0n });
  });

  it("excludes closed accounts from all totals", () => {
    const accounts = [acct("open", true), acct("closed", true, true)];
    const balances = new Map<string, bigint>([
      ["open", 1_000n],
      ["closed", 99_000n],
    ]);
    expect(sidebarTotals(accounts, balances)).toEqual({
      budgetTotal: 1_000n,
      trackingTotal: 0n,
      netTotal: 1_000n,
    });
  });
});

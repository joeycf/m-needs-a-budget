import { describe, expect, it } from "vitest";

import { parseBudget, parseBudgetMonth, parseRegister } from "./parse";

const REGISTER_HEADER = [
  "Account",
  "Flag",
  "Date",
  "Payee",
  "Category Group/Category",
  "Category Group",
  "Category",
  "Memo",
  "Outflow",
  "Inflow",
  "Cleared",
];

function registerRow(over: Record<string, string> = {}): string[] {
  const base: Record<string, string> = {
    Account: "🟠 PNC Spend",
    Flag: "",
    Date: "03/10/2026",
    Payee: "Store",
    "Category Group/Category": "Wants: Grocer",
    "Category Group": "Wants",
    Category: "Grocer",
    Memo: "",
    Outflow: "$12.34",
    Inflow: "$0.00",
    Cleared: "Reconciled",
    ...over,
  };
  return REGISTER_HEADER.map((h) => base[h]);
}

describe("parseRegister", () => {
  it("computes amount = inflow − outflow as milliunits", () => {
    const [row] = parseRegister([REGISTER_HEADER, registerRow()]);
    expect(row.amount).toBe(-12_340n);
  });

  it("treats inflow as positive income", () => {
    const [row] = parseRegister([
      REGISTER_HEADER,
      registerRow({ Outflow: "$0.00", Inflow: "$1950.00", Category: "Ready to Assign", "Category Group": "Inflow" }),
    ]);
    expect(row.amount).toBe(1_950_000n);
  });

  it("maps Cleared and normalizes date to ISO, flag to null when blank", () => {
    const [row] = parseRegister([REGISTER_HEADER, registerRow({ Cleared: "Uncleared" })]);
    expect(row.cleared).toBe("uncleared");
    expect(row.date).toBe("2026-03-10");
    expect(row.flag).toBeNull();
  });

  it("applies the corrupted-account alias", () => {
    const [row] = parseRegister([
      REGISTER_HEADER,
      registerRow({ Account: "������ PNC Growth" }),
    ]);
    expect(row.account).toBe("🟠 PNC Growth");
  });
});

const BUDGET_HEADER = [
  "Month",
  "Category Group/Category",
  "Category Group",
  "Category",
  "Assigned",
  "Activity",
  "Available",
];

describe("parseBudget", () => {
  it("parses signed activity/available and the month label", () => {
    const [row] = parseBudget([
      BUDGET_HEADER,
      ["Jun 2020", "Flex: Coffee", "Flex", "Coffee", "$6.45", "-$6.45", "$0.00"],
    ]);
    expect(row).toMatchObject({
      month: "2020-06-01",
      category: "Coffee",
      assigned: 6_450n,
      activity: -6_450n,
      available: 0n,
    });
  });
});

describe("parseBudgetMonth", () => {
  it("turns 'MMM yyyy' into the first of the month", () => {
    expect(parseBudgetMonth("Jun 2020")).toBe("2020-06-01");
    expect(parseBudgetMonth("Dec 2026")).toBe("2026-12-01");
  });

  it("throws on a malformed month", () => {
    expect(() => parseBudgetMonth("nope")).toThrow();
  });
});

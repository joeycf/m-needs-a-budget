import { describe, expect, it } from "vitest";

import {
  formatMonthLabel,
  formatRegisterDate,
  mobileDateLabel,
  parseRegisterDate,
  todayISO,
} from "@/lib/dates";

describe("todayISO", () => {
  it("returns a yyyy-MM-dd string", () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatRegisterDate", () => {
  it("formats ISO dates as MM/DD/YYYY per the register design", () => {
    expect(formatRegisterDate("2026-06-11")).toBe("06/11/2026");
    expect(formatRegisterDate("2026-05-30")).toBe("05/30/2026");
  });
});

describe("parseRegisterDate", () => {
  it("parses MM/DD/YYYY and M/D/YYYY to ISO", () => {
    expect(parseRegisterDate("06/11/2026")).toBe("2026-06-11");
    expect(parseRegisterDate("6/1/2026")).toBe("2026-06-01");
  });

  it("accepts ISO input unchanged", () => {
    expect(parseRegisterDate("2026-06-11")).toBe("2026-06-11");
  });

  it("rejects invalid dates", () => {
    expect(parseRegisterDate("13/40/2026")).toBeNull();
    expect(parseRegisterDate("2026-02-30")).toBeNull();
    expect(parseRegisterDate("yesterday")).toBeNull();
    expect(parseRegisterDate("")).toBeNull();
  });
});

describe("formatMonthLabel", () => {
  it("formats budget months as full month + year", () => {
    expect(formatMonthLabel("2026-06-01")).toBe("June 2026");
    expect(formatMonthLabel("2025-12-01")).toBe("December 2025");
  });
});

describe("mobileDateLabel", () => {
  const today = "2026-06-11";

  it("labels today and yesterday", () => {
    expect(mobileDateLabel("2026-06-11", today)).toBe("Today");
    expect(mobileDateLabel("2026-06-10", today)).toBe("Yesterday");
  });

  it("labels other dates as full month + day", () => {
    expect(mobileDateLabel("2026-06-09", today)).toBe("June 9");
    expect(mobileDateLabel("2026-05-30", today)).toBe("May 30");
  });

  it("includes the year for other calendar years", () => {
    expect(mobileDateLabel("2025-12-31", today)).toBe("December 31, 2025");
  });
});

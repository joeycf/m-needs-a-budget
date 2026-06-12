import { describe, expect, it } from "vitest";

import {
  formatMilliunits,
  milliunitsToInput,
  parseMoneyToMilliunits,
} from "@/lib/money";

describe("formatMilliunits", () => {
  it("formats zero", () => {
    expect(formatMilliunits(0n)).toBe("$0.00");
  });

  it("formats whole dollars with two decimals", () => {
    expect(formatMilliunits(3_500_000n)).toBe("$3,500.00");
  });

  it("formats cents", () => {
    expect(formatMilliunits(1_234_560n)).toBe("$1,234.56");
  });

  it("uses a true minus sign (U+2212) for negatives", () => {
    expect(formatMilliunits(-42_070n)).toBe("−$42.07");
  });

  it("groups thousands", () => {
    expect(formatMilliunits(12_250_000n)).toBe("$12,250.00");
    expect(formatMilliunits(1_234_567_890n)).toBe("$1,234,567.89");
  });

  it("truncates sub-cent milliunits toward zero", () => {
    expect(formatMilliunits(1_999n)).toBe("$1.99");
    expect(formatMilliunits(-1_999n)).toBe("−$1.99");
  });
});

describe("milliunitsToInput", () => {
  it("renders the unsigned magnitude for editor fields", () => {
    expect(milliunitsToInput(84_120n)).toBe("84.12");
    expect(milliunitsToInput(-1_800_000n)).toBe("1800.00");
    expect(milliunitsToInput(0n)).toBe("0.00");
  });

  it("round-trips through parseMoneyToMilliunits", () => {
    expect(parseMoneyToMilliunits(milliunitsToInput(42_070n))).toBe(42_070n);
  });
});

describe("parseMoneyToMilliunits", () => {
  it("parses plain dollar amounts", () => {
    expect(parseMoneyToMilliunits("5")).toBe(5_000n);
    expect(parseMoneyToMilliunits("42.07")).toBe(42_070n);
  });

  it("parses currency symbols, commas, and spaces", () => {
    expect(parseMoneyToMilliunits("$1,234.56")).toBe(1_234_560n);
    expect(parseMoneyToMilliunits(" 1 234.56 ")).toBe(1_234_560n);
  });

  it("parses negatives with hyphen or true minus", () => {
    expect(parseMoneyToMilliunits("-42.07")).toBe(-42_070n);
    expect(parseMoneyToMilliunits("−$638.50")).toBe(-638_500n);
  });

  it("parses partial decimals", () => {
    expect(parseMoneyToMilliunits(".5")).toBe(500n);
    expect(parseMoneyToMilliunits("5.")).toBe(5_000n);
    expect(parseMoneyToMilliunits("5.3")).toBe(5_300n);
  });

  it("parses amounts beyond float precision exactly (no floats)", () => {
    expect(parseMoneyToMilliunits("90071992547409.93")).toBe(
      90_071_992_547_409_930n,
    );
  });

  it("returns null for blank input", () => {
    expect(parseMoneyToMilliunits("")).toBeNull();
    expect(parseMoneyToMilliunits("   ")).toBeNull();
    expect(parseMoneyToMilliunits("$")).toBeNull();
  });

  it("rejects garbage and malformed numbers", () => {
    expect(parseMoneyToMilliunits("abc")).toBeNull();
    expect(parseMoneyToMilliunits("1.2.3")).toBeNull();
    expect(parseMoneyToMilliunits("--5")).toBeNull();
    expect(parseMoneyToMilliunits("1.234")).toBeNull(); // > 2 decimals
    expect(parseMoneyToMilliunits("5-")).toBeNull();
  });
});

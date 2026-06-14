import { describe, expect, it } from "vitest";

import { parseCsv, withHeader } from "./csv";

describe("parseCsv", () => {
  it("parses simple quoted rows", () => {
    expect(parseCsv('"a","b","c"\n"1","2","3"')).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    // A YNAB memo like "CeraVe, Ultra-Light" must stay one field.
    expect(parseCsv('"x","CeraVe, Ultra-Light","y"')).toEqual([
      ["x", "CeraVe, Ultra-Light", "y"],
    ]);
  });

  it('unescapes doubled quotes ("")', () => {
    expect(parseCsv('"she said ""hi""","ok"')).toEqual([['she said "hi"', "ok"]]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('"line1\nline2","b"')).toEqual([["line1\nline2", "b"]]);
  });

  it("strips a leading UTF-8 BOM and handles CRLF", () => {
    expect(parseCsv('﻿"a","b"\r\n"1","2"\r\n')).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("preserves emoji and empty trailing fields", () => {
    expect(parseCsv('"🟠 PNC Spend","",""')).toEqual([["🟠 PNC Spend", "", ""]]);
  });

  it("does not emit a spurious row for a trailing newline", () => {
    expect(parseCsv('"a"\n')).toHaveLength(1);
  });
});

describe("withHeader", () => {
  it("indexes columns by name and drops blank trailing rows", () => {
    const { index, data } = withHeader([
      ["Account", "Amount"],
      ["PNC", "$1.00"],
      ["", ""],
    ]);
    expect(index("Amount")).toBe(1);
    expect(data).toEqual([["PNC", "$1.00"]]);
  });

  it("throws on a missing expected column", () => {
    expect(() => withHeader([["Account"]]).index("Nope")).toThrow(/missing expected column/);
  });
});

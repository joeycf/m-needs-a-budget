// Money lives as integer milliunits (bigint, $1.00 = 1000n) everywhere;
// these are the only conversion points to and from user-facing strings.

const MONEY_INPUT = /^([-−])?(\d*)(?:\.(\d*))?$/;

/** "$1,234.56" with a true minus sign (−) for negatives. Sub-cent
 *  milliunits truncate toward zero. */
export function formatMilliunits(milli: bigint): string {
  const negative = milli < 0n;
  const abs = negative ? -milli : milli;
  const dollars = (abs / 1000n).toLocaleString("en-US");
  const cents = ((abs % 1000n) / 10n).toString().padStart(2, "0");
  return `${negative ? "−" : ""}$${dollars}.${cents}`;
}

/** Parse user input ("$1,234.56", "-42.07", ".5") to milliunits without
 *  ever going through a float. Blank or malformed input returns null. */
export function parseMoneyToMilliunits(input: string): bigint | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  const match = MONEY_INPUT.exec(cleaned);
  if (!match) return null;

  const [, sign, whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return null;
  if (fraction.length > 2) return null;

  const milli =
    BigInt(whole === "" ? 0 : whole) * 1000n +
    BigInt(fraction.padEnd(3, "0"));
  return sign ? -milli : milli;
}

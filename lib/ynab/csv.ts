// Minimal RFC-4180 CSV parser for the one-time YNAB import (M10). YNAB's
// Register.csv / Budget.csv quote every field, escape embedded quotes as "",
// and put commas, newlines, and emoji inside fields — so naive `split(",")`
// is wrong (verified: register memos contain `","`). No new dependency
// (iron rule 7); this is the whole parser.

/** Parse CSV text into rows of string fields. Strips a leading UTF-8 BOM,
 *  handles "" escapes and quoted commas/newlines, and tolerates both CRLF and
 *  LF. A trailing newline does not produce a spurious empty row. */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawField = false; // distinguishes a real empty trailing field from EOF

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      sawField = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
      sawField = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      if (sawField || field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
      }
      row = [];
      field = "";
      sawField = false;
    } else {
      field += char;
      sawField = true;
    }
  }
  if (sawField || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Split a parsed sheet into its header row and a column-name accessor over the
 *  data rows. Throws if an expected column is missing — fail fast on an
 *  unexpected export shape rather than silently reading `undefined`. */
export function withHeader(rows: string[][]): {
  header: string[];
  data: string[][];
  index: (column: string) => number;
} {
  const [header, ...data] = rows;
  if (!header) throw new Error("CSV is empty");
  const index = (column: string): number => {
    const at = header.indexOf(column);
    if (at === -1) {
      throw new Error(
        `CSV missing expected column ${JSON.stringify(column)}; got [${header
          .map((h) => JSON.stringify(h))
          .join(", ")}]`,
      );
    }
    return at;
  };
  // Drop fully-blank trailing rows (some exports end with one).
  return { header, data: data.filter((r) => r.some((c) => c !== "")), index };
}

import { format, isValid, parse } from "date-fns";

import { parseRegisterDate } from "@/lib/dates";
import { parseMoneyToMilliunits } from "@/lib/money";
import type { ClearedStatus } from "@/lib/db/schema";
import { withHeader } from "./csv";
import { canonicalAccountName, type BudgetRow, type RegisterRow } from "./types";

// Raw YNAB rows → normalized records. Amounts go through lib/money string math
// (never a float, iron rule 1); dates through lib/dates. Anything unparseable
// throws with row context rather than importing a silent zero.

/** "$1,234.56" / "-$6.45" / "" → milliunits (blank = 0). */
function money(raw: string, rowNum: number, column: string): bigint {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "$0.00") return 0n;
  const parsed = parseMoneyToMilliunits(trimmed);
  if (parsed === null) {
    throw new Error(
      `Row ${rowNum}: cannot parse ${column} amount ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

const CLEARED: Record<string, ClearedStatus> = {
  Uncleared: "uncleared",
  Cleared: "cleared",
  Reconciled: "reconciled",
};

function cleared(raw: string, rowNum: number): ClearedStatus {
  const mapped = CLEARED[raw.trim()];
  if (!mapped) {
    throw new Error(`Row ${rowNum}: unknown Cleared value ${JSON.stringify(raw)}`);
  }
  return mapped;
}

/** YNAB budget month label "Jun 2020" → "2020-06-01". */
export function parseBudgetMonth(raw: string): string {
  const parsed = parse(raw.trim(), "MMM yyyy", new Date());
  if (!isValid(parsed)) {
    throw new Error(`Cannot parse budget month ${JSON.stringify(raw)}`);
  }
  return format(parsed, "yyyy-MM-01");
}

export function parseRegister(rows: string[][]): RegisterRow[] {
  const { data, index } = withHeader(rows);
  const cAccount = index("Account");
  const cFlag = index("Flag");
  const cDate = index("Date");
  const cPayee = index("Payee");
  const cGroup = index("Category Group");
  const cCategory = index("Category");
  const cMemo = index("Memo");
  const cOutflow = index("Outflow");
  const cInflow = index("Inflow");
  const cCleared = index("Cleared");

  return data.map((r, i) => {
    const rowNum = i + 1;
    const date = parseRegisterDate(r[cDate]);
    if (date === null) {
      throw new Error(`Row ${rowNum}: cannot parse Date ${JSON.stringify(r[cDate])}`);
    }
    const flag = r[cFlag].trim();
    return {
      rowNum,
      account: canonicalAccountName(r[cAccount]),
      flag: flag === "" ? null : flag,
      date,
      payee: r[cPayee],
      group: r[cGroup],
      category: r[cCategory],
      memo: r[cMemo],
      amount: money(r[cInflow], rowNum, "Inflow") - money(r[cOutflow], rowNum, "Outflow"),
      cleared: cleared(r[cCleared], rowNum),
    } satisfies RegisterRow;
  });
}

export function parseBudget(rows: string[][]): BudgetRow[] {
  const { data, index } = withHeader(rows);
  const cMonth = index("Month");
  const cGroup = index("Category Group");
  const cCategory = index("Category");
  const cAssigned = index("Assigned");
  const cActivity = index("Activity");
  const cAvailable = index("Available");

  return data.map((r, i) => {
    const rowNum = i + 1;
    return {
      month: parseBudgetMonth(r[cMonth]),
      group: r[cGroup],
      category: r[cCategory],
      assigned: money(r[cAssigned], rowNum, "Assigned"),
      activity: money(r[cActivity], rowNum, "Activity"),
      available: money(r[cAvailable], rowNum, "Available"),
    } satisfies BudgetRow;
  });
}

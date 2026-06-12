import { formatRegisterDate } from "@/lib/dates";
import type {
  CategoryOption,
  PayeeOption,
  RegisterRow,
} from "@/lib/db/queries";
import { milliunitsToInput } from "@/lib/money";

export type { CategoryOption, PayeeOption, RegisterRow };

/** Account context the register needs (full account rows stay server-side). */
export interface RegisterAccount {
  id: string;
  name: string;
  note: string | null;
  onBudget: boolean;
  closed: boolean;
}

/** Option for the account picker in the All Accounts add row. */
export interface AccountPickOption {
  id: string;
  name: string;
  onBudget: boolean;
}

export type DatePreset = "month" | "30d" | "year" | "all";

export interface RegisterFilters {
  search: string;
  datePreset: DatePreset;
  categoryId: string | null;
  payeeId: string | null;
  unclearedOnly: boolean;
}

export const DEFAULT_FILTERS: RegisterFilters = {
  search: "",
  datePreset: "month",
  categoryId: null,
  payeeId: null,
  unclearedOnly: false,
};

/** Editor field state for the add/edit row and the mobile sheet.
 *  Amounts and dates stay raw strings; the server action parses them. */
export interface TxnDraft {
  accountId: string;
  date: string;
  payeeName: string;
  categoryId: string | null;
  memo: string;
  outflow: string;
  inflow: string;
}

export function draftFromRow(row: RegisterRow): TxnDraft {
  return {
    accountId: row.accountId,
    date: formatRegisterDate(row.date),
    payeeName: row.payeeName ?? "",
    categoryId: row.categoryId,
    memo: row.memo ?? "",
    outflow: row.amount < 0n ? milliunitsToInput(row.amount) : "",
    inflow: row.amount > 0n ? milliunitsToInput(row.amount) : "",
  };
}

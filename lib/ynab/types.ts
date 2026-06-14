import type { AccountType, ClearedStatus } from "@/lib/db/schema";

// Shared records + the user-specific account mapping for the M10 YNAB import.
// Money is integer milliunits everywhere (iron rule 1); dates are ISO
// "yyyy-MM-dd"; months are "yyyy-MM-01".

// ---------------------------------------------------------------------------
// Account mapping — the one thing the YNAB export does NOT carry.
// ---------------------------------------------------------------------------
//
// Cards proven by Budget.csv's "Credit Card Payments" group; on- vs off-budget
// proven by each "Starting Balance" row's category (categorized to Ready to
// Assign = cash/on-budget; uncategorized = tracking). checking-vs-savings and
// asset-vs-liability are cosmetic to the engine (cash class is uniform;
// tracking only affects net-worth reports), so they're best-effort labels —
// edit freely before a --commit run.

export interface YnabAccountConfig {
  type: AccountType;
  closed?: boolean;
}

export const ACCOUNT_TYPES: Record<string, YnabAccountConfig> = {
  "🟠 PNC Spend": { type: "checking" },
  "🟣 Ally Bank": { type: "savings" },
  "🟠 PNC Growth": { type: "savings" },
  "❌ PNC Reserve": { type: "savings", closed: true },
  "🟥 Bank of America": { type: "credit_card" },
  "🟦 Capital One": { type: "credit_card" },
  "🟨 Synchrony": { type: "credit_card" },
  "👵🏽 Voya": { type: "tracking_asset" },
  "👵🏽 Fidelity": { type: "tracking_asset" },
  "🎓 Maryland 529": { type: "tracking_asset" },
  "🏡 1206 Gaither Rd": { type: "tracking_asset" },
  "🏠 Pennymac": { type: "tracking_liability" },
  "🚙 Chase": { type: "tracking_liability" },
};

// One register row (1 of 5,957) carries a corrupted-encoding account name that
// is really "🟠 PNC Growth" — and it is one leg of a PNC Growth↔PNC Spend
// transfer, so normalizing it here also lets that transfer pair cleanly.
export const ACCOUNT_ALIASES: Record<string, string> = {
  "������ PNC Growth": "🟠 PNC Growth",
};

/** Canonical account name after applying known-corruption aliases. */
export function canonicalAccountName(raw: string): string {
  return ACCOUNT_ALIASES[raw] ?? raw;
}

export const ON_BUDGET_TYPES: ReadonlySet<AccountType> = new Set<AccountType>([
  "checking",
  "savings",
  "cash",
  "credit_card",
]);

export const CASH_TYPES: ReadonlySet<AccountType> = new Set<AccountType>([
  "checking",
  "savings",
  "cash",
]);

// ---------------------------------------------------------------------------
// Parsed rows
// ---------------------------------------------------------------------------

/** One Register.csv row, normalized. `category`/`group` are "" when blank. */
export interface RegisterRow {
  rowNum: number; // 1-based data row, for error messages
  account: string; // canonical (aliased) account name
  flag: string | null;
  date: string; // yyyy-MM-dd
  payee: string; // raw; may be "Transfer : <Account>"
  group: string; // Category Group ("", "Inflow", "Hidden Categories", real)
  category: string; // Category ("", "Ready to Assign", a real/card name)
  memo: string; // raw; split children start with "Split (k/n) "
  amount: bigint; // inflow − outflow, milliunits
  cleared: ClearedStatus;
}

/** One Budget.csv row, normalized. */
export interface BudgetRow {
  month: string; // yyyy-MM-01
  group: string;
  category: string;
  assigned: bigint;
  activity: bigint;
  available: bigint;
}

// ---------------------------------------------------------------------------
// Reconstructed dataset (ids pre-generated so cross-refs need no update pass)
// ---------------------------------------------------------------------------

export interface AccountRecord {
  id: string;
  name: string;
  type: AccountType;
  onBudget: boolean;
  closed: boolean;
  sortOrder: number;
}

export interface GroupRecord {
  id: string;
  name: string;
  isSystem: boolean;
  hidden: boolean;
  sortOrder: number;
}

export interface CategoryRecord {
  id: string;
  groupId: string;
  name: string;
  hidden: boolean;
  isSystem: boolean;
  linkedAccountId: string | null;
  sortOrder: number;
  /** Derived flag for the engine; not a column. */
  isReadyToAssign: boolean;
}

export interface PayeeRecord {
  id: string;
  name: string;
  transferAccountId: string | null;
}

export interface TransactionRecord {
  id: string;
  accountId: string;
  date: string;
  amount: bigint;
  payeeId: string | null;
  categoryId: string | null; // null: split parent / on-budget↔on-budget transfer / tracking
  memo: string | null;
  cleared: ClearedStatus;
  flag: string | null;
  transferAccountId: string | null;
  transferTransactionId: string | null;
}

export interface SubtransactionRecord {
  id: string;
  transactionId: string;
  amount: bigint;
  categoryId: string | null;
  memo: string | null;
}

export interface CategoryMonthRecord {
  categoryId: string;
  month: string;
  assigned: bigint;
}

/** YNAB's own per-(category, month) numbers, resolved to our category id, for
 *  the validation diff. */
export interface ExpectedCell {
  categoryId: string;
  categoryName: string;
  month: string;
  assigned: bigint;
  activity: bigint;
  available: bigint;
}

export interface Dataset {
  budgetName: string;
  accounts: AccountRecord[];
  groups: GroupRecord[];
  categories: CategoryRecord[];
  payees: PayeeRecord[];
  transactions: TransactionRecord[];
  subtransactions: SubtransactionRecord[];
  categoryMonths: CategoryMonthRecord[];
  expected: ExpectedCell[];
  cutoff: string; // yyyy-MM-dd
  cutoffMonth: string; // yyyy-MM-01
  /** Non-fatal data observations surfaced in the report. */
  warnings: string[];
}

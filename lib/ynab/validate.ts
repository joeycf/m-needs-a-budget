import {
  computeBudget,
  monthOfDate,
  nextMonth,
  type BudgetInput,
  type EngineSubtransaction,
  type EngineTransaction,
} from "@/lib/engine/budget";
import { formatMilliunits } from "@/lib/money";
import { CASH_TYPES, type Dataset } from "./types";

// The milestone's real deliverable: replay the imported history through the
// production engine (lib/engine/budget.ts) and diff against YNAB's own exported
// numbers. Two independent legs:
//   1. per-(category, month) Assigned/Activity/Available vs Budget.csv, and
//   2. the §4 invariant (Σ cash = RTA + Σ available [+ residual]) — the
//      non-circular tie between Ready to Assign and real account balances,
//      checked exactly as lib/engine/budget.test.ts's property test does.

export interface Mismatch {
  categoryName: string;
  month: string;
  field: "assigned" | "activity" | "available";
  ynab: bigint;
  engine: bigint;
  isPaymentCategory: boolean;
}

export interface InvariantCheck {
  month: string;
  cash: bigint;
  rta: bigint;
  available: bigint;
  creditOverspent: bigint;
  residualOk: boolean; // cash === rta + available + creditOverspent
  verbatimOk: boolean; // cash === rta + available (expected after `last`)
}

export interface ValidationResult {
  cellsCompared: number;
  monthsCompared: number;
  mismatches: Mismatch[];
  invariants: InvariantCheck[];
  lastDataMonth: string;
  cashBalance: bigint;
  finalRta: bigint;
  finalAvailable: bigint;
  ok: boolean;
}

/** Build the pure engine input from the reconstructed dataset, attaching split
 *  children as subtransactions (the production query won't load these until
 *  M6, but the engine has always supported them — see budget.test.ts). */
function toBudgetInput(dataset: Dataset): BudgetInput {
  const subsByParent = new Map<string, EngineSubtransaction[]>();
  for (const sub of dataset.subtransactions) {
    const list = subsByParent.get(sub.transactionId);
    const entry = { amount: sub.amount, categoryId: sub.categoryId };
    if (list) list.push(entry);
    else subsByParent.set(sub.transactionId, [entry]);
  }
  const transactions: EngineTransaction[] = dataset.transactions.map((t) => {
    const subs = subsByParent.get(t.id);
    return {
      accountId: t.accountId,
      date: t.date,
      amount: t.amount,
      categoryId: t.categoryId,
      transferAccountId: t.transferAccountId,
      ...(subs ? { subtransactions: subs } : {}),
    };
  });
  return {
    accounts: dataset.accounts.map((a) => ({
      id: a.id,
      type: a.type,
      onBudget: a.onBudget,
    })),
    categories: dataset.categories.map((c) => ({
      id: c.id,
      isReadyToAssign: c.isReadyToAssign,
      linkedAccountId: c.linkedAccountId,
    })),
    assignments: dataset.categoryMonths.map((m) => ({
      categoryId: m.categoryId,
      month: m.month,
      assigned: m.assigned,
    })),
    transactions,
  };
}

const maxMonth = (a: string, b: string): string => (a >= b ? a : b);

export function validate(dataset: Dataset): ValidationResult {
  const input = toBudgetInput(dataset);
  const { cutoffMonth } = dataset;

  // Latest month carrying data (≤ cutoffMonth by construction). The invariant
  // is meaningful at `last` and the two months after it (no data follows, so
  // available(m) and the all-time cash balance line up).
  let last = "0000-01-01";
  for (const t of dataset.transactions) last = maxMonth(last, monthOfDate(t.date));
  for (const m of dataset.categoryMonths) last = maxMonth(last, m.month);
  if (last === "0000-01-01") last = cutoffMonth;

  const afterLast = nextMonth(nextMonth(last));
  const through = maxMonth(afterLast, cutoffMonth);
  const months = computeBudget(input, through);

  // Leg 1 — per-(category, month) diff for fully-elapsed months (< cutoffMonth;
  // the cutoff month itself is partial — txns < cutoff but full-month YNAB
  // assignments — so it is excluded from pass/fail).
  const paymentCatIds = new Set(
    dataset.categories.filter((c) => c.linkedAccountId != null).map((c) => c.id),
  );
  const mismatches: Mismatch[] = [];
  const comparedMonths = new Set<string>();
  let cellsCompared = 0;
  for (const cell of dataset.expected) {
    if (cell.month >= cutoffMonth) continue;
    comparedMonths.add(cell.month);
    cellsCompared++;
    const row = months.get(cell.month)?.categories.get(cell.categoryId);
    const engine = row
      ? { assigned: row.assigned, activity: row.activity, available: row.available }
      : { assigned: 0n, activity: 0n, available: 0n };
    const isPaymentCategory = paymentCatIds.has(cell.categoryId);
    const fields = [
      ["assigned", cell.assigned, engine.assigned],
      ["activity", cell.activity, engine.activity],
      ["available", cell.available, engine.available],
    ] as const;
    for (const [field, ynab, eng] of fields) {
      if (ynab !== eng) {
        mismatches.push({
          categoryName: cell.categoryName,
          month: cell.month,
          field,
          ynab,
          engine: eng,
          isPaymentCategory,
        });
      }
    }
  }

  // Leg 2 — §4 invariant. Cash-class accounts only on the left (card debt is
  // not cash; payment categories hold the reserved cash on the right).
  const cashIds = new Set(
    dataset.accounts
      .filter((a) => CASH_TYPES.has(a.type))
      .map((a) => a.id),
  );
  let cashBalance = 0n;
  for (const t of dataset.transactions) {
    if (cashIds.has(t.accountId)) cashBalance += t.amount;
  }

  const invariants: InvariantCheck[] = [];
  for (const m of [last, nextMonth(last), afterLast]) {
    const state = months.get(m);
    if (!state) continue;
    let available = 0n;
    let creditOverspent = 0n;
    for (const row of state.categories.values()) {
      available += row.available;
      creditOverspent += row.creditOverspent;
    }
    invariants.push({
      month: m,
      cash: cashBalance,
      rta: state.readyToAssign,
      available,
      creditOverspent,
      residualOk: cashBalance === state.readyToAssign + available + creditOverspent,
      // Verbatim form is only expected once the data month has passed.
      verbatimOk: cashBalance === state.readyToAssign + available,
    });
  }

  const finalState = months.get(afterLast);
  let finalAvailable = 0n;
  for (const row of finalState?.categories.values() ?? []) {
    finalAvailable += row.available;
  }

  const invariantOk = invariants.every(
    (c) => c.residualOk && (c.month === last || c.verbatimOk),
  );
  return {
    cellsCompared,
    monthsCompared: comparedMonths.size,
    mismatches,
    invariants,
    lastDataMonth: last,
    cashBalance,
    finalRta: finalState?.readyToAssign ?? 0n,
    finalAvailable,
    ok: mismatches.length === 0 && invariantOk,
  };
}

const m$ = formatMilliunits;

/** Human-readable report. `limit` caps the per-mismatch detail lines. */
export function formatReport(
  dataset: Dataset,
  result: ValidationResult,
  limit = Infinity,
): string {
  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push("══════════════════════════════════════════════════════════════════");
  push("  YNAB IMPORT — VALIDATION REPORT");
  push("══════════════════════════════════════════════════════════════════");
  push(`Cutoff:        ${dataset.cutoff}  (transactions strictly before)`);
  push(`Cutoff month:  ${dataset.cutoffMonth}  (assignments imported through)`);
  push(`Last data month: ${result.lastDataMonth}`);
  push();
  push("Imported (in-memory):");
  push(`  accounts:        ${dataset.accounts.length}`);
  push(`  category groups: ${dataset.groups.length}`);
  push(`  categories:      ${dataset.categories.length}`);
  push(`  payees:          ${dataset.payees.length}`);
  push(`  transactions:    ${dataset.transactions.length}`);
  push(`  subtransactions: ${dataset.subtransactions.length}`);
  push(`  category_months: ${dataset.categoryMonths.length}`);
  push();

  if (dataset.warnings.length > 0) {
    push("Warnings:");
    for (const w of dataset.warnings) push(`  • ${w}`);
    push();
  }

  push("──────────────────────────────────────────────────────────────────");
  push("  Leg 1 — per-(category, month) vs YNAB Budget.csv (months < cutoff)");
  push("──────────────────────────────────────────────────────────────────");
  push(`Cells compared: ${result.cellsCompared} across ${result.monthsCompared} months`);
  const byField = { assigned: 0, activity: 0, available: 0 };
  let paymentMismatches = 0;
  for (const mm of result.mismatches) {
    byField[mm.field]++;
    if (mm.isPaymentCategory) paymentMismatches++;
  }
  push(
    `Mismatches: ${result.mismatches.length} ` +
      `(assigned ${byField.assigned}, activity ${byField.activity}, available ${byField.available}; ` +
      `${paymentMismatches} on credit-card payment categories)`,
  );
  if (result.mismatches.length > 0) {
    push();
    push("  month       field      category                         YNAB → engine (Δ)");
    let shown = 0;
    for (const mm of result.mismatches) {
      if (shown >= limit) {
        push(`  … ${result.mismatches.length - shown} more (see data/import-report.txt)`);
        break;
      }
      const name =
        mm.categoryName.length > 30
          ? mm.categoryName.slice(0, 29) + "…"
          : mm.categoryName.padEnd(30);
      push(
        `  ${mm.month}  ${mm.field.padEnd(9)}  ${name}  ` +
          `${m$(mm.ynab)} → ${m$(mm.engine)} (${m$(mm.engine - mm.ynab)})`,
      );
      shown++;
    }
  }
  push();

  push("──────────────────────────────────────────────────────────────────");
  push("  Leg 2 — §4 invariant: Σ cash = RTA + Σ available [+ creditOverspent]");
  push("──────────────────────────────────────────────────────────────────");
  for (const c of result.invariants) {
    const tag = c.month === result.lastDataMonth ? "residual" : "verbatim";
    const ok = c.residualOk && (c.month === result.lastDataMonth || c.verbatimOk);
    push(
      `  ${c.month} [${tag}] ${ok ? "OK  " : "FAIL"}  ` +
        `cash ${m$(c.cash)} = RTA ${m$(c.rta)} + avail ${m$(c.available)}` +
        (c.creditOverspent !== 0n ? ` + creditOverspent ${m$(c.creditOverspent)}` : ""),
    );
    if (!ok) {
      const rhs = c.rta + c.available + c.creditOverspent;
      push(`        → off by ${m$(c.cash - rhs)}`);
    }
  }
  push();
  push(
    `Final cash on hand ${m$(result.cashBalance)} = ` +
      `Ready to Assign ${m$(result.finalRta)} + ` +
      `Σ category Available ${m$(result.finalAvailable)}`,
  );
  push();
  push("══════════════════════════════════════════════════════════════════");
  push(`  RESULT: ${result.ok ? "PASS — engine reproduces YNAB exactly" : "REVIEW — see mismatches above"}`);
  push("══════════════════════════════════════════════════════════════════");
  return lines.join("\n");
}

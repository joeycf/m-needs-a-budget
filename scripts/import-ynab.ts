import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadEnvConfig } from "@next/env";

import { parseCsv } from "@/lib/ynab/csv";
import { parseBudget, parseRegister } from "@/lib/ynab/parse";
import { reconstruct } from "@/lib/ynab/reconstruct";
import { formatReport, validate } from "@/lib/ynab/validate";
import type { Dataset } from "@/lib/ynab/types";

// PRD §10 — one-time YNAB historical import. Reads Register.csv + Budget.csv
// from a gitignored data/ folder, reconstructs transfers/splits, replays the
// result through the engine and diffs it against YNAB's own numbers, and only
// writes to the DB when explicitly asked.
//
//   npm run import:ynab -- --cutoff 2026-06-15            # dry-run (default)
//   npm run import:ynab -- --cutoff 2026-06-15 --commit --wipe
//
// Dry-run never opens a DB connection (lib/db is imported only on --commit), so
// it runs without DATABASE_URL.

interface Args {
  cutoff: string;
  commit: boolean;
  wipe: boolean;
  dataDir: string;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { commit: false, wipe: false, dataDir: "data" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const valueOf = (flag: string): string => {
      const eq = arg.indexOf("=");
      if (eq !== -1) return arg.slice(eq + 1);
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (arg === "--commit") args.commit = true;
    else if (arg === "--wipe") args.wipe = true;
    else if (arg.startsWith("--cutoff")) args.cutoff = valueOf("--cutoff");
    else if (arg.startsWith("--data-dir")) args.dataDir = valueOf("--data-dir");
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.cutoff) {
    throw new Error("--cutoff <YYYY-MM-DD> is required");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.cutoff) || Number.isNaN(Date.parse(args.cutoff))) {
    throw new Error(`--cutoff must be a valid YYYY-MM-DD date, got ${JSON.stringify(args.cutoff)}`);
  }
  return args as Args;
}

const CHUNK = 500;
function chunk<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Persist the dataset. Full-reset wipe keeps only the budget row, recreating
 *  the system Internal/Ready-to-Assign and Credit Card Payments rows from the
 *  dataset (equivalent end state, simpler than id-remapping). One transaction:
 *  all-or-nothing (iron rules 4/8). */
async function writeToDb(dataset: Dataset, wipe: boolean): Promise<void> {
  const { getDb, closeDb } = await import("@/lib/db");
  const { eq, sql } = await import("drizzle-orm");
  const schema = await import("@/lib/db/schema");
  const {
    budgets,
    accounts,
    categoryGroups,
    categories,
    payees,
    transactions,
    subtransactions,
    categoryMonths,
  } = schema;

  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      let [budget] = await tx
        .select({ id: budgets.id })
        .from(budgets)
        .limit(1);
      if (!budget) {
        [budget] = await tx
          .insert(budgets)
          .values({ name: dataset.budgetName, currency: "USD" })
          .returning({ id: budgets.id });
      }
      const budgetId = budget.id;

      const existing = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.budgetId, budgetId))
        .limit(1);
      if (existing.length > 0 && !wipe) {
        throw new Error(
          "Budget already has data — rerun with --wipe to replace it.",
        );
      }

      if (wipe) {
        // Dependency order: transactions (subtransactions cascade) → categories
        // (category_months cascade, clears linked_account_id refs) → groups →
        // payees → accounts.
        await tx.delete(transactions).where(eq(transactions.budgetId, budgetId));
        await tx.delete(categories).where(eq(categories.budgetId, budgetId));
        await tx.delete(categoryGroups).where(eq(categoryGroups.budgetId, budgetId));
        await tx.delete(payees).where(eq(payees.budgetId, budgetId));
        await tx.delete(accounts).where(eq(accounts.budgetId, budgetId));
      }

      for (const part of chunk(dataset.accounts)) {
        await tx.insert(accounts).values(
          part.map((a) => ({
            id: a.id,
            budgetId,
            name: a.name,
            type: a.type,
            onBudget: a.onBudget,
            closed: a.closed,
            sortOrder: a.sortOrder,
          })),
        );
      }
      for (const part of chunk(dataset.groups)) {
        await tx.insert(categoryGroups).values(
          part.map((g) => ({
            id: g.id,
            budgetId,
            name: g.name,
            isSystem: g.isSystem,
            hidden: g.hidden,
            sortOrder: g.sortOrder,
          })),
        );
      }
      for (const part of chunk(dataset.categories)) {
        await tx.insert(categories).values(
          part.map((c) => ({
            id: c.id,
            budgetId,
            groupId: c.groupId,
            name: c.name,
            hidden: c.hidden,
            isSystem: c.isSystem,
            linkedAccountId: c.linkedAccountId,
            sortOrder: c.sortOrder,
          })),
        );
      }
      for (const part of chunk(dataset.payees)) {
        await tx.insert(payees).values(
          part.map((p) => ({
            id: p.id,
            budgetId,
            name: p.name,
            transferAccountId: p.transferAccountId,
          })),
        );
      }
      // Insert transactions with transfer_transaction_id NULL first — the pair
      // self-reference is a cycle, so it can't satisfy the FK at insert time;
      // a batched UPDATE links the pairs afterward.
      for (const part of chunk(dataset.transactions)) {
        await tx.insert(transactions).values(
          part.map((t) => ({
            id: t.id,
            budgetId,
            accountId: t.accountId,
            date: t.date,
            amount: t.amount,
            payeeId: t.payeeId,
            categoryId: t.categoryId,
            memo: t.memo,
            cleared: t.cleared,
            flag: t.flag,
            transferAccountId: t.transferAccountId,
            transferTransactionId: null,
          })),
        );
      }
      const linked = dataset.transactions.filter(
        (t) => t.transferTransactionId !== null,
      );
      for (const part of chunk(linked)) {
        const values = sql.join(
          part.map((t) => sql`(${t.id}::uuid, ${t.transferTransactionId}::uuid)`),
          sql`, `,
        );
        await tx.execute(sql`
          UPDATE transactions AS t
             SET transfer_transaction_id = v.ttid
            FROM (VALUES ${values}) AS v(id, ttid)
           WHERE t.id = v.id
        `);
      }
      for (const part of chunk(dataset.subtransactions)) {
        await tx.insert(subtransactions).values(
          part.map((s) => ({
            id: s.id,
            transactionId: s.transactionId,
            amount: s.amount,
            categoryId: s.categoryId,
            memo: s.memo,
          })),
        );
      }
      for (const part of chunk(dataset.categoryMonths)) {
        await tx.insert(categoryMonths).values(
          part.map((m) => ({
            categoryId: m.categoryId,
            month: m.month,
            assigned: m.assigned,
          })),
        );
      }
    });
  } finally {
    await closeDb();
  }
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const args = parseArgs(process.argv.slice(2));

  const register = parseRegister(
    parseCsv(readFileSync(join(args.dataDir, "Register.csv"), "utf8")),
  );
  const budget = parseBudget(
    parseCsv(readFileSync(join(args.dataDir, "Budget.csv"), "utf8")),
  );

  const dataset = reconstruct(register, budget, args.cutoff);
  const result = validate(dataset);

  const full = formatReport(dataset, result, Infinity);
  const reportPath = join(args.dataDir, "import-report.txt");
  writeFileSync(reportPath, full + "\n", "utf8");

  console.log(formatReport(dataset, result, 40));
  console.log(`\nFull report written to ${reportPath}`);

  if (!args.commit) {
    console.log(
      "\nDRY RUN — no database changes." +
        (args.wipe ? " (--wipe ignored without --commit.)" : "") +
        "\nReview the report, then rerun with --commit --wipe to persist.",
    );
    return;
  }

  if (!result.ok) {
    console.log(
      "\n⚠️  Validation did not fully pass — review the mismatches above before trusting the committed data.",
    );
  }
  console.log(`\nCommitting to the database${args.wipe ? " (full reset)" : ""}…`);
  await writeToDb(dataset, args.wipe);
  console.log(
    `Done. Imported ${dataset.accounts.length} accounts, ` +
      `${dataset.transactions.length} transactions, ` +
      `${dataset.categoryMonths.length} category-months.`,
  );
}

main().catch((err) => {
  console.error("\nImport failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

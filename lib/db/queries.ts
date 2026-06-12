import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  accounts,
  budgets,
  categories,
  categoryGroups,
  payees,
  transactions,
  type Account,
  type Budget,
  type ClearedStatus,
} from "@/lib/db/schema";

// Read helpers for the single-user budget. Balances are simple SQL sums
// (allowed per PRD §4 note); all richer math stays in lib/engine.

export async function getBudget(): Promise<Budget | undefined> {
  const db = getDb();
  const [budget] = await db.select().from(budgets).limit(1);
  return budget;
}

export type AccountWithBalance = Account & { balance: bigint };

export async function getAccountsWithBalances(
  budgetId: string,
): Promise<AccountWithBalance[]> {
  const db = getDb();
  const rows = await db
    .select({
      account: accounts,
      balance: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .where(eq(accounts.budgetId, budgetId))
    .groupBy(accounts.id)
    .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt));
  return rows.map((row) => ({ ...row.account, balance: BigInt(row.balance) }));
}

export interface RegisterRow {
  id: string;
  accountId: string;
  accountName: string;
  date: string;
  amount: bigint;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  memo: string | null;
  cleared: ClearedStatus;
  isTransfer: boolean;
}

/** Register rows for one account, or the whole budget (All Accounts). */
export async function getRegisterRows(
  budgetId: string,
  accountId?: string,
): Promise<RegisterRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      accountName: accounts.name,
      date: transactions.date,
      amount: transactions.amount,
      payeeId: transactions.payeeId,
      payeeName: payees.name,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      memo: transactions.memo,
      cleared: transactions.cleared,
      transferTransactionId: transactions.transferTransactionId,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(payees, eq(transactions.payeeId, payees.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      accountId
        ? eq(transactions.accountId, accountId)
        : eq(transactions.budgetId, budgetId),
    )
    .orderBy(desc(transactions.date), desc(transactions.createdAt));
  return rows.map(({ transferTransactionId, ...row }) => ({
    ...row,
    isTransfer: transferTransactionId !== null,
  }));
}

export interface PayeeOption {
  id: string;
  name: string;
  lastCategoryId: string | null;
  lastCategoryName: string | null;
}

/** Non-transfer payees with their most recently used category (derived,
 *  never stored — PRD §5) for autocomplete pre-fill. */
export async function getPayeeOptions(budgetId: string): Promise<PayeeOption[]> {
  const db = getDb();
  const payeeRows = await db
    .select({ id: payees.id, name: payees.name })
    .from(payees)
    .where(and(eq(payees.budgetId, budgetId), isNull(payees.transferAccountId)))
    .orderBy(asc(payees.name));

  const categorized = await db
    .select({
      payeeId: transactions.payeeId,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(eq(transactions.budgetId, budgetId), isNotNull(transactions.payeeId)),
    )
    .orderBy(desc(transactions.date), desc(transactions.createdAt));

  const lastByPayee = new Map<
    string,
    { categoryId: string; categoryName: string }
  >();
  for (const row of categorized) {
    if (row.payeeId !== null && !lastByPayee.has(row.payeeId)) {
      lastByPayee.set(row.payeeId, {
        categoryId: row.categoryId!,
        categoryName: row.categoryName,
      });
    }
  }

  return payeeRows.map((payee) => {
    const last = lastByPayee.get(payee.id);
    return {
      ...payee,
      lastCategoryId: last?.categoryId ?? null,
      lastCategoryName: last?.categoryName ?? null,
    };
  });
}

export interface CategoryOption {
  id: string;
  name: string;
  groupName: string;
  isReadyToAssign: boolean;
}

/** Register category choices: Ready to Assign first (income), then visible
 *  categories in group/sort order. */
export async function getCategoryOptions(
  budgetId: string,
): Promise<CategoryOption[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      groupName: categoryGroups.name,
      isSystem: categories.isSystem,
    })
    .from(categories)
    .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(
      and(
        eq(categories.budgetId, budgetId),
        eq(categories.hidden, false),
        eq(categoryGroups.hidden, false),
      ),
    )
    .orderBy(asc(categoryGroups.sortOrder), asc(categories.sortOrder));

  const options = rows.map((row) => ({
    id: row.id,
    name: row.name,
    groupName: row.groupName,
    isReadyToAssign: row.isSystem && row.name === "Ready to Assign",
  }));
  return [
    ...options.filter((o) => o.isReadyToAssign),
    ...options.filter((o) => !o.isReadyToAssign && o.groupName !== "Internal"),
  ];
}

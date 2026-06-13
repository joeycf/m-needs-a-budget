import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  accounts,
  budgets,
  categories,
  categoryGroups,
  categoryMonths,
  payees,
  transactions,
  type Account,
  type Budget,
  type ClearedStatus,
} from "@/lib/db/schema";
import type { BudgetInput } from "@/lib/engine/budget";

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
  /** Set on the synthesized "Transfer : <account>" options — picking one makes
   *  the transaction a transfer to that account rather than a payee posting. */
  transferAccountId: string | null;
}

/** Non-transfer payees with their most recently used category (derived,
 *  never stored — PRD §5) for autocomplete pre-fill, followed by a synthesized
 *  "Transfer : <account>" option per open on-budget account (M5 transfers). */
export async function getPayeeOptions(budgetId: string): Promise<PayeeOption[]> {
  const db = getDb();
  const [payeeRows, transferAccounts] = await Promise.all([
    db
      .select({ id: payees.id, name: payees.name })
      .from(payees)
      .where(and(eq(payees.budgetId, budgetId), isNull(payees.transferAccountId)))
      .orderBy(asc(payees.name)),
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(
        and(
          eq(accounts.budgetId, budgetId),
          eq(accounts.onBudget, true),
          eq(accounts.closed, false),
        ),
      )
      .orderBy(asc(accounts.name)),
  ]);

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

  const regular: PayeeOption[] = payeeRows.map((payee) => {
    const last = lastByPayee.get(payee.id);
    return {
      ...payee,
      lastCategoryId: last?.categoryId ?? null,
      lastCategoryName: last?.categoryName ?? null,
      transferAccountId: null,
    };
  });
  const transfers: PayeeOption[] = transferAccounts.map((account) => ({
    id: `transfer:${account.id}`,
    name: `Transfer : ${account.name}`,
    lastCategoryId: null,
    lastCategoryName: null,
    transferAccountId: account.id,
  }));
  return [...regular, ...transfers];
}

/** Everything the budget engine needs, mapped to its pure input types.
 *  Subtransactions can't exist before M6, so transactions ship bare; transfer
 *  legs carry transfer_account_id so the engine can route card payments. */
export async function getBudgetEngineInput(
  budgetId: string,
): Promise<BudgetInput> {
  const db = getDb();
  const [accountRows, categoryRows, assignmentRows, txnRows] =
    await Promise.all([
      db
        .select({ id: accounts.id, type: accounts.type, onBudget: accounts.onBudget })
        .from(accounts)
        .where(eq(accounts.budgetId, budgetId)),
      db
        .select({
          id: categories.id,
          isSystem: categories.isSystem,
          name: categories.name,
          linkedAccountId: categories.linkedAccountId,
        })
        .from(categories)
        .where(eq(categories.budgetId, budgetId)),
      db
        .select({
          categoryId: categoryMonths.categoryId,
          month: categoryMonths.month,
          assigned: categoryMonths.assigned,
        })
        .from(categoryMonths)
        .innerJoin(categories, eq(categoryMonths.categoryId, categories.id))
        .where(eq(categories.budgetId, budgetId)),
      db
        .select({
          accountId: transactions.accountId,
          date: transactions.date,
          amount: transactions.amount,
          categoryId: transactions.categoryId,
          transferAccountId: transactions.transferAccountId,
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .where(and(eq(transactions.budgetId, budgetId), eq(accounts.onBudget, true))),
    ]);

  return {
    accounts: accountRows,
    categories: categoryRows.map((row) => ({
      id: row.id,
      isReadyToAssign: row.isSystem && row.name === "Ready to Assign",
      linkedAccountId: row.linkedAccountId,
    })),
    assignments: assignmentRows,
    transactions: txnRows,
  };
}

export interface BudgetGridCategory {
  id: string;
  name: string;
}

export interface BudgetGridGroup {
  id: string;
  name: string;
  categories: BudgetGridCategory[];
}

/** Visible category groups for the budget grid, in sort order. The Internal
 *  group (only the system RTA category) and empty system groups (Credit Card
 *  Payments until M5) drop out. */
export async function getBudgetGrid(
  budgetId: string,
): Promise<BudgetGridGroup[]> {
  const db = getDb();
  const [groupRows, categoryRows] = await Promise.all([
    db
      .select({
        id: categoryGroups.id,
        name: categoryGroups.name,
        isSystem: categoryGroups.isSystem,
      })
      .from(categoryGroups)
      .where(
        and(eq(categoryGroups.budgetId, budgetId), eq(categoryGroups.hidden, false)),
      )
      .orderBy(asc(categoryGroups.sortOrder), asc(categoryGroups.name)),
    db
      .select({ id: categories.id, name: categories.name, groupId: categories.groupId })
      .from(categories)
      .where(
        and(
          eq(categories.budgetId, budgetId),
          eq(categories.hidden, false),
          eq(categories.isSystem, false),
        ),
      )
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
  ]);

  const byGroup = new Map<string, BudgetGridCategory[]>();
  for (const category of categoryRows) {
    const list = byGroup.get(category.groupId) ?? [];
    list.push({ id: category.id, name: category.name });
    byGroup.set(category.groupId, list);
  }

  return groupRows
    .map((group) => ({
      id: group.id,
      name: group.name,
      isSystem: group.isSystem,
      categories: byGroup.get(group.id) ?? [],
    }))
    .filter((group) => !(group.isSystem && group.categories.length === 0))
    .map(({ id, name, categories: cats }) => ({ id, name, categories: cats }));
}

export interface CategoryOption {
  id: string;
  name: string;
  groupName: string;
  isReadyToAssign: boolean;
}

/** Register category choices: Ready to Assign first (income), then visible
 *  categories in group/sort order. Payment categories are excluded — card
 *  spending is categorized to a normal category; the engine moves the funded
 *  slice to the payment category, you never post to it directly. */
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
        isNull(categories.linkedAccountId),
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

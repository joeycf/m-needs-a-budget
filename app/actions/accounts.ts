"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { requireSession } from "@/lib/auth/require-session";
import { todayISO } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { createPaymentCategory } from "@/lib/db/credit-cards";
import { getOrCreatePayee } from "@/lib/db/payees";
import { getBudget } from "@/lib/db/queries";
import {
  accounts,
  accountTypes,
  categories,
  payees,
  transactions,
  type AccountType,
} from "@/lib/db/schema";
import { parseMoneyToMilliunits } from "@/lib/money";

export type ActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const ON_BUDGET_TYPES: readonly AccountType[] = [
  "checking",
  "savings",
  "cash",
  "credit_card",
];

// Starting balances on cash accounts are income for the budget; card debt
// and tracking balances stay uncategorized (PRD §9 seed note).
const CASH_TYPES: readonly AccountType[] = ["checking", "savings", "cash"];

const createAccountSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100),
  type: z.enum(accountTypes),
  startingBalance: z.string().max(30).default(""),
  note: z.string().trim().max(500).default(""),
});

export async function createAccount(
  input: unknown,
): Promise<ActionResult<{ accountId: string }>> {
  await requireSession();
  const parsed = createAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid account details." };
  const { name, type, note } = parsed.data;

  const balanceRaw = parsed.data.startingBalance.trim();
  const balance = balanceRaw === "" ? 0n : parseMoneyToMilliunits(balanceRaw);
  if (balance === null) {
    return { ok: false, error: "Enter the starting balance like 1,234.56." };
  }

  const budget = await getBudget();
  if (!budget) return { ok: false, error: "No budget — run npm run db:seed." };

  const db = getDb();
  const accountId = await db.transaction(async (tx) => {
    const [sort] = await tx
      .select({
        next: sql<number>`coalesce(max(${accounts.sortOrder}) + 1, 0)`,
      })
      .from(accounts)
      .where(eq(accounts.budgetId, budget.id));

    const [account] = await tx
      .insert(accounts)
      .values({
        budgetId: budget.id,
        name,
        type,
        onBudget: ON_BUDGET_TYPES.includes(type),
        note: note === "" ? null : note,
        sortOrder: sort.next,
      })
      .returning({ id: accounts.id });

    // Every credit card gets a payment category in the system group (PRD §4).
    if (type === "credit_card") {
      await createPaymentCategory(tx, budget.id, account.id, name);
    }

    if (balance !== 0n) {
      let categoryId: string | null = null;
      if (CASH_TYPES.includes(type)) {
        const [rta] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.budgetId, budget.id),
              eq(categories.isSystem, true),
              eq(categories.name, "Ready to Assign"),
            ),
          );
        if (!rta) throw new Error("Ready to Assign category missing");
        categoryId = rta.id;
      }
      await tx.insert(transactions).values({
        budgetId: budget.id,
        accountId: account.id,
        date: todayISO(),
        amount: balance,
        payeeId: await getOrCreatePayee(tx, budget.id, "Starting Balance"),
        categoryId,
        cleared: "cleared",
      });
    }
    return account.id;
  });

  revalidatePath("/", "layout");
  return { ok: true, accountId };
}

const updateAccountSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Name is required.").max(100),
  note: z.string().trim().max(500).default(""),
});

export async function updateAccount(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = updateAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid account details." };

  const { id, name } = parsed.data;
  const note = parsed.data.note === "" ? null : parsed.data.note;

  const db = getDb();
  const ok = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(accounts)
      .set({ name, note })
      .where(eq(accounts.id, id))
      .returning({ id: accounts.id });
    if (!updated) return false;

    // Keep the linked payment category and the account's transfer payee in
    // step with the account name (both render the card name to the user).
    await tx
      .update(categories)
      .set({ name })
      .where(eq(categories.linkedAccountId, id));
    await tx
      .update(payees)
      .set({ name: `Transfer : ${name}` })
      .where(eq(payees.transferAccountId, id));
    return true;
  });
  if (!ok) return { ok: false, error: "Account not found." };

  revalidatePath("/", "layout");
  return { ok: true };
}

const setClosedSchema = z.object({ id: z.uuid(), closed: z.boolean() });

export async function setAccountClosed(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = setClosedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const { id, closed } = parsed.data;
  const db = getDb();
  const ok = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(accounts)
      .set({ closed })
      .where(eq(accounts.id, id))
      .returning({ id: accounts.id });
    if (!updated) return false;

    // A card's payment category is hidden with the account and shown again
    // when it reopens (PRD §4).
    await tx
      .update(categories)
      .set({ hidden: closed })
      .where(eq(categories.linkedAccountId, id));
    return true;
  });
  if (!ok) return { ok: false, error: "Account not found." };

  revalidatePath("/", "layout");
  return { ok: true };
}

const deleteAccountSchema = z.object({ id: z.uuid() });

/** Hard delete. The account's own transactions cascade, but references with
 *  no cascade must be detached first: the other side of any transfer, the
 *  account's transfer payee, and the linked payment category (plus any stray
 *  postings to it). */
export async function deleteAccount(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const { id } = parsed.data;
  const db = getDb();
  const ok = await db.transaction(async (tx) => {
    // Orphan the counterpart side of transfers into/out of this account.
    await tx
      .update(transactions)
      .set({ transferAccountId: null, transferTransactionId: null })
      .where(eq(transactions.transferAccountId, id));
    // Demote the account's transfer payee to a plain payee row.
    await tx
      .update(payees)
      .set({ transferAccountId: null })
      .where(eq(payees.transferAccountId, id));
    // Detach any postings to the payment category, then drop the category
    // (its category_months cascade).
    const linked = await tx
      .select({ catId: categories.id })
      .from(categories)
      .where(eq(categories.linkedAccountId, id));
    for (const { catId } of linked) {
      await tx
        .update(transactions)
        .set({ categoryId: null })
        .where(eq(transactions.categoryId, catId));
    }
    await tx.delete(categories).where(eq(categories.linkedAccountId, id));

    const [deleted] = await tx
      .delete(accounts)
      .where(eq(accounts.id, id))
      .returning({ id: accounts.id });
    return Boolean(deleted);
  });
  if (!ok) return { ok: false, error: "Account not found." };

  revalidatePath("/", "layout");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { requireSession } from "@/lib/auth/require-session";
import { todayISO } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { getOrCreatePayee } from "@/lib/db/payees";
import { getBudget } from "@/lib/db/queries";
import {
  accounts,
  accountTypes,
  categories,
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

  const db = getDb();
  const updated = await db
    .update(accounts)
    .set({
      name: parsed.data.name,
      note: parsed.data.note === "" ? null : parsed.data.note,
    })
    .where(eq(accounts.id, parsed.data.id))
    .returning({ id: accounts.id });
  if (updated.length === 0) return { ok: false, error: "Account not found." };

  revalidatePath("/", "layout");
  return { ok: true };
}

const setClosedSchema = z.object({ id: z.uuid(), closed: z.boolean() });

export async function setAccountClosed(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = setClosedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const db = getDb();
  const updated = await db
    .update(accounts)
    .set({ closed: parsed.data.closed })
    .where(eq(accounts.id, parsed.data.id))
    .returning({ id: accounts.id });
  if (updated.length === 0) return { ok: false, error: "Account not found." };

  revalidatePath("/", "layout");
  return { ok: true };
}

const deleteAccountSchema = z.object({ id: z.uuid() });

/** Hard delete: the FK cascade removes the account's transactions. */
export async function deleteAccount(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const db = getDb();
  const deleted = await db
    .delete(accounts)
    .where(eq(accounts.id, parsed.data.id))
    .returning({ id: accounts.id });
  if (deleted.length === 0) return { ok: false, error: "Account not found." };

  revalidatePath("/", "layout");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireSession } from "@/lib/auth/require-session";
import { parseRegisterDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { getOrCreatePayee, getOrCreateTransferPayee } from "@/lib/db/payees";
import { getBudget } from "@/lib/db/queries";
import { accounts, categories, transactions } from "@/lib/db/schema";
import { parseMoneyToMilliunits } from "@/lib/money";
import type { ActionResult } from "./accounts";

const txnFieldsSchema = z.object({
  accountId: z.uuid(),
  date: z.string().max(20),
  payeeName: z.string().trim().min(1, "Payee is required.").max(200),
  categoryId: z.uuid().nullable(),
  memo: z.string().trim().max(500).default(""),
  outflow: z.string().max(30).default(""),
  inflow: z.string().max(30).default(""),
});

type TxnFields = z.infer<typeof txnFieldsSchema>;

/** Outflow XOR inflow (both are positive magnitudes) → signed milliunits. */
function resolveAmount(fields: TxnFields): bigint | { error: string } {
  const outRaw = fields.outflow.trim();
  const inRaw = fields.inflow.trim();
  const out = outRaw === "" ? 0n : parseMoneyToMilliunits(outRaw);
  const inf = inRaw === "" ? 0n : parseMoneyToMilliunits(inRaw);
  if (out === null || inf === null || out < 0n || inf < 0n) {
    return { error: "Enter amounts like 1,234.56." };
  }
  if (out > 0n && inf > 0n) {
    return { error: "Enter either an outflow or an inflow, not both." };
  }
  if (out === 0n && inf === 0n) {
    return { error: "Enter an outflow or inflow amount." };
  }
  return inf > 0n ? inf : -out;
}

/** Validates account + category against the budget and applies the
 *  category rules: tracking accounts are never categorized; a blank
 *  category on an on-budget account defaults to Ready to Assign. */
async function resolveTxnTarget(
  budgetId: string,
  fields: TxnFields,
): Promise<
  | { accountId: string; categoryId: string | null; date: string }
  | { error: string }
> {
  const date = parseRegisterDate(fields.date);
  if (!date) return { error: "Enter the date like 06/11/2026." };

  const db = getDb();
  const [account] = await db
    .select({
      id: accounts.id,
      onBudget: accounts.onBudget,
      closed: accounts.closed,
    })
    .from(accounts)
    .where(
      and(eq(accounts.id, fields.accountId), eq(accounts.budgetId, budgetId)),
    );
  if (!account) return { error: "Account not found." };
  if (account.closed) return { error: "This account is closed." };

  if (!account.onBudget) {
    return { accountId: account.id, categoryId: null, date };
  }

  if (fields.categoryId === null) {
    const [rta] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.budgetId, budgetId),
          eq(categories.isSystem, true),
          eq(categories.name, "Ready to Assign"),
        ),
      );
    if (!rta) return { error: "Ready to Assign category missing." };
    return { accountId: account.id, categoryId: rta.id, date };
  }

  const [category] = await db
    .select({ id: categories.id, isSystem: categories.isSystem, name: categories.name })
    .from(categories)
    .where(
      and(
        eq(categories.id, fields.categoryId),
        eq(categories.budgetId, budgetId),
      ),
    );
  if (!category || (category.isSystem && category.name !== "Ready to Assign")) {
    return { error: "Category not found." };
  }
  return { accountId: account.id, categoryId: category.id, date };
}

const createTxnSchema = txnFieldsSchema.extend({
  cleared: z.boolean().default(false),
  // Set → this is a transfer to that account; payee/category are ignored.
  transferAccountId: z.uuid().nullable().default(null),
});

/** Loads an account and requires it to be an open on-budget account — the
 *  only transfer endpoints M5 supports (tracking transfers arrive in M6). */
async function loadOpenOnBudgetAccount(
  budgetId: string,
  accountId: string,
): Promise<{ id: string } | { error: string }> {
  const db = getDb();
  const [account] = await db
    .select({
      id: accounts.id,
      onBudget: accounts.onBudget,
      closed: accounts.closed,
    })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.budgetId, budgetId)));
  if (!account) return { error: "Account not found." };
  if (account.closed) return { error: "This account is closed." };
  if (!account.onBudget) {
    return { error: "Transfers to tracking accounts aren't supported yet." };
  }
  return { id: account.id };
}

export async function createTransaction(
  input: unknown,
): Promise<ActionResult> {
  await requireSession();
  const parsed = createTxnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid transaction." };

  const budget = await getBudget();
  if (!budget) return { ok: false, error: "No budget — run npm run db:seed." };

  const amount = resolveAmount(parsed.data);
  if (typeof amount === "object") return { ok: false, ...amount };

  const db = getDb();

  // Transfer: a linked pair of mirrored, uncategorized rows between two open
  // on-budget accounts, each side naming the other's transfer payee (iron
  // rule 4 — both written in one DB transaction).
  if (parsed.data.transferAccountId !== null) {
    const date = parseRegisterDate(parsed.data.date);
    if (!date) return { ok: false, error: "Enter the date like 06/11/2026." };
    const source = await loadOpenOnBudgetAccount(budget.id, parsed.data.accountId);
    if ("error" in source) return { ok: false, error: source.error };
    const dest = await loadOpenOnBudgetAccount(
      budget.id,
      parsed.data.transferAccountId,
    );
    if ("error" in dest) return { ok: false, error: dest.error };
    if (source.id === dest.id) {
      return { ok: false, error: "Pick a different account to transfer to." };
    }

    const memo = parsed.data.memo === "" ? null : parsed.data.memo;
    await db.transaction(async (tx) => {
      const [from] = await tx
        .insert(transactions)
        .values({
          budgetId: budget.id,
          accountId: source.id,
          date,
          amount,
          payeeId: await getOrCreateTransferPayee(tx, budget.id, dest.id),
          categoryId: null,
          memo,
          cleared: parsed.data.cleared ? "cleared" : "uncleared",
          transferAccountId: dest.id,
        })
        .returning({ id: transactions.id });
      const [to] = await tx
        .insert(transactions)
        .values({
          budgetId: budget.id,
          accountId: dest.id,
          date,
          amount: -amount,
          payeeId: await getOrCreateTransferPayee(tx, budget.id, source.id),
          categoryId: null,
          memo,
          cleared: "uncleared",
          transferAccountId: source.id,
          transferTransactionId: from.id,
        })
        .returning({ id: transactions.id });
      await tx
        .update(transactions)
        .set({ transferTransactionId: to.id })
        .where(eq(transactions.id, from.id));
    });

    revalidatePath("/", "layout");
    return { ok: true };
  }

  const target = await resolveTxnTarget(budget.id, parsed.data);
  if ("error" in target) return { ok: false, error: target.error };

  await db.transaction(async (tx) => {
    await tx.insert(transactions).values({
      budgetId: budget.id,
      accountId: target.accountId,
      date: target.date,
      amount,
      payeeId: await getOrCreatePayee(tx, budget.id, parsed.data.payeeName),
      categoryId: target.categoryId,
      memo: parsed.data.memo === "" ? null : parsed.data.memo,
      cleared: parsed.data.cleared ? "cleared" : "uncleared",
    });
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

const updateTxnSchema = txnFieldsSchema.extend({
  id: z.uuid(),
  cleared: z.boolean().optional(), // undefined = keep current status
});

export async function updateTransaction(
  input: unknown,
): Promise<ActionResult> {
  await requireSession();
  const parsed = updateTxnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid transaction." };

  const budget = await getBudget();
  if (!budget) return { ok: false, error: "No budget — run npm run db:seed." };

  const db = getDb();
  const [existing] = await db
    .select({
      id: transactions.id,
      cleared: transactions.cleared,
      transferTransactionId: transactions.transferTransactionId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.id, parsed.data.id),
        eq(transactions.budgetId, budget.id),
      ),
    );
  if (!existing) return { ok: false, error: "Transaction not found." };
  // Transfers are linked pairs (iron rule 4) and arrive in Milestone 6 —
  // refuse to touch them here rather than break the pair. Splits likewise
  // cannot exist yet.
  if (existing.transferTransactionId !== null) {
    return { ok: false, error: "Transfers can't be edited yet." };
  }
  if (existing.cleared === "reconciled") {
    return { ok: false, error: "Reconciled transactions are locked." };
  }

  const amount = resolveAmount(parsed.data);
  if (typeof amount === "object") return { ok: false, ...amount };
  const target = await resolveTxnTarget(budget.id, parsed.data);
  if ("error" in target) return { ok: false, error: target.error };

  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({
        accountId: target.accountId,
        date: target.date,
        amount,
        payeeId: await getOrCreatePayee(tx, budget.id, parsed.data.payeeName),
        categoryId: target.categoryId,
        memo: parsed.data.memo === "" ? null : parsed.data.memo,
        ...(parsed.data.cleared === undefined
          ? {}
          : { cleared: parsed.data.cleared ? "cleared" : "uncleared" as const }),
      })
      .where(eq(transactions.id, existing.id));
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

const idSchema = z.object({ id: z.uuid() });

export async function deleteTransaction(
  input: unknown,
): Promise<ActionResult> {
  await requireSession();
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const db = getDb();
  const [existing] = await db
    .select({
      id: transactions.id,
      transferTransactionId: transactions.transferTransactionId,
    })
    .from(transactions)
    .where(eq(transactions.id, parsed.data.id));
  if (!existing) return { ok: false, error: "Transaction not found." };

  // Deleting one side of a transfer deletes both (iron rule 4). Null the
  // self-referential links first so neither delete trips the FK.
  await db.transaction(async (tx) => {
    const otherId = existing.transferTransactionId;
    if (otherId !== null) {
      await tx
        .update(transactions)
        .set({ transferTransactionId: null })
        .where(eq(transactions.id, existing.id));
      await tx
        .update(transactions)
        .set({ transferTransactionId: null })
        .where(eq(transactions.id, otherId));
      await tx.delete(transactions).where(eq(transactions.id, otherId));
    }
    await tx.delete(transactions).where(eq(transactions.id, existing.id));
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

/** uncleared ↔ cleared; reconciled is locked until the M6 reconcile flow. */
export async function toggleCleared(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const db = getDb();
  const [existing] = await db
    .select({ id: transactions.id, cleared: transactions.cleared })
    .from(transactions)
    .where(eq(transactions.id, parsed.data.id));
  if (!existing) return { ok: false, error: "Transaction not found." };
  if (existing.cleared === "reconciled") {
    return { ok: false, error: "Reconciled transactions are locked." };
  }

  await db
    .update(transactions)
    .set({ cleared: existing.cleared === "cleared" ? "uncleared" : "cleared" })
    .where(eq(transactions.id, existing.id));

  revalidatePath("/", "layout");
  return { ok: true };
}

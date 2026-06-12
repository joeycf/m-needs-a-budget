"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { requireSession } from "@/lib/auth/require-session";
import { getDb } from "@/lib/db";
import { getBudget, getBudgetEngineInput } from "@/lib/db/queries";
import { categories, categoryMonths } from "@/lib/db/schema";
import { computeMonth, prevMonth } from "@/lib/engine/budget";
import { parseMoneyToMilliunits } from "@/lib/money";
import type { ActionResult } from "./accounts";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const MAX_ASSIGNED = 1_000_000_000_000n; // $1B in milliunits

const setAssignedSchema = z.object({
  categoryId: z.uuid(),
  month: z.string().regex(MONTH_RE),
  amount: z.string().max(30),
});

/** The category must belong to the budget and not be system-managed
 *  (Ready to Assign is never assigned to directly). */
async function resolveAssignableCategory(
  budgetId: string,
  categoryId: string,
): Promise<{ id: string } | { error: string }> {
  const db = getDb();
  const [category] = await db
    .select({ id: categories.id, isSystem: categories.isSystem })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.budgetId, budgetId)));
  if (!category || category.isSystem) return { error: "Category not found." };
  return { id: category.id };
}

/** Inline Assigned cell: set the absolute amount for (category, month).
 *  Negative values are allowed (moving money out past zero, YNAB-style). */
export async function setAssigned(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = setAssignedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid assignment." };

  const amount = parseMoneyToMilliunits(parsed.data.amount.trim());
  if (amount === null || amount > MAX_ASSIGNED || amount < -MAX_ASSIGNED) {
    return { ok: false, error: "Enter an amount like 1,234.56." };
  }

  const budget = await getBudget();
  if (!budget) return { ok: false, error: "No budget — run npm run db:seed." };
  const category = await resolveAssignableCategory(
    budget.id,
    parsed.data.categoryId,
  );
  if ("error" in category) return { ok: false, error: category.error };

  const db = getDb();
  await db
    .insert(categoryMonths)
    .values({
      categoryId: category.id,
      month: parsed.data.month,
      assigned: amount,
    })
    .onConflictDoUpdate({
      target: [categoryMonths.categoryId, categoryMonths.month],
      set: { assigned: amount },
    });

  revalidatePath("/");
  return { ok: true };
}

/** Assign popover (Manually tab): move a positive amount from RTA into a
 *  category by incrementing its assigned for the month. */
export async function assignToCategory(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = setAssignedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid assignment." };

  const amount = parseMoneyToMilliunits(parsed.data.amount.trim());
  if (amount === null || amount <= 0n || amount > MAX_ASSIGNED) {
    return { ok: false, error: "Enter a positive amount to assign." };
  }

  const budget = await getBudget();
  if (!budget) return { ok: false, error: "No budget — run npm run db:seed." };
  const category = await resolveAssignableCategory(
    budget.id,
    parsed.data.categoryId,
  );
  if ("error" in category) return { ok: false, error: category.error };

  const db = getDb();
  await db
    .insert(categoryMonths)
    .values({
      categoryId: category.id,
      month: parsed.data.month,
      assigned: amount,
    })
    .onConflictDoUpdate({
      target: [categoryMonths.categoryId, categoryMonths.month],
      set: { assigned: sql`${categoryMonths.assigned} + excluded.assigned` },
    });

  revalidatePath("/");
  return { ok: true };
}

const quickAssignSchema = z.object({
  month: z.string().regex(MONTH_RE),
  mode: z.enum(["assignedLastMonth", "spentLastMonth", "resetToZero"]),
});

/** Assign popover (Auto tab): bulk-set every category's assigned for the
 *  month. "Underfunded" joins in M7 with targets. */
export async function quickAssign(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = quickAssignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { month, mode } = parsed.data;

  const budget = await getBudget();
  if (!budget) return { ok: false, error: "No budget — run npm run db:seed." };

  const db = getDb();
  const eligible = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(eq(categories.budgetId, budget.id), eq(categories.isSystem, false)),
    );
  if (eligible.length === 0) return { ok: true };
  const eligibleIds = eligible.map((row) => row.id);

  if (mode === "resetToZero") {
    await db
      .update(categoryMonths)
      .set({ assigned: 0n })
      .where(
        and(
          eq(categoryMonths.month, month),
          inArray(categoryMonths.categoryId, eligibleIds),
        ),
      );
    revalidatePath("/");
    return { ok: true };
  }

  // Target amounts come from last month's state; missing rows mean zero,
  // and zero rows are written anyway (equivalent to no row everywhere).
  const targets = new Map<string, bigint>(eligibleIds.map((id) => [id, 0n]));
  if (mode === "assignedLastMonth") {
    const rows = await db
      .select({
        categoryId: categoryMonths.categoryId,
        assigned: categoryMonths.assigned,
      })
      .from(categoryMonths)
      .where(
        and(
          eq(categoryMonths.month, prevMonth(month)),
          inArray(categoryMonths.categoryId, eligibleIds),
        ),
      );
    for (const row of rows) targets.set(row.categoryId, row.assigned);
  } else {
    const engineInput = await getBudgetEngineInput(budget.id);
    const previous = computeMonth(engineInput, prevMonth(month));
    for (const id of eligibleIds) {
      const activity = previous.categories.get(id)?.activity ?? 0n;
      targets.set(id, activity < 0n ? -activity : 0n);
    }
  }

  await db
    .insert(categoryMonths)
    .values(
      [...targets].map(([categoryId, assigned]) => ({
        categoryId,
        month,
        assigned,
      })),
    )
    .onConflictDoUpdate({
      target: [categoryMonths.categoryId, categoryMonths.month],
      set: { assigned: sql`excluded.assigned` },
    });

  revalidatePath("/");
  return { ok: true };
}

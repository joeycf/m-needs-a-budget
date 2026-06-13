import { and, eq, sql } from "drizzle-orm";

import type { DbClient } from "@/lib/db/payees";
import { categories, categoryGroups } from "@/lib/db/schema";

// Credit-card payment categories (PRD §4). Each credit_card account owns one
// auto-created category in the system "Credit Card Payments" group, linked via
// categories.linked_account_id. The engine reserves the funded slice of card
// spending onto it; the UI shows it like any other category row.

const CARD_PAYMENTS_GROUP = "Credit Card Payments";

/** The system "Credit Card Payments" group, created if a budget somehow
 *  lacks it (seed makes it, but never assume). Works inside a transaction. */
export async function getOrCreateCardPaymentsGroup(
  db: DbClient,
  budgetId: string,
): Promise<string> {
  const [existing] = await db
    .select({ id: categoryGroups.id })
    .from(categoryGroups)
    .where(
      and(
        eq(categoryGroups.budgetId, budgetId),
        eq(categoryGroups.isSystem, true),
        eq(categoryGroups.name, CARD_PAYMENTS_GROUP),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [sort] = await db
    .select({ next: sql<number>`coalesce(max(${categoryGroups.sortOrder}) + 1, 0)` })
    .from(categoryGroups)
    .where(eq(categoryGroups.budgetId, budgetId));
  const [created] = await db
    .insert(categoryGroups)
    .values({
      budgetId,
      name: CARD_PAYMENTS_GROUP,
      isSystem: true,
      sortOrder: sort.next,
    })
    .returning({ id: categoryGroups.id });
  return created.id;
}

/** Create the payment category for a freshly created credit-card account. */
export async function createPaymentCategory(
  db: DbClient,
  budgetId: string,
  accountId: string,
  accountName: string,
): Promise<string> {
  const groupId = await getOrCreateCardPaymentsGroup(db, budgetId);
  const [sort] = await db
    .select({ next: sql<number>`coalesce(max(${categories.sortOrder}) + 1, 0)` })
    .from(categories)
    .where(eq(categories.groupId, groupId));
  const [created] = await db
    .insert(categories)
    .values({
      budgetId,
      groupId,
      name: accountName,
      linkedAccountId: accountId,
      sortOrder: sort.next,
    })
    .returning({ id: categories.id });
  return created.id;
}

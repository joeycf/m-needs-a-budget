import { and, eq, isNull, sql } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { payees } from "@/lib/db/schema";

// Works inside or outside a db.transaction.
export type DbClient = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Free-text payees create or reuse a row (PRD §5). Matching is
 *  case-insensitive on the whitespace-normalized name; transfer payees
 *  (transfer_account_id set) are never matched. */
export async function getOrCreatePayee(
  db: DbClient,
  budgetId: string,
  rawName: string,
): Promise<string> {
  const name = rawName.trim().replace(/\s+/g, " ");
  const [existing] = await db
    .select({ id: payees.id })
    .from(payees)
    .where(
      and(
        eq(payees.budgetId, budgetId),
        isNull(payees.transferAccountId),
        sql`lower(${payees.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(payees)
    .values({ budgetId, name })
    .returning({ id: payees.id });
  return created.id;
}

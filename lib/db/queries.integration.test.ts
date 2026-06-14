import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/lib/db";
import { getBudgetEngineInput } from "@/lib/db/queries";
import {
  accounts,
  budgets,
  categories,
  categoryGroups,
  subtransactions,
  transactions,
} from "@/lib/db/schema";
import { computeMonth } from "@/lib/engine/budget";

// DB-backed test that split activity reaches the engine through the REAL query
// path (getBudgetEngineInput), not just the pure engine — the M10 import stores
// splits as parent + subtransactions, and the live budget grid must attribute
// them per sub-category. Opt-in so the default `npm test` stays offline:
//   RUN_DB_TESTS=1 npm test
// Runs inside a throwaway budget and removes it (cascade).
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === "1";
if (RUN_DB_TESTS) {
  // @next/env never loads .env.local under NODE_ENV=test (vitest sets it);
  // clear it just for the load so DATABASE_URL resolves.
  const mutableEnv = process.env as Record<string, string | undefined>;
  const nodeEnv = mutableEnv.NODE_ENV;
  delete mutableEnv.NODE_ENV;
  loadEnvConfig(process.cwd());
  mutableEnv.NODE_ENV = nodeEnv;
}

describe.skipIf(!RUN_DB_TESTS)(
  "getBudgetEngineInput — split activity (integration)",
  () => {
    let budgetId: string;
    let groceriesId: string;
    let diningId: string;

    beforeAll(async () => {
      const db = getDb();
      const [budget] = await db
        .insert(budgets)
        .values({ name: `M10 split IT ${Date.now()}` })
        .returning({ id: budgets.id });
      budgetId = budget.id;

      const [account] = await db
        .insert(accounts)
        .values({ budgetId, name: "Checking", type: "checking", onBudget: true })
        .returning({ id: accounts.id });

      const [group] = await db
        .insert(categoryGroups)
        .values({ budgetId, name: "Wants" })
        .returning({ id: categoryGroups.id });
      const [groceries] = await db
        .insert(categories)
        .values({ budgetId, groupId: group.id, name: "Groceries" })
        .returning({ id: categories.id });
      const [dining] = await db
        .insert(categories)
        .values({ budgetId, groupId: group.id, name: "Dining" })
        .returning({ id: categories.id });
      groceriesId = groceries.id;
      diningId = dining.id;

      // A split: parent uncategorized ($80 outflow), two subs to different
      // categories ($50 groceries + $30 dining).
      const [parent] = await db
        .insert(transactions)
        .values({
          budgetId,
          accountId: account.id,
          date: "2026-06-15",
          amount: -80_000n,
          categoryId: null,
        })
        .returning({ id: transactions.id });
      await db.insert(subtransactions).values([
        { transactionId: parent.id, amount: -50_000n, categoryId: groceriesId },
        { transactionId: parent.id, amount: -30_000n, categoryId: diningId },
      ]);
    });

    afterAll(async () => {
      if (budgetId) {
        const db = getDb();
        // subtransactions.category_id has no ON DELETE, so the budget cascade
        // can't drop categories while subs still reference them. Delete the
        // transactions first (cascading their subs), then the budget cascades
        // the rest — the same ordering scripts/import-ynab.ts's --wipe uses.
        await db.delete(transactions).where(eq(transactions.budgetId, budgetId));
        await db.delete(budgets).where(eq(budgets.id, budgetId));
      }
      await closeDb();
    });

    it("attributes each split sub-amount to its sub-category via the real query", async () => {
      const input = await getBudgetEngineInput(budgetId);
      const state = computeMonth(input, "2026-06-01");
      // Before wiring, the parent shipped bare (categoryId null, no subs) and
      // both categories saw $0 — this is the regression guard.
      expect(state.categories.get(groceriesId)?.activity).toBe(-50_000n);
      expect(state.categories.get(diningId)?.activity).toBe(-30_000n);
    });
  },
);

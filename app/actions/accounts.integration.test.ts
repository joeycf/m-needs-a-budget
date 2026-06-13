import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { deleteAccount } from "@/app/actions/accounts";
import { closeDb, getDb } from "@/lib/db";
import {
  accounts,
  budgets,
  categories,
  categoryGroups,
  payees,
  transactions,
} from "@/lib/db/schema";

// DB-backed integration test for deleteAccount's FK cleanup — the one M5
// behavior a pure unit test can't cover (mocks don't enforce foreign keys).
// Opt-in so the default `npm test` stays pure, fast, and offline:
//   RUN_DB_TESTS=1 npm test
// It runs against DATABASE_URL inside its own throwaway budget and removes it.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === "1";
if (RUN_DB_TESTS) {
  // @next/env never loads .env.local under NODE_ENV=test (vitest sets it);
  // clear it just for the load so DATABASE_URL/APP_PASSWORD resolve. (NODE_ENV
  // is typed read-only, hence the mutable-record cast.)
  const mutableEnv = process.env as Record<string, string | undefined>;
  const nodeEnv = mutableEnv.NODE_ENV;
  delete mutableEnv.NODE_ENV;
  loadEnvConfig(process.cwd());
  mutableEnv.NODE_ENV = nodeEnv;
}

vi.mock("@/lib/auth/require-session", () => ({ requireSession: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

describe.skipIf(!RUN_DB_TESTS)("deleteAccount — FK cleanup (integration)", () => {
  let budgetId: string;
  let cardId: string;
  let checkingId: string;
  let payCatId: string;
  let cardPayeeId: string;
  let checkingLegId: string; // counterpart (survives, orphaned)
  let cardLegId: string; // on the card (cascades away)
  let taggedTxnId: string; // posting categorized to the payment category

  beforeAll(async () => {
    const db = getDb();
    const [budget] = await db
      .insert(budgets)
      .values({ name: `M5 deleteAccount IT ${Date.now()}` })
      .returning({ id: budgets.id });
    budgetId = budget.id;

    const [checking] = await db
      .insert(accounts)
      .values({ budgetId, name: "Checking", type: "checking", onBudget: true })
      .returning({ id: accounts.id });
    checkingId = checking.id;
    const [card] = await db
      .insert(accounts)
      .values({ budgetId, name: "Visa", type: "credit_card", onBudget: true })
      .returning({ id: accounts.id });
    cardId = card.id;

    const [group] = await db
      .insert(categoryGroups)
      .values({ budgetId, name: "Credit Card Payments", isSystem: true })
      .returning({ id: categoryGroups.id });
    const [payCat] = await db
      .insert(categories)
      .values({
        budgetId,
        groupId: group.id,
        name: "Visa",
        linkedAccountId: cardId,
      })
      .returning({ id: categories.id });
    payCatId = payCat.id;

    // System transfer payee for the card, used on the checking-side leg.
    const [payee] = await db
      .insert(payees)
      .values({ budgetId, name: "Transfer : Visa", transferAccountId: cardId })
      .returning({ id: payees.id });
    cardPayeeId = payee.id;

    // Linked transfer pair: a $50 payment Checking → Visa.
    const [checkingLeg] = await db
      .insert(transactions)
      .values({
        budgetId,
        accountId: checkingId,
        date: "2026-06-10",
        amount: -50_000n,
        payeeId: cardPayeeId,
        categoryId: null,
        transferAccountId: cardId,
      })
      .returning({ id: transactions.id });
    checkingLegId = checkingLeg.id;
    const [cardLeg] = await db
      .insert(transactions)
      .values({
        budgetId,
        accountId: cardId,
        date: "2026-06-10",
        amount: 50_000n,
        categoryId: null,
        transferAccountId: checkingId,
        transferTransactionId: checkingLegId,
      })
      .returning({ id: transactions.id });
    cardLegId = cardLeg.id;
    await db
      .update(transactions)
      .set({ transferTransactionId: cardLegId })
      .where(eq(transactions.id, checkingLegId));

    // A stray posting categorized straight to the payment category.
    const [tagged] = await db
      .insert(transactions)
      .values({
        budgetId,
        accountId: checkingId,
        date: "2026-06-11",
        amount: -1_000n,
        categoryId: payCatId,
      })
      .returning({ id: transactions.id });
    taggedTxnId = tagged.id;
  });

  afterAll(async () => {
    if (budgetId) {
      // Cascade removes every row created above.
      await getDb().delete(budgets).where(eq(budgets.id, budgetId));
    }
    await closeDb();
  });

  it("deletes a card with a payment category and inbound transfer, no FK error", async () => {
    const result = await deleteAccount({ id: cardId });
    expect(result).toEqual({ ok: true });

    const db = getDb();
    const rows = async (id: string) =>
      db.select().from(transactions).where(eq(transactions.id, id));

    // The card and its own (cascading) leg are gone.
    expect(await db.select().from(accounts).where(eq(accounts.id, cardId))).toHaveLength(0);
    expect(await rows(cardLegId)).toHaveLength(0);

    // The payment category is gone.
    expect(
      await db.select().from(categories).where(eq(categories.id, payCatId)),
    ).toHaveLength(0);

    // The counterpart leg survives, orphaned (links nulled).
    const [checkingLeg] = await rows(checkingLegId);
    expect(checkingLeg).toBeDefined();
    expect(checkingLeg.transferAccountId).toBeNull();
    expect(checkingLeg.transferTransactionId).toBeNull();

    // The stray posting to the payment category is de-categorized, not deleted.
    const [tagged] = await rows(taggedTxnId);
    expect(tagged).toBeDefined();
    expect(tagged.categoryId).toBeNull();

    // The transfer payee is demoted to a plain payee, not deleted.
    const [payee] = await db.select().from(payees).where(eq(payees.id, cardPayeeId));
    expect(payee).toBeDefined();
    expect(payee.transferAccountId).toBeNull();
  });
});

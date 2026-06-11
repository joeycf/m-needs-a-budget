import { loadEnvConfig } from "@next/env";

import { closeDb, getDb } from "@/lib/db";
import { budgets, categories, categoryGroups } from "@/lib/db/schema";

loadEnvConfig(process.cwd());

// Starter groups/categories per PRD §9 seed spec.
const starterGroups: { name: string; categories: string[] }[] = [
  { name: "Bills", categories: ["Rent", "Electric", "Internet", "Phone"] },
  { name: "Needs", categories: ["Groceries", "Transportation", "Medical"] },
  { name: "Wants", categories: ["Dining Out", "Fun Money", "Subscriptions"] },
  { name: "Savings", categories: ["Emergency Fund", "Vacation"] },
];

async function main() {
  const db = getDb();

  const existing = await db.select({ id: budgets.id }).from(budgets).limit(1);
  if (existing.length > 0) {
    console.log("Seed skipped: a budget already exists.");
    return;
  }

  await db.transaction(async (tx) => {
    const [budget] = await tx
      .insert(budgets)
      .values({ name: "M Needs a Budget", currency: "USD" })
      .returning();

    const [internalGroup] = await tx
      .insert(categoryGroups)
      .values({
        budgetId: budget.id,
        name: "Internal",
        isSystem: true,
        sortOrder: 0,
      })
      .returning();

    // All income is categorized here; it feeds the RTA pool (PRD §4).
    await tx.insert(categories).values({
      budgetId: budget.id,
      groupId: internalGroup.id,
      name: "Ready to Assign",
      isSystem: true,
      sortOrder: 0,
    });

    // Empty; payment categories are auto-created with each CC account (M5).
    await tx.insert(categoryGroups).values({
      budgetId: budget.id,
      name: "Credit Card Payments",
      isSystem: true,
      sortOrder: 1,
    });

    for (const [i, group] of starterGroups.entries()) {
      const [groupRow] = await tx
        .insert(categoryGroups)
        .values({ budgetId: budget.id, name: group.name, sortOrder: i + 2 })
        .returning();

      await tx.insert(categories).values(
        group.categories.map((name, j) => ({
          budgetId: budget.id,
          groupId: groupRow.id,
          name,
          sortOrder: j,
        })),
      );
    }
  });

  console.log(
    'Seeded budget "M Needs a Budget": Internal (Ready to Assign), Credit Card Payments, and 4 starter groups with 12 categories.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());

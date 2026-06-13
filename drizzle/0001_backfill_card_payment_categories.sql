-- Backfill credit-card payment categories (Milestone 5). Cards created before
-- M5 wired auto-creation have no payment category; give each one in its
-- budget's system "Credit Card Payments" group. Idempotent: re-running skips
-- cards that already have a linked category.

-- Ensure every budget that owns a credit card has the system group.
INSERT INTO "category_groups" ("budget_id", "name", "is_system", "sort_order")
SELECT DISTINCT a."budget_id", 'Credit Card Payments', true,
       COALESCE((SELECT MAX(g2."sort_order") + 1 FROM "category_groups" g2
                 WHERE g2."budget_id" = a."budget_id"), 0)
FROM "accounts" a
WHERE a."type" = 'credit_card'
  AND NOT EXISTS (
    SELECT 1 FROM "category_groups" g
    WHERE g."budget_id" = a."budget_id"
      AND g."is_system" = true AND g."name" = 'Credit Card Payments'
  );
--> statement-breakpoint
-- One payment category per card that lacks one, named after the account.
INSERT INTO "categories" ("budget_id", "group_id", "name", "linked_account_id", "sort_order")
SELECT a."budget_id", g."id", a."name", a."id",
       (SELECT COALESCE(MAX(c2."sort_order"), -1) FROM "categories" c2 WHERE c2."group_id" = g."id")
         + ROW_NUMBER() OVER (PARTITION BY g."id" ORDER BY a."created_at", a."id")
FROM "accounts" a
JOIN "category_groups" g
  ON g."budget_id" = a."budget_id"
  AND g."is_system" = true AND g."name" = 'Credit Card Payments'
WHERE a."type" = 'credit_card'
  AND NOT EXISTS (
    SELECT 1 FROM "categories" c WHERE c."linked_account_id" = a."id"
  );

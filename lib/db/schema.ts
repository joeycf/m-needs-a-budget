import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Mirrors docs/PRD.md §9 exactly. All money columns are integer milliunits
// ($1.00 = 1000, outflows negative) surfaced as JS bigint; all date columns
// are plain 'YYYY-MM-DD' strings, months normalized to 'YYYY-MM-01'.

export const accountTypes = [
  "checking",
  "savings",
  "cash",
  "credit_card",
  "tracking_asset",
  "tracking_liability",
] as const;
export type AccountType = (typeof accountTypes)[number];

export const clearedStatuses = ["uncleared", "cleared", "reconciled"] as const;
export type ClearedStatus = (typeof clearedStatuses)[number];

export const goalTypes = [
  "monthly_funding",
  "target_balance",
  "target_balance_by_date",
] as const;
export type GoalType = (typeof goalTypes)[number];

export const scheduleFrequencies = [
  "weekly",
  "every_other_week",
  "twice_a_month",
  "monthly",
  "yearly",
] as const;
export type ScheduleFrequency = (typeof scheduleFrequencies)[number];

export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("USD"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: accountTypes }).notNull(),
    onBudget: boolean("on_budget").notNull(), // derived from type at creation
    note: text("note"),
    closed: boolean("closed").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "accounts_type_check",
      sql`${table.type} IN ('checking','savings','cash','credit_card','tracking_asset','tracking_liability')`,
    ),
  ],
);

export const payees = pgTable(
  "payees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // non-null = system transfer payee
    transferAccountId: uuid("transfer_account_id").references(
      () => accounts.id,
    ),
  },
  (table) => [unique("payees_budget_id_name_unique").on(table.budgetId, table.name)],
);

export const categoryGroups = pgTable("category_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  budgetId: uuid("budget_id")
    .notNull()
    .references(() => budgets.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isSystem: boolean("is_system").notNull().default(false), // 'Credit Card Payments', 'Internal'
  hidden: boolean("hidden").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => categoryGroups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    note: text("note"),
    hidden: boolean("hidden").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    // set for CC payment categories
    linkedAccountId: uuid("linked_account_id").references(() => accounts.id),
    isSystem: boolean("is_system").notNull().default(false), // 'Ready to Assign'
    goalType: text("goal_type", { enum: goalTypes }),
    goalAmount: bigint("goal_amount", { mode: "bigint" }), // milliunits
    goalTargetMonth: date("goal_target_month", { mode: "string" }), // first of month
  },
  (table) => [
    check(
      "categories_goal_type_check",
      sql`${table.goalType} IN ('monthly_funding','target_balance','target_balance_by_date')`,
    ),
  ],
);

// One row per (category, month) the user has touched; missing row = assigned 0.
export const categoryMonths = pgTable(
  "category_months",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    month: date("month", { mode: "string" }).notNull(), // always YYYY-MM-01
    // sql`0` instead of 0n: drizzle-kit's snapshot serializer can't handle
    // BigInt literals; the emitted DDL is identical (DEFAULT 0).
    assigned: bigint("assigned", { mode: "bigint" }).notNull().default(sql`0`),
  },
  (table) => [
    unique("category_months_category_id_month_unique").on(
      table.categoryId,
      table.month,
    ),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(), // milliunits, outflow negative
    payeeId: uuid("payee_id").references(() => payees.id),
    // NULL when: split parent, transfer between on-budget accounts,
    // or any tracking-account transaction
    categoryId: uuid("category_id").references(() => categories.id),
    memo: text("memo"),
    cleared: text("cleared", { enum: clearedStatuses })
      .notNull()
      .default("uncleared"),
    flag: text("flag"),
    transferAccountId: uuid("transfer_account_id").references(
      () => accounts.id,
    ),
    transferTransactionId: uuid("transfer_transaction_id").references(
      (): AnyPgColumn => transactions.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "transactions_cleared_check",
      sql`${table.cleared} IN ('uncleared','cleared','reconciled')`,
    ),
    index("idx_txn_account_date").on(table.accountId, table.date),
    index("idx_txn_category_date").on(table.categoryId, table.date),
    index("idx_txn_budget_date").on(table.budgetId, table.date),
  ],
);

export const subtransactions = pgTable("subtransactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  categoryId: uuid("category_id").references(() => categories.id),
  memo: text("memo"),
});

export const scheduledTransactions = pgTable(
  "scheduled_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    frequency: text("frequency", { enum: scheduleFrequencies }).notNull(),
    nextDate: date("next_date", { mode: "string" }).notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    payeeId: uuid("payee_id").references(() => payees.id),
    categoryId: uuid("category_id").references(() => categories.id),
    memo: text("memo"),
  },
  (table) => [
    check(
      "scheduled_transactions_frequency_check",
      sql`${table.frequency} IN ('weekly','every_other_week','twice_a_month','monthly','yearly')`,
    ),
  ],
);

export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Payee = typeof payees.$inferSelect;
export type NewPayee = typeof payees.$inferInsert;
export type CategoryGroup = typeof categoryGroups.$inferSelect;
export type NewCategoryGroup = typeof categoryGroups.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type CategoryMonth = typeof categoryMonths.$inferSelect;
export type NewCategoryMonth = typeof categoryMonths.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Subtransaction = typeof subtransactions.$inferSelect;
export type NewSubtransaction = typeof subtransactions.$inferInsert;
export type ScheduledTransaction = typeof scheduledTransactions.$inferSelect;
export type NewScheduledTransaction = typeof scheduledTransactions.$inferInsert;

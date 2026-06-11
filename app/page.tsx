import { count } from "drizzle-orm";

import { logout } from "@/app/actions/auth";
import { requireSession } from "@/lib/auth/require-session";
import { getDb } from "@/lib/db";
import { budgets, categories, categoryGroups } from "@/lib/db/schema";

export default async function HomePage() {
  await requireSession();

  const db = getDb();
  const [budget] = await db.select().from(budgets).limit(1);
  const [groupCount] = await db.select({ value: count() }).from(categoryGroups);
  const [categoryCount] = await db.select({ value: count() }).from(categories);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {budget?.name ?? "M Needs a Budget"}
        </h1>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Sign out
          </button>
        </form>
      </header>

      {budget ? (
        <section className="mt-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="text-sm font-medium text-neutral-500">
            Milestone 1 — foundation
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            <li>
              Budget <span className="font-medium">{budget.name}</span> (
              {budget.currency}) is seeded.
            </li>
            <li>
              {groupCount.value} category groups, {categoryCount.value}{" "}
              categories (including system rows).
            </li>
            <li>Password gate and signed session cookie are active.</li>
          </ul>
          <p className="mt-3 text-sm text-neutral-500">
            Accounts and the transaction register arrive in Milestone 2; the
            budget grid in Milestone 3.
          </p>
        </section>
      ) : (
        <p className="mt-6 text-sm text-neutral-500">
          No budget found — run <code>npm run db:seed</code> to create the
          starter budget.
        </p>
      )}
    </main>
  );
}

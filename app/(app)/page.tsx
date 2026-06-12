import { count } from "drizzle-orm";

import { logout } from "@/app/actions/auth";
import { MobileTopBar } from "@/components/shell/mobile-top-bar";
import { getDb } from "@/lib/db";
import { budgets, categories, categoryGroups } from "@/lib/db/schema";

// Placeholder home: the budget grid replaces this in Milestone 3.
// Session is enforced by the (app) layout.
export default async function HomePage() {
  const db = getDb();
  const [budget] = await db.select().from(budgets).limit(1);
  const [groupCount] = await db.select({ value: count() }).from(categoryGroups);
  const [categoryCount] = await db.select({ value: count() }).from(categories);

  return (
    <>
      <MobileTopBar title="Budget" showLogo />
      <main className="w-full max-w-2xl flex-1 p-6">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-(--text-xl) font-bold">
            {budget?.name ?? "M Needs a Budget"}
          </h1>
          <form action={logout}>
            <button type="submit" className="btn btn-secondary">
              Sign out
            </button>
          </form>
        </header>

        {budget ? (
          <section className="card mt-6 p-4">
            <h2 className="th-caps">Milestone 2 — accounts &amp; register</h2>
            <ul className="mt-2 space-y-1 text-(--text-table)">
              <li>
                Budget <span className="font-medium">{budget.name}</span> (
                {budget.currency}) is seeded with {groupCount.value} category
                groups and {categoryCount.value} categories.
              </li>
              <li>
                Add accounts from the sidebar; each account gets a full
                transaction register.
              </li>
              <li>The budget grid arrives in Milestone 3.</li>
            </ul>
          </section>
        ) : (
          <p className="mt-6 text-(--text-table) text-(--text-secondary)">
            No budget found — run <code>npm run db:seed</code> to create the
            starter budget.
          </p>
        )}
      </main>
    </>
  );
}

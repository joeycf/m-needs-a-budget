import { notFound } from "next/navigation";

import { RegisterView } from "@/components/register/register-view";
import { todayISO } from "@/lib/dates";
import {
  getAccountsWithBalances,
  getBudget,
  getCategoryOptions,
  getPayeeOptions,
  getRegisterRows,
} from "@/lib/db/queries";

export default async function AllAccountsPage() {
  const budget = await getBudget();
  if (!budget) notFound();

  const [accounts, rows, payees, categories] = await Promise.all([
    getAccountsWithBalances(budget.id),
    getRegisterRows(budget.id),
    getPayeeOptions(budget.id),
    getCategoryOptions(budget.id),
  ]);

  return (
    <RegisterView
      mode="all"
      accountOptions={accounts
        .filter((a) => !a.closed)
        .map((a) => ({ id: a.id, name: a.name, onBudget: a.onBudget }))}
      rows={rows}
      payees={payees}
      categories={categories}
      today={todayISO()}
    />
  );
}

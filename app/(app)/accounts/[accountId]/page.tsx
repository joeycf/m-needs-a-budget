import { notFound } from "next/navigation";
import { z } from "zod";

import { RegisterView } from "@/components/register/register-view";
import { todayISO } from "@/lib/dates";
import {
  getAccountsWithBalances,
  getBudget,
  getCategoryOptions,
  getPayeeOptions,
  getRegisterRows,
} from "@/lib/db/queries";

export default async function AccountRegisterPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  if (!z.uuid().safeParse(accountId).success) notFound();

  const budget = await getBudget();
  if (!budget) notFound();

  const accounts = await getAccountsWithBalances(budget.id);
  const account = accounts.find((a) => a.id === accountId);
  if (!account) notFound();

  const [rows, payees, categories] = await Promise.all([
    getRegisterRows(budget.id, account.id),
    getPayeeOptions(budget.id),
    getCategoryOptions(budget.id),
  ]);

  return (
    <RegisterView
      mode="account"
      account={{
        id: account.id,
        name: account.name,
        note: account.note,
        onBudget: account.onBudget,
        closed: account.closed,
      }}
      rows={rows}
      payees={payees}
      categories={categories}
      today={todayISO()}
    />
  );
}

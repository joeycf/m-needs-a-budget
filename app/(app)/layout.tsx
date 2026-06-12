import { AppShell } from "@/components/shell/app-shell";
import type { SidebarData } from "@/components/shell/shell-context";
import { requireSession } from "@/lib/auth/require-session";
import { getAccountsWithBalances, getBudget } from "@/lib/db/queries";
import { sidebarTotals } from "@/lib/engine/register";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireSession();

  const budget = await getBudget();
  const accounts = budget ? await getAccountsWithBalances(budget.id) : [];
  const open = accounts.filter((account) => !account.closed);
  const totals = sidebarTotals(
    accounts,
    new Map(accounts.map((account) => [account.id, account.balance])),
  );

  const pick = (a: (typeof accounts)[number]) => ({
    id: a.id,
    name: a.name,
    balance: a.balance,
  });
  const sidebar: SidebarData = {
    budgetAccounts: open.filter((a) => a.onBudget).map(pick),
    trackingAccounts: open.filter((a) => !a.onBudget).map(pick),
    ...totals,
  };

  return <AppShell sidebar={sidebar}>{children}</AppShell>;
}

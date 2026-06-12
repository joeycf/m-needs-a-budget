import { BudgetView } from "@/components/budget/budget-view";
import { MobileTopBar } from "@/components/shell/mobile-top-bar";
import { formatMonthLabel, todayISO } from "@/lib/dates";
import {
  getBudget,
  getBudgetEngineInput,
  getBudgetGrid,
} from "@/lib/db/queries";
import {
  computeMonth,
  monthOfDate,
  nextMonth,
  prevMonth,
} from "@/lib/engine/budget";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

// Budget (home). All grid numbers are derived by the engine per request —
// nothing is stored (iron rule 2). Session is enforced by the (app) layout.
export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;

  const budget = await getBudget();
  if (!budget) {
    return (
      <>
        <MobileTopBar title="Budget" showLogo />
        <main className="w-full max-w-2xl flex-1 p-6">
          <p className="text-(--text-table) text-(--text-secondary)">
            No budget found — run <code>npm run db:seed</code> to create the
            starter budget.
          </p>
        </main>
      </>
    );
  }

  const [engineInput, grid] = await Promise.all([
    getBudgetEngineInput(budget.id),
    getBudgetGrid(budget.id),
  ]);

  // Navigable months: earliest data through next month (mock shows one
  // month of lookahead); the ?month= param is clamped into that range.
  const currentMonth = monthOfDate(todayISO());
  const maxMonth = nextMonth(currentMonth);
  let minMonth = currentMonth;
  for (const txn of engineInput.transactions) {
    const m = monthOfDate(txn.date);
    if (m < minMonth) minMonth = m;
  }
  for (const assignment of engineInput.assignments) {
    if (assignment.month < minMonth) minMonth = assignment.month;
  }

  const requested =
    monthParam && MONTH_RE.test(monthParam) ? monthParam : currentMonth;
  const month =
    requested < minMonth ? minMonth : requested > maxMonth ? maxMonth : requested;

  const state = computeMonth(engineInput, month);
  const previous = computeMonth(engineInput, prevMonth(month));
  // RTA is one global number (modern-YNAB): always today's, whatever
  // month is being viewed. Overspending only hits it once a month ends.
  const rta =
    month === currentMonth
      ? state.readyToAssign
      : computeMonth(engineInput, currentMonth).readyToAssign;

  const groups = grid.map((group) => ({
    id: group.id,
    name: group.name,
    categories: group.categories.map((category) => {
      const row = state.categories.get(category.id);
      return {
        id: category.id,
        name: category.name,
        assigned: row?.assigned ?? 0n,
        activity: row?.activity ?? 0n,
        available: row?.available ?? 0n,
        isCreditOverspent:
          (row?.creditOverspent ?? 0n) > 0n && (row?.cashOverspent ?? 0n) === 0n,
      };
    }),
  }));

  let assignedLastMonth = 0n;
  let spentLastMonth = 0n;
  for (const row of previous.categories.values()) {
    assignedLastMonth += row.assigned;
    spentLastMonth += row.activity < 0n ? -row.activity : 0n;
  }

  return (
    <BudgetView
      month={month}
      monthLabel={formatMonthLabel(month)}
      minMonth={minMonth}
      maxMonth={maxMonth}
      rta={rta}
      groups={groups}
      autoTotals={{ assignedLastMonth, spentLastMonth }}
      hasAccounts={engineInput.accounts.some((account) => account.onBudget)}
    />
  );
}

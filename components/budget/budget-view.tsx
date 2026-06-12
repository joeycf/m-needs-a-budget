"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";

import { assignToCategory, quickAssign, setAssigned } from "@/app/actions/budget";
import { logout } from "@/app/actions/auth";
import { AssignPopover, type QuickAssignMode } from "@/components/budget/assign-popover";
import { BudgetTable } from "@/components/budget/budget-table";
import { MobileTopBar } from "@/components/shell/mobile-top-bar";
import { nextMonth, prevMonth } from "@/lib/engine/budget";
import { formatMilliunits, milliunitsToSignedInput } from "@/lib/money";

// Budget screen per docs/design/Budget Screen.html: top bar with month
// switcher + compact RTA banner (Assign popover), then the grid. Numbers
// arrive fully derived from the server engine; edits adjust them
// optimistically by delta (the mock's RTA_BASE − Δassigned trick) until
// revalidation replaces the props.

export interface BudgetRowData {
  id: string;
  name: string;
  assigned: bigint;
  activity: bigint;
  available: bigint;
}

export interface BudgetGroupData {
  id: string;
  name: string;
  categories: BudgetRowData[];
}

export interface AutoTotals {
  assignedLastMonth: bigint;
  spentLastMonth: bigint;
}

function MonthSwitcher({
  month,
  monthLabel,
  minMonth,
  maxMonth,
}: {
  month: string;
  monthLabel: string;
  minMonth: string;
  maxMonth: string;
}) {
  const arrow = "btn btn-ghost w-7 p-0 text-base";
  return (
    <div className="flex items-center gap-1">
      {month > minMonth ? (
        <Link href={`/?month=${prevMonth(month)}`} className={arrow} aria-label="Previous month">
          ‹
        </Link>
      ) : (
        <span className={`${arrow} opacity-40`} aria-hidden>
          ‹
        </span>
      )}
      <div className="min-w-[150px] text-center text-(--text-xl) font-bold tabular-nums">
        {monthLabel}
      </div>
      {month < maxMonth ? (
        <Link href={`/?month=${nextMonth(month)}`} className={arrow} aria-label="Next month">
          ›
        </Link>
      ) : (
        <span className={`${arrow} opacity-40`} aria-hidden>
          ›
        </span>
      )}
    </div>
  );
}

export function BudgetView({
  month,
  monthLabel,
  minMonth,
  maxMonth,
  rta,
  groups,
  autoTotals,
}: {
  month: string;
  monthLabel: string;
  minMonth: string;
  maxMonth: string;
  rta: bigint;
  groups: BudgetGroupData[];
  autoTotals: AutoTotals;
}) {
  const [, startTransition] = useTransition();
  const [assignOpen, setAssignOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrides, addOverride] = useOptimistic(
    new Map<string, bigint>(),
    (current, next: { categoryId: string; assigned: bigint }) =>
      new Map(current).set(next.categoryId, next.assigned),
  );

  // Apply pending assigned values; available and RTA move by the delta.
  const viewGroups = groups.map((group) => ({
    ...group,
    categories: group.categories.map((category) => {
      const assigned = overrides.get(category.id) ?? category.assigned;
      return {
        ...category,
        assigned,
        available: category.available + (assigned - category.assigned),
      };
    }),
  }));
  const assignedDelta = groups.reduce(
    (sum, group) =>
      sum +
      group.categories.reduce(
        (groupSum, category) =>
          groupSum + ((overrides.get(category.id) ?? category.assigned) - category.assigned),
        0n,
      ),
    0n,
  );
  const viewRta = rta - assignedDelta;

  const commitAssigned = (categoryId: string, assigned: bigint) => {
    setError(null);
    startTransition(async () => {
      addOverride({ categoryId, assigned });
      const result = await setAssigned({
        categoryId,
        month,
        amount: milliunitsToSignedInput(assigned),
      });
      if (!result.ok) setError(result.error);
    });
  };

  const submitAssign = (categoryId: string, amount: bigint) => {
    setAssignOpen(false);
    setError(null);
    const current = viewGroups
      .flatMap((group) => group.categories)
      .find((category) => category.id === categoryId);
    startTransition(async () => {
      if (current) {
        addOverride({ categoryId, assigned: current.assigned + amount });
      }
      const result = await assignToCategory({
        categoryId,
        month,
        amount: milliunitsToSignedInput(amount),
      });
      if (!result.ok) setError(result.error);
    });
  };

  const submitQuickAssign = (mode: QuickAssignMode) => {
    setAssignOpen(false);
    setError(null);
    startTransition(async () => {
      const result = await quickAssign({ month, mode });
      if (!result.ok) setError(result.error);
    });
  };

  const rtaState = viewRta > 0n ? "positive" : viewRta < 0n ? "negative" : "zero";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MobileTopBar title="Budget" showLogo />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-(--border-default) bg-(--bg-surface) px-4 py-3 md:px-6">
        <MonthSwitcher
          month={month}
          monthLabel={monthLabel}
          minMonth={minMonth}
          maxMonth={maxMonth}
        />
        <div className="flex items-center gap-3">
          {/* Not in the design handoff; preserved from the M2 placeholder so
              the app keeps a sign-out until a designed home exists. */}
          <form action={logout}>
            <button type="submit" className="btn btn-ghost">
              Sign out
            </button>
          </form>
          <div
            className={`rta-banner rta-banner--${rtaState} relative box-border w-[320px] max-w-full justify-between`}
          >
            <div>
              <div className="rta-amount num text-left">
                {formatMilliunits(viewRta)}
              </div>
              <div className="rta-label">
                {rtaState === "zero" ? "All money assigned" : "Ready to Assign"}
              </div>
            </div>
            {rtaState !== "zero" ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setAssignOpen((open) => !open)}
              >
                {rtaState === "negative" ? "Fix" : "Assign"} ▾
              </button>
            ) : null}
            {assignOpen ? (
              <AssignPopover
                rta={viewRta}
                groups={viewGroups}
                autoTotals={autoTotals}
                onAssign={submitAssign}
                onQuickAssign={submitQuickAssign}
                onClose={() => setAssignOpen(false)}
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        {error ? (
          <p className="mb-3 text-(--text-table) text-(--cash-overspent-fg)">
            {error}
          </p>
        ) : null}
        <BudgetTable groups={viewGroups} onCommitAssigned={commitAssigned} />
      </div>
    </div>
  );
}

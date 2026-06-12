"use client";

import { useEffect, useState } from "react";

import type { AutoTotals, BudgetGroupData } from "@/components/budget/budget-view";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMilliunits, milliunitsToInput, parseMoneyToMilliunits } from "@/lib/money";

// RTA Assign/Fix popover per budget-components.jsx AssignPopover: 280px card
// anchored under the banner button, Manually tab default. Auto ships three of
// the four design rows — "Underfunded" needs targets and lands in M7. Escape
// closes (the mock's only dismiss besides the buttons).

export type QuickAssignMode =
  | "assignedLastMonth"
  | "spentLastMonth"
  | "resetToZero";

function MiniAvailablePill({ value }: { value: bigint }) {
  const pillClass =
    value > 0n ? "pill--funded" : value < 0n ? "pill--cash" : "pill--zero";
  return (
    <span
      className={`pill ${pillClass} h-[18px] min-w-0 shrink-0 px-[7px] text-[11px]`}
    >
      {formatMilliunits(value)}
    </span>
  );
}

function GroupedCategorySelect({
  groups,
  value,
  onChange,
}: {
  groups: BudgetGroupData[];
  value: string | null;
  onChange: (categoryId: string) => void;
}) {
  const current = groups
    .flatMap((group) => group.categories)
    .find((category) => category.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-(--control-h) w-full cursor-pointer items-center justify-between gap-2 rounded-(--radius-sm) border border-(--border-strong) bg-(--bg-surface) px-2 text-(--text-table)"
        >
          <span className={`truncate ${current ? "" : "text-(--text-muted)"}`}>
            {current ? current.name : "Select category…"}
          </span>
          <span className="text-[10px] text-(--text-muted)">▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[240px]">
        {groups.map((group) => (
          <div key={group.id}>
            <DropdownMenuLabel className="pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-(--tracking-caps) text-(--text-muted)">
              {group.name}
            </DropdownMenuLabel>
            {group.categories.map((category) => (
              <DropdownMenuItem
                key={category.id}
                onSelect={() => onChange(category.id)}
                className="justify-between gap-4 text-(--text-table)"
              >
                <span className="truncate">{category.name}</span>
                <MiniAvailablePill value={category.available} />
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AutoRow({
  label,
  amount,
  onClick,
}: {
  label: string;
  amount?: bigint;
  onClick: () => void;
}) {
  return (
    <button type="button" className="menu-item w-full" onClick={onClick}>
      <span>{label}</span>
      {amount !== undefined ? (
        <span className="num text-(--text-secondary)">
          {formatMilliunits(amount)}
        </span>
      ) : (
        <span />
      )}
    </button>
  );
}

export function AssignPopover({
  rta,
  groups,
  autoTotals,
  onAssign,
  onQuickAssign,
  onClose,
}: {
  rta: bigint;
  groups: BudgetGroupData[];
  autoTotals: AutoTotals;
  onAssign: (categoryId: string, amount: bigint) => void;
  onQuickAssign: (mode: QuickAssignMode) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"manually" | "auto">("manually");
  const [amount, setAmount] = useState(() =>
    milliunitsToInput(rta > 0n ? rta : 0n),
  );
  const [to, setTo] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parsed = parseMoneyToMilliunits(amount.trim());
  const valid = to !== null && parsed !== null && parsed > 0n;

  const tabClass = (active: boolean) =>
    `flex-1 cursor-pointer border-b-2 py-[7px] text-center text-(--text-table) ${
      active
        ? "border-(--accent) font-semibold text-(--teal-800)"
        : "border-transparent font-medium text-(--text-secondary)"
    }`;

  return (
    <div className="card absolute right-0 top-[calc(100%+6px)] z-60 w-[280px] cursor-default p-0 text-left text-(--text-primary) shadow-(--shadow-menu)">
      <div className="flex border-b border-(--border-default)">
        <button
          type="button"
          className={tabClass(tab === "manually")}
          onClick={() => setTab("manually")}
        >
          Manually
        </button>
        <button
          type="button"
          className={tabClass(tab === "auto")}
          onClick={() => setTab("auto")}
        >
          Auto
        </button>
      </div>

      {tab === "manually" ? (
        <div className="p-3.5">
          <div className="mb-2.5">
            <div className="th-caps mb-1">Amount</div>
            <input
              className="input num box-border w-full text-right"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="mb-3.5">
            <div className="th-caps mb-1">To:</div>
            <GroupedCategorySelect groups={groups} value={to} onChange={setTo} />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary flex-[1.6]"
              disabled={!valid}
              onClick={() => {
                if (valid) onAssign(to, parsed);
              }}
            >
              Assign {formatMilliunits(parsed !== null && parsed > 0n ? parsed : 0n)}
            </button>
          </div>
        </div>
      ) : (
        <div className="p-1">
          <AutoRow
            label="Assigned last month"
            amount={autoTotals.assignedLastMonth}
            onClick={() => onQuickAssign("assignedLastMonth")}
          />
          <AutoRow
            label="Spent last month"
            amount={autoTotals.spentLastMonth}
            onClick={() => onQuickAssign("spentLastMonth")}
          />
          <AutoRow label="Reset to $0.00" onClick={() => onQuickAssign("resetToZero")} />
        </div>
      )}
    </div>
  );
}

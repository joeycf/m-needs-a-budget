"use client";

import { Fragment, useRef, useState } from "react";

import type { BudgetGroupData, BudgetRowData } from "@/components/budget/budget-view";
import {
  formatMilliunits,
  milliunitsToSignedInput,
  parseMoneyToMilliunits,
} from "@/lib/money";

// Budget grid per budget-components.jsx BudgetTable: collapsible group rows
// with sums, inline-editable Assigned, static Activity (click-through lands
// with M7 polish), Available pill (yellow = purely credit-overspent).

function AssignedCell({
  value,
  onCommit,
}: {
  value: bigint;
  onCommit: (assigned: bigint) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);

  const start = () => {
    cancelled.current = false;
    setDraft(milliunitsToSignedInput(value));
    setEditing(true);
  };

  const finish = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const parsed = parseMoneyToMilliunits(draft.trim());
    if (parsed === null || parsed === value) return;
    onCommit(parsed);
  };

  return (
    <td
      className="num w-[130px] cursor-text"
      onClick={() => !editing && start()}
    >
      {editing ? (
        <input
          className="input-cell"
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
          onBlur={finish}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              cancelled.current = true;
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        formatMilliunits(value)
      )}
    </td>
  );
}

function CategoryRow({
  category,
  onCommitAssigned,
}: {
  category: BudgetRowData;
  onCommitAssigned: (categoryId: string, assigned: bigint) => void;
}) {
  const pillClass =
    category.available > 0n
      ? "pill--funded"
      : category.available < 0n
        ? category.isCreditOverspent
          ? "pill--credit"
          : "pill--cash"
        : "pill--zero";
  return (
    <tr>
      <td className="align-middle">{category.name}</td>
      <AssignedCell
        value={category.assigned}
        onCommit={(assigned) => onCommitAssigned(category.id, assigned)}
      />
      <td className="num w-[130px]">
        <span className="text-(--text-secondary)">
          {formatMilliunits(category.activity)}
        </span>
      </td>
      <td className="num w-[150px]">
        <span className={`pill ${pillClass} cursor-default`}>
          {formatMilliunits(category.available)}
        </span>
      </td>
    </tr>
  );
}

export function BudgetTable({
  groups,
  onCommitAssigned,
}: {
  groups: BudgetGroupData[];
  onCommitAssigned: (categoryId: string, assigned: bigint) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="rounded-(--radius-md) border border-(--border-default) bg-(--bg-surface) shadow-(--shadow-sm)">
      <table className="mnab-table">
        <thead>
          <tr>
            <th>Category</th>
            <th className="num w-[130px]">Assigned</th>
            <th className="num w-[130px]">Activity</th>
            <th className="num w-[150px]">Available</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const isCollapsed = !!collapsed[group.id];
            const sums = group.categories.reduce(
              (acc, category) => ({
                assigned: acc.assigned + category.assigned,
                activity: acc.activity + category.activity,
                available: acc.available + category.available,
              }),
              { assigned: 0n, activity: 0n, available: 0n },
            );
            return (
              <Fragment key={group.id}>
                <tr
                  className="group-row cursor-pointer"
                  onClick={() =>
                    setCollapsed((current) => ({
                      ...current,
                      [group.id]: !current[group.id],
                    }))
                  }
                >
                  <td>
                    <span className="inline-block w-4 text-(--text-secondary)">
                      {isCollapsed ? "▸" : "▾"}
                    </span>
                    {group.name}
                  </td>
                  <td className="num">{formatMilliunits(sums.assigned)}</td>
                  <td className="num">{formatMilliunits(sums.activity)}</td>
                  <td className="num pr-4">{formatMilliunits(sums.available)}</td>
                </tr>
                {isCollapsed
                  ? null
                  : group.categories.map((category) => (
                      <CategoryRow
                        key={category.id}
                        category={category}
                        onCommitAssigned={onCommitAssigned}
                      />
                    ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {groups.length === 0 ? (
        <p className="px-3 py-4 text-(--text-table) text-(--text-secondary)">
          No categories yet — run <code>npm run db:seed</code>.
        </p>
      ) : null}
    </div>
  );
}

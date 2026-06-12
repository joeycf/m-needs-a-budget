"use client";

import type { RegisterRow } from "@/components/register/types";
import { mobileDateLabel } from "@/lib/dates";
import type { RegisterBalanceSummary } from "@/lib/engine/register";
import { formatMilliunits } from "@/lib/money";

function StripFig({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: bigint;
  strong?: boolean;
}) {
  return (
    <div className="flex-1 text-center">
      <div
        className={`num text-center ${strong ? "text-(--text-md) font-bold" : "text-(--text-table) font-semibold"}`}
        style={{
          color: value < 0n ? "var(--cash-overspent-fg)" : "var(--text-primary)",
        }}
      >
        {formatMilliunits(value)}
      </div>
      <div className="mt-px text-[10px] font-semibold uppercase tracking-(--tracking-caps) text-(--text-muted)">
        {label}
      </div>
    </div>
  );
}

export function MobileBalanceStrip({
  balances,
}: {
  balances: RegisterBalanceSummary;
}) {
  return (
    <div className="flex items-center border-b border-(--border-default) bg-(--bg-surface) px-2 py-2.5">
      <StripFig label="Cleared" value={balances.cleared} />
      <span className="text-(--text-muted)">+</span>
      <StripFig label="Uncleared" value={balances.uncleared} />
      <span className="text-(--text-muted)">=</span>
      <StripFig label="Working" value={balances.working} strong />
    </div>
  );
}

function MobileTxnRow({
  row,
  onClick,
}: {
  row: RegisterRow;
  onClick?: () => void;
}) {
  const inflow = row.amount > 0n;
  const cleared = row.cleared !== "uncleared";
  const subtitle = [row.categoryName ?? "—", row.memo]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 border-b border-(--border-row) bg-(--bg-surface) px-4 text-left"
    >
      <div className="min-w-0">
        <div className="truncate text-(--text-base) font-medium">
          {row.payeeName ?? "—"}
        </div>
        <div className="truncate text-(--text-sm) text-(--text-secondary)">
          {subtitle}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={`num text-(--text-base) font-semibold ${inflow ? "amount-inflow" : ""}`}
        >
          {formatMilliunits(inflow ? row.amount : -row.amount)}
        </span>
        <span
          className="text-(--text-sm)"
          style={{
            color: cleared ? "var(--funded-strong)" : "var(--text-muted)",
          }}
        >
          {cleared ? "●" : "○"}
        </span>
      </div>
    </button>
  );
}

/** Mobile register list per Register Checking.html: date-grouped rows
 *  with caps labels and a teal FAB for the add sheet. */
export function MobileRegister({
  rows,
  today,
  onAdd,
  onEdit,
}: {
  rows: RegisterRow[];
  today: string;
  onAdd: () => void;
  onEdit: (row: RegisterRow) => void;
}) {
  const groups: { label: string; rows: RegisterRow[] }[] = [];
  for (const row of rows) {
    const label = mobileDateLabel(row.date, today);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }

  return (
    <div className="relative flex-1 overflow-y-auto">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="px-4 pb-1 pt-2.5 text-(--text-xs) font-semibold uppercase tracking-(--tracking-caps) text-(--text-muted)">
            {group.label}
          </div>
          {group.rows.map((row) => (
            <MobileTxnRow
              key={row.id}
              row={row}
              onClick={row.isTransfer ? undefined : () => onEdit(row)}
            />
          ))}
        </div>
      ))}
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-(--text-table) text-(--text-secondary)">
          No transactions match.
        </p>
      ) : null}
      <button
        type="button"
        aria-label="Add transaction"
        onClick={onAdd}
        className="fixed bottom-5 right-4 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-(--accent) text-[26px] font-normal text-white shadow-[0_4px_12px_rgba(10,79,72,0.35)] md:hidden"
      >
        +
      </button>
    </div>
  );
}

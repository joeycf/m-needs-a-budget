"use client";

import { format, parseISO, subDays } from "date-fns";
import { useMemo, useOptimistic, useState, useTransition } from "react";

import {
  createTransaction,
  deleteTransaction,
  toggleCleared,
  updateTransaction,
} from "@/app/actions/transactions";
import { BalanceHeader } from "@/components/register/balance-header";
import {
  MobileBalanceStrip,
  MobileRegister,
} from "@/components/register/mobile-register";
import { MobileTxnSheet } from "@/components/register/mobile-txn-sheet";
import { RegisterToolbar } from "@/components/register/register-toolbar";
import {
  emptyDraft,
  TxnEditorRow,
  type EditorSubmitResult,
} from "@/components/register/txn-editor-row";
import {
  DEFAULT_FILTERS,
  draftFromRow,
  type AccountPickOption,
  type CategoryOption,
  type PayeeOption,
  type RegisterAccount,
  type RegisterFilters,
  type RegisterRow,
  type TxnDraft,
} from "@/components/register/types";
import { MobileTopBar } from "@/components/shell/mobile-top-bar";
import { formatRegisterDate } from "@/lib/dates";
import { registerBalances } from "@/lib/engine/register";
import { formatMilliunits } from "@/lib/money";

function filterStart(preset: RegisterFilters["datePreset"], today: string) {
  if (preset === "month") return `${today.slice(0, 8)}01`;
  if (preset === "30d") return format(subDays(parseISO(today), 30), "yyyy-MM-dd");
  if (preset === "year") return `${today.slice(0, 5)}01-01`;
  return null;
}

function applyFilters(
  rows: RegisterRow[],
  filters: RegisterFilters,
  today: string,
): RegisterRow[] {
  const start = filterStart(filters.datePreset, today);
  const query = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (start !== null && row.date < start) return false;
    if (filters.unclearedOnly && row.cleared !== "uncleared") return false;
    if (filters.categoryId !== null && row.categoryId !== filters.categoryId)
      return false;
    if (filters.payeeId !== null && row.payeeId !== filters.payeeId)
      return false;
    if (query !== "") {
      const haystack = [
        row.payeeName,
        row.categoryName,
        row.memo,
        row.accountName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function DisplayRow({
  row,
  showAccountCol,
  onClick,
  onToggle,
}: {
  row: RegisterRow;
  showAccountCol: boolean;
  onClick?: () => void;
  onToggle: () => void;
}) {
  const reconciled = row.cleared === "reconciled";
  return (
    <tr onClick={onClick} className={onClick ? "cursor-pointer" : ""}>
      <td className="whitespace-nowrap tabular-nums">
        {formatRegisterDate(row.date)}
      </td>
      {showAccountCol ? <td className="truncate">{row.accountName}</td> : null}
      <td>{row.payeeName ?? <span className="text-(--text-muted)">—</span>}</td>
      <td className={row.categoryName ? "" : "text-(--text-muted)"}>
        {row.categoryName ?? "—"}
      </td>
      <td className="max-w-[240px] truncate text-(--text-secondary)">
        {row.memo}
      </td>
      <td className="num">
        {row.amount < 0n ? formatMilliunits(-row.amount) : ""}
      </td>
      <td className="num amount-inflow">
        {row.amount > 0n ? formatMilliunits(row.amount) : ""}
      </td>
      <td className="text-center" onClick={(e) => e.stopPropagation()}>
        {reconciled ? (
          <span className="cleared-check cursor-default" title="Reconciled">
            ✓
          </span>
        ) : (
          <button
            type="button"
            className={
              row.cleared === "cleared" ? "cleared-check" : "uncleared-check"
            }
            title={row.cleared === "cleared" ? "Cleared" : "Uncleared"}
            onClick={onToggle}
          >
            ✓
          </button>
        )}
      </td>
    </tr>
  );
}

type SheetState =
  | { mode: "add" }
  | { mode: "edit"; row: RegisterRow }
  | null;

export function RegisterView({
  mode,
  account,
  accountOptions = [],
  rows,
  payees,
  categories,
  today,
}: {
  mode: "account" | "all";
  account?: RegisterAccount;
  accountOptions?: AccountPickOption[];
  rows: RegisterRow[];
  payees: PayeeOption[];
  categories: CategoryOption[];
  today: string;
}) {
  const [filters, setFilters] = useState<RegisterFilters>(DEFAULT_FILTERS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [, startTransition] = useTransition();

  const [optimisticRows, applyFlip] = useOptimistic(
    rows,
    (state, id: string) =>
      state.map((row) =>
        row.id === id
          ? {
              ...row,
              cleared:
                row.cleared === "uncleared"
                  ? ("cleared" as const)
                  : ("uncleared" as const),
            }
          : row,
      ),
  );

  const balances = registerBalances(optimisticRows);
  const filtered = useMemo(
    () => applyFilters(optimisticRows, filters, today),
    [optimisticRows, filters, today],
  );

  const title = mode === "account" ? (account?.name ?? "") : "All Accounts";
  const showAccountCol = mode === "all";
  const canAdd = mode === "all" ? accountOptions.length > 0 : !account?.closed;

  const onBudgetFor = (accountId: string) =>
    mode === "account"
      ? (account?.onBudget ?? true)
      : (accountOptions.find((a) => a.id === accountId)?.onBudget ?? true);

  function toggle(id: string) {
    startTransition(async () => {
      applyFlip(id);
      await toggleCleared({ id });
    });
  }

  async function submitCreate(
    draft: TxnDraft,
    cleared = false,
  ): Promise<EditorSubmitResult> {
    return createTransaction({
      accountId: mode === "account" ? account!.id : draft.accountId,
      date: draft.date,
      payeeName: draft.payeeName,
      categoryId: draft.categoryId,
      memo: draft.memo,
      outflow: draft.outflow,
      inflow: draft.inflow,
      cleared,
    });
  }

  async function submitUpdate(
    row: RegisterRow,
    draft: TxnDraft,
    cleared?: boolean,
  ): Promise<EditorSubmitResult> {
    const result = await updateTransaction({
      id: row.id,
      accountId: draft.accountId,
      date: draft.date,
      payeeName: draft.payeeName,
      categoryId: draft.categoryId,
      memo: draft.memo,
      outflow: draft.outflow,
      inflow: draft.inflow,
      cleared,
    });
    if (result.ok) setEditingId(null);
    return result;
  }

  async function submitDelete(row: RegisterRow): Promise<EditorSubmitResult> {
    const result = await deleteTransaction({ id: row.id });
    if (result.ok) setEditingId(null);
    return result;
  }

  const sheetInitial = useMemo<TxnDraft>(() => {
    if (sheet?.mode === "edit") return draftFromRow(sheet.row);
    return emptyDraft(mode === "account" ? (account?.id ?? "") : "", today);
  }, [sheet, mode, account?.id, today]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ---------- Desktop ---------- */}
      <BalanceHeader title={title} balances={balances} account={account} />
      <RegisterToolbar
        filters={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        categories={categories}
        payees={payees}
        count={filtered.length}
      />
      <div className="hidden min-h-0 flex-1 overflow-auto px-6 pb-6 pt-3 md:block">
        <div className="rounded-(--radius-md) border border-(--border-default) bg-(--bg-surface) shadow-(--shadow-sm)">
          <table className="mnab-table">
            <thead>
              <tr>
                <th className="w-[100px]">Date</th>
                {showAccountCol ? <th className="w-[150px]">Account</th> : null}
                <th>Payee</th>
                <th className="w-[160px]">Category</th>
                <th>Memo</th>
                <th className="num w-[110px]">Outflow</th>
                <th className="num w-[110px]">Inflow</th>
                <th className="w-11 text-center">✓</th>
              </tr>
            </thead>
            <tbody>
              {canAdd ? (
                <TxnEditorRow
                  key={`add-${account?.id ?? "all"}`}
                  mode="add"
                  initial={emptyDraft(account?.id ?? "", today)}
                  fixedAccount={mode === "account" ? account : undefined}
                  accountOptions={accountOptions}
                  payees={payees}
                  categories={categories}
                  showAccountCol={showAccountCol}
                  onSubmit={(draft) => submitCreate(draft)}
                  onCancel={() => {}}
                />
              ) : null}
              {filtered.map((row) =>
                editingId === row.id ? (
                  <TxnEditorRow
                    key={row.id}
                    mode="edit"
                    initial={draftFromRow(row)}
                    fixedAccount={mode === "account" ? account : undefined}
                    accountOptions={accountOptions}
                    payees={payees}
                    categories={categories}
                    showAccountCol={showAccountCol}
                    onSubmit={(draft) => submitUpdate(row, draft)}
                    onCancel={() => setEditingId(null)}
                    onDelete={() => submitDelete(row)}
                  />
                ) : (
                  <DisplayRow
                    key={row.id}
                    row={row}
                    showAccountCol={showAccountCol}
                    onClick={
                      row.isTransfer || row.cleared === "reconciled"
                        ? undefined
                        : () => setEditingId(row.id)
                    }
                    onToggle={() => toggle(row.id)}
                  />
                ),
              )}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-(--text-table) text-(--text-secondary)">
              No transactions match.
            </p>
          ) : null}
        </div>
      </div>

      {/* ---------- Mobile ---------- */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        <MobileTopBar
          title={title}
          onSearch={() => setMobileSearchOpen((open) => !open)}
        />
        {mobileSearchOpen ? (
          <div className="border-b border-(--border-default) bg-(--bg-surface) p-2">
            <input
              className="input w-full"
              placeholder="Search transactions…"
              autoFocus
              value={filters.search}
              onChange={(e) =>
                setFilters((f) => ({ ...f, search: e.target.value }))
              }
            />
          </div>
        ) : null}
        <MobileBalanceStrip balances={balances} />
        <MobileRegister
          rows={filtered}
          today={today}
          onAdd={canAdd ? () => setSheet({ mode: "add" }) : () => {}}
          onEdit={(row) => {
            if (row.cleared !== "reconciled") setSheet({ mode: "edit", row });
          }}
        />
      </div>

      <MobileTxnSheet
        open={sheet !== null}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        mode={sheet?.mode ?? "add"}
        initial={sheetInitial}
        initialCleared={
          sheet?.mode === "edit" ? sheet.row.cleared !== "uncleared" : false
        }
        onBudgetFor={onBudgetFor}
        accountOptions={
          mode === "all" && sheet?.mode !== "edit" ? accountOptions : undefined
        }
        categories={categories}
        payees={payees}
        onSubmit={(draft, cleared) =>
          sheet?.mode === "edit"
            ? submitUpdate(sheet.row, draft, cleared)
            : submitCreate(draft, cleared)
        }
        onDelete={
          sheet?.mode === "edit" ? () => submitDelete(sheet.row) : undefined
        }
      />
    </div>
  );
}

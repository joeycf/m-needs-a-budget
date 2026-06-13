"use client";

import { useRef, useState, useTransition, type KeyboardEvent } from "react";

import { MiniSelect } from "@/components/register/mini-select";
import type {
  AccountPickOption,
  CategoryOption,
  PayeeOption,
  RegisterAccount,
  TxnDraft,
} from "@/components/register/types";
import { formatRegisterDate } from "@/lib/dates";

const cellInput =
  "h-6 w-full rounded-[2px] border border-(--border-strong) bg-(--bg-surface) px-1 text-(--text-table) placeholder:text-(--text-muted) focus:border-(--accent) focus:outline-none";
const cellInputNum = `${cellInput} num`;

export interface EditorSubmitResult {
  ok: boolean;
  error?: string;
}

/** The teal inline editor pair of rows from Register Checking.html —
 *  used for both the always-on add row and row editing. Enter saves,
 *  Esc cancels, picking a payee fills its last-used category. */
export function TxnEditorRow({
  mode,
  initial,
  fixedAccount,
  accountOptions = [],
  payees,
  categories,
  showAccountCol = false,
  onSubmit,
  onCancel,
  onDelete,
}: {
  mode: "add" | "edit";
  initial: TxnDraft;
  fixedAccount?: RegisterAccount;
  accountOptions?: AccountPickOption[];
  payees: PayeeOption[];
  categories: CategoryOption[];
  showAccountCol?: boolean;
  onSubmit: (draft: TxnDraft) => Promise<EditorSubmitResult>;
  onCancel: () => void;
  onDelete?: () => Promise<EditorSubmitResult>;
}) {
  const [draft, setDraft] = useState<TxnDraft>(initial);
  const [payeeOpen, setPayeeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const payeeInputRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof TxnDraft>(key: K, value: TxnDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const onBudget = fixedAccount
    ? fixedAccount.onBudget
    : (accountOptions.find((a) => a.id === draft.accountId)?.onBudget ?? true);

  const currentAccountId = fixedAccount?.id ?? draft.accountId;
  const suggestions = payees.filter(
    (p) =>
      draft.payeeName !== "" &&
      // Can't transfer to the account you're already in.
      p.transferAccountId !== currentAccountId &&
      p.name.toLowerCase().includes(draft.payeeName.toLowerCase()) &&
      p.name.toLowerCase() !== draft.payeeName.toLowerCase(),
  );

  function pickPayee(payee: PayeeOption) {
    setDraft((d) => ({
      ...d,
      payeeName: payee.name,
      transferAccountId: payee.transferAccountId,
      // A transfer has no category; a plain payee fills its last category.
      categoryId: payee.transferAccountId
        ? null
        : (d.categoryId ?? payee.lastCategoryId),
    }));
    setPayeeOpen(false);
  }

  function save() {
    if (pending) return;
    if (showAccountCol && draft.accountId === "") {
      setError("Pick an account.");
      return;
    }
    if (draft.payeeName.trim() === "") {
      setError("Payee is required.");
      return;
    }
    if (draft.outflow.trim() === "" && draft.inflow.trim() === "") {
      setError("Enter an outflow or inflow amount.");
      return;
    }
    startTransition(async () => {
      const result = await onSubmit(draft);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setError(null);
      if (mode === "add") {
        setDraft({ ...initial, date: draft.date });
        setPayeeOpen(false);
        payeeInputRef.current?.focus();
      }
    });
  }

  function cancel() {
    setError(null);
    setPayeeOpen(false);
    if (mode === "add") setDraft({ ...initial, date: draft.date });
    onCancel();
  }

  function onKey(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-slot="dropdown-menu-trigger"]')) return;
    if (event.key === "Enter" && !payeeOpen) {
      event.preventDefault();
      save();
    }
    if (event.key === "Escape") cancel();
  }

  const categoryOptions = categories.map((c) => ({
    id: c.id,
    label: c.name,
    sublabel: c.isReadyToAssign ? "Income" : c.groupName,
  }));

  const colCount = 6 + (showAccountCol ? 1 : 0) + 1; // +1 cleared column

  return (
    <>
      <tr className="bg-(--teal-50)" onKeyDown={onKey}>
        <td className="w-[100px]">
          <input
            className={cellInput}
            aria-label="Date"
            value={draft.date}
            onChange={(e) => set("date", e.target.value)}
          />
        </td>
        {showAccountCol ? (
          <td className="w-[150px]">
            <MiniSelect
              value={draft.accountId === "" ? null : draft.accountId}
              options={accountOptions.map((a) => ({ id: a.id, label: a.name }))}
              onChange={(id) => set("accountId", id)}
              placeholder="Account…"
            />
          </td>
        ) : null}
        <td className="relative">
          <input
            ref={payeeInputRef}
            className={cellInput}
            placeholder="Payee"
            value={draft.payeeName}
            onChange={(e) => {
              // Editing the payee text drops any transfer link.
              setDraft((d) => ({
                ...d,
                payeeName: e.target.value,
                transferAccountId: null,
              }));
              setPayeeOpen(true);
            }}
            onBlur={() => setTimeout(() => setPayeeOpen(false), 150)}
          />
          {payeeOpen && suggestions.length > 0 ? (
            <div
              className="menu absolute left-2 top-[calc(100%-4px)] z-[70] w-[220px]"
            >
              {suggestions.slice(0, 8).map((p) => (
                <div
                  key={p.id}
                  className="menu-item"
                  onMouseDown={() => pickPayee(p)}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-(--text-xs) text-(--text-muted)">
                    {p.lastCategoryName ?? ""}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </td>
        <td className="w-[160px]">
          {draft.transferAccountId ? (
            <MiniSelect
              value={null}
              options={[]}
              onChange={() => {}}
              fixed="Transfer"
            />
          ) : onBudget ? (
            <MiniSelect
              value={draft.categoryId}
              options={categoryOptions}
              onChange={(id) => set("categoryId", id)}
            />
          ) : (
            <MiniSelect value={null} options={[]} onChange={() => {}} fixed="—" />
          )}
        </td>
        <td>
          <input
            className={cellInput}
            placeholder="Memo"
            value={draft.memo}
            onChange={(e) => set("memo", e.target.value)}
          />
        </td>
        <td className="w-[110px]">
          <input
            className={cellInputNum}
            placeholder="Outflow"
            inputMode="decimal"
            value={draft.outflow}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                outflow: e.target.value,
                inflow: e.target.value === "" ? d.inflow : "",
              }))
            }
          />
        </td>
        <td className="w-[110px]">
          <input
            className={cellInputNum}
            placeholder="Inflow"
            inputMode="decimal"
            value={draft.inflow}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                inflow: e.target.value,
                outflow: e.target.value === "" ? d.outflow : "",
              }))
            }
          />
        </td>
        <td className="w-11 text-center">
          <span className="uncleared-check">✓</span>
        </td>
      </tr>
      <tr className="bg-(--teal-50)" onKeyDown={onKey}>
        <td colSpan={colCount} className="h-[30px] px-2 pb-2 pt-0.5">
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-(--text-xs) text-(--text-muted)">
              {error ? (
                <span style={{ color: "var(--cash-overspent-fg)" }}>{error}</span>
              ) : (
                "Enter saves · Esc cancels · payee fills its last category"
              )}
            </span>
            {mode === "edit" && onDelete ? (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ color: "var(--cash-overspent-fg)" }}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await onDelete();
                    if (!result.ok) {
                      setError(result.error ?? "Something went wrong.");
                    }
                  })
                }
              >
                Delete
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={pending}
            >
              Save
            </button>
          </div>
        </td>
      </tr>
    </>
  );
}

/** Blank draft for the add row. */
export function emptyDraft(accountId: string, todayIso: string): TxnDraft {
  return {
    accountId,
    date: formatRegisterDate(todayIso),
    payeeName: "",
    categoryId: null,
    memo: "",
    outflow: "",
    inflow: "",
    transferAccountId: null,
  };
}

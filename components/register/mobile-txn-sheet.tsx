"use client";

import { useId, useState, useTransition } from "react";

import type { EditorSubmitResult } from "@/components/register/txn-editor-row";
import type {
  AccountPickOption,
  CategoryOption,
  PayeeOption,
  TxnDraft,
} from "@/components/register/types";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { parseRegisterDate, todayISO } from "@/lib/dates";

type Flow = "outflow" | "inflow";

function SheetField({
  label,
  last = false,
  children,
}: {
  label: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex min-h-12 items-center justify-between gap-3 px-4 ${
        last ? "" : "border-b border-(--border-row)"
      }`}
    >
      <span className="shrink-0 text-(--text-table) text-(--text-secondary)">
        {label}
      </span>
      {children}
    </label>
  );
}

const fieldInput =
  "min-w-0 flex-1 bg-transparent text-right text-(--text-base) font-medium text-(--text-primary) outline-none placeholder:text-(--text-muted)";

interface SheetFormProps {
  mode: "add" | "edit";
  initial: TxnDraft;
  initialCleared: boolean;
  onBudgetFor: (accountId: string) => boolean;
  accountOptions?: AccountPickOption[];
  categories: CategoryOption[];
  payees: PayeeOption[];
  onSubmit: (draft: TxnDraft, cleared: boolean) => Promise<EditorSubmitResult>;
  onDelete?: () => Promise<EditorSubmitResult>;
  onClose: () => void;
}

/** Bottom add/edit sheet per the "Mobile — add transaction" artboard. */
export function MobileTxnSheet({
  open,
  onOpenChange,
  ...form
}: Omit<SheetFormProps, "onClose"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="gap-0 rounded-t-[14px] p-0 pb-3 md:hidden"
      >
        {/* Radix unmounts the content on close, so the form state re-seeds
            from `initial` on every open — no effect-driven syncing. */}
        <SheetForm {...form} onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

function SheetForm({
  mode,
  initial,
  initialCleared,
  onBudgetFor,
  accountOptions,
  categories,
  payees,
  onSubmit,
  onDelete,
  onClose,
}: SheetFormProps) {
  const datalistId = useId();
  const [pending, startTransition] = useTransition();
  const [flow, setFlow] = useState<Flow>(
    initial.inflow !== "" ? "inflow" : "outflow",
  );
  const [amount, setAmount] = useState(
    initial.inflow !== "" ? initial.inflow : initial.outflow,
  );
  const [accountId, setAccountId] = useState(initial.accountId);
  const [payeeName, setPayeeName] = useState(initial.payeeName);
  const [categoryId, setCategoryId] = useState<string | null>(
    initial.categoryId,
  );
  const [date, setDate] = useState(
    () => parseRegisterDate(initial.date) ?? todayISO(),
  );
  const [memo, setMemo] = useState(initial.memo);
  const [cleared, setCleared] = useState(initialCleared);
  const [error, setError] = useState<string | null>(null);

  const onBudget = onBudgetFor(accountId);
  const rta = categories.find((c) => c.isReadyToAssign);
  const grouped = new Map<string, CategoryOption[]>();
  for (const c of categories.filter((c) => !c.isReadyToAssign)) {
    grouped.set(c.groupName, [...(grouped.get(c.groupName) ?? []), c]);
  }

  function changePayee(name: string) {
    setPayeeName(name);
    if (categoryId === null) {
      const match = payees.find(
        (p) => p.name.toLowerCase() === name.trim().toLowerCase(),
      );
      if (match?.lastCategoryId) setCategoryId(match.lastCategoryId);
    }
  }

  function save() {
    if (pending) return;
    if (accountOptions && accountId === "") {
      setError("Pick an account.");
      return;
    }
    if (payeeName.trim() === "") {
      setError("Payee is required.");
      return;
    }
    if (amount.trim() === "") {
      setError("Enter an amount.");
      return;
    }
    startTransition(async () => {
      const draft: TxnDraft = {
        accountId,
        date,
        payeeName,
        categoryId,
        memo,
        outflow: flow === "outflow" ? amount : "",
        inflow: flow === "inflow" ? amount : "",
      };
      const result = await onSubmit(draft, cleared);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      onClose();
    });
  }

  return (
    <>
      <div className="mx-auto mt-2 h-1 w-9 rounded-[2px] bg-(--gray-300)" />
      <div className="flex items-center justify-between px-4 pt-2.5">
        <SheetTitle className="text-(--text-md) font-semibold">
          {mode === "add" ? "New transaction" : "Edit transaction"}
        </SheetTitle>
        <SheetClose className="-mr-3 flex h-11 w-11 cursor-pointer items-center justify-center text-(--text-base) text-(--text-secondary)">
          ✕
        </SheetClose>
      </div>

      <div className="mx-4 mt-1 flex overflow-hidden rounded-(--radius-sm) border border-(--border-strong)">
        {(["outflow", "inflow"] as Flow[]).map((side) => (
          <button
            key={side}
            type="button"
            onClick={() => setFlow(side)}
            className={`flex-1 cursor-pointer py-[9px] text-center text-(--text-table) ${
              flow === side
                ? "bg-(--gray-800) font-semibold text-(--gray-50)"
                : "font-medium text-(--text-secondary)"
            }`}
          >
            {side === "outflow" ? "Outflow" : "Inflow"}
          </button>
        ))}
      </div>

      <div className="px-4 pb-3 pt-4">
        <input
          className="num w-full bg-transparent text-center text-[34px] font-bold outline-none placeholder:text-(--text-muted)"
          placeholder="$0.00"
          inputMode="decimal"
          aria-label="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <div className="border-t border-(--border-row)">
        {accountOptions ? (
          <SheetField label="Account">
            <select
              className={fieldInput}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="" disabled>
                Pick an account…
              </option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </SheetField>
        ) : null}
        <SheetField label="Payee">
          <input
            className={fieldInput}
            placeholder="Payee"
            list={datalistId}
            value={payeeName}
            onChange={(e) => changePayee(e.target.value)}
          />
          <datalist id={datalistId}>
            {payees.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
        </SheetField>
        <SheetField label="Category">
          {onBudget ? (
            <select
              className={fieldInput}
              value={categoryId ?? ""}
              onChange={(e) =>
                setCategoryId(e.target.value === "" ? null : e.target.value)
              }
            >
              <option value="">
                {rta ? `${rta.name} (default)` : "Ready to Assign"}
              </option>
              {rta ? <option value={rta.id}>{rta.name}</option> : null}
              {[...grouped.entries()].map(([groupName, cats]) => (
                <optgroup key={groupName} label={groupName}>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          ) : (
            <span className="text-(--text-base) font-medium text-(--text-muted)">
              —
            </span>
          )}
        </SheetField>
        <SheetField label="Date">
          <input
            type="date"
            className={fieldInput}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </SheetField>
        <SheetField label="Memo">
          <input
            className={fieldInput}
            placeholder="Add memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </SheetField>
        <SheetField label="Cleared" last>
          <button
            type="button"
            onClick={() => setCleared(!cleared)}
            className="cursor-pointer text-(--text-base) font-medium"
            style={{
              color: cleared ? "var(--funded-strong)" : "var(--text-muted)",
            }}
          >
            {cleared ? "● Cleared" : "○ Uncleared"}
          </button>
        </SheetField>
      </div>

      {error ? (
        <p
          className="px-4 pt-2 text-(--text-sm)"
          style={{ color: "var(--cash-overspent-fg)" }}
        >
          {error}
        </p>
      ) : null}

      <div className="px-4 pt-2">
        <button
          type="button"
          className="btn btn-primary w-full"
          style={{ height: 48, fontSize: 16 }}
          onClick={save}
          disabled={pending}
        >
          Save transaction
        </button>
        {mode === "edit" && onDelete ? (
          <button
            type="button"
            className="btn btn-ghost mt-1 w-full"
            style={{ height: 40, color: "var(--cash-overspent-fg)" }}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await onDelete();
                if (!result.ok) {
                  setError(result.error ?? "Something went wrong.");
                  return;
                }
                onClose();
              })
            }
          >
            Delete transaction
          </button>
        ) : null}
      </div>
    </>
  );
}

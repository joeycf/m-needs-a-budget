"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import {
  createAccount,
  deleteAccount,
  updateAccount,
} from "@/app/actions/accounts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AccountType } from "@/lib/db/schema";

const TYPE_GROUPS: { label: string; types: [AccountType, string][] }[] = [
  {
    label: "Budget accounts",
    types: [
      ["checking", "Checking"],
      ["savings", "Savings"],
      ["cash", "Cash"],
      ["credit_card", "Credit card"],
    ],
  },
  {
    label: "Tracking accounts",
    types: [
      ["tracking_asset", "Asset (investments, property)"],
      ["tracking_liability", "Liability (loans, mortgage)"],
    ],
  },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-(--text-sm) text-(--text-secondary)">
        {label}
      </span>
      {children}
    </label>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="text-(--text-sm)" style={{ color: "var(--cash-overspent-fg)" }}>
      {error}
    </p>
  );
}

export function AddAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("checking");
  const [startingBalance, setStartingBalance] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createAccount({ name, type, startingBalance, note });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      setName("");
      setType("checking");
      setStartingBalance("");
      setNote("");
      setError(null);
      router.push(`/accounts/${result.accountId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[6px]">
        <DialogHeader>
          <DialogTitle>Add account</DialogTitle>
          <DialogDescription>
            Budget accounts participate in the budget; tracking accounts only
            affect net worth.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Name">
            <input
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Checking"
              autoFocus
              required
            />
          </Field>
          <Field label="Type">
            <select
              className="input w-full"
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
            >
              {TYPE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.types.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Current balance">
            <input
              className="input num w-full"
              value={startingBalance}
              onChange={(e) => setStartingBalance(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
            />
          </Field>
          <p className="-mt-2 text-(--text-xs) text-(--text-muted)">
            Negative for money you owe. Cash balances flow into Ready to
            Assign as a Starting Balance transaction.
          </p>
          <Field label="Note">
            <input
              className="input w-full"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              Add account
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditAccountDialog({
  account,
  open,
  onOpenChange,
}: {
  account: { id: string; name: string; note: string | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[6px]">
        <DialogHeader>
          <DialogTitle>Edit account</DialogTitle>
        </DialogHeader>
        {/* Radix unmounts the content on close, so the form re-seeds from
            the account on every open without effect-driven state syncing. */}
        <EditAccountForm account={account} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function EditAccountForm({
  account,
  onClose,
}: {
  account: { id: string; name: string; note: string | null };
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(account.name);
  const [note, setNote] = useState(account.note ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateAccount({ id: account.id, name, note });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Name">
            <input
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </Field>
          <Field label="Note">
            <input
              className="input w-full"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </Field>
      <ErrorLine error={error} />
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          Save
        </button>
      </div>
    </form>
  );
}

export function DeleteAccountDialog({
  account,
  open,
  onOpenChange,
}: {
  account: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    startTransition(async () => {
      const result = await deleteAccount({ id: account.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      router.push("/");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[6px]">
        <DialogHeader>
          <DialogTitle>Delete {account.name}?</DialogTitle>
          <DialogDescription>
            This permanently deletes the account and every transaction in it.
            If you just want it out of the way, close the account instead.
          </DialogDescription>
        </DialogHeader>
        <ErrorLine error={error} />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={confirm}
            disabled={pending}
          >
            Delete account
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

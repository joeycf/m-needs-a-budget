"use client";

import { useState, useTransition } from "react";

import { setAccountClosed } from "@/app/actions/accounts";
import {
  DeleteAccountDialog,
  EditAccountDialog,
} from "@/components/accounts/account-dialogs";
import type { RegisterAccount } from "@/components/register/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RegisterBalanceSummary } from "@/lib/engine/register";
import { formatMilliunits } from "@/lib/money";

function BalanceFig({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: bigint;
  strong?: boolean;
}) {
  return (
    <div className="text-right">
      <div
        className={`num ${strong ? "text-(--text-lg) font-bold" : "text-(--text-md) font-semibold"}`}
        style={{
          color: value < 0n ? "var(--cash-overspent-fg)" : "var(--text-primary)",
        }}
      >
        {formatMilliunits(value)}
      </div>
      <div className="th-caps mt-px">{label}</div>
    </div>
  );
}

/** Desktop register header per register-components.jsx BalanceHeader:
 *  account name · Cleared + Uncleared = Working · Reconcile (M6) · ⋯ menu. */
export function BalanceHeader({
  title,
  balances,
  account,
}: {
  title: string;
  balances: RegisterBalanceSummary;
  account?: RegisterAccount;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [, startTransition] = useTransition();
  const operator = "pb-3.5 text-(--text-base) text-(--text-muted)";

  return (
    <div className="hidden items-center gap-6 border-b border-(--border-default) bg-(--bg-surface) px-6 py-3.5 md:flex">
      <div className="flex flex-1 items-center gap-2.5 truncate">
        <span className="truncate text-(--text-xl) font-bold">{title}</span>
        {account?.closed ? (
          <span className="pill pill--zero h-[18px] min-w-0 px-2 text-(--text-xs)">
            Closed
          </span>
        ) : null}
      </div>
      <div className="flex items-end gap-3.5">
        <BalanceFig label="Cleared" value={balances.cleared} />
        <span className={operator}>+</span>
        <BalanceFig label="Uncleared" value={balances.uncleared} />
        <span className={operator}>=</span>
        <BalanceFig label="Working balance" value={balances.working} strong />
      </div>
      {account ? (
        <>
          <button
            type="button"
            className="btn btn-secondary"
            disabled
            title="Reconciliation arrives in Milestone 6"
          >
            Reconcile
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Account actions"
                className="btn btn-ghost w-7 px-0 text-(--text-md)"
              >
                ⋯
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-[200px]">
              <DropdownMenuItem
                className="text-(--text-table)"
                onSelect={() => setEditOpen(true)}
              >
                Edit account
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-(--text-table)"
                onSelect={() =>
                  startTransition(async () => {
                    await setAccountClosed({
                      id: account.id,
                      closed: !account.closed,
                    });
                  })
                }
              >
                {account.closed ? "Reopen account" : "Close account"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="text-(--text-table)"
                onSelect={() => setDeleteOpen(true)}
              >
                Delete account
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <EditAccountDialog
            account={account}
            open={editOpen}
            onOpenChange={setEditOpen}
          />
          <DeleteAccountDialog
            account={account}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
          />
        </>
      ) : null}
    </div>
  );
}

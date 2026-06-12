"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { AddAccountDialog } from "@/components/accounts/account-dialogs";
import type {
  SidebarAccountItem,
  SidebarData,
} from "@/components/shell/shell-context";
import { formatMilliunits } from "@/lib/money";

// Sidebar per shell-components.jsx, token tone ("light" variant — the
// vars themselves flip dark). Layout numbers come straight from the mock:
// 12x8 padding, 30px nav rows, 28px account rows (40/44 when mobile).

function NavItem({
  label,
  href,
  active,
  mobile,
  onNavigate,
}: {
  label: string;
  href?: string;
  active?: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const className = `flex items-center rounded-(--radius-sm) px-2.5 ${
    mobile ? "h-11 text-(--text-base)" : "h-[30px] text-(--text-table)"
  } ${
    active
      ? "bg-(--teal-50) font-semibold text-(--teal-800)"
      : "font-medium text-(--text-primary) hover:bg-(--gray-100)"
  }`;
  if (!href) {
    // Placeholder destinations (Reports → M8) render inert and muted.
    return (
      <div className={className} aria-disabled title="Coming in a later milestone">
        <span className="opacity-50">{label}</span>
      </div>
    );
  }
  return (
    <Link href={href} className={className} onClick={onNavigate}>
      {label}
    </Link>
  );
}

function AccountRow({
  account,
  active,
  mobile,
  onNavigate,
}: {
  account: SidebarAccountItem;
  active?: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const negative = account.balance < 0n;
  return (
    <Link
      href={`/accounts/${account.id}`}
      onClick={onNavigate}
      className={`flex items-center justify-between gap-2 rounded-(--radius-sm) px-2.5 ${
        mobile ? "h-10" : "h-7"
      } ${active ? "bg-(--teal-50)" : "hover:bg-(--gray-100)"}`}
    >
      <span
        className={`truncate text-(--text-table) ${
          active ? "font-semibold text-(--teal-800)" : "text-(--text-primary)"
        }`}
      >
        {account.name}
      </span>
      <span
        className={`num shrink-0 text-(--text-sm) ${active ? "font-semibold" : ""}`}
        style={{
          color: negative
            ? "var(--cash-overspent-fg)"
            : active
              ? "var(--teal-800)"
              : "var(--text-secondary)",
        }}
      >
        {formatMilliunits(account.balance)}
      </span>
    </Link>
  );
}

function SectionHeading({ label, total }: { label: string; total: bigint }) {
  return (
    <div className="mb-0.5 flex items-baseline justify-between px-2.5">
      <span className="th-caps">{label}</span>
      <span className="num text-(--text-xs) text-(--text-muted)">
        {formatMilliunits(total)}
      </span>
    </div>
  );
}

export function Sidebar({
  data,
  mobile = false,
  onNavigate,
}: {
  data: SidebarData;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div
      className="flex h-full flex-col border-r border-(--border-default) bg-(--bg-surface) px-2 py-3"
      style={{ width: mobile ? 300 : "var(--sidebar-w)" }}
    >
      <div className="flex items-center gap-2 px-2.5 pb-3 pt-0.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] bg-(--accent) text-(--text-table) font-bold text-white">
          M
        </div>
        <div className="truncate text-(--text-base) font-bold text-(--text-primary)">
          M Needs a Budget
        </div>
      </div>

      <nav className="flex flex-col gap-px">
        <NavItem
          label="Budget"
          href="/"
          active={pathname === "/"}
          mobile={mobile}
          onNavigate={onNavigate}
        />
        <NavItem label="Reports" mobile={mobile} />
        <NavItem
          label="All Accounts"
          href="/accounts"
          active={pathname === "/accounts"}
          mobile={mobile}
          onNavigate={onNavigate}
        />
      </nav>

      <div className="mt-5 flex flex-col gap-px">
        <SectionHeading label="Budget" total={data.budgetTotal} />
        {data.budgetAccounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            active={pathname === `/accounts/${account.id}`}
            mobile={mobile}
            onNavigate={onNavigate}
          />
        ))}
      </div>
      {data.trackingAccounts.length > 0 ? (
        <div className="mt-4 flex flex-col gap-px">
          <SectionHeading label="Tracking" total={data.trackingTotal} />
          {data.trackingAccounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              active={pathname === `/accounts/${account.id}`}
              mobile={mobile}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}

      <div className="flex-1" />

      <div className="mx-0.5 flex items-center justify-between border-t border-(--border-default) px-2 pb-3 pt-2.5">
        <span className="text-(--text-sm) font-medium text-(--text-secondary)">
          Net total
        </span>
        <span className="num text-(--text-table) font-semibold text-(--text-primary)">
          {formatMilliunits(data.netTotal)}
        </span>
      </div>

      <button
        type="button"
        className={`btn btn-secondary w-full ${mobile ? "h-10!" : ""}`}
        onClick={() => setAddOpen(true)}
      >
        + Add account
      </button>
      <AddAccountDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

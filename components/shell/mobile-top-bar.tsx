"use client";

import { useShell } from "@/components/shell/shell-context";

/** 52px mobile top bar per App Shell.html / Register Checking.html:
 *  ☰ opens the nav drawer; the register variant adds a ⌕ search toggle. */
export function MobileTopBar({
  title,
  showLogo = false,
  onSearch,
}: {
  title: string;
  showLogo?: boolean;
  onSearch?: () => void;
}) {
  const { openDrawer } = useShell();
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-1 border-b border-(--border-default) bg-(--bg-surface) px-1.5 md:hidden">
      <button
        type="button"
        aria-label="Open navigation"
        onClick={openDrawer}
        className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-(--radius-sm) text-lg text-(--text-primary)"
      >
        ☰
      </button>
      <div className="flex items-center gap-2">
        {showLogo ? (
          <div className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] bg-(--accent) text-xs font-bold text-white">
            M
          </div>
        ) : null}
        <span className="text-(--text-md) font-semibold">{title}</span>
      </div>
      <div className="flex-1" />
      {onSearch ? (
        <button
          type="button"
          aria-label="Search"
          onClick={onSearch}
          className="flex h-11 w-11 cursor-pointer items-center justify-center text-base text-(--text-secondary)"
        >
          ⌕
        </button>
      ) : null}
    </div>
  );
}

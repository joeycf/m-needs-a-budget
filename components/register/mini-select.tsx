"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface MiniSelectOption {
  id: string;
  label: string;
  sublabel?: string;
}

/** Compact select per budget-components.jsx MiniSelect: 28px bordered
 *  trigger, token .menu-style list sized to the trigger. `fixed` renders
 *  the non-interactive gray variant (tracking-account category cell). */
export function MiniSelect({
  value,
  options,
  onChange,
  placeholder = "Select category…",
  fixed,
}: {
  value: string | null;
  options: MiniSelectOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  fixed?: string;
}) {
  if (fixed !== undefined) {
    return (
      <div className="flex h-7 items-center justify-between rounded-(--radius-sm) border border-(--border-default) bg-(--gray-100) px-2 text-(--text-table) text-(--text-primary)">
        <span>{fixed}</span>
      </div>
    );
  }

  const current = options.find((option) => option.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-7 w-full cursor-pointer items-center justify-between gap-2 rounded-(--radius-sm) border border-(--border-strong) bg-(--bg-surface) px-2 text-(--text-table)"
        >
          <span className={`truncate ${current ? "" : "text-(--text-muted)"}`}>
            {current ? current.label : placeholder}
          </span>
          <span className="text-[10px] text-(--text-muted)">▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[240px]">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onSelect={() => onChange(option.id)}
            className="justify-between gap-4 text-(--text-table)"
          >
            <span className="truncate">{option.label}</span>
            {option.sublabel ? (
              <span className="shrink-0 text-(--text-xs) text-(--text-muted)">
                {option.sublabel}
              </span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

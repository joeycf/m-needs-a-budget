"use client";

import type {
  CategoryOption,
  DatePreset,
  PayeeOption,
  RegisterFilters,
} from "@/components/register/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const DATE_LABELS: Record<DatePreset, string> = {
  month: "Date: this month",
  "30d": "Date: last 30 days",
  year: "Date: this year",
  all: "Date: all",
};

function FilterChip({
  label,
  active = false,
  caret = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  caret?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-6 cursor-pointer items-center gap-[5px] rounded-(--radius-pill) border px-2.5 text-(--text-sm) font-medium ${
        active
          ? "border-(--teal-300) bg-(--teal-50) text-(--teal-800)"
          : "border-(--border-strong) bg-(--bg-surface) text-(--text-secondary)"
      }`}
    >
      {label}
      {caret ? <span className="text-[9px] opacity-70">▾</span> : null}
    </button>
  );
}

function ChipMenu({
  chip,
  children,
}: {
  chip: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{chip}</DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[280px] w-auto min-w-[200px]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const radioItemClass = "text-(--text-table)";

/** Search + filter chips + count, per register-components.jsx toolbar. */
export function RegisterToolbar({
  filters,
  onChange,
  categories,
  payees,
  count,
}: {
  filters: RegisterFilters;
  onChange: (patch: Partial<RegisterFilters>) => void;
  categories: CategoryOption[];
  payees: PayeeOption[];
  count: number;
}) {
  const category = categories.find((c) => c.id === filters.categoryId);
  const payee = payees.find((p) => p.id === filters.payeeId);

  return (
    <div className="hidden items-center gap-2 px-6 pt-3 md:flex">
      <input
        className="input w-[230px]"
        placeholder="Search transactions…"
        value={filters.search}
        onChange={(e) => onChange({ search: e.target.value })}
      />

      <ChipMenu
        chip={
          <FilterChip
            label={DATE_LABELS[filters.datePreset]}
            active={filters.datePreset !== "month"}
            caret
          />
        }
      >
        <DropdownMenuRadioGroup
          value={filters.datePreset}
          onValueChange={(value) =>
            onChange({ datePreset: value as DatePreset })
          }
        >
          {(Object.keys(DATE_LABELS) as DatePreset[]).map((preset) => (
            <DropdownMenuRadioItem
              key={preset}
              value={preset}
              className={radioItemClass}
            >
              {DATE_LABELS[preset].replace("Date: ", "")}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </ChipMenu>

      <ChipMenu
        chip={
          <FilterChip
            label={category ? category.name : "Category"}
            active={filters.categoryId !== null}
            caret
          />
        }
      >
        <DropdownMenuRadioGroup
          value={filters.categoryId ?? "all"}
          onValueChange={(value) =>
            onChange({ categoryId: value === "all" ? null : value })
          }
        >
          <DropdownMenuRadioItem value="all" className={radioItemClass}>
            All categories
          </DropdownMenuRadioItem>
          {categories.map((c) => (
            <DropdownMenuRadioItem
              key={c.id}
              value={c.id}
              className={radioItemClass}
            >
              {c.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </ChipMenu>

      <ChipMenu
        chip={
          <FilterChip
            label={payee ? payee.name : "Payee"}
            active={filters.payeeId !== null}
            caret
          />
        }
      >
        <DropdownMenuRadioGroup
          value={filters.payeeId ?? "all"}
          onValueChange={(value) =>
            onChange({ payeeId: value === "all" ? null : value })
          }
        >
          <DropdownMenuRadioItem value="all" className={radioItemClass}>
            All payees
          </DropdownMenuRadioItem>
          {payees.map((p) => (
            <DropdownMenuRadioItem
              key={p.id}
              value={p.id}
              className={radioItemClass}
            >
              {p.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </ChipMenu>

      <FilterChip
        label="Uncleared"
        active={filters.unclearedOnly}
        onClick={() => onChange({ unclearedOnly: !filters.unclearedOnly })}
      />

      <div className="flex-1" />
      <span className="text-(--text-sm) text-(--text-muted)">
        {count} transaction{count === 1 ? "" : "s"}
      </span>
    </div>
  );
}

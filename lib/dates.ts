import { format, isValid, parse, parseISO, subDays } from "date-fns";

// All dates are plain "yyyy-MM-dd" strings end to end (iron rule 5);
// Date objects exist only transiently inside these helpers.

export function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/** Register column format per the design: MM/DD/YYYY. */
export function formatRegisterDate(iso: string): string {
  return format(parseISO(iso), "MM/dd/yyyy");
}

const INPUT_FORMATS = ["M/d/yyyy", "yyyy-MM-dd"];

/** Parse register date input (MM/DD/YYYY, M/D/YYYY, or ISO) to ISO.
 *  Invalid or impossible dates return null. */
export function parseRegisterDate(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  for (const fmt of INPUT_FORMATS) {
    const parsed = parse(trimmed, fmt, new Date());
    if (isValid(parsed)) return format(parsed, "yyyy-MM-dd");
  }
  return null;
}

/** Budget month switcher label: "2026-06-01" → "June 2026". */
export function formatMonthLabel(month: string): string {
  return format(parseISO(month), "MMMM yyyy");
}

/** Mobile register group label: Today / Yesterday / "June 9"
 *  (with year when not the current year). */
export function mobileDateLabel(iso: string, today: string = todayISO()): string {
  if (iso === today) return "Today";
  const todayDate = parseISO(today);
  if (format(subDays(todayDate, 1), "yyyy-MM-dd") === iso) return "Yesterday";
  const date = parseISO(iso);
  return format(
    date,
    date.getFullYear() === todayDate.getFullYear() ? "MMMM d" : "MMMM d, yyyy",
  );
}

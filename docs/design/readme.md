# M Needs A Budget — Design System

Personal zero-based budgeting web app (YNAB-style). Single user, manual entry, password gate.
Source of truth for product behavior: `docs/PRD.md` in https://github.com/joeycf/m-needs-a-budget
(stack: Next.js + Tailwind + shadcn/ui; money is integer milliunits, formatted only at the UI edge).

## Vibe

**A spreadsheet you trust, not a marketing site.** Dense, data-heavy. Light mode is the default;
a full dark theme exists — apply `data-theme="dark"` to any subtree and every token flips
(near-black `#141619` app bg, `#20242a` cards, light text, brightened teal, money states as
tinted fills with high-contrast text). Quiet chrome; the numbers are the interface.
No gradients, no illustration, no emoji.

## Visual foundations

- **Color**: cool neutral grays for all surfaces (`--bg-app` #f4f5f6 app shell, white tables/cards).
  One accent: deep teal `--accent` #15756a — used for primary buttons, focus, selection, links,
  and inline-edit affordances. Never used for money states.
- **Four semantic money states** — reuse these EVERYWHERE (Available pills, RTA banner, report legends):
  - `--funded-bg/fg` green — available > 0 (`--funded-strong` #197a41 for solid fills/checkmarks)
  - `--credit-overspent-bg/fg` yellow — overspent on credit
  - `--cash-overspent-bg/fg` red — overspent with cash
  - `--zero-bg/fg` gray — exactly zero
  All pill and banner text pairs are contrast-audited ≥ 4.5:1 in both themes.
- **Type**: Inter only (400/500/600/700). 13px in tables (`--text-table`), 14px default UI,
  11px uppercase column headers (`.th-caps`). **Every money figure uses `.num`**
  (tabular numerals, right-aligned). Negative amounts use a true minus sign (−), not a hyphen.
- **Money formatting**: `$1,234.56`. Inflows may tint green (`.amount-inflow`); outflows stay
  plain dark — red is reserved for *overspent*, not ordinary spending.
- **Density**: 32px table rows, 28px controls, 4px spacing scale. Cells pad 6×8px.
- **Borders over shadows**: 1px `--border-default` everywhere; shadows only for menus
  (`--shadow-menu`) and the slide-in side panel (`--shadow-panel`).
- **Radii**: 4px controls, 6px cards/menus, full pills for Available amounts.
- **Hover**: rows tint `--bg-hover`; buttons darken one step. Press darkens again. 120ms ease.
- **Selection**: teal-tinted `--bg-selected` row background.
- **Focus**: `--focus-ring` teal double-ring. The app is keyboard-first (Enter saves, Esc cancels).

## Content fundamentals

- Sentence case everywhere ("Cover overspending", not "Cover Overspending").
- Terse, verb-first labels: "Assign", "Move money", "Reconcile", "Fresh start".
- YNAB vocabulary is canonical: Ready to Assign, Assigned, Activity, Available,
  category groups, budget vs. tracking accounts, cleared/uncleared/working balance.
- No exclamation marks, no mascot tone. Status speaks through the four colors, not copy.

## Iconography

No icon font yet. Use sparse Unicode glyphs where the spec calls for them
(✓ cleared, ← → month switcher, ▸/▾ group disclosure, ⋯ overflow). If richer icons become
necessary, use Lucide from CDN (1.5px stroke, 16px in tables) — flag it before adopting.

## Files

- `styles.css` — entry point; `@import`s everything below. Link this from every screen.
- `tokens/colors.css` — neutrals, teal accent, the four semantic states, aliases.
- `tokens/typography.css` — Inter, scale, `.num`, `.th-caps`.
- `tokens/spacing.css` — spacing/radius/density/elevation/layout vars.
- `tokens/components.css` — `.btn*`, `.input`, `.input-cell`, `.pill--*`, `.rta-banner--*`,
  `.mnab-table`, `.card`, `.menu`.
- `guidelines/*.card.html` — specimen cards (Design System tab).
- `Design System.html` — one-page visual spec.
- `app/` — files imported from the repo for reference (login form, layout, globals).

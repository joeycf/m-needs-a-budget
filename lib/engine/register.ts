// Pure register math (PRD §7 register header + sidebar). No React, no DB,
// no I/O — plain data in, computed state out. Balances are always derived
// from transactions, never stored (iron rule 2).

export type ClearedStatus = "uncleared" | "cleared" | "reconciled";

export interface RegisterTxn {
  amount: bigint;
  cleared: ClearedStatus;
}

export interface RegisterBalanceSummary {
  cleared: bigint;
  uncleared: bigint;
  working: bigint;
}

/** Cleared (reconciled counts as cleared) + uncleared = working balance. */
export function registerBalances(
  txns: readonly RegisterTxn[],
): RegisterBalanceSummary {
  let cleared = 0n;
  let uncleared = 0n;
  for (const txn of txns) {
    if (txn.cleared === "uncleared") uncleared += txn.amount;
    else cleared += txn.amount;
  }
  return { cleared, uncleared, working: cleared + uncleared };
}

/** Working balance per account id (sum of all its transaction amounts). */
export function accountBalances(
  txns: readonly { accountId: string; amount: bigint }[],
): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  for (const txn of txns) {
    balances.set(txn.accountId, (balances.get(txn.accountId) ?? 0n) + txn.amount);
  }
  return balances;
}

export interface AccountForTotals {
  id: string;
  onBudget: boolean;
  closed: boolean;
}

export interface SidebarTotals {
  budgetTotal: bigint;
  trackingTotal: bigint;
  netTotal: bigint;
}

/** Sidebar section totals. Closed accounts are excluded; accounts with no
 *  transactions count as zero. */
export function sidebarTotals(
  accounts: readonly AccountForTotals[],
  balances: ReadonlyMap<string, bigint>,
): SidebarTotals {
  let budgetTotal = 0n;
  let trackingTotal = 0n;
  for (const account of accounts) {
    if (account.closed) continue;
    const balance = balances.get(account.id) ?? 0n;
    if (account.onBudget) budgetTotal += balance;
    else trackingTotal += balance;
  }
  return { budgetTotal, trackingTotal, netTotal: budgetTotal + trackingTotal };
}

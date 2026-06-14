import { randomUUID } from "node:crypto";

import { monthOfDate } from "@/lib/engine/budget";
import {
  ACCOUNT_TYPES,
  ON_BUDGET_TYPES,
  type AccountRecord,
  type BudgetRow,
  type CategoryMonthRecord,
  type CategoryRecord,
  type Dataset,
  type ExpectedCell,
  type GroupRecord,
  type PayeeRecord,
  type RegisterRow,
  type SubtransactionRecord,
  type TransactionRecord,
} from "./types";

// Turn normalized YNAB rows into a fully-linked in-memory dataset (ids
// pre-generated so transfer/sub cross-references need no second pass). Pure:
// no DB, no I/O — the script writes it, the tests exercise it, the validator
// replays it through the engine.

const TRANSFER_PREFIX = "Transfer : ";
const SPLIT_RE = /^Split \((\d+)\/(\d+)\)\s?/;
const RTA_NAME = "Ready to Assign";
const HIDDEN_GROUP = "Hidden Categories";
const INTERNAL_GROUP = "Internal";
const CARD_PAYMENTS_GROUP = "Credit Card Payments";

/** Normalize a free-text payee for case-insensitive de-dup (mirrors
 *  lib/db/payees.ts:getOrCreatePayee). */
function payeeKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function reconstruct(
  registerRows: readonly RegisterRow[],
  budgetRows: readonly BudgetRow[],
  cutoff: string,
  budgetName = "M Needs a Budget",
): Dataset {
  const warnings: string[] = [];
  const cutoffMonth = monthOfDate(cutoff);

  // -------------------------------------------------------------------------
  // Accounts — from the full register (complete set regardless of cutoff),
  // fail-closed against the type map.
  // -------------------------------------------------------------------------
  const accountByName = new Map<string, AccountRecord>();
  const unknownAccounts = new Map<string, number>(); // name -> first row
  for (const row of registerRows) {
    if (accountByName.has(row.account)) continue;
    const config = ACCOUNT_TYPES[row.account];
    if (!config) {
      if (!unknownAccounts.has(row.account))
        unknownAccounts.set(row.account, row.rowNum);
      continue;
    }
    accountByName.set(row.account, {
      id: randomUUID(),
      name: row.account,
      type: config.type,
      onBudget: ON_BUDGET_TYPES.has(config.type),
      closed: config.closed ?? false,
      sortOrder: accountByName.size,
    });
  }
  if (unknownAccounts.size > 0) {
    const lines = [...unknownAccounts].map(
      ([name, rowNum]) => `  ${JSON.stringify(name)} (first at row ${rowNum})`,
    );
    throw new Error(
      `Unknown account name(s) not in ACCOUNT_TYPES (edit lib/ynab/types.ts):\n${lines.join(
        "\n",
      )}`,
    );
  }
  const accounts = [...accountByName.values()];
  const cardNames = new Set(
    accounts.filter((a) => a.type === "credit_card").map((a) => a.name),
  );

  // -------------------------------------------------------------------------
  // Categories — names are globally unique, so key by name. Real group comes
  // from the register/budget (skipping the "Hidden Categories" pseudo-group);
  // a name that only ever lands under "Hidden Categories" is purely-hidden.
  // -------------------------------------------------------------------------
  interface CatInfo {
    name: string;
    group: string | null;
    order: number;
  }
  const catInfo = new Map<string, CatInfo>();
  const groupOrder: string[] = [];
  const seenGroup = new Set<string>();
  const noteGroup = (group: string): void => {
    if (!seenGroup.has(group)) {
      seenGroup.add(group);
      groupOrder.push(group);
    }
  };
  const noteCat = (name: string, group: string): void => {
    if (name === "" || cardNames.has(name)) return; // blank / payment category
    let info = catInfo.get(name);
    if (!info) {
      info = { name, group: null, order: catInfo.size };
      catInfo.set(name, info);
    }
    if (info.group === null && group !== "" && group !== HIDDEN_GROUP) {
      info.group = group;
      noteGroup(group);
    }
  };
  for (const row of registerRows) {
    if (row.group === "Inflow") continue; // income → RTA, not a real category
    noteCat(row.category, row.group);
  }
  for (const row of budgetRows) noteCat(row.category, row.group);

  // Build groups: Internal (0), Credit Card Payments (1), real groups (2..),
  // Hidden Categories last (only if needed).
  const groups: GroupRecord[] = [];
  const groupByName = new Map<string, GroupRecord>();
  const addGroup = (
    name: string,
    isSystem: boolean,
    hidden: boolean,
  ): GroupRecord => {
    const record: GroupRecord = {
      id: randomUUID(),
      name,
      isSystem,
      hidden,
      sortOrder: groups.length,
    };
    groups.push(record);
    groupByName.set(name, record);
    return record;
  };
  const internalGroup = addGroup(INTERNAL_GROUP, true, false);
  const cardPaymentsGroup = addGroup(CARD_PAYMENTS_GROUP, true, false);
  for (const group of groupOrder) addGroup(group, false, false);
  const hasHidden = [...catInfo.values()].some((c) => c.group === null);
  const hiddenGroup = hasHidden ? addGroup(HIDDEN_GROUP, false, true) : null;

  // Build categories.
  const categories: CategoryRecord[] = [];
  const rta: CategoryRecord = {
    id: randomUUID(),
    groupId: internalGroup.id,
    name: RTA_NAME,
    hidden: false,
    isSystem: true,
    linkedAccountId: null,
    sortOrder: 0,
    isReadyToAssign: true,
  };
  categories.push(rta);

  // One payment category per card (mirrors lib/db/credit-cards.ts).
  const paymentCatByCardName = new Map<string, CategoryRecord>();
  for (const account of accounts) {
    if (account.type !== "credit_card") continue;
    const record: CategoryRecord = {
      id: randomUUID(),
      groupId: cardPaymentsGroup.id,
      name: account.name,
      hidden: account.closed,
      isSystem: false,
      linkedAccountId: account.id,
      sortOrder: paymentCatByCardName.size,
      isReadyToAssign: false,
    };
    categories.push(record);
    paymentCatByCardName.set(account.name, record);
  }

  // Normal + purely-hidden categories, in first-appearance order per group.
  const normalCatByName = new Map<string, CategoryRecord>();
  const perGroupSort = new Map<string, number>();
  for (const info of [...catInfo.values()].sort((a, b) => a.order - b.order)) {
    const group =
      info.group !== null ? groupByName.get(info.group)! : hiddenGroup!;
    const sortOrder = perGroupSort.get(group.id) ?? 0;
    perGroupSort.set(group.id, sortOrder + 1);
    const record: CategoryRecord = {
      id: randomUUID(),
      groupId: group.id,
      name: info.name,
      hidden: info.group === null,
      isSystem: false,
      linkedAccountId: null,
      sortOrder,
      isReadyToAssign: false,
    };
    categories.push(record);
    normalCatByName.set(info.name, record);
  }

  if (hiddenGroup) {
    const names = [...catInfo.values()]
      .filter((c) => c.group === null)
      .map((c) => c.name);
    warnings.push(
      `${names.length} purely-hidden categor${
        names.length === 1 ? "y" : "ies"
      } placed in a hidden "${HIDDEN_GROUP}" group: ${names.join(", ")}`,
    );
  }

  /** Resolve a row's category column to a category id (null = uncategorized). */
  const resolveCategory = (
    group: string,
    category: string,
    rowNum: number,
  ): string | null => {
    if (group === "Inflow") {
      if (category !== RTA_NAME) {
        throw new Error(
          `Row ${rowNum}: unexpected Inflow category ${JSON.stringify(category)}`,
        );
      }
      return rta.id;
    }
    if (category === "") return null;
    const normal = normalCatByName.get(category);
    if (normal) return normal.id;
    const payment = paymentCatByCardName.get(category);
    if (payment) return payment.id;
    throw new Error(`Row ${rowNum}: unmapped category ${JSON.stringify(category)}`);
  };

  // -------------------------------------------------------------------------
  // Payees — regular (de-duped, case-insensitive) + per-account transfer payee.
  // -------------------------------------------------------------------------
  const payees: PayeeRecord[] = [];
  const regularPayeeByKey = new Map<string, PayeeRecord>();
  const transferPayeeByAccountId = new Map<string, PayeeRecord>();
  const regularPayee = (name: string): string => {
    const key = payeeKey(name);
    let record = regularPayeeByKey.get(key);
    if (!record) {
      record = {
        id: randomUUID(),
        name: name.trim().replace(/\s+/g, " "),
        transferAccountId: null,
      };
      regularPayeeByKey.set(key, record);
      payees.push(record);
    }
    return record.id;
  };
  const transferPayee = (account: AccountRecord): string => {
    let record = transferPayeeByAccountId.get(account.id);
    if (!record) {
      record = {
        id: randomUUID(),
        name: `${TRANSFER_PREFIX}${account.name}`,
        transferAccountId: account.id,
      };
      transferPayeeByAccountId.set(account.id, record);
      payees.push(record);
    }
    return record.id;
  };

  /** payeeId for a row: a "Transfer : X" payee points at X's transfer payee. */
  const resolvePayee = (row: RegisterRow): string | null => {
    if (row.payee.startsWith(TRANSFER_PREFIX)) {
      const counterpart = accountByName.get(
        row.payee.slice(TRANSFER_PREFIX.length),
      );
      return counterpart ? transferPayee(counterpart) : regularPayee(row.payee);
    }
    return row.payee.trim() === "" ? null : regularPayee(row.payee);
  };

  // -------------------------------------------------------------------------
  // Transactions — filter to before the cutoff, then split-group in file order.
  // Transfer legs and split parents are linked afterward.
  // -------------------------------------------------------------------------
  const rows = registerRows.filter((r) => r.date < cutoff);
  const transactions: TransactionRecord[] = [];
  const subtransactions: SubtransactionRecord[] = [];
  const normalLegs: { record: TransactionRecord; row: RegisterRow }[] = [];

  const stripSplitMemo = (memo: string): string | null => {
    const text = memo.replace(SPLIT_RE, "").trim();
    return text === "" ? null : text;
  };

  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    const match = SPLIT_RE.exec(row.memo);
    if (match) {
      const k = Number(match[1]);
      const n = Number(match[2]);
      if (k !== 1) {
        throw new Error(
          `Row ${row.rowNum}: split begins at ${k}/${n}, expected 1/${n}`,
        );
      }
      const children = rows.slice(i, i + n);
      if (children.length < n) {
        throw new Error(`Row ${row.rowNum}: split truncated (${children.length}/${n})`);
      }
      children.forEach((child, j) => {
        const cm = SPLIT_RE.exec(child.memo);
        if (!cm || Number(cm[1]) !== j + 1 || Number(cm[2]) !== n) {
          throw new Error(
            `Row ${child.rowNum}: expected Split (${j + 1}/${n}), got ${JSON.stringify(child.memo)}`,
          );
        }
        if (
          child.account !== row.account ||
          child.date !== row.date ||
          child.payee !== row.payee
        ) {
          throw new Error(`Row ${child.rowNum}: split child differs from parent`);
        }
        if (child.payee.startsWith(TRANSFER_PREFIX)) {
          throw new Error(
            `Row ${child.rowNum}: transfer inside a split is unsupported`,
          );
        }
      });

      const parentId = randomUUID();
      const amount = children.reduce((sum, c) => sum + c.amount, 0n);
      for (const child of children) {
        subtransactions.push({
          id: randomUUID(),
          transactionId: parentId,
          amount: child.amount,
          categoryId: resolveCategory(child.group, child.category, child.rowNum),
          memo: stripSplitMemo(child.memo),
        });
      }
      transactions.push({
        id: parentId,
        accountId: accountByName.get(row.account)!.id,
        date: row.date,
        amount,
        payeeId: resolvePayee(row),
        categoryId: null, // split parent
        memo: null,
        cleared: row.cleared,
        flag: row.flag,
        transferAccountId: null,
        transferTransactionId: null,
      });
      i += n;
    } else {
      const record: TransactionRecord = {
        id: randomUUID(),
        accountId: accountByName.get(row.account)!.id,
        date: row.date,
        amount: row.amount,
        payeeId: resolvePayee(row),
        categoryId: resolveCategory(row.group, row.category, row.rowNum),
        memo: row.memo.trim() === "" ? null : row.memo,
        cleared: row.cleared,
        flag: row.flag,
        transferAccountId: null,
        transferTransactionId: null,
      };
      transactions.push(record);
      normalLegs.push({ record, row });
      i += 1;
    }
  }

  // Transfer pairing: bucket legs by (unordered account pair, date, |amount|),
  // then match across the two accounts. After the PNC alias, every leg pairs.
  const buckets = new Map<string, typeof normalLegs>();
  for (const leg of normalLegs) {
    if (!leg.row.payee.startsWith(TRANSFER_PREFIX)) continue;
    const counterpartName = leg.row.payee.slice(TRANSFER_PREFIX.length);
    if (!accountByName.has(counterpartName)) {
      warnings.push(
        `Row ${leg.row.rowNum}: transfer to unknown account ${JSON.stringify(counterpartName)} — imported without a counterpart`,
      );
      continue;
    }
    const amount = leg.record.amount;
    const key = [
      [leg.row.account, counterpartName].sort().join(" "),
      leg.row.date,
      (amount < 0n ? -amount : amount).toString(),
    ].join(" ");
    const bucket = buckets.get(key);
    if (bucket) bucket.push(leg);
    else buckets.set(key, [leg]);
  }
  for (const legs of buckets.values()) {
    const byAccount = new Map<string, typeof normalLegs>();
    for (const leg of legs) {
      const list = byAccount.get(leg.row.account);
      if (list) list.push(leg);
      else byAccount.set(leg.row.account, [leg]);
    }
    const [first, second] = [...byAccount.values()];
    const a = first ?? [];
    const b = second ?? [];
    const pairs = Math.min(a.length, b.length);
    for (let p = 0; p < pairs; p++) {
      const legA = a[p];
      const legB = b[p];
      legA.record.transferAccountId = accountByName.get(legB.row.account)!.id;
      legB.record.transferAccountId = accountByName.get(legA.row.account)!.id;
      legA.record.transferTransactionId = legB.record.id;
      legB.record.transferTransactionId = legA.record.id;
    }
    for (const leftover of [...a.slice(pairs), ...b.slice(pairs)]) {
      // Counterpart known but its leg is absent (should not happen post-alias).
      const counterpart = accountByName.get(
        leftover.row.payee.slice(TRANSFER_PREFIX.length),
      )!;
      leftover.record.transferAccountId = counterpart.id;
      warnings.push(
        `Row ${leftover.row.rowNum}: unpaired transfer leg to ${JSON.stringify(counterpart.name)}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Assignments (category_months) + YNAB expected values for validation.
  // Option B: import only months ≤ the cutoff month.
  // -------------------------------------------------------------------------
  const categoryMonths: CategoryMonthRecord[] = [];
  const expected: ExpectedCell[] = [];
  const seenCell = new Set<string>();
  for (const row of budgetRows) {
    const categoryId = cardNames.has(row.category)
      ? paymentCatByCardName.get(row.category)!.id
      : (normalCatByName.get(row.category)?.id ?? null);
    if (categoryId === null) {
      throw new Error(
        `Budget row: unmapped category ${JSON.stringify(row.category)} (${row.month})`,
      );
    }
    const cellKey = `${categoryId} ${row.month}`;
    if (seenCell.has(cellKey)) {
      throw new Error(
        `Duplicate Budget.csv row for ${JSON.stringify(row.category)} ${row.month}`,
      );
    }
    seenCell.add(cellKey);

    expected.push({
      categoryId,
      categoryName: row.category,
      month: row.month,
      assigned: row.assigned,
      activity: row.activity,
      available: row.available,
    });
    if (row.month <= cutoffMonth) {
      categoryMonths.push({ categoryId, month: row.month, assigned: row.assigned });
    }
  }

  return {
    budgetName,
    accounts,
    groups,
    categories,
    payees,
    transactions,
    subtransactions,
    categoryMonths,
    expected,
    cutoff,
    cutoffMonth,
    warnings,
  };
}

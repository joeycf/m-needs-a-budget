"use client";

import { createContext, useContext } from "react";

export interface SidebarAccountItem {
  id: string;
  name: string;
  balance: bigint;
}

export interface SidebarData {
  budgetAccounts: SidebarAccountItem[];
  trackingAccounts: SidebarAccountItem[];
  budgetTotal: bigint;
  trackingTotal: bigint;
  netTotal: bigint;
}

interface ShellContextValue {
  openDrawer: () => void;
}

export const ShellContext = createContext<ShellContextValue>({
  openDrawer: () => {},
});

/** Lets page-level mobile top bars open the shell's nav drawer. */
export function useShell(): ShellContextValue {
  return useContext(ShellContext);
}

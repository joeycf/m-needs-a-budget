"use client";

import { useMemo, useState } from "react";

import { Sidebar } from "@/components/shell/sidebar";
import {
  ShellContext,
  type SidebarData,
} from "@/components/shell/shell-context";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

/** Desktop: fixed 240px sidebar + scrolling main. Mobile: pages render a
 *  MobileTopBar whose ☰ opens the 300px drawer (App Shell.html). */
export function AppShell({
  sidebar,
  children,
}: {
  sidebar: SidebarData;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const shell = useMemo(() => ({ openDrawer: () => setDrawerOpen(true) }), []);

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-dvh w-full">
        <aside className="hidden h-full shrink-0 md:block">
          <Sidebar data={sidebar} />
        </aside>

        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent
            side="left"
            showCloseButton={false}
            className="w-[300px] gap-0 border-r-0 p-0"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Sidebar
              data={sidebar}
              mobile
              onNavigate={() => setDrawerOpen(false)}
            />
          </SheetContent>
        </Sheet>

        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
      </div>
    </ShellContext.Provider>
  );
}

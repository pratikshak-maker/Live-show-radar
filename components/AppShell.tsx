"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { ToastProvider } from "./ToastProvider";
import { ScanProvider } from "./ScanProvider";
import { Header } from "./Header";
import { BottomTabs } from "./BottomTabs";
import { StatusLine } from "./StatusLine";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <Tooltip.Provider>
        <ScanProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-[10px] focus:bg-stage focus:px-4 focus:py-2 focus:text-stage-ink"
          >
            Skip to content
          </a>
          <Header />
          <StatusLine />
          <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-28 pt-4 md:pb-16">
            {children}
          </main>
          <BottomTabs />
        </ScanProvider>
      </Tooltip.Provider>
    </ToastProvider>
  );
}

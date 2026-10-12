"use client";

import * as Toast from "@radix-ui/react-toast";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type ToastInput = {
  title: string;
  description?: string;
  kind?: "success" | "info" | "error";
  action?: { label: string; onClick: () => void };
  links?: { label: string; href: string }[];
  durationMs?: number;
};

type ToastItem = ToastInput & { id: number };

const Ctx = createContext<{ push: (t: ToastInput) => void } | null>(null);

export function useToast() {
  const c = useContext(Ctx);
  if (!c) return { push: () => {} };
  return c;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((t: ToastInput) => {
    setItems((prev) => [...prev.slice(-3), { ...t, id: Date.now() + Math.random() }]);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <Ctx.Provider value={value}>
      <Toast.Provider swipeDirection="right" duration={5000}>
        {children}
        {items.map((t) => (
          <Toast.Root
            key={t.id}
            duration={t.durationMs ?? (t.action ? 8000 : 4500)}
            onOpenChange={(open) => {
              if (!open) setItems((prev) => prev.filter((x) => x.id !== t.id));
            }}
            className="flex items-start gap-3 rounded-[12px] border border-line bg-raised p-3 pr-2 text-sm shadow-none data-[state=closed]:opacity-0 data-[state=open]:slide-in"
          >
            <span className="mt-0.5 shrink-0" aria-hidden>
              {t.kind === "error" ? (
                <TriangleAlert className="h-4 w-4 text-urgent" />
              ) : t.kind === "info" ? (
                <Info className="h-4 w-4 text-muted" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-confirmed" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <Toast.Title className="font-medium">{t.title}</Toast.Title>
              {t.description && (
                <Toast.Description className="text-muted">{t.description}</Toast.Description>
              )}
              {t.links && t.links.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-3">
                  {t.links.map((l) => (
                    <a
                      key={l.href}
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-stage underline underline-offset-2"
                    >
                      {l.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
            {t.action && (
              <Toast.Action altText={t.action.label} asChild>
                <button
                  type="button"
                  onClick={t.action.onClick}
                  className="min-h-9 rounded-[10px] px-3 font-medium text-stage hover:bg-surface"
                >
                  {t.action.label}
                </button>
              </Toast.Action>
            )}
            <Toast.Close
              aria-label="Dismiss"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-muted hover:bg-surface"
            >
              <X className="h-4 w-4" />
            </Toast.Close>
          </Toast.Root>
        ))}
        <Toast.Viewport className="fixed bottom-20 left-1/2 z-[100] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2 outline-none md:bottom-6 md:left-auto md:right-6 md:translate-x-0" />
      </Toast.Provider>
    </Ctx.Provider>
  );
}

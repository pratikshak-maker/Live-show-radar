"use client";

import * as Popover from "@radix-ui/react-popover";
import { Bell, CalendarClock, Hourglass, MapPinned, Sparkles, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SCAN_DONE_EVENT } from "./ScanProvider";

type AlertItem = {
  id: string;
  show_id: string;
  alert_type: string;
  read_at: string | null;
  created_at: string;
  message: string;
};

function relative(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

function iconFor(type: string) {
  if (type.startsWith("early_bird")) return <Hourglass className="h-4 w-4 text-urgent" />;
  if (type === "cancelled") return <XCircle className="h-4 w-4 text-urgent" />;
  if (type === "date_changed" || type === "venue_changed" || type === "deadline_found")
    return <CalendarClock className="h-4 w-4 text-muted" />;
  if (type === "new_show") return <Sparkles className="h-4 w-4 text-stage" />;
  return <MapPinned className="h-4 w-4 text-muted" />;
}

export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AlertItem[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { alerts: AlertItem[]; unread: number };
      setItems(body.alerts);
      setUnread(body.unread);
    } catch {
      /* offline or not configured */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 60_000);
    window.addEventListener(SCAN_DONE_EVENT, load);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener(SCAN_DONE_EVENT, load);
    };
  }, [load]);

  async function markRead(ids: string[] | "all") {
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ids === "all" ? { all: true } : { ids }),
    }).catch(() => undefined);
    void load();
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Alerts, ${unread} unread` : "Alerts"}
          className="relative grid h-11 w-11 place-items-center rounded-[12px] text-muted hover:bg-surface hover:text-ink"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-stage px-1 text-[11px] font-semibold text-stage-ink">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[min(92vw,380px)] rounded-[18px] border border-line bg-raised p-2"
        >
          <div className="flex items-center justify-between px-3 py-2">
            <h2 className="text-base font-semibold">Alerts</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markRead("all")}
                className="rounded-[10px] px-2 py-1 text-sm text-stage hover:bg-surface"
              >
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-3 pb-4 pt-1 text-sm text-muted">
              Nothing yet. When an artist announces a show in India, it shows up here first.
            </p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {items.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void markRead([a.id]);
                      setOpen(false);
                      router.push(`/?show=${a.show_id}`);
                    }}
                    className="flex w-full items-start gap-3 rounded-[12px] px-3 py-2.5 text-left hover:bg-surface"
                  >
                    <span className="mt-1 shrink-0" aria-hidden>
                      {iconFor(a.alert_type)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${a.read_at ? "text-muted" : "font-medium"}`}>
                        {a.message}
                      </span>
                      <span className="block text-xs text-muted">{relative(a.created_at)}</span>
                    </span>
                    {!a.read_at && (
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-stage" aria-label="Unread" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

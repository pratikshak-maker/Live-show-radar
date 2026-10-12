"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SCAN_DONE_EVENT } from "./ScanProvider";

type Status = {
  configured: boolean;
  artistCount: number;
  lastCheckedAt: string | null;
  missingConnections: number;
};

function ago(iso: string | null): string {
  if (!iso) return "not yet";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

export function StatusLine() {
  const [s, setS] = useState<Status | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (res.ok) setS((await res.json()) as Status);
    } catch {
      /* ignore */
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

  return (
    <div className="mx-auto flex min-h-8 w-full max-w-6xl flex-wrap items-center gap-x-2 px-4 pt-2 text-sm text-muted">
      {s && s.configured ? (
        <>
          <span>
            Watching {s.artistCount} artist{s.artistCount === 1 ? "" : "s"}. Last checked{" "}
            {ago(s.lastCheckedAt)}.
          </span>
          {s.missingConnections > 0 && (
            <Link href="/settings" className="text-stage underline underline-offset-2">
              {s.missingConnections} connection{s.missingConnections === 1 ? "" : "s"} available
            </Link>
          )}
        </>
      ) : s ? (
        <Link href="/setup" className="text-stage underline underline-offset-2">
          Finish setup to start watching
        </Link>
      ) : (
        <span aria-hidden>&nbsp;</span>
      )}
    </div>
  );
}

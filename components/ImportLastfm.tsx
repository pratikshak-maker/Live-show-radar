"use client";

import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";
import { useToast } from "./ToastProvider";

type Row = { name: string; alreadyTracked: boolean };

export function ImportLastfm({ onDone }: { onDone: () => void }) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function preview() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/import/lastfm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: user }),
      });
      const body = (await res.json()) as { artists?: Row[]; error?: { message: string } };
      if (!res.ok || !body.artists) {
        setError(body.error?.message ?? "Couldn't load that profile.");
        return;
      }
      setRows(body.artists);
      setChecked(new Set(body.artists.filter((a) => !a.alreadyTracked).map((a) => a.name)));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const res = await fetch("/api/import/lastfm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: user, confirm: [...checked] }),
      });
      const body = (await res.json()) as { added?: number };
      push({
        title: `Added ${body.added ?? 0} artists`,
        description: "They'll be checked in the next few scans.",
      });
      setOpen(false);
      setRows(null);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  const fresh = rows?.filter((r) => !r.alreadyTracked) ?? [];

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex min-h-11 items-center rounded-[12px] border border-line px-4 text-sm font-medium hover:bg-surface"
        >
          Import from Last.fm
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-50 w-[min(92vw,360px)] rounded-[18px] border border-line bg-raised p-4"
        >
          {!rows ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void preview();
              }}
              className="space-y-3"
            >
              <label className="block text-sm font-medium">
                Last.fm username
                <input
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  className="mt-1 min-h-11 w-full rounded-[12px] border border-line bg-surface px-3 text-base"
                  autoFocus
                />
              </label>
              {error && <p className="text-sm text-urgent">{error}</p>}
              <button
                type="submit"
                disabled={busy || user.trim().length < 2}
                className="min-h-11 w-full rounded-[12px] bg-stage font-medium text-stage-ink disabled:opacity-60"
              >
                {busy ? "Loading…" : "Show my top artists"}
              </button>
            </form>
          ) : (
            <div>
              <p className="text-sm text-muted">
                {fresh.length} new artists from the last 12 months.
              </p>
              <ul className="mt-2 max-h-64 overflow-y-auto">
                {rows.map((r) => (
                  <li key={r.name}>
                    <label
                      className={`flex min-h-10 items-center gap-2 px-1 text-sm ${r.alreadyTracked ? "text-muted" : ""}`}
                    >
                      <input
                        type="checkbox"
                        disabled={r.alreadyTracked}
                        checked={checked.has(r.name)}
                        onChange={(e) => {
                          const next = new Set(checked);
                          if (e.target.checked) next.add(r.name);
                          else next.delete(r.name);
                          setChecked(next);
                        }}
                        className="h-4 w-4 accent-[var(--stage)]"
                      />
                      {r.name}
                      {r.alreadyTracked && <span className="ml-auto text-xs">already tracked</span>}
                    </label>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={busy || checked.size === 0}
                className="mt-3 min-h-11 w-full rounded-[12px] bg-stage font-medium text-stage-ink disabled:opacity-60"
              >
                {busy ? "Adding…" : `Add ${checked.size} artists`}
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

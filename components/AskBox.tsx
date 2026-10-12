"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import type { ShowWithArtist } from "@/lib/types";
import { fmtDay } from "@/lib/time";

type Answer = { answer: string | null; reason?: string; shows: ShowWithArtist[] };

export function AskBox({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Answer | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q.trim() }),
      });
      const body = (await r.json()) as Answer & { error?: { message: string } };
      if (!r.ok) setErr(body.error?.message ?? "Couldn't answer that.");
      else setRes(body);
    } catch {
      setErr("Couldn't reach the server — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="relative">
        <label className="sr-only" htmlFor="ask">
          Ask about your shows
        </label>
        <Sparkles
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stage"
          aria-hidden
        />
        <input
          id="ask"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={300}
          placeholder="Ask: any shows in Bengaluru this month?"
          className="min-h-12 w-full rounded-[12px] border border-line bg-surface pl-10 pr-24 text-base placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={busy || q.trim().length < 2}
          className="absolute right-1.5 top-1.5 min-h-9 rounded-[10px] bg-stage px-3.5 text-sm font-medium text-stage-ink disabled:opacity-60"
        >
          {busy ? "Asking…" : "Ask"}
        </button>
      </form>
      {(res || err) && (
        <div className="mt-2 rounded-[12px] border border-line bg-surface p-4" aria-live="polite">
          {err && <p className="text-sm text-urgent">{err}</p>}
          {res && res.answer === null && (
            <p className="text-sm text-muted">
              {res.reason === "not_configured"
                ? "Connect Gemini to enable this."
                : "I couldn't answer that just now. Try again in a moment."}
            </p>
          )}
          {res?.answer && (
            <>
              <p className="text-sm">{res.answer}</p>
              {res.shows.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {res.shows.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(s.id)}
                        className="min-h-10 rounded-[10px] border border-line px-3 text-left text-sm hover:bg-raised"
                      >
                        <span className="artist-name">{s.artist.name}</span>
                        <span className="text-muted">
                          {" "}
                          · {s.city}, {fmtDay(s.start_date)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted">Powered by Gemini</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

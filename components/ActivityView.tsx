"use client";

import { CheckCircle2, ChevronDown, Info, TriangleAlert, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useScan, type LogRow } from "./ScanProvider";
import { relativeAgo } from "@/lib/time";

export type RunSummary = {
  id: string;
  trigger: "cron" | "manual" | "artist";
  status: "running" | "completed" | "partial" | "failed";
  artist_ids: string[];
  stats: {
    artists?: number;
    newShows?: number;
    alerts?: number;
    geminiCalls?: number;
    sbCredits?: number;
  };
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

const TRIGGER: Record<RunSummary["trigger"], string> = {
  cron: "Scheduled",
  manual: "Check now",
  artist: "One artist",
};
const STATUS: Record<RunSummary["status"], string> = {
  running: "Running",
  completed: "Done",
  partial: "Partly done",
  failed: "Failed",
};

function LevelIcon({ level }: { level: LogRow["level"] }) {
  const cls = "h-4 w-4 shrink-0";
  if (level === "success")
    return <CheckCircle2 className={`${cls} text-confirmed`} aria-label="Success" />;
  if (level === "warn")
    return <TriangleAlert className={`${cls} text-urgent`} aria-label="Warning" />;
  if (level === "error") return <XCircle className={`${cls} text-urgent`} aria-label="Error" />;
  return <Info className={`${cls} text-muted`} aria-label="Info" />;
}

export function LogList({ logs }: { logs: LogRow[] }) {
  const ref = useRef<HTMLUListElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  return (
    <ul
      ref={ref}
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="max-h-80 space-y-1.5 overflow-y-auto pr-1"
    >
      {logs.length === 0 && <li className="text-sm text-muted">Starting up…</li>}
      {logs.map((l) => (
        <li
          key={l.id}
          className={`flex items-start gap-2 text-sm ${l.level === "info" ? "text-muted" : ""}`}
        >
          <span className="mt-0.5">
            <LevelIcon level={l.level} />
          </span>
          <span>{l.message}</span>
        </li>
      ))}
    </ul>
  );
}

function Meter({
  label,
  used,
  max,
  hint,
}: {
  label: string;
  used: number;
  max?: number;
  hint?: string;
}) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : null;
  return (
    <div className="rounded-[18px] border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="artist-name text-2xl">
        {used}
        {max ? <span className="text-base text-muted"> / {max}</span> : null}
      </p>
      {pct !== null && (
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-raised"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          <div
            className={`h-full ${pct > 85 ? "bg-urgent" : "bg-confirmed"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function HistoryRow({ run }: { run: RunSummary }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const dur = run.finished_at
    ? Math.max(
        1,
        Math.round(
          (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000,
        ),
      )
    : null;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !logs) {
      const res = await fetch(`/api/scan/runs/${run.id}?afterLogId=0`, { cache: "no-store" });
      if (res.ok) setLogs(((await res.json()) as { logs: LogRow[] }).logs);
    }
  }

  return (
    <li className="rounded-[14px] border border-line bg-surface">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        className="grid w-full min-h-14 grid-cols-[1fr_auto] items-center gap-2 px-4 py-2 text-left sm:grid-cols-[1.2fr_1fr_repeat(3,0.6fr)_auto]"
      >
        <span>
          <span className="block font-medium">{TRIGGER[run.trigger]}</span>
          <span className="block text-xs text-muted">{relativeAgo(run.started_at)}</span>
        </span>
        <span className="hidden text-sm sm:block">
          {run.stats.artists ?? run.artist_ids.length} artists
        </span>
        <span className="hidden text-sm sm:block">{run.stats.newShows ?? 0} new</span>
        <span className="hidden text-sm sm:block">{run.stats.alerts ?? 0} alerts</span>
        <span className="hidden text-sm text-muted sm:block">{dur ? `${dur}s` : "—"}</span>
        <span className="flex items-center gap-2 text-sm">
          <span
            className={
              run.status === "failed"
                ? "text-urgent"
                : run.status === "completed"
                  ? "text-confirmed"
                  : "text-muted"
            }
          >
            {STATUS[run.status]}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3">
          {logs ? <LogList logs={logs} /> : <p className="text-sm text-muted">Loading…</p>}
        </div>
      )}
    </li>
  );
}

export function ActivityView({
  runs,
  usage,
}: {
  runs: RunSummary[];
  usage: { gemini: number; scrapingbee: number; scrapingbeeBudget: number };
}) {
  const { running, logs, artistsDone, run, startScan } = useScan();
  const total = run?.artist_ids.length ?? 0;

  return (
    <div>
      <h1 className="text-3xl font-bold">Activity</h1>
      <p className="mt-1 text-muted">Watch the agent work, and see what it found on past checks.</p>

      <section
        aria-labelledby="live"
        className="mt-5 rounded-[18px] border border-line bg-surface p-4"
      >
        <div className="flex items-center gap-3">
          <span className={`radar-icon text-stage ${running ? "is-sweeping" : ""}`} aria-hidden />
          <h2 id="live" className="text-lg font-semibold">
            {running ? "Checking now" : logs.length > 0 ? "Last check" : "Nothing running"}
          </h2>
          {running && total > 0 && (
            <span className="text-sm text-muted">
              Artist {Math.min(artistsDone + 1, total)} of {total}
            </span>
          )}
          {!running && (
            <button
              type="button"
              onClick={() => void startScan()}
              className="ml-auto min-h-10 rounded-[12px] bg-stage px-4 text-sm font-medium text-stage-ink"
            >
              Check now
            </button>
          )}
        </div>
        {logs.length > 0 || running ? (
          <div className="mt-3">
            <LogList logs={logs} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">
            The radar checks a few artists every 30 minutes. Press Check now to watch it work.
          </p>
        )}
      </section>

      <section aria-labelledby="usage" className="mt-6">
        <h2 id="usage" className="text-lg font-semibold">
          Today&apos;s usage
        </h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Meter
            label="Gemini calls"
            used={usage.gemini}
            hint="Each artist uses two calls per check."
          />
          <Meter
            label="Ticket-page credits"
            used={usage.scrapingbee}
            max={usage.scrapingbeeBudget}
            hint="ScrapingBee credits against your daily budget."
          />
        </div>
      </section>

      <section aria-labelledby="history" className="mt-6">
        <h2 id="history" className="text-lg font-semibold">
          Past checks
        </h2>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            No checks yet. The first one runs within 30 minutes, or press Check now.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {runs.map((r) => (
              <HistoryRow key={r.id} run={r} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

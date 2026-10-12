"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useToast } from "./ToastProvider";

export type LogRow = {
  id: number;
  ts: string;
  level: "info" | "success" | "warn" | "error";
  artist_name: string | null;
  step: string;
  message: string;
};

export type RunInfo = {
  id: string;
  trigger: "cron" | "manual" | "artist";
  status: "running" | "completed" | "partial" | "failed";
  artist_ids: string[];
  stats: Record<string, unknown>;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

type ScanCtx = {
  running: boolean;
  runId: string | null;
  run: RunInfo | null;
  logs: LogRow[];
  artistsDone: number;
  scanningArtistId: string | null;
  cooldownSeconds: number;
  startScan: (artistId?: string) => Promise<void>;
  attach: (runId: string) => void;
};

const Ctx = createContext<ScanCtx | null>(null);

export function useScan(): ScanCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useScan must be used inside ScanProvider");
  return c;
}

export const SCAN_DONE_EVENT = "lsr:scan-done";

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { push } = useToast();
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunInfo | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [scanningArtistId, setScanningArtistId] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const lastLogId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const attach = useCallback(
    (id: string) => {
      stopPolling();
      lastLogId.current = 0;
      setLogs([]);
      setRun(null);
      setRunId(id);
    },
    [stopPolling],
  );

  // Poll the active run every 1.5 s.
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/scan/runs/${runId}?afterLogId=${lastLogId.current}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { run: RunInfo; logs: LogRow[]; done: boolean };
        if (cancelled) return;
        if (body.logs.length > 0) {
          lastLogId.current = body.logs[body.logs.length - 1].id;
          setLogs((prev) => [...prev, ...body.logs]);
        }
        setRun(body.run);
        if (body.done) {
          const stats = body.run.stats as { newShows?: number; alerts?: number };
          setRunId(null);
          setScanningArtistId(null);
          if (body.run.status === "failed") {
            push({
              kind: "error",
              title: "Couldn't finish checking",
              description: "Your data is safe — we'll retry on the next check.",
            });
          } else {
            const n = stats.newShows ?? 0;
            push({
              title: n > 0 ? `Found ${n} new show${n === 1 ? "" : "s"}` : "Check complete",
              description: n > 0 ? undefined : "Nothing new right now. We'll keep watching.",
            });
          }
          window.dispatchEvent(new CustomEvent(SCAN_DONE_EVENT));
          router.refresh();
          return;
        }
      } catch {
        // transient — keep polling
      }
      if (!cancelled) timer.current = setTimeout(tick, 1500);
    };
    void tick();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [runId, push, router, stopPolling]);

  // Rate-limit countdown ("Next check in 2:41")
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const t = setTimeout(() => setCooldownSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldownSeconds]);

  const startScan = useCallback(
    async (artistId?: string) => {
      if (runId) return;
      try {
        const res = await fetch("/api/scan/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(artistId ? { artistId } : {}),
        });
        const body = (await res.json()) as {
          runId?: string;
          retryAfterSeconds?: number;
          error?: { message: string };
        };
        if (body.runId) {
          setScanningArtistId(artistId ?? null);
          attach(body.runId);
          return;
        }
        if (res.status === 429 && body.retryAfterSeconds) {
          setCooldownSeconds(body.retryAfterSeconds);
          return;
        }
        push({
          kind: "error",
          title: "Couldn't start a check",
          description: body.error?.message ?? "Please try again in a moment.",
        });
      } catch {
        push({
          kind: "error",
          title: "Couldn't reach the server",
          description: "Your data is safe — try again in a moment.",
        });
      }
    },
    [runId, attach, push],
  );

  const artistsDone = logs.filter((l) => l.step === "artist_done").length;

  const value = useMemo<ScanCtx>(
    () => ({
      running: runId !== null,
      runId,
      run,
      logs,
      artistsDone,
      scanningArtistId,
      cooldownSeconds,
      startScan,
      attach,
    }),
    [runId, run, logs, artistsDone, scanningArtistId, cooldownSeconds, startScan, attach],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

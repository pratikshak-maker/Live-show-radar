"use client";

import { useScan } from "./ScanProvider";

function fmtCooldown(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ScanButton() {
  const { running, startScan, cooldownSeconds } = useScan();
  const cooling = cooldownSeconds > 0 && !running;

  return (
    <button
      type="button"
      onClick={() => void startScan()}
      disabled={running || cooling}
      aria-busy={running}
      className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-stage px-3.5 font-medium text-stage-ink transition-opacity hover:opacity-90 disabled:opacity-70 md:px-4"
    >
      <span className={`radar-icon ${running ? "is-sweeping" : ""}`} aria-hidden />
      {running ? (
        <span>Checking…</span>
      ) : cooling ? (
        <span>
          <span className="sm:hidden">Next in {fmtCooldown(cooldownSeconds)}</span>
          <span className="hidden sm:inline">Next check in {fmtCooldown(cooldownSeconds)}</span>
        </span>
      ) : (
        <span>Check now</span>
      )}
    </button>
  );
}

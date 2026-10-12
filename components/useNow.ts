"use client";

import { useSyncExternalStore } from "react";

const MINUTE = 60_000;

function subscribe(cb: () => void) {
  const t = setInterval(cb, MINUTE);
  return () => clearInterval(t);
}

const snapshot = () => Math.floor(Date.now() / MINUTE) * MINUTE;

/** Current time, rounded down to the minute; re-renders subscribers once a minute. */
export function useNow(): Date {
  const ms = useSyncExternalStore(subscribe, snapshot, snapshot);
  return new Date(ms);
}

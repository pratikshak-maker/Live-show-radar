"use client";

import * as Switch from "@radix-ui/react-switch";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Chip } from "./Chips";
import { ThemeToggle } from "./ThemeToggle";
import { useToast } from "./ToastProvider";
import { setupDocUrl } from "@/lib/constants";

type Settings = {
  alertEmail: string | null;
  emailAlertsEnabled: boolean;
  homeCity: string;
  cities: string[];
  googleEmailMasked: string | null;
  googleEmailDefault: string | null;
  adminRequired: boolean;
  adminUnlocked: boolean;
};

type Integration = {
  key: string;
  label: string;
  configured: boolean;
  connected?: boolean;
  needsReconnect?: boolean;
  purpose: string;
  setupDocAnchor: string;
};

const NO_KEY = new Set(["musicbrainz", "deezer", "nominatim"]);

const PARAM_MESSAGES: Record<string, string> = {
  denied: "Google connection was cancelled.",
  bad_state: "That sign-in expired. Please try again.",
  no_refresh_token:
    "Google didn't return a long-lived token. Please connect again and approve all permissions.",
  error: "Couldn't connect Google. Please try again.",
  not_configured: "Google isn't set up yet — see the setup steps.",
};

export function SettingsView() {
  const { push } = useToast();
  const params = useSearchParams();
  const [s, setS] = useState<Settings | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [email, setEmail] = useState("");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const toasted = useRef(false);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch("/api/settings", { cache: "no-store" }),
      fetch("/api/integrations", { cache: "no-store" }),
    ]);
    if (a.ok) {
      const body = (await a.json()) as Settings;
      setS(body);
      setEmail((cur) => cur || body.alertEmail || body.googleEmailDefault || "");
    }
    if (b.ok) setIntegrations(((await b.json()) as { integrations: Integration[] }).integrations);
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (toasted.current) return;
    if (params.get("connected") === "google") {
      toasted.current = true;
      void fetch("/api/integrations")
        .then((r) => r.json() as Promise<{ googleEmail: string | null }>)
        .then((b) =>
          push({
            title: `Google connected — alerts will arrive at ${b.googleEmail ?? "your Google account"}.`,
          }),
        );
    }
    const g = params.get("google");
    if (g) {
      toasted.current = true;
      push({ kind: "error", title: PARAM_MESSAGES[g] ?? "Google connection failed." });
    }
    if (params.get("admin") === "required") {
      toasted.current = true;
      push({ kind: "info", title: "Enter the admin passcode below first." });
    }
  }, [params, push]);

  async function patch(body: Record<string, unknown>, okTitle: string) {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      push({ title: okTitle });
      void load();
    } else {
      const b = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
      push({ kind: "error", title: "Couldn't save", description: b?.error?.message });
    }
  }

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    if (res.ok) {
      setPasscode("");
      push({ title: "Unlocked" });
      void load();
    } else push({ kind: "error", title: "That passcode didn't match." });
  }

  async function testAlert() {
    setBusy("test");
    try {
      const res = await fetch("/api/settings/test-alert", { method: "POST" });
      const b = (await res.json()) as { to?: string; error?: { message: string } };
      if (res.ok)
        push({ title: "Alert email sent", description: `Check ${b.to ?? "your inbox"}.` });
      else push({ kind: "error", title: "Couldn't send the test", description: b.error?.message });
    } finally {
      setBusy(null);
    }
  }

  async function dataAction(action: "clear_samples" | "reset_artists") {
    setBusy(action);
    try {
      const res = await fetch("/api/settings/data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok)
        push({
          title: action === "clear_samples" ? "Sample data cleared" : "Starter artists restored",
        });
      else
        push({
          kind: "error",
          title: "Needs the admin passcode",
          description: "Enter it above, then try again.",
        });
    } finally {
      setBusy(null);
    }
  }

  async function disconnectGoogle() {
    const res = await fetch("/api/auth/google/disconnect", { method: "POST" });
    if (res.ok) {
      push({ title: "Google disconnected" });
      void load();
    } else push({ kind: "error", title: "Needs the admin passcode" });
  }

  const locked = Boolean(s?.adminRequired && !s.adminUnlocked);
  const googleOn = integrations.find((i) => i.key === "googleOAuth")?.connected;

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-3xl font-bold">Settings</h1>

      {locked && (
        <form
          onSubmit={unlock}
          className="flex flex-wrap items-end gap-2 rounded-[18px] border border-line bg-surface p-4"
        >
          <label className="min-w-[200px] flex-1 text-sm font-medium">
            Admin passcode
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-[12px] border border-line bg-raised px-3 text-base"
              autoComplete="current-password"
            />
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-[12px] bg-stage px-4 font-medium text-stage-ink"
          >
            Unlock
          </button>
          <p className="w-full text-xs text-muted">
            Only needed once to change alert settings, connections or delete data. Browsing and “I’m
            going” never need it.
          </p>
        </form>
      )}

      <section aria-labelledby="alerts" className="space-y-3">
        <h2 id="alerts" className="text-xl font-semibold">
          Alerts
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void patch({ alert_email: email.trim() }, "Alert email saved");
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="min-w-[220px] flex-1 text-sm font-medium">
            Send alerts to
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@gmail.com"
              className="mt-1 min-h-11 w-full rounded-[12px] border border-line bg-surface px-3 text-base"
            />
          </label>
          <button
            type="submit"
            disabled={locked}
            className="min-h-11 rounded-[12px] border border-line px-4 font-medium hover:bg-surface disabled:opacity-50"
          >
            Save
          </button>
        </form>
        <div className="flex items-center justify-between gap-4 rounded-[14px] border border-line bg-surface p-4">
          <label htmlFor="email-switch" className="text-sm">
            <span className="block font-medium">Email alerts</span>
            <span className="text-muted">
              One email per check, with Bengaluru and early-bird items first.
            </span>
          </label>
          <Switch.Root
            id="email-switch"
            checked={s?.emailAlertsEnabled ?? true}
            disabled={locked}
            onCheckedChange={(v) =>
              void patch({ email_alerts_enabled: v }, v ? "Email alerts on" : "Email alerts off")
            }
            className="relative h-7 w-12 shrink-0 rounded-full bg-raised data-[state=checked]:bg-stage disabled:opacity-50"
          >
            <Switch.Thumb className="block h-6 w-6 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[22px]" />
          </Switch.Root>
        </div>
        <div>
          <button
            type="button"
            onClick={() => void testAlert()}
            disabled={busy === "test"}
            className="min-h-11 rounded-[12px] bg-stage px-4 font-medium text-stage-ink disabled:opacity-60"
          >
            {busy === "test" ? "Sending…" : "Send me a test alert"}
          </button>
          {!googleOn && (
            <p className="mt-1 text-sm text-muted">Connect Google to get email alerts.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="home" className="space-y-2">
        <h2 id="home" className="text-xl font-semibold">
          Home city
        </h2>
        <label className="block text-sm">
          <span className="sr-only">Home city</span>
          <select
            value={s?.homeCity ?? "Bengaluru"}
            disabled={locked}
            onChange={(e) =>
              void patch({ home_city: e.target.value }, `Home city set to ${e.target.value}`)
            }
            className="min-h-11 rounded-[12px] border border-line bg-surface px-3 text-base disabled:opacity-50"
          >
            {(s?.cities ?? ["Bengaluru"]).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <p className="text-sm text-muted">Shows here get their own lane and rank higher.</p>
      </section>

      <section aria-labelledby="conn" className="space-y-3">
        <h2 id="conn" className="text-xl font-semibold">
          Connections
        </h2>
        <ul className="space-y-2">
          {integrations.map((i) => {
            const noKey = NO_KEY.has(i.key);
            const needs = i.needsReconnect;
            const chip = needs
              ? { text: "Needs reconnect", tone: "urgent" as const }
              : i.connected || (i.configured && i.key !== "googleOAuth" && i.key !== "spotify")
                ? { text: noKey ? "No key needed" : "Connected", tone: "confirmed" as const }
                : { text: "Not connected", tone: "muted" as const };
            return (
              <li
                key={i.key}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] border border-line bg-surface p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {i.label}
                    <Chip tone={chip.tone}>{chip.text}</Chip>
                  </p>
                  <p className="text-sm text-muted">
                    {i.purpose}
                    {i.key === "googleOAuth" && s?.googleEmailMasked
                      ? ` Connected as ${s.googleEmailMasked}.`
                      : ""}
                  </p>
                </div>
                <ConnAction i={i} onDisconnect={disconnectGoogle} locked={locked} />
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="data" className="space-y-2">
        <h2 id="data" className="text-xl font-semibold">
          Data
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void dataAction("clear_samples")}
            disabled={busy !== null}
            className="min-h-11 rounded-[12px] border border-line px-4 text-sm font-medium hover:bg-surface disabled:opacity-60"
          >
            Clear sample data
          </button>
          <button
            type="button"
            onClick={() => void dataAction("reset_artists")}
            disabled={busy !== null}
            className="min-h-11 rounded-[12px] border border-line px-4 text-sm font-medium hover:bg-surface disabled:opacity-60"
          >
            Reset artists to the starter list
          </button>
        </div>
        <p className="text-sm text-muted">
          Resetting only adds back missing starter artists. Nothing you added is removed.
        </p>
      </section>

      <section aria-labelledby="look" className="space-y-2">
        <h2 id="look" className="text-xl font-semibold">
          Appearance
        </h2>
        <div className="flex items-center gap-2 text-sm text-muted">
          <ThemeToggle /> Switch between the dark and light theme.
        </div>
      </section>
    </div>
  );
}

function ConnAction({
  i,
  onDisconnect,
  locked,
}: {
  i: Integration;
  onDisconnect: () => void;
  locked: boolean;
}) {
  const btn =
    "inline-flex min-h-10 items-center rounded-[12px] border border-line px-3.5 text-sm font-medium hover:bg-raised";
  if (i.key === "googleOAuth") {
    if (!i.configured) {
      return (
        <div className="text-right">
          <a
            href={setupDocUrl(i.setupDocAnchor)}
            target="_blank"
            rel="noopener noreferrer"
            className={btn}
          >
            How to set up
          </a>
          <p className="mt-1 max-w-[260px] text-xs text-muted">
            Needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY.
          </p>
        </div>
      );
    }
    if (i.needsReconnect)
      return (
        <a href="/api/auth/google/start" className={`${btn} bg-stage text-stage-ink`}>
          Reconnect Google
        </a>
      );
    if (i.connected) {
      return (
        <button
          type="button"
          onClick={onDisconnect}
          disabled={locked}
          className={`${btn} disabled:opacity-50`}
        >
          Disconnect
        </button>
      );
    }
    return (
      <a href="/api/auth/google/start" className={`${btn} bg-stage text-stage-ink`}>
        Connect Google
      </a>
    );
  }
  if (i.key === "spotify" && i.configured) {
    return (
      <a href="/api/auth/spotify/start" className={btn}>
        Connect
      </a>
    );
  }
  if (!i.configured) {
    return (
      <a
        href={setupDocUrl(i.setupDocAnchor)}
        target="_blank"
        rel="noopener noreferrer"
        className={btn}
      >
        How to set up
      </a>
    );
  }
  return null;
}

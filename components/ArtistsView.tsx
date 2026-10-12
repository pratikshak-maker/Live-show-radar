"use client";

import { RefreshCw, Search, Star, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { Chip } from "./Chips";
import { ImportLastfm } from "./ImportLastfm";
import { useScan } from "./ScanProvider";
import { useToast } from "./ToastProvider";
import { relativeAgo } from "@/lib/time";
import type { ArtistRow } from "@/lib/types";

export type ArtistItem = ArtistRow & { show_count: number };
type Suggestion = { mbid: string; name: string; disambiguation: string | null; country: string | null };

const FILTERS = ["All", "Favorites", "Has shows", "India", "International"] as const;
type Filter = (typeof FILTERS)[number];

export function ArtistsView({
  initial,
  lastfmEnabled,
  spotifyEnabled,
}: {
  initial: ArtistItem[];
  lastfmEnabled: boolean;
  spotifyEnabled: boolean;
}) {
  const params = useSearchParams();
  const { push } = useToast();
  const { startScan, running, scanningArtistId, logs } = useScan();
  const [artists, setArtists] = useState(initial);
  const [filter, setFilter] = useState<Filter>("All");
  const [q, setQ] = useState("");

  // Server data changes after scans / router.refresh()
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setArtists(initial);
  }

  // Spotify redirect result toast (runs once per param set)
  const toasted = useRef(false);
  useEffect(() => {
    const s = params.get("spotify");
    if (!s || toasted.current) return;
    toasted.current = true;
    const msg: Record<string, string> = {
      ok: `Imported ${params.get("added") ?? 0} artists from Spotify.`,
      denied: "Spotify connection was cancelled.",
      not_allowed: "Spotify only allows accounts added by the app owner to connect.",
      bad_state: "That Spotify sign-in expired. Please try again.",
      error: "Couldn't reach Spotify. Please try again.",
      not_configured: "Spotify isn't set up yet.",
    };
    push({ title: msg[s] ?? "Spotify", kind: s === "ok" ? "success" : "info" });
  }, [params, push]);

  const reload = useCallback(async () => {
    const res = await fetch("/api/artists", { cache: "no-store" });
    if (res.ok) setArtists(((await res.json()) as { artists: ArtistItem[] }).artists);
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return artists.filter((a) => {
      if (needle && !a.name.toLowerCase().includes(needle)) return false;
      switch (filter) {
        case "Favorites":
          return a.is_favorite;
        case "Has shows":
          return a.show_count > 0;
        case "India":
          return a.origin === "india";
        case "International":
          return a.origin === "international";
        default:
          return true;
      }
    });
  }, [artists, filter, q]);

  async function patch(id: string, body: { is_favorite?: boolean; is_active?: boolean }) {
    await fetch("/api/artists", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
  }

  function toggleFavorite(a: ArtistItem) {
    setArtists((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_favorite: !x.is_favorite } : x)));
    void patch(a.id, { is_favorite: !a.is_favorite });
  }

  function remove(a: ArtistItem) {
    setArtists((prev) => prev.filter((x) => x.id !== a.id));
    void patch(a.id, { is_active: false });
    push({
      title: `Removed ${a.name}`,
      action: {
        label: "Undo",
        onClick: () => {
          void patch(a.id, { is_active: true }).then(reload);
        },
      },
    });
  }

  async function onAdded(a: ArtistItem, created: boolean) {
    await reload();
    if (!created) {
      push({ title: `${a.name} is already on your list`, kind: "info" });
      return;
    }
    push({ title: `Added ${a.name}.`, description: "Checking for India shows…" });
    void startScan(a.id);
  }

  const lastLog = logs.length > 0 ? logs[logs.length - 1].message : "Checking for India shows…";

  return (
    <div>
      <h1 className="text-3xl font-bold">Artists</h1>
      <p className="mt-1 text-muted">The radar watches these artists for any announcement in India.</p>

      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-start">
        <AddArtistBar onAdded={onAdded} />
        <div className="flex flex-wrap gap-2">
          {lastfmEnabled && <ImportLastfm onDone={reload} />}
          {spotifyEnabled && (
            <a
              href="/api/auth/spotify/start"
              className="inline-flex min-h-11 items-center rounded-[12px] border border-line px-4 text-sm font-medium hover:bg-surface"
            >
              Connect Spotify
            </a>
          )}
        </div>
      </div>
      {spotifyEnabled && (
        <p className="mt-2 text-xs text-muted">
          Spotify only allows accounts added by the app owner to connect. Everyone else can add
          artists by name or import from Last.fm.
        </p>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Filter artists" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`min-h-10 rounded-full px-3.5 text-sm font-medium ${
                filter === f ? "bg-stage text-stage-ink" : "bg-surface text-muted hover:text-ink"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <label className="relative block sm:w-64">
          <span className="sr-only">Search your artists</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search artists…"
            className="min-h-11 w-full rounded-[12px] border border-line bg-surface pl-9 pr-3 text-sm placeholder:text-muted"
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="mt-10 text-center text-muted">
          {artists.length === 0
            ? "No artists yet. Add one above and the radar starts watching right away."
            : "No artists match that filter."}
        </p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((a) => {
            const scanning = running && scanningArtistId === a.id;
            return (
              <li key={a.id} className="rounded-[18px] border border-line bg-surface p-4">
                <div className="flex gap-3">
                  <Avatar name={a.name} src={a.image_url} size={52} />
                  <div className="min-w-0 flex-1">
                    <p className="artist-name truncate text-lg leading-tight">{a.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {a.origin !== "unknown" && (
                        <Chip>{a.origin === "india" ? "India" : "International"}</Chip>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <button
                      type="button"
                      onClick={() => toggleFavorite(a)}
                      aria-pressed={a.is_favorite}
                      aria-label={a.is_favorite ? `Unfavorite ${a.name}` : `Favorite ${a.name}`}
                      title="Favorites are checked more often and ranked higher"
                      className="grid h-10 w-10 place-items-center rounded-[10px] hover:bg-raised"
                    >
                      <Star className={`h-5 w-5 ${a.is_favorite ? "fill-urgent text-urgent" : "text-muted"}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void startScan(a.id)}
                      disabled={running}
                      aria-label={`Check ${a.name} now`}
                      title="Check now"
                      className="grid h-10 w-10 place-items-center rounded-[10px] hover:bg-raised disabled:opacity-50"
                    >
                      <RefreshCw className={`h-4 w-4 text-muted ${scanning ? "animate-spin" : ""}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(a)}
                      aria-label={`Remove ${a.name}`}
                      className="grid h-10 w-10 place-items-center rounded-[10px] hover:bg-raised"
                    >
                      <X className="h-4 w-4 text-muted" />
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-sm" aria-live="polite">
                  {scanning ? (
                    <span className="text-muted">{lastLog}</span>
                  ) : a.last_scan_status === "error" ? (
                    <button type="button" onClick={() => void startScan(a.id)} className="text-urgent underline underline-offset-2">
                      Couldn&apos;t check — retry
                    </button>
                  ) : a.show_count > 0 ? (
                    <span className="font-medium text-confirmed">
                      {a.show_count} show{a.show_count === 1 ? "" : "s"} in India
                    </span>
                  ) : a.last_scanned_at ? (
                    <span className="text-muted">No India shows yet</span>
                  ) : (
                    <span className="text-muted">Not checked yet</span>
                  )}
                  <span className="text-muted"> · checked {relativeAgo(a.last_scanned_at)}</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AddArtistBar({ onAdded }: { onAdded: (a: ArtistItem, created: boolean) => void }) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  const visible = text.trim().length >= 2 ? results : [];

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/artists/search?q=${encodeURIComponent(q)}`);
        if (!res.ok || mine !== seq.current) return;
        const body = (await res.json()) as { results: Suggestion[] };
        setResults(body.results);
        setOpen(true);
        setActive(-1);
      } catch {
        /* ignore */
      }
    }, 350);
    return () => clearTimeout(t);
  }, [text]);

  async function add(s: { name: string; mbid?: string; disambiguation?: string | null; country?: string | null }) {
    setBusy(true);
    setOpen(false);
    try {
      const res = await fetch("/api/artists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(s),
      });
      if (res.ok) {
        const body = (await res.json()) as { artist: ArtistItem; created: boolean };
        setText("");
        setResults([]);
        onAdded(body.artist, body.created);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex-1">
      <label className="block">
        <span className="sr-only">Add an artist by name</span>
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls="artist-suggestions"
          aria-autocomplete="list"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => visible.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, visible.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const pick = visible[active];
              if (pick) void add(pick);
              else if (text.trim().length >= 2) void add({ name: text.trim() });
            } else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Add an artist by name…"
          disabled={busy}
          className="min-h-11 w-full rounded-[12px] border border-line bg-surface px-4 text-base placeholder:text-muted"
        />
      </label>
      {open && visible.length > 0 && (
        <ul
          id="artist-suggestions"
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-[14px] border border-line bg-raised p-1"
        >
          {visible.map((r, i) => (
            <li key={r.mbid} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void add(r)}
                className={`flex min-h-11 w-full flex-col rounded-[10px] px-3 py-1.5 text-left hover:bg-surface ${i === active ? "bg-surface" : ""}`}
              >
                <span className="font-medium">{r.name}</span>
                <span className="text-xs text-muted">
                  {[r.disambiguation, r.country].filter(Boolean).join(" · ") || "Artist"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
